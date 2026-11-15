import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProfileOutput, WAVE1_PROFILES } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier, type GoogleIdentity } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { acceptForgeTerms, placeholderTermsRefused } from '../src/forge/candidate';
import { sha256 } from '../src/lib/crypto';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
type Route = 'SME_PM' | 'SME_EXPERT_PM';
type Sme = { smeUserId: string; cookie: string };

/** The mock sign-in, except that a subject starting `unverified-` comes back with an unverified email. */
class TestGoogle extends MockGoogleVerifier {
  override async verify(credential: string): Promise<GoogleIdentity> {
    const g = await super.verify(credential);
    return g.subject.startsWith('unverified-') ? { ...g, emailVerified: false } : g;
  }
}

describe('MVP1 step 3: candidate app (account claim, Before you start, Home)', () => {
  let app: FastifyInstance;
  const google = new TestGoogle(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  const { setFlow, source, signIn, acceptTerms, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
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

  async function project(route: Route = 'SME_PM') {
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

  const tasksOf = (projectId: string) => db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
  const fixedTask = async (projectId: string) => (await tasksOf(projectId)).find((t) => !t.slot?.isOpen && t.status === 'CREATED')!;
  const anyTask = async (projectId: string) => (await tasksOf(projectId)).find((t) => t.status === 'CREATED')!;
  const audits = (action: string) => db.auditEvent.findMany({ where: { clientId, action }, orderBy: { createdAt: 'asc' } });
  const home = async (a: Sme) => {
    const r = await get(a.cookie, '/me/forge/home');
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const meTask = async (a: Sme, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();
  async function saveAndSubmit(a: Sme, id: string) {
    const s = await put(a.cookie, `/me/tasks/${id}`, { output: sampleProfileOutput(PROFILE), activeSecondsDelta: 10, expectedRevision: (await meTask(a, id)).revision });
    expect(s.statusCode, s.body).toBe(200);
    const sub = await post(a.cookie, `/me/tasks/${id}/submit`, { expectedRevision: (await meTask(a, id)).revision, syntheticDeclaration: true, flagExplanations: {} });
    expect(sub.statusCode, sub.body).toBe(200);
  }

  /** Sourced and assigned by the PM before the person ever signs in: the account is pre-created with no identity. */
  async function preAssigned(pid: string, email: string) {
    const s = await source(pid, 'SME', { email, first: 'Ada', last: 'Author' });
    const t = await fixedTask(pid);
    expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
    const smeUserId = (await db.sourcedPerson.findUniqueOrThrow({ where: { id: s.id } })).smeUserId!;
    expect(await db.providerIdentity.count({ where: { smeUserId } })).toBe(0);
    return { sourcedPersonId: s.id, taskId: t.id, smeUserId };
  }

  // ── Public settings ──

  it('GET /public/forge-settings needs no sign-in and follows the Admin switch', async () => {
    const on = await app.inject({ method: 'GET', url: '/api/v1/public/forge-settings' });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ newFlow: true, candidateSignIn: 'OFFLINE' });
    await setFlow(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/forge-settings' })).json()).toEqual({ newFlow: false, candidateSignIn: 'OFFLINE' });
  });

  // ── Account claim ──

  describe('account claim at first sign-in', () => {
    it('links the first sign-in with the uploaded email to the pre-created account; the task is on Home', async () => {
      const pid = await project();
      const pre = await preAssigned(pid, 'ada.claim@gmail.test');
      await db.smeUser.update({ where: { id: pre.smeUserId }, data: { adultAttestedAt: null } });
      const me = await signIn('Ada.Claim@gmail.test', `google-${randomUUID()}`, 'Ada A.', { terms: false });
      expect(me.smeUserId).toBe(pre.smeUserId);
      expect(await db.providerIdentity.count({ where: { smeUserId: pre.smeUserId } })).toBe(1);
      expect((await db.smeUser.findUniqueOrThrow({ where: { id: pre.smeUserId } })).adultAttestedAt).not.toBeNull();
      const [claimed] = await audits('candidate.account_claimed');
      expect(claimed).toMatchObject({ entityId: pre.smeUserId, actorType: 'CANDIDATE' });
      expect(claimed!.after).toMatchObject({ created: false, sourcedPersonIds: [pre.sourcedPersonId] });
      expect(JSON.stringify(claimed!.after)).not.toMatch(/ada|gmail/i);
      expect(await audits('candidate.account_created')).toHaveLength(0);

      const h = await home(me);
      expect(h).toMatchObject({ newFlow: true, termsAccepted: false, name: 'Ada Author', reviewTasks: [] });
      expect(h.authorTasks).toEqual([{ taskId: pre.taskId, label: expect.any(String), projectName: expect.any(String), status: 'New', date: expect.any(String), reworkComments: 0 }]);
      // Later sign-ins use the same identity.
      const again = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: (await db.providerIdentity.findFirstOrThrow({ where: { smeUserId: pre.smeUserId } })).subject, email: 'ada.claim@gmail.test', name: 'Ada' }) } });
      expect(again.json().id).toBe(pre.smeUserId);
    });

    it('a sourced person with no account yet gets a new one, and every row with that email points at it', async () => {
      const p1 = await project();
      const p2 = await project();
      const a = await source(p1, 'SME', { email: 'two.projects@gmail.test' });
      const b = await source(p2, 'SME', { email: 'two.projects@gmail.test' });
      const me = await signIn('two.projects@gmail.test', `google-${randomUUID()}`, 'Two P', { terms: false });
      for (const id of [a.id, b.id]) expect((await db.sourcedPerson.findUniqueOrThrow({ where: { id } })).smeUserId).toBe(me.smeUserId);
      expect((await audits('candidate.account_claimed'))[0]!.after).toMatchObject({ created: true, sourcedPersonIds: [a.id, b.id] });
      // Assigning later uses that account.
      expect((await assign(p1, a.id, (await fixedTask(p1)).id)).statusCode).toBe(200);
      expect((await home(me)).authorTasks).toHaveLength(1);
    });

    it('does not claim on an unverified email, another email, or an account that already has a sign-in', async () => {
      const pid = await project();
      const pre = await preAssigned(pid, 'kept@gmail.test');
      const unverified = await signIn('kept@gmail.test', `unverified-${randomUUID()}`, 'X', { terms: false });
      expect(unverified.smeUserId).not.toBe(pre.smeUserId);
      const other = await signIn('someone.else@gmail.test', `google-${randomUUID()}`, 'Y', { terms: false });
      expect(other.smeUserId).not.toBe(pre.smeUserId);
      const owner = await signIn('kept@gmail.test', `google-${randomUUID()}`, 'Z', { terms: false });
      expect(owner.smeUserId).toBe(pre.smeUserId);
      // A second Google account with the same email never takes over the claimed one.
      const second = await signIn('kept@gmail.test', `google-${randomUUID()}`, 'Z2', { terms: false });
      expect(second.smeUserId).not.toBe(pre.smeUserId);
      expect(await db.providerIdentity.count({ where: { smeUserId: pre.smeUserId } })).toBe(1);
      expect(await audits('candidate.account_claimed')).toHaveLength(1);
    });

    it('with the new flow off, sign-in keeps creating a new account (never merge by email)', async () => {
      const pid = await project();
      const pre = await preAssigned(pid, 'off.flow@gmail.test');
      await setFlow(false);
      const me = await signIn('off.flow@gmail.test', `google-${randomUUID()}`, 'Off', { terms: false });
      expect(me.smeUserId).not.toBe(pre.smeUserId);
      expect(await audits('candidate.account_claimed')).toHaveLength(0);
      expect(await audits('candidate.account_created')).toHaveLength(1);
      expect((await home(me))).toMatchObject({ newFlow: false, authorTasks: [], reviewTasks: [] });
    });
  });

  // ── Terms ──

  describe('Before you start (terms)', () => {
    it('direct work needs the current terms; stale hashes are refused; accepting is idempotent and audited', async () => {
      const pid = await project();
      const pre = await preAssigned(pid, 'terms@gmail.test');
      const me = await signIn('terms@gmail.test', `google-${randomUUID()}`, 'T', { terms: false });
      const proj = await get(me.cookie, `/me/projects/${pid}`);
      expect(proj.statusCode).toBe(409);
      expect(proj.json().details).toMatchObject({ step: 'terms', href: '/welcome' });
      const save = await put(me.cookie, `/me/tasks/${pre.taskId}`, { output: { header: { title: 'x' } }, activeSecondsDelta: 1, expectedRevision: (await meTask(me, pre.taskId)).revision });
      expect(save.statusCode).toBe(409);
      expect(save.json().details.step).toBe('terms');

      const view = (await get(me.cookie, '/me/forge/terms')).json();
      expect(view.accepted).toBe(false);
      expect(view.terms.map((t: { key: string }) => t.key)).toEqual(['contributor', 'confidentiality_ip', 'data_use']);
      expect(view.terms[0]).toMatchObject({ title: expect.any(String), body: expect.any(String), version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), placeholder: true });
      const hashes = Object.fromEntries(view.terms.map((t: { key: string; sha256: string }) => [t.key, t.sha256]));
      const stale = await post(me.cookie, '/me/forge/terms', { hashes: { ...hashes, data_use: 'a'.repeat(64) }, syntheticOnly: true });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('TERMS_CHANGED');
      expect((await post(me.cookie, '/me/forge/terms', { hashes, syntheticOnly: false })).statusCode).toBe(400);
      expect((await post(me.cookie, '/me/forge/terms', { hashes: { contributor: hashes.contributor }, syntheticOnly: true })).statusCode).toBe(400);

      expect((await post(me.cookie, '/me/forge/terms', { hashes, syntheticOnly: true })).statusCode).toBe(200);
      expect((await post(me.cookie, '/me/forge/terms', { hashes, syntheticOnly: true })).statusCode).toBe(200);
      const consents = await db.consent.findMany({ where: { smeUserId: me.smeUserId } });
      expect(consents.map((c) => c.purpose).sort()).toEqual(['synthetic_data_only', 'terms:confidentiality_ip', 'terms:contributor', 'terms:data_use']);
      expect(consents.find((c) => c.purpose === 'terms:contributor')!.version).toBe(hashes.contributor);
      const accepted = await audits('candidate.terms_accepted');
      expect(accepted).toHaveLength(2);
      expect(accepted[1]!.after).toMatchObject({ alreadyAccepted: true, recorded: 0 });
      expect((await get(me.cookie, '/me/forge/terms')).json().accepted).toBe(true);
      expect((await home(me)).termsAccepted).toBe(true);
      expect((await get(me.cookie, `/me/projects/${pid}`)).statusCode).toBe(200);

      // A newly published version must be accepted again.
      const body = 'Contributor agreement, version 2.';
      await db.termsDocument.create({ data: { clientId, key: 'contributor', version: 2, title: 'Contributor agreement', body, sha256: sha256(body), placeholder: false } });
      expect((await get(me.cookie, `/me/projects/${pid}`)).json().details.step).toBe('terms');
      expect((await post(me.cookie, '/me/forge/terms', { hashes, syntheticOnly: true })).json().error).toBe('TERMS_CHANGED');
      await acceptTerms(me.cookie);
      expect((await get(me.cookie, `/me/projects/${pid}`)).statusCode).toBe(200);
    });

    it('placeholder terms are refused where onboarding refuses them, and the terms routes need the new flow', async () => {
      expect(placeholderTermsRefused({ requireLiveIdentity: true, NODE_ENV: 'production', appEnv: 'production' })).toBe(true);
      expect(placeholderTermsRefused({ requireLiveIdentity: false, NODE_ENV: 'production', appEnv: 'staging' })).toBe(true);
      expect(placeholderTermsRefused({ requireLiveIdentity: false, NODE_ENV: 'production', appEnv: 'demo' })).toBe(false);
      expect(placeholderTermsRefused({ requireLiveIdentity: false, NODE_ENV: 'test', appEnv: 'local' })).toBe(false);
      const me = await signIn('placeholder@gmail.test', undefined, 'P', { terms: false });
      const terms = await db.termsDocument.findMany({ where: { clientId } });
      const hashes = Object.fromEntries(terms.map((t) => [t.key, t.sha256])) as Record<'contributor' | 'confidentiality_ip' | 'data_use', string>;
      const actor = { smeUserId: me.smeUserId, clientId, sessionId: randomUUID() } as Parameters<typeof acceptForgeTerms>[1];
      await expect(db.$transaction((tx) => acceptForgeTerms(tx, actor, { hashes, syntheticOnly: true }, true, async () => undefined))).rejects.toMatchObject({ code: 'TERMS_PLACEHOLDER' });

      await setFlow(false);
      expect((await get(me.cookie, '/me/forge/terms')).json().error).toBe('NEW_FLOW_OFF');
      expect((await post(me.cookie, '/me/forge/terms', { hashes, syntheticOnly: true })).json().error).toBe('NEW_FLOW_OFF');
    });
  });

  // ── Home ──

  it('Home lists author statuses (New, In review, Rework with its comment count) and review tasks; the Reviewer needs the terms', async () => {
    const pid = await project('SME_EXPERT_PM');
    const author = await signIn('home.author@gmail.test', undefined, 'Ada Author');
    const s = await source(pid, 'SME', { email: 'home.author@gmail.test', first: 'Ada', last: 'Author' });
    const first = await fixedTask(pid);
    expect((await assign(pid, s.id, first.id)).statusCode).toBe(200);
    const second = await anyTask(pid);
    expect((await assign(pid, s.id, second.id)).statusCode).toBe(200);

    const reviewer = await signIn('home.reviewer@gmail.test', undefined, 'Rita Reviewer', { terms: false });
    const r = await source(pid, 'REVIEWER', { email: 'home.reviewer@gmail.test', first: 'Rita', last: 'Reviewer' });
    expect((await assign(pid, r.id, first.id)).statusCode).toBe(200);

    await saveAndSubmit(author, first.id);
    let h = await home(author);
    expect(Object.fromEntries(h.authorTasks.map((t: { taskId: string; status: string }) => [t.taskId, t.status]))).toEqual({ [first.id]: 'In review', [second.id]: 'New' });
    const rh = await home(reviewer);
    expect(rh.termsAccepted).toBe(false);
    expect(rh.reviewTasks).toEqual([expect.objectContaining({ taskId: first.id, status: 'To review', author: 'Ada Author' })]);

    // The Reviewer must accept the terms before opening or deciding.
    expect((await get(reviewer.cookie, `/me/reviews/${first.id}`)).json().error).toBe('TERMS_REQUIRED');
    const blocked = await post(reviewer.cookie, `/me/reviews/${first.id}/decision`, { decision: 'REWORK', expectedVersion: 1, expectedRevision: 0, comments: [{ section: 'S1', text: 'x' }] });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('TERMS_REQUIRED');
    await acceptTerms(reviewer.cookie);
    const v = (await get(reviewer.cookie, `/me/reviews/${first.id}`)).json();
    const back = await post(reviewer.cookie, `/me/reviews/${first.id}/decision`, { decision: 'REWORK', expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, comments: [{ section: 'S1', text: 'Name the trigger.' }, { section: 'S6-S8', text: 'Explain the outcome.' }] });
    expect(back.statusCode, back.body).toBe(200);

    h = await home(author);
    expect(h.authorTasks.find((t: { taskId: string }) => t.taskId === first.id)).toMatchObject({ status: 'Rework', reworkComments: 2 });
    expect(h.authorTasks.find((t: { taskId: string }) => t.taskId === second.id)).toMatchObject({ status: 'New', reworkComments: 0 });
    expect((await home(reviewer)).reviewTasks).toEqual([expect.objectContaining({ taskId: first.id, status: 'Sent back' })]);
    // The author sees each comment with its section on the task.
    expect((await meTask(author, first.id)).review.comments).toEqual([{ section: 'S1', text: 'Name the trigger.' }, { section: 'S6-S8', text: 'Explain the outcome.' }]);
  });
});
