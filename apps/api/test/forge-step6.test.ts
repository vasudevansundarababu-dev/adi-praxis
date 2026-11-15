import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WAVE1_PROFILES } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { verifyPassword } from '../src/auth/password';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { sha256 } from '../src/lib/crypto';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const GOOD = 'a-long-enough-passphrase-42';

describe('MVP1 step 6: candidate sign-in modes (Offline and Online)', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const email = new MemoryEmailSender();
  let clientId: string;
  let admin: string;
  let pm: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const pub = (url: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload });
  const setMode = async (candidateSignIn: 'OFFLINE' | 'ONLINE') => expect((await call(app, 'PUT', admin, '/admin/forge-settings', { candidateSignIn })).statusCode).toBe(200);

  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email, embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    email.sent.length = 0;
    email.failNext = 0;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    await setFlow(true);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function project(route: 'SME_PM' | 'SME_EXPERT_PM' = 'SME_PM') {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const tpl = (
      await post(admin, '/templates', {
        domainId,
        workflowName: PROFILE.catalogWorkflowName,
        primaryWork: 'Author a realistic synthetic case with its reference solution and rubric.',
        verificationCriteria: 'Evidence, reference and rubric are consistent.',
        humanGate: 'A reviewer approves every task; the agent only recommends.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${tpl.id}/publish`)).statusCode).toBe(200);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: route, templateId: tpl.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    return p.id as string;
  }
  const openTasks = async (projectId: string) => (await db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } })).filter((t) => t.status === 'CREATED' && !t.assignedToId);
  const audits = (action: string) => db.auditEvent.findMany({ where: { clientId, action }, orderBy: { createdAt: 'asc' } });
  const tokenFrom = (i: number) => email.sent[i]!.text.match(/\/set-password\/(\S+)/)![1]!;

  /** Sourced and assigned (as SME) by the PM. Returns the sourced person, task and account. */
  async function assigned(pid: string, mail: string) {
    const s = await source(pid, 'SME', { email: mail, first: 'Ada', last: 'Author' });
    const t = (await openTasks(pid))[0]!;
    const r = await assign(pid, s.id, t.id);
    expect(r.statusCode, r.body).toBe(200);
    const smeUserId = (await db.sourcedPerson.findUniqueOrThrow({ where: { id: s.id } })).smeUserId!;
    return { sourcedPersonId: s.id, taskId: t.id, smeUserId };
  }
  const setPassword = (token: string, password: string) => pub('/auth/password/set', { token, password });
  const signInPassword = (mail: string, password: string, adultAttested?: boolean) => pub('/auth/password', { email: mail, password, ...(adultAttested === undefined ? {} : { adultAttested }) });

  // ── Mode enforcement ──
  describe('mode enforcement', () => {
    it('Offline: the mock Google sign-in works; the password routes answer 409 SIGN_IN_MODE (forgot is always 202)', async () => {
      await signIn('offline.person@gmail.test');
      for (const [url, body] of [['/auth/password', { email: 'offline.person@gmail.test', password: GOOD, adultAttested: true }], ['/auth/password/set', { token: 'x'.repeat(40), password: GOOD }]] as const) {
        const r = await pub(url, body);
        expect(r.statusCode).toBe(409);
        expect(r.json().error).toBe('SIGN_IN_MODE');
      }
      expect((await pub('/auth/password/forgot', { email: 'offline.person@gmail.test' })).statusCode).toBe(202);
      expect(email.sent).toHaveLength(0);
    });

    it('Online: Google sign-in answers 409 SIGN_IN_MODE pointing to email and password', async () => {
      await setMode('ONLINE');
      const r = await pub('/auth/google', { credential: google.mint({ subject: 'mock-x@gmail.test', email: 'x@gmail.test', name: 'X' }), adultAttested: true });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'SIGN_IN_MODE', message: expect.stringMatching(/email and password/) });
      expect(await db.smeUser.count({ where: { contactEmail: 'x@gmail.test' } })).toBe(0);
    });

    it('new flow off: Google sign-in is unchanged and every password route but forgot is 409, whatever the mode', async () => {
      await setMode('ONLINE');
      await setFlow(false);
      const me = await signIn('legacy.person@gmail.test');
      expect(me.smeUserId).toBeTruthy();
      expect((await signInPassword('legacy.person@gmail.test', GOOD, true)).json().error).toBe('SIGN_IN_MODE');
      expect((await setPassword('y'.repeat(40), GOOD)).json().error).toBe('SIGN_IN_MODE');
      expect((await pub('/auth/password/forgot', { email: 'legacy.person@gmail.test' })).statusCode).toBe(202);
      expect(email.sent).toHaveLength(0);
    });
  });

  // ── Set-your-password link on direct assignment ──
  describe('set-password link', () => {
    it('Online: a direct assignment emails a one-time link (only its hash stored), once; never the password', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, 'new.author@gmail.test');
      expect(email.sent).toHaveLength(1);
      const m = email.sent[0]!;
      expect(m.to).toBe('new.author@gmail.test');
      expect(m.subject).toBe('Your ADI Forge account');
      expect(m.text).toMatch(/http:\/\/localhost:3101\/set-password\/\S{20,}/);
      expect(m.text).toMatch(/expires in 72 hours/);
      expect(m.text).toMatch(/new\.author@gmail\.test/);
      expect(m.text).toMatch(/Never reply to this email with a password/);
      expect(`${m.subject}\n${m.text}`).not.toMatch(/Praxis|Anvil|ADI-Labs/);
      const token = tokenFrom(0);
      const rows = await db.candidatePasswordToken.findMany({ where: { smeUserId: a.smeUserId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ purpose: 'set', tokenHash: sha256(token), usedAt: null });
      expect(rows[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000);
      expect(JSON.stringify(rows)).not.toContain(token);
      const au = await audits('candidate.password_link_sent');
      expect(au).toHaveLength(1);
      expect(JSON.stringify(au)).not.toMatch(/new\.author|Ada|set-password/);

      // A second task for the same person: no second link while the first is live.
      const t2 = (await openTasks(pid))[0]!;
      expect((await assign(pid, a.sourcedPersonId, t2.id)).statusCode).toBe(200);
      expect(email.sent).toHaveLength(1);
    });

    it('Online: a Reviewer gets the link too', async () => {
      await setMode('ONLINE');
      const pid = await project('SME_EXPERT_PM');
      const a = await assigned(pid, 'author.two@gmail.test');
      const r = await source(pid, 'REVIEWER', { email: 'rev.one@gmail.test', first: 'Rita', last: 'Reviewer' });
      expect((await assign(pid, r.id, a.taskId)).statusCode).toBe(200);
      expect(email.sent.map((m) => m.to)).toEqual(['author.two@gmail.test', 'rev.one@gmail.test']);
    });

    it('Offline: no email on assignment', async () => {
      const pid = await project();
      await assigned(pid, 'quiet.author@gmail.test');
      expect(email.sent).toHaveLength(0);
      expect(await db.candidatePasswordToken.count()).toBe(0);
    });

    it('a failed email undoes the assignment (the email goes in the same command)', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const s = await source(pid, 'SME', { email: 'fail.author@gmail.test' });
      const t = (await openTasks(pid))[0]!;
      email.failNext = 1;
      expect((await assign(pid, s.id, t.id)).statusCode).toBe(500);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } })).assignedToId).toBeNull();
      expect(await db.candidatePasswordToken.count()).toBe(0);
    });

    it('resend replaces the old link; only ADMIN or the owning PM; 409 in Offline', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, 'resend.author@gmail.test');
      const old = tokenFrom(0);
      const r = await post(pm, `/projects/${pid}/people/${a.sourcedPersonId}/password-link`);
      expect(r.statusCode, r.body).toBe(200);
      expect(email.sent).toHaveLength(2);
      const fresh = tokenFrom(1);
      expect(fresh).not.toBe(old);
      expect(await db.candidatePasswordToken.count({ where: { smeUserId: a.smeUserId } })).toBe(1);
      expect((await setPassword(old, GOOD)).json().error).toBe('LINK_INVALID');
      expect((await setPassword(fresh, GOOD)).statusCode).toBe(200);
      expect((await audits('candidate.password_link_sent')).at(-1)!.after).toMatchObject({ replaced: 1, onAssign: false });

      const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
      expect((await post(otherPm, `/projects/${pid}/people/${a.sourcedPersonId}/password-link`)).statusCode).toBe(404);
      expect((await post(admin, `/projects/${pid}/people/${a.sourcedPersonId}/password-link`)).statusCode).toBe(200);
      await setMode('OFFLINE');
      expect((await post(admin, `/projects/${pid}/people/${a.sourcedPersonId}/password-link`)).json().error).toBe('SIGN_IN_MODE');
    });

    it('resend refuses a person who is not assigned', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const s = await source(pid, 'SME', { email: 'unassigned@gmail.test' });
      const r = await post(pm, `/projects/${pid}/people/${s.id}/password-link`);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('NOT_ASSIGNED');
    });
  });

  // ── Set password ──
  describe('set password', () => {
    it('refuses weak passwords and the email name, then sets once; a used or expired link is LINK_INVALID', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, 'grace.hopper@gmail.test');
      const token = tokenFrom(0);
      const short = await setPassword(token, 'short-one');
      expect(short.statusCode).toBe(400);
      expect(short.json().error).toBe('WEAK_PASSWORD');
      const named = await setPassword(token, 'my-Grace.Hopper-pass');
      expect(named.statusCode).toBe(400);
      expect(named.json().error).toBe('WEAK_PASSWORD');
      expect(named.json().message).toMatch(/email address/);

      const ok = await setPassword(token, GOOD);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toEqual({ ok: true });
      expect(ok.cookies.find((c) => c.name === 'praxis_candidate')).toBeUndefined();
      const cred = await db.candidateCredential.findUniqueOrThrow({ where: { smeUserId: a.smeUserId } });
      expect(cred.passwordHash).not.toContain(GOOD);
      expect(await verifyPassword(cred.passwordHash, GOOD)).toBe(true);
      const au = await audits('candidate.password_set');
      expect(au).toHaveLength(1);
      expect(au[0]!.after).toMatchObject({ purpose: 'set' });
      expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(GOOD);

      const reuse = await setPassword(token, 'another-long-passphrase');
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().error).toBe('LINK_INVALID');
      const unknown = await setPassword('z'.repeat(43), GOOD);
      expect(unknown.json()).toEqual(expect.objectContaining({ error: 'LINK_INVALID', message: reuse.json().message }));

      // A later assignment does not send another link: the person has a password.
      const t2 = (await openTasks(pid))[0]!;
      expect((await assign(pid, a.sourcedPersonId, t2.id)).statusCode).toBe(200);
      expect(email.sent).toHaveLength(1);
    });

    it('an expired link is LINK_INVALID', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, 'late.author@gmail.test');
      await db.candidatePasswordToken.updateMany({ where: { smeUserId: a.smeUserId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const r = await setPassword(tokenFrom(0), GOOD);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('LINK_INVALID');
      // With the link expired, the next assignment sends a fresh one.
      const t2 = (await openTasks(pid))[0]!;
      expect((await assign(pid, a.sourcedPersonId, t2.id)).statusCode).toBe(200);
      expect(email.sent).toHaveLength(2);
    });
  });

  // ── Password sign-in ──
  describe('password sign-in', () => {
    async function withPassword(mail: string) {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, mail);
      expect((await setPassword(tokenFrom(email.sent.length - 1), GOOD)).statusCode).toBe(200);
      return a;
    }

    it('signs in with a cookie and the same account DTO; the 18+ confirmation is needed the first time only', async () => {
      const a = await withPassword('signin.author@gmail.test');
      const noAdult = await signInPassword('signin.author@gmail.test', GOOD);
      expect(noAdult.statusCode).toBe(400);
      expect(noAdult.json().error).toBe('ADULT_ATTESTATION_REQUIRED');

      const r = await signInPassword('Signin.Author@Gmail.test', GOOD, true);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ id: a.smeUserId, contactEmail: 'signin.author@gmail.test', accountStatus: 'ACTIVE' });
      const cookie = r.cookies.find((c) => c.name === 'praxis_candidate')!;
      expect(cookie.httpOnly).toBe(true);
      expect((await db.smeUser.findUniqueOrThrow({ where: { id: a.smeUserId } })).adultAttestedAt).not.toBeNull();
      const me = await call(app, 'GET', `praxis_candidate=${cookie.value}`, '/me');
      expect(me.json().id).toBe(a.smeUserId);
      const au = await audits('candidate.signed_in_password');
      expect(au).toHaveLength(1);
      expect(au[0]).toMatchObject({ actorType: 'CANDIDATE', actorId: a.smeUserId, entityId: a.smeUserId });
      expect(JSON.stringify(au)).not.toMatch(/signin\.author|a-long-enough/);

      // Later sign-ins need no confirmation.
      expect((await signInPassword('signin.author@gmail.test', GOOD)).statusCode).toBe(200);
    });

    it('a wrong password and an unknown email give the same 401 body', async () => {
      await withPassword('known.author@gmail.test');
      const wrong = await signInPassword('known.author@gmail.test', 'not-the-right-passphrase', true);
      const unknown = await signInPassword('nobody.here@gmail.test', GOOD, true);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      const strip = (b: Record<string, unknown>) => ({ error: b.error, message: b.message });
      expect(strip(wrong.json())).toEqual(strip(unknown.json()));
      expect(wrong.json().error).toBe('INVALID_CREDENTIALS');
    });

    it('an assigned person with no password yet cannot sign in (401); an inactive account is refused', async () => {
      await setMode('ONLINE');
      const pid = await project();
      await assigned(pid, 'nopass.author@gmail.test');
      expect((await signInPassword('nopass.author@gmail.test', GOOD, true)).statusCode).toBe(401);

      const b = await withPassword('suspended.author@gmail.test');
      await db.smeUser.update({ where: { id: b.smeUserId }, data: { accountStatus: 'SUSPENDED' } });
      expect((await signInPassword('suspended.author@gmail.test', GOOD, true)).statusCode).toBe(403);
    });

    it('setting a password signs out the person\'s other candidate sessions', async () => {
      const a = await withPassword('sessions.author@gmail.test');
      const r = await signInPassword('sessions.author@gmail.test', GOOD, true);
      const cookie = `praxis_candidate=${r.cookies.find((c) => c.name === 'praxis_candidate')!.value}`;
      expect((await call(app, 'GET', cookie, '/me')).statusCode).toBe(200);
      expect((await pub('/auth/password/forgot', { email: 'sessions.author@gmail.test' })).statusCode).toBe(202);
      expect((await setPassword(tokenFrom(email.sent.length - 1), 'a-brand-new-passphrase')).statusCode).toBe(200);
      expect((await call(app, 'GET', cookie, '/me')).statusCode).toBe(401);
      expect((await signInPassword('sessions.author@gmail.test', GOOD)).statusCode).toBe(401);
      expect((await signInPassword('sessions.author@gmail.test', 'a-brand-new-passphrase')).json().id).toBe(a.smeUserId);
    });
  });

  // ── Forgot password ──
  describe('forgot password', () => {
    it('always 202; emails a reset link only for a known assigned person; the link works once and expires in an hour', async () => {
      await setMode('ONLINE');
      const pid = await project();
      const a = await assigned(pid, 'forgot.author@gmail.test');
      const s = await source(pid, 'SME', { email: 'sourced.only@gmail.test' });
      expect(s.id).toBeTruthy();
      const before = email.sent.length;

      for (const mail of ['nobody@gmail.test', 'sourced.only@gmail.test', 'not-an-email']) {
        const r = await pub('/auth/password/forgot', { email: mail });
        expect(r.statusCode).toBe(202);
        expect(r.json()).toEqual({ ok: true });
      }
      expect(email.sent).toHaveLength(before);
      expect(await audits('candidate.password_reset_requested')).toHaveLength(0);

      const r = await pub('/auth/password/forgot', { email: 'Forgot.Author@gmail.test' });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ ok: true });
      expect(email.sent).toHaveLength(before + 1);
      const m = email.sent.at(-1)!;
      expect(m.to).toBe('forgot.author@gmail.test');
      expect(m.text).toMatch(/expires in 1 hour/);
      expect(`${m.subject}\n${m.text}`).not.toMatch(/Praxis|Anvil|ADI-Labs/);
      const token = tokenFrom(email.sent.length - 1);
      const row = await db.candidatePasswordToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
      expect(row.purpose).toBe('reset');
      expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
      const au = await audits('candidate.password_reset_requested');
      expect(au).toHaveLength(1);
      expect(au[0]!.entityId).toBe(a.smeUserId);
      expect(JSON.stringify(au)).not.toMatch(/forgot\.author/);

      expect((await setPassword(token, GOOD)).statusCode).toBe(200);
      expect((await setPassword(token, 'another-long-passphrase')).json().error).toBe('LINK_INVALID');
      expect((await audits('candidate.password_set')).at(-1)!.after).toMatchObject({ purpose: 'reset' });
      expect((await signInPassword('forgot.author@gmail.test', GOOD, true)).statusCode).toBe(200);
    });

    it('a failed email still answers 202', async () => {
      await setMode('ONLINE');
      const pid = await project();
      await assigned(pid, 'flaky.author@gmail.test');
      email.failNext = 1;
      expect((await pub('/auth/password/forgot', { email: 'flaky.author@gmail.test' })).statusCode).toBe(202);
      expect(await db.candidatePasswordToken.count({ where: { purpose: 'reset' } })).toBe(0);
    });
  });
});
