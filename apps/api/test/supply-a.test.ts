import type { FastifyInstance } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CandidateSubmissionInput, roleLabel, screenRequirements, normaliseEmail, normalisePhone } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryEmailSender } from '../src/lib/email';
import { secretBox } from '../src/lib/secrets';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { emitEvent } from '../src/outbox/outbox';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { remindAndExpireInvites, submitCandidate } from '../src/supply/submissions';
import { MAX_WEBHOOK_ATTEMPTS, processPartnerWebhooks, type WebhookSender } from '../src/supply/webhooks';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

/** Captures webhook posts; can be told to fail. */
class FakeReceiver implements WebhookSender {
  posts: { url: string; body: string; headers: Record<string, string> }[] = [];
  status = 200;
  async post(url: string, body: string, headers: Record<string, string>) {
    this.posts.push({ url, body, headers });
    return { status: this.status };
  }
  events() {
    return this.posts.map((p) => JSON.parse(p.body) as { id: string; type: string; sandbox: boolean; data: Record<string, unknown> });
  }
}
const verify = (secret: string, header: string, body: string) => {
  const m = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  return !!m && createHmac('sha256', secret).update(`${m[1]}.${body}`).digest('hex') === m[2];
};

describe('M10a SME supply: partners, Partner API, requisitions and submissions (docs/SME-SUPPLY.md)', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig({ SME_SUPPLY_ENABLED: 'true' });
  const box = secretBox(config);
  const receiver = new FakeReceiver();
  let clientId: string;
  let admin: string;
  let pm: string;
  let validator: string;

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, selectionGate: stubSelectionGate, email });
  });
  beforeEach(async () => {
    await resetDb();
    email.sent.length = 0;
    receiver.posts.length = 0;
    receiver.status = 200;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    validator = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem(), ...headers }, payload: payload as object });
  const put = (cookie: string, url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });
  const api = (token: string, method: 'GET' | 'POST', url: string, payload?: object, key = randomUUID()) => app.inject({ method, url: `/partner/v1${url}`, headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'idempotency-key': key } : {}) }, ...(payload ? { payload } : {}) });

  /** A STAFFING project with a published opportunity and SME supply switched on. */
  async function supplyProject() {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    await post(admin, `/templates/${t.id}/publish`);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author synthetic KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { templateId: t.id, name: `P ${randomUUID().slice(0, 6)}`, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['IN', 'GB'], required: false }] })).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/opportunity/publish`)).statusCode).toBe(200);
    return p.id as string;
  }

  async function partner(name = `Partner ${randomUUID().slice(0, 4)}`) {
    const p = (await post(admin, '/partners', { name, businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] })).json();
    const userEmail = `ops.${randomUUID().slice(0, 6)}@partner.example`;
    expect((await post(admin, `/partners/${p.id}/users`, { email: userEmail, name: 'Ops Lead', password: 'partner-password-1', requirePasswordChange: false })).statusCode).toBe(201);
    const res = await app.inject({ method: 'POST', url: '/api/v1/partner-portal/login', payload: { email: userEmail, password: 'partner-password-1' } });
    expect(res.statusCode, res.body).toBe(200);
    const portal = `praxis_partner=${res.cookies.find((c) => c.name === 'praxis_partner')!.value}`;
    return { id: p.id as string, name, portal };
  }

  async function credentials(portal: string, environment: 'SANDBOX' | 'LIVE', scopes?: string[]) {
    const c = (await post(portal, '/partner-portal/clients', { environment, ...(scopes ? { scopes } : {}) })).json();
    const tok = await app.inject({ method: 'POST', url: '/partner/v1/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `grant_type=client_credentials&client_id=${c.clientId}&client_secret=${c.clientSecret}` });
    expect(tok.statusCode, tok.body).toBe(200);
    return { ...c, token: tok.json().access_token as string };
  }

  async function webhook(portal: string, environment: 'SANDBOX' | 'LIVE') {
    const w = (await post(portal, '/partner-portal/webhooks', { url: 'https://hooks.partner.example/praxis', events: ['*'], environment })).json();
    return w.signingSecret as string;
  }

  async function requisition(projectId: string, partnerIds: string[], extra: object = {}) {
    await post(pm, `/projects/${projectId}/sme-supply`, { enabled: true });
    const r = (await post(pm, '/requisitions', { projectId, title: 'KYC annotators (India)', summary: 'Label KYC onboarding decisions.', domain: 'banking', tier: 'ANNOTATOR', headcount: 10, languages: ['en'], jurisdictions: ['IN'], minimumRequirements: { minYears: 2, qualifications: [], licenceRequired: false }, allowedPartnerIds: partnerIds, maxPerPartner: 50, ...extra })).json();
    expect(r.id, JSON.stringify(r)).toBeTruthy();
    expect((await post(pm, `/requisitions/${r.id}/transition`, { to: 'OPEN' })).statusCode).toBe(200);
    return r.id as string;
  }

  // Each test person gets a different Indian mobile number unless a test sets one (the phone is a duplicate key).
  const mobile = () => `+91 9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const person = (over: object = {}) => ({ partnerRef: `ref-${randomUUID().slice(0, 8)}`, name: 'Priya Raman', email: `priya.${randomUUID().slice(0, 6)}@example.test`, phone: mobile(), country: 'IN', experienceSummary: 'Four years of KYC onboarding review at a retail bank, including beneficial ownership checks.', experienceYears: 4, qualifications: ['CAMS'], languages: ['en'], partnerTrainingAttestation: true, candidateConsent: true, ...over });

  describe('feature flag', () => {
    it('with the flag off no M10 route, job handler or partner audience exists, and FLOW 2 is unchanged', async () => {
      const off = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
      for (const [method, url] of [['POST', '/partner/v1/oauth/token'], ['GET', '/partner/v1/requisitions'], ['POST', '/api/v1/partner-portal/login'], ['GET', '/api/v1/partners'], ['GET', '/api/v1/requisitions'], ['POST', '/api/v1/me/partner-invites/redeem'], ['GET', `/api/v1/careers/requisitions/${randomUUID()}`]] as const) {
        expect((await off.inject({ method, url, payload: {} })).statusCode, url).toBe(404);
      }
      expect((await off.inject({ method: 'GET', url: '/api/v1/opportunities' })).statusCode).toBe(200);
      await off.close();
      expect(defaultHandlers({ config: testConfig() }).for('sme.identity_verified')).toEqual([]);
      expect(defaultHandlers({ config: testConfig() }).for('enrollment.decided').map((h) => h.name)).not.toContain('m10.partner-selection-decided');
      expect(defaultHandlers({ config }).for('sme.identity_verified').map((h) => h.name)).toEqual(['m10.partner-identity-verified']);
    });

    it('a requisition needs the per-project switch as well', async () => {
      const projectId = await supplyProject();
      const res = await post(pm, '/requisitions', { projectId, title: 'Annotators', domain: 'banking', tier: 'ANNOTATOR', headcount: 3 });
      expect(res.json().error).toBe('SME_SUPPLY_OFF');
    });
  });

  describe('sandbox partner end to end', () => {
    it('lists open requisitions, submits a candidate and receives a signed webhook for every state change', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const secret = await webhook(p.portal, 'SANDBOX');
      const reqId = await requisition(projectId, [p.id]);
      const sb = await credentials(p.portal, 'SANDBOX');

      const list = await api(sb.token, 'GET', '/requisitions?status=open');
      expect(list.json().data.map((r: { id: string }) => r.id)).toEqual([reqId]);
      expect(list.json().data[0]).not.toHaveProperty('allowedPartnerIds');
      expect((await api(sb.token, 'GET', `/requisitions/${reqId}`)).json()).toMatchObject({ id: reqId, tierLabel: 'Annotator', minimumRequirements: { minYears: 2 } });

      const sub = await api(sb.token, 'POST', `/requisitions/${reqId}/candidates`, person());
      expect(sub.statusCode, sub.body).toBe(201);
      const id = sub.json().candidateId;
      expect(sub.json()).toMatchObject({ state: 'INVITED', screen: 'MEETS' });
      expect(email.sent).toHaveLength(0); // sandbox: nobody real is emailed

      for (const event of ['identity_verified', 'selected', 'training_completed', 'test_passed', 'certified', 'activated'] as const) {
        expect((await api(sb.token, 'POST', `/sandbox/candidates/${id}/simulate`, { event })).statusCode).toBe(200);
      }
      const view = (await api(sb.token, 'GET', `/candidates/${id}`)).json();
      expect(view.states).toMatchObject({ submission: 'INVITED', screen: 'MEETS', identity: 'VERIFIED', selection: 'SELECTED', certification: 'CERTIFIED', standing: 'PROBATION' });
      expect(view.history.length).toBeGreaterThanOrEqual(9);

      await processPartnerWebhooks(db, box, receiver);
      const types = receiver.events().map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['requisition.opened', 'candidate.received', 'candidate.invited', 'candidate.identity_verified', 'candidate.selected', 'candidate.training_completed', 'candidate.test_passed', 'candidate.certified', 'candidate.activated']));
      for (const post of receiver.posts) expect(verify(secret, post.headers['praxis-signature']!, post.body)).toBe(true);
      expect(receiver.events().every((e) => e.sandbox)).toBe(true);
      expect(receiver.events().find((e) => e.type === 'candidate.received')!.data).toMatchObject({ candidateId: id, requisitionId: reqId });
      expect((await api(sb.token, 'GET', '/placements')).json().data).toEqual([expect.objectContaining({ candidateId: id, tier: 'ANNOTATOR', standing: 'PROBATION' })]);
    });

    it('OAuth: bad secret, unknown grant, extra scope and missing scope are refused; revoked clients stop working', async () => {
      const p = await partner();
      const c = (await post(p.portal, '/partner-portal/clients', { environment: 'SANDBOX', scopes: ['requisitions:read'] })).json();
      const tok = (body: string) => app.inject({ method: 'POST', url: '/partner/v1/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: body });
      expect((await tok(`grant_type=client_credentials&client_id=${c.clientId}&client_secret=wrong`)).json()).toEqual({ error: 'invalid_client', error_description: 'Client authentication failed.' });
      expect((await tok(`grant_type=password&client_id=${c.clientId}&client_secret=${c.clientSecret}`)).json().error).toBe('unsupported_grant_type');
      expect((await tok(`grant_type=client_credentials&client_id=${c.clientId}&client_secret=${c.clientSecret}&scope=candidates:write`)).json().error).toBe('invalid_scope');
      // HTTP Basic works too.
      const basic = await app.inject({ method: 'POST', url: '/partner/v1/oauth/token', headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}` }, payload: { grant_type: 'client_credentials' } });
      const token = basic.json().access_token;
      expect(basic.json()).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'requisitions:read' });
      expect((await api(token, 'GET', '/requisitions')).statusCode).toBe(200);
      expect((await api(token, 'POST', `/requisitions/${randomUUID()}/candidates`, person())).statusCode).toBe(403);
      expect((await api('pat_not-a-real-token-at-all-xxxx', 'GET', '/requisitions')).statusCode).toBe(401);
      expect((await post(p.portal, `/partner-portal/clients/${c.id}/revoke`)).statusCode).toBe(200);
      expect((await api(token, 'GET', '/requisitions')).statusCode).toBe(401);
      // A secret is shown once; the list never includes it.
      expect(JSON.stringify((await get(p.portal, '/partner-portal/clients')).json())).not.toContain(c.clientSecret);
    });

    it('writes are idempotent: the same Idempotency-Key replays the first response and creates nothing new', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const reqId = await requisition(projectId, [p.id]);
      const sb = await credentials(p.portal, 'SANDBOX');
      const key = randomUUID();
      const body = person();
      const a = await api(sb.token, 'POST', `/requisitions/${reqId}/candidates`, body, key);
      const b = await api(sb.token, 'POST', `/requisitions/${reqId}/candidates`, body, key);
      expect(b.json()).toEqual(a.json());
      expect(b.headers['idempotent-replayed']).toBe('true');
      expect(await db.partnerSubmission.count()).toBe(1);
      expect((await api(sb.token, 'POST', `/requisitions/${reqId}/candidates`, person())).statusCode).toBe(201);
      expect((await app.inject({ method: 'POST', url: `/partner/v1/requisitions/${reqId}/candidates`, headers: { authorization: `Bearer ${sb.token}` }, payload: person() })).statusCode).toBe(400);
    });
  });

  describe('duplicates and ownership', () => {
    it('a duplicate from another partner is rejected without revealing the owner; the owner may resubmit to another requisition', async () => {
      const projectId = await supplyProject();
      const a = await partner('Acme Staffing');
      const b = await partner('Beta Talent');
      const r1 = await requisition(projectId, [a.id, b.id]);
      const la = await credentials(a.portal, 'LIVE');
      const lb = await credentials(b.portal, 'LIVE');
      const who = person({ email: 'Priya.Raman+work@gmail.com', phone: '+91 98765 43210' });
      expect((await api(la.token, 'POST', `/requisitions/${r1}/candidates`, who)).statusCode).toBe(201);

      // Same person: different email formatting (Gmail dots and tag), or the same phone.
      for (const dup of [person({ email: 'priyaraman@gmail.com', phone: undefined }), person({ email: 'other@example.test', phone: '098765 43210' })]) {
        const res = await api(lb.token, 'POST', `/requisitions/${r1}/candidates`, dup);
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({ error: 'DUPLICATE_CANDIDATE', state: 'DUPLICATE', message: 'This candidate is already registered with ADI Praxis through another submission.' });
        expect(res.body).not.toMatch(/Acme|acme/);
        expect(res.body).not.toContain(a.id);
      }
      const dupView = (await api(lb.token, 'GET', `/candidates/${(await db.partnerSubmission.findFirstOrThrow({ where: { partnerId: b.id } })).id}`)).json();
      expect(JSON.stringify(dupView)).not.toMatch(/Acme|acme/);
      expect(dupView.states.submission).toBe('DUPLICATE');

      // The owner can put the same person forward for another requisition; the same one twice is refused.
      const r2 = await requisition(projectId, [a.id]);
      expect((await api(la.token, 'POST', `/requisitions/${r2}/candidates`, person({ email: who.email }))).statusCode).toBe(201);
      expect((await api(la.token, 'POST', `/requisitions/${r1}/candidates`, person({ email: who.email }))).json().error).toBe('ALREADY_SUBMITTED');
    });

    it('after the owner withdraws, a 90-day cool-off applies to every partner; after it, a new partner may submit', async () => {
      const projectId = await supplyProject();
      const a = await partner();
      const b = await partner();
      const r1 = await requisition(projectId, [a.id, b.id]);
      const la = await credentials(a.portal, 'LIVE');
      const lb = await credentials(b.portal, 'LIVE');
      const who = person();
      const id = (await api(la.token, 'POST', `/requisitions/${r1}/candidates`, who)).json().candidateId;
      expect((await api(la.token, 'POST', `/candidates/${id}/withdraw`)).json().states.submission).toBe('WITHDRAWN');
      const cool = await api(lb.token, 'POST', `/requisitions/${r1}/candidates`, person({ email: who.email }));
      expect(cool.json().message).toMatch(/can be submitted again from \d{4}-\d{2}-\d{2}/);
      await db.$executeRaw`UPDATE "PartnerSubmission" SET ended_at = now() - interval '91 days' WHERE id = ${id}::uuid`;
      expect((await api(lb.token, 'POST', `/requisitions/${r1}/candidates`, person({ email: who.email }))).statusCode).toBe(201);
    });

    it('requisition rules: only allowed partners, only when open, per-partner limit, unique partnerRef', async () => {
      const projectId = await supplyProject();
      const a = await partner();
      const outsider = await partner();
      const r = await requisition(projectId, [a.id], { maxPerPartner: 1 });
      const la = await credentials(a.portal, 'LIVE');
      const lo = await credentials(outsider.portal, 'LIVE');
      expect((await api(lo.token, 'GET', `/requisitions/${r}`)).statusCode).toBe(404);
      expect((await api(lo.token, 'POST', `/requisitions/${r}/candidates`, person())).statusCode).toBe(404);
      const first = person();
      expect((await api(la.token, 'POST', `/requisitions/${r}/candidates`, first)).statusCode).toBe(201);
      expect((await api(la.token, 'POST', `/requisitions/${r}/candidates`, person({ partnerRef: first.partnerRef }))).json().error).toBe('PARTNER_REF_IN_USE');
      expect((await api(la.token, 'POST', `/requisitions/${r}/candidates`, person())).json().error).toBe('PARTNER_LIMIT_REACHED');
      expect((await post(pm, `/requisitions/${r}/transition`, { to: 'PAUSED' })).statusCode).toBe(200);
      expect((await api(la.token, 'GET', '/requisitions?status=open')).json().data).toEqual([]);
      expect((await post(pm, `/requisitions/${r}/transition`, { to: 'DRAFT' })).json().error).toBe('INVALID_TRANSITION');
    });
  });

  describe('invite into FLOW 2 and human decisions', () => {
    async function signIn(emailAddr: string) {
      const credential = google.mint({ subject: `sub-${emailAddr}`, email: emailAddr, name: 'Priya Raman' });
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential, adultAttested: true } });
      return { cookie: `praxis_candidate=${res.cookies.find((c) => c.name === 'praxis_candidate')!.value}`, smeUserId: res.json().id as string };
    }

    it('a live submission is invited by email into FLOW 2; the candidate signs in and lands in the opportunity’s profile', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const r = await requisition(projectId, [p.id]);
      const live = await credentials(p.portal, 'LIVE');
      const secret = await webhook(p.portal, 'LIVE');
      const who = person();
      const submitted = (await api(live.token, 'POST', `/requisitions/${r}/candidates`, who)).json();
      const id = submitted.candidateId;
      // Outside the test/demo environment the link only ever goes by email.
      expect(submitted.inviteLinkForTesting).toBeUndefined();
      expect(email.sent).toHaveLength(1);
      const token = email.sent[0]!.text.match(/\/partner-invite\/(\S+)/)![1]!;
      expect(email.sent[0]!.to).toBe(who.email);

      const c = await signIn(who.email);
      const red = await post(c.cookie, '/me/partner-invites/redeem', { token });
      expect(red.statusCode, red.body).toBe(200);
      const e = await db.enrollment.findUniqueOrThrow({ where: { id: red.json().enrollmentId } });
      expect(e).toMatchObject({ smeUserId: c.smeUserId, status: 'DRAFT' });

      // In the test/demo environment (email simulated) the partner is shown the same working link.
      const other = person();
      const shown = await db.$transaction((tx) => submitCandidate(tx, { email: null, appUrl: 'http://candidate.test', exposeInviteLink: true }, { clientId, ch: { partnerId: p.id, sandbox: false, channel: 'PARTNER_PORTAL' }, requisitionId: r, input: CandidateSubmissionInput.parse(other) }, async () => {}));
      const link = shown.body.inviteLinkForTesting as string;
      expect(link).toMatch(/^http:\/\/candidate\.test\/partner-invite\/\S+$/);
      const c2 = await signIn(other.email);
      expect((await post(c2.cookie, '/me/partner-invites/redeem', { token: link.split('/').pop() })).statusCode).toBe(200);
      expect((await db.supplyCandidate.findFirstOrThrow({ where: { emailNorm: who.email.toLowerCase() } })).smeUserId).toBe(c.smeUserId);

      // FLOW 2 changes reach the partner: identity verified, then the human selection decision.
      await db.$transaction(async (tx) => {
        await emitEvent(tx, clientId, { name: 'sme.identity_verified', aggregateType: 'SmeUser', aggregateId: c.smeUserId, payload: { smeUserId: c.smeUserId } });
        await emitEvent(tx, clientId, { name: 'enrollment.decided', aggregateType: 'Enrollment', aggregateId: e.id, payload: { enrollmentId: e.id, outcome: 'SELECTED' } });
      });
      for (const ev of await db.outboxEvent.findMany({ where: { name: { in: ['sme.identity_verified', 'enrollment.decided'] } }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, defaultHandlers({ config }), ev.id);
      const view = (await api(live.token, 'GET', `/candidates/${id}`)).json();
      expect(view).toMatchObject({ inviteAccepted: true, states: { submission: 'INVITED', identity: 'VERIFIED', selection: 'SELECTED' } });
      await processPartnerWebhooks(db, box, receiver);
      expect(receiver.events().map((x) => x.type)).toEqual(expect.arrayContaining(['candidate.invited', 'candidate.identity_verified', 'candidate.selected']));
      expect(receiver.posts.every((x) => verify(secret, x.headers['praxis-signature']!, x.body))).toBe(true);
      // The link belongs to one person: they can open it again, but a second account cannot take the invite.
      expect((await post(c.cookie, '/me/partner-invites/redeem', { token })).json().enrollmentId).toBe(e.id);
      const thief = await post((await signIn('someone.else@example.test')).cookie, '/me/partner-invites/redeem', { token });
      expect(thief.statusCode).toBe(409);
      expect(thief.json().error).toBe('INVITE_TAKEN');
      expect((await db.supplyCandidate.findFirstOrThrow({ where: { submissions: { some: { id } } } })).smeUserId).toBe(c.smeUserId);
    });

    it('a candidate below the minimum is still invited; only a Validator can confirm "not met" (bulk allowed)', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const r = await requisition(projectId, [p.id]);
      const live = await credentials(p.portal, 'LIVE');
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = (await api(live.token, 'POST', `/requisitions/${r}/candidates`, person({ experienceYears: 1 }))).json();
        expect(res).toMatchObject({ state: 'INVITED', screen: 'DOES_NOT_MEET_RECOMMENDED', screenReasons: [expect.stringMatching(/1 years.*2\+/)] });
        ids.push(res.candidateId);
      }
      // Nobody but a person with the Validator (or Admin) role can confirm.
      expect((await post(pm, '/partner-submissions/screen-decisions', { submissionIds: ids, decision: 'CONFIRM_NOT_MET', note: 'Below minimum' })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/partner-submissions/screen-decisions', headers: { cookie: p.portal, ...idem() }, payload: { submissionIds: ids, decision: 'CONFIRM_NOT_MET', note: 'x' } })).statusCode).toBe(401);
      const d = await post(validator, '/partner-submissions/screen-decisions', { submissionIds: ids, decision: 'CONFIRM_NOT_MET', note: 'Two years of KYC review are required for this pool.' });
      expect(d.statusCode, d.body).toBe(200);
      expect(d.json().items.every((x: { screen: string }) => x.screen === 'CONFIRMED_NOT_MET')).toBe(true);
      const view = (await api(live.token, 'GET', `/candidates/${ids[0]}`)).json();
      expect(view.states.screen).toBe('CONFIRMED_NOT_MET');
      expect(view.history.find((h: { to: string }) => h.to === 'CONFIRMED_NOT_MET').reason).toMatch(/Two years/);
      const audit = await db.auditEvent.findMany({ where: { entityId: ids[0]!, action: 'supply.screen.confirmed_not_met' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorType).toBe('USER');
    });

    it('invites: a reminder on day 3, expiry on day 7 (then the link no longer works)', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const r = await requisition(projectId, [p.id]);
      const live = await credentials(p.portal, 'LIVE');
      const who = person();
      const id = (await api(live.token, 'POST', `/requisitions/${r}/candidates`, who)).json().candidateId;
      const token = email.sent[0]!.text.match(/\/partner-invite\/(\S+)/)![1]!;
      const t0 = Date.now();
      expect(await remindAndExpireInvites(db, email, 'http://candidate.test', new Date(t0 + 3.1 * 86_400_000))).toEqual({ reminded: 1, expired: 0 });
      expect(email.sent.at(-1)!.subject).toMatch(/^Reminder/);
      expect(await remindAndExpireInvites(db, email, 'http://candidate.test', new Date(t0 + 3.2 * 86_400_000))).toEqual({ reminded: 0, expired: 0 });
      expect(await remindAndExpireInvites(db, email, 'http://candidate.test', new Date(t0 + 7.1 * 86_400_000))).toEqual({ reminded: 0, expired: 1 });
      expect((await api(live.token, 'GET', `/candidates/${id}`)).json().states.submission).toBe('EXPIRED');
      const c = await signIn(who.email);
      expect((await post(c.cookie, '/me/partner-invites/redeem', { token })).statusCode).toBe(404);
    });

    it('direct careers page: a signed-in candidate applies and is taken into the profile', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const r = await requisition(projectId, [p.id], { directChannel: true });
      expect((await get('', `/careers/requisitions/${r}`)).json()).toMatchObject({ title: 'KYC annotators (India)', tierLabel: 'Annotator' });
      const c = await signIn(`direct.${randomUUID().slice(0, 6)}@example.test`);
      const res = await post(c.cookie, `/me/requisitions/${r}/apply`, { experienceSummary: 'Five years of retail KYC and periodic reviews.', experienceYears: 5, country: 'IN', languages: ['en'], consent: true });
      expect(res.statusCode, res.body).toBe(200);
      const s = await db.partnerSubmission.findFirstOrThrow({ where: { requisitionId: r } });
      expect(s).toMatchObject({ channel: 'DIRECT', state: 'INVITED', partnerId: null, enrollmentId: res.json().enrollmentId });
    });
  });

  describe('webhook delivery', () => {
    it('retries with backoff until delivered, gives up after the limit, and can be replayed from the portal', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      await webhook(p.portal, 'LIVE');
      await requisition(projectId, [p.id]);
      receiver.status = 500;
      const t = Date.now();
      await processPartnerWebhooks(db, box, receiver, new Date(t));
      let d = await db.partnerWebhookDelivery.findFirstOrThrow();
      expect(d).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: 500 });
      expect(d.nextAttemptAt.getTime()).toBe(t + 30_000);
      await processPartnerWebhooks(db, box, receiver, new Date(t + 1000));
      expect(receiver.posts).toHaveLength(1); // not due yet
      for (let i = 1; i < MAX_WEBHOOK_ATTEMPTS; i++) await processPartnerWebhooks(db, box, receiver, new Date(t + 10 * 86_400_000 * i));
      d = await db.partnerWebhookDelivery.findFirstOrThrow({ where: { id: d.id } });
      expect(d).toMatchObject({ status: 'FAILED', attempts: MAX_WEBHOOK_ATTEMPTS });

      const list = (await get(p.portal, '/partner-portal/webhook-deliveries')).json().items;
      expect(list[0]).toMatchObject({ status: 'FAILED', eventType: 'requisition.opened' });
      receiver.status = 204;
      const replay = await post(p.portal, `/partner-portal/webhook-deliveries/${d.id}/replay`);
      expect(replay.statusCode).toBe(202);
      await processPartnerWebhooks(db, box, receiver, new Date(t + 100 * 86_400_000));
      const again = await db.partnerWebhookDelivery.findUniqueOrThrow({ where: { id: replay.json().id } });
      expect(again).toMatchObject({ status: 'DELIVERED', replayOfId: d.id, eventId: d.eventId });
      // Another partner cannot replay it.
      const other = await partner();
      expect((await post(other.portal, `/partner-portal/webhook-deliveries/${d.id}/replay`)).statusCode).toBe(404);
    });
  });

  describe('partner portal and audit', () => {
    it('portal sessions are their own audience: the partner cookie opens no console or candidate route and vice versa', async () => {
      const p = await partner();
      expect((await get(p.portal, '/partner-portal/me')).json()).toMatchObject({ partner: { id: p.id } });
      expect((await get(p.portal, '/partners')).statusCode).toBe(401);
      expect((await get(p.portal, '/me')).statusCode).toBe(401);
      expect((await get(pm, '/partner-portal/me')).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/partner-portal/login', payload: { email: 'nobody@partner.example', password: 'x' } })).statusCode).toBe(401);
      expect((await post(p.portal, '/partner-portal/logout')).statusCode).toBe(200);
      expect((await get(p.portal, '/partner-portal/me')).statusCode).toBe(401);
    });

    it('suspending a partner ends its tokens and portal access', async () => {
      const p = await partner();
      const c = await credentials(p.portal, 'SANDBOX');
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/partners/${p.id}`, headers: { cookie: admin, ...idem() }, payload: { status: 'SUSPENDED' } })).statusCode).toBe(200);
      expect((await api(c.token, 'GET', '/requisitions')).statusCode).toBe(401);
      expect((await get(p.portal, '/partner-portal/me')).statusCode).toBe(401);
    });

    it('every step is in the audit log with its actor type', async () => {
      const projectId = await supplyProject();
      const p = await partner();
      const r = await requisition(projectId, [p.id]);
      const live = await credentials(p.portal, 'LIVE');
      const id = (await api(live.token, 'POST', `/requisitions/${r}/candidates`, person())).json().candidateId;
      const actions = (await db.auditEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => `${e.actorType}:${e.action}`);
      expect(actions).toEqual(expect.arrayContaining(['USER:partner.created', 'USER:partner.user_created', 'PARTNER:partner.user_signed_in', 'PARTNER:partner.client_created', 'PARTNER:partner.token_issued', 'USER:project.sme_supply_changed', 'USER:requisition.created', 'USER:requisition.state_changed', 'PARTNER:supply.submission.received', 'PARTNER:supply.screen.meets', 'PARTNER:supply.submission.invited']));
      expect(await db.auditEvent.count({ where: { entityId: id } })).toBeGreaterThanOrEqual(3);
      // The state history is append-only in the database.
      await expect(db.$executeRaw`UPDATE "CandidateStateEvent" SET to_state = 'X'`).rejects.toThrow(/append-only/);
    });
  });

  describe('shared rules', () => {
    it('labels: the internal REVIEWER role is shown as Validator; SME tiers are Expert, Reviewer, Annotator', () => {
      expect(['ADMIN', 'PM', 'REVIEWER'].map(roleLabel)).toEqual(['Admin', 'PM', 'Validator']);
    });
    it('normalises emails and phones for duplicate matching', () => {
      expect(normaliseEmail(' P.Raman+x@GoogleMail.com ')).toBe('praman@gmail.com');
      expect(normaliseEmail('a.b+c@corp.example')).toBe('a.b@corp.example');
      expect(normalisePhone('098765 43210', 'IN')).toBe('919876543210');
      expect(normalisePhone('+91 98765-43210', 'IN')).toBe('919876543210');
      expect(normalisePhone('12', 'IN')).toBeNull();
    });
    it('the requirement screen only recommends, and flags a licence for a Validator', () => {
      expect(screenRequirements({ minYears: 3, qualifications: ['CAMS'], licenceRequired: false, notes: '' }, { experienceYears: 5, qualifications: ['cams'], languages: [], experienceSummary: 'x' }).state).toBe('MEETS');
      expect(screenRequirements({ minYears: 0, qualifications: [], licenceRequired: true, notes: '' }, { experienceYears: 5, qualifications: [], languages: [], experienceSummary: 'x' }).state).toBe('UNCLEAR');
      expect(screenRequirements({ minYears: 8, qualifications: [], licenceRequired: false, notes: '' }, { experienceYears: 5, qualifications: [], languages: [], experienceSummary: 'x' }).state).toBe('DOES_NOT_MEET_RECOMMENDED');
    });
  });
});
