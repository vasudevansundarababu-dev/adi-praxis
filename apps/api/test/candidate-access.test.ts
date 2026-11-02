import type { FastifyInstance } from 'fastify';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { GoogleIdTokenVerifier, MockGoogleVerifier } from '../src/candidate/google';
import { isAdult, MockIdentityProvider } from '../src/candidate/identity-provider';
import { applicationBlockReason, processIdentityWebhook } from '../src/candidate/identity-service';
import { loadConfig } from '../src/config';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import { createCandidate, createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { docxWithText, pdfWithText } from './documents';

const SECRET = 'test-mock-secret';

describe('M4a: sourcing, candidate sign-in, identity, opportunity', () => {
  let app: FastifyInstance;
  let google: MockGoogleVerifier;
  let identity: MockIdentityProvider;
  let clientId: string;
  let admin: string;
  let pm: string;
  let reviewer: string;
  let reviewerId: string;

  beforeAll(async () => {
    google = new MockGoogleVerifier(SECRET);
    identity = new MockIdentityProvider(SECRET, 'http://candidate.test');
    // Campaign tests assign synthetic candidates, so this file uses the staffing test double for the selection gate.
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, google, identity, resolveClientId: async () => clientId, selectionGate: stubSelectionGate });
  });

  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    const reviewerUser = await createUser(clientId, ['REVIEWER']);
    reviewerId = reviewerUser.id;
    reviewer = await login(app, reviewerUser.email);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const put = (cookie: string, url: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });

  /** Signs in through POST /auth/google with a mock credential; returns the candidate cookie. */
  async function signIn(email = `${randomUUID().slice(0, 8)}@example.test`, opts: { attest?: boolean; subject?: string } = {}) {
    const credential = google.mint({ subject: opts.subject ?? `sub-${email}`, email, name: 'Test Candidate' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential, adultAttested: opts.attest ?? true } });
    const cookie = res.cookies.find((c) => c.name === 'praxis_candidate');
    return { res, cookie: cookie ? `praxis_candidate=${cookie.value}` : '' };
  }

  /** A STAFFING project with a published opportunity (needs 2 workers). */
  async function staffingProjectWithOpportunity(extra: object = {}) {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    await post(admin, `/templates/${t.id}/publish`);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author synthetic KYC cases.', skills: ['KYC', 'EDD'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'HYBRID', location: 'London, UK' })).json();
    const p = (
      await post(pm, '/projects', {
        templateId: t.id, name: `P ${randomUUID().slice(0, 6)}`, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06',
        jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }], ...extra,
      })
    ).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const pub = await post(pm, `/projects/${p.id}/opportunity/publish`);
    expect(pub.statusCode, pub.body).toBe(200);
    const opportunityId = (await db.opportunity.findUniqueOrThrow({ where: { projectId: p.id } })).id;
    return { projectId: p.id as string, opportunityId };
  }

  // ─────────────── CF-01 / CF-02: sign-in ───────────────

  describe('CF-01 Google sign-in', () => {
    it('a valid credential creates the account and a server session; next step is identity', async () => {
      const { res, cookie } = await signIn('ada@example.test');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ displayName: 'Test Candidate', contactEmail: 'ada@example.test', identityStatus: 'NOT_STARTED', nextStep: 'VERIFY_IDENTITY' });
      const c = res.cookies.find((x) => x.name === 'praxis_candidate')!;
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('Lax');
      expect((await get(cookie, '/me')).json().id).toBe(res.json().id);
      const session = await db.session.findFirstOrThrow({ where: { smeUserId: res.json().id } });
      expect(session.audience).toBe('CANDIDATE');
    });

    it('rejects tampered, expired or foreign credentials', async () => {
      const good = google.mint({ subject: 's1', email: 'a@x.test', name: 'A' });
      const [prefix, payload, sig] = good.split('.');
      const tampered = `${prefix}.${Buffer.from(JSON.stringify({ sub: 'attacker', email: 'a@x.test', aud: 'praxis-mock', exp: 9999999999 })).toString('base64url')}.${sig}`;
      const expired = google.mint({ subject: 's1', email: 'a@x.test', name: 'A' }, -10);
      const foreign = new MockGoogleVerifier('someone-else').mint({ subject: 's1', email: 'a@x.test', name: 'A' });
      for (const credential of [tampered, expired, foreign, 'not-a-token-at-all']) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential, adultAttested: true } });
        expect(res.statusCode).toBe(401);
        expect(res.json().error).toBe('INVALID_GOOGLE_CREDENTIAL');
      }
      expect(payload).toBeTruthy();
      expect(await db.smeUser.count()).toBe(0);
    });

    it('first sign-in requires the 18+ confirmation; later sign-ins do not', async () => {
      const first = await signIn('young@example.test', { attest: false });
      expect(first.res.statusCode).toBe(400);
      expect(first.res.json().error).toBe('ADULT_ATTESTATION_REQUIRED');
      expect(await db.smeUser.count()).toBe(0);
      expect((await signIn('young@example.test', { attest: true })).res.statusCode).toBe(200);
      expect((await signIn('young@example.test', { attest: false })).res.statusCode).toBe(200);
      expect((await db.smeUser.findFirstOrThrow()).adultAttestedAt).not.toBeNull();
    });

    it('uses the stable Google subject, never the email, as the identity key', async () => {
      const a = await signIn('shared@example.test', { subject: 'google-sub-A' });
      const b = await signIn('shared@example.test', { subject: 'google-sub-B' });
      expect(a.res.json().id).not.toBe(b.res.json().id);
      expect(await db.smeUser.count()).toBe(2);
    });

    it('candidate and internal sessions are separate audiences', async () => {
      const { cookie } = await signIn();
      expect((await get(cookie, '/auth/me')).statusCode).toBe(401);
      expect((await get(cookie, '/projects')).statusCode).toBe(401);
      expect((await get(pm, '/me')).statusCode).toBe(401);
    });

    it('logout revokes the candidate session', async () => {
      const { cookie } = await signIn();
      expect((await post(cookie, '/me/logout')).statusCode).toBe(204);
      expect((await get(cookie, '/me')).statusCode).toBe(401);
    });

    it('the real verifier checks signature, audience, issuer and expiry (local keys, no network)', async () => {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const verifier = new GoogleIdTokenVerifier('our-client-id.apps.googleusercontent.com', async () => ({ kid1: pem }));
      const now = Math.floor(Date.now() / 1000);
      const jwt = (claims: object, key = privateKey) => {
        const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'kid1', typ: 'JWT' })).toString('base64url');
        const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
        const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url');
        return `${h}.${p}.${s}`;
      };
      const base = { iss: 'https://accounts.google.com', aud: 'our-client-id.apps.googleusercontent.com', sub: '1234567890', email: 'x@gmail.com', email_verified: true, iat: now, exp: now + 600 };
      expect(await verifier.verify(jwt(base))).toMatchObject({ subject: '1234567890', emailVerified: true });
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
      for (const bad of [jwt({ ...base, aud: 'someone-else' }), jwt({ ...base, iss: 'https://evil.example' }), jwt({ ...base, exp: now - 3600, iat: now - 7200 }), jwt(base, other)]) {
        await expect(verifier.verify(bad)).rejects.toMatchObject({ code: 'INVALID_GOOGLE_CREDENTIAL' });
      }
    });

    it('production refuses mock sign-in and mock identity', () => {
      expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL })).toThrow(/mocks are local-only/);
    });
  });

  describe('CF-02 Apple is not implemented', () => {
    it('there is no working Apple sign-in endpoint', async () => {
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/apple', payload: {} })).statusCode).toBe(404);
    });
    it('the provider model allows linking another provider to the same account later', async () => {
      const { res } = await signIn();
      const smeUserId = res.json().id;
      await db.providerIdentity.create({ data: { clientId, smeUserId, provider: 'APPLE', subject: 'apple-sub' } });
      expect(await db.providerIdentity.count({ where: { smeUserId } })).toBe(2);
    });
  });

  // ─────────────── CF-04 / CF-05 / CF-06: identity ───────────────

  describe('identity verification', () => {
    async function startIdentity(cookie: string) {
      const res = await post(cookie, '/me/identity/session', { returnTo: '/opportunities/x' });
      expect(res.statusCode, res.body).toBe(200);
      return (await db.identityAttempt.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).providerSessionId;
    }
    const deliver = (rawBody: Buffer, signature: string, requireLive = false) => processIdentityWebhook(db, identity, { requireLive }, rawBody, signature);

    it('starting creates a provider session; an interrupted one is resumed', async () => {
      const { cookie } = await signIn();
      const first = await startIdentity(cookie);
      expect((await get(cookie, '/me/identity')).json()).toMatchObject({ identityStatus: 'REQUIRES_INPUT' });
      const again = await post(cookie, '/me/identity/session', {});
      expect(again.json().url).toContain(first);
      expect(await db.identityAttempt.count()).toBe(1);
    });

    it('CF-04: a browser "success" return is not proof; only the provider result counts', async () => {
      const { cookie } = await signIn();
      await startIdentity(cookie);
      // Returning to /verify changes nothing server-side.
      expect((await get(cookie, '/me/identity')).json().identityStatus).toBe('REQUIRES_INPUT');
      expect((await get(cookie, '/me')).json().nextStep).toBe('VERIFY_IDENTITY');
    });

    it('a signed provider webhook verifies the candidate', async () => {
      const { cookie } = await signIn();
      const sessionId = await startIdentity(cookie);
      const { rawBody, signature } = identity.simulate(sessionId, { status: 'verified', adult: true });
      expect(await deliver(rawBody, signature)).toBe('processed');
      expect((await get(cookie, '/me')).json()).toMatchObject({ identityStatus: 'VERIFIED', nextStep: 'CHOOSE_OPPORTUNITY', identityLabel: 'Identity verified (test mode)' });
      const a = await db.identityAttempt.findFirstOrThrow();
      expect(a.adultConfirmed).toBe(true);
      // Only the over-18 answer is stored: nothing like a date of birth anywhere on the record.
      expect(JSON.stringify(a)).not.toMatch(/dob|birth/i);
    });

    it('CF-05: bad signatures are rejected at the HTTP endpoint', async () => {
      const { cookie } = await signIn();
      const sessionId = await startIdentity(cookie);
      const { rawBody } = identity.simulate(sessionId, { status: 'verified' });
      const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/stripe/identity-webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, payload: rawBody });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SIGNATURE');
      expect((await get(cookie, '/me')).json().identityStatus).toBe('REQUIRES_INPUT');
    });

    it('CF-05: a correctly signed webhook over HTTP is processed from the raw body', async () => {
      const { cookie } = await signIn();
      const sessionId = await startIdentity(cookie);
      const { rawBody, signature } = identity.simulate(sessionId, { status: 'verified' });
      const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/stripe/identity-webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload: rawBody });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().result).toBe('processed');
    });

    it('CF-05: duplicates are ignored and out-of-order events cannot roll status back', async () => {
      const { cookie } = await signIn();
      const sessionId = await startIdentity(cookie);
      const t = Math.floor(Date.now() / 1000);
      const older = identity.simulate(sessionId, { status: 'processing' }, t - 60);
      const newer = identity.simulate(sessionId, { status: 'verified' }, t);
      expect(await deliver(newer.rawBody, newer.signature)).toBe('processed');
      expect(await deliver(newer.rawBody, newer.signature)).toBe('duplicate');
      expect(await deliver(older.rawBody, older.signature)).toBe('stale');
      expect((await get(cookie, '/me')).json().identityStatus).toBe('VERIFIED');
      expect(await db.webhookReceipt.count()).toBe(2);
    });

    it('CF-05: a test-mode result never confers live eligibility where live is required', async () => {
      const { cookie } = await signIn();
      const sessionId = await startIdentity(cookie);
      const { rawBody, signature } = identity.simulate(sessionId, { status: 'verified' });
      await deliver(rawBody, signature, true);
      const me = (await get(cookie, '/me')).json();
      expect(me.identityStatus).not.toBe('VERIFIED');
      expect(me.identityProblem).toMatch(/test mode/);
    });

    it('under-18 results are refused with a non-expertise message; unknown age goes to review', async () => {
      const a = await signIn();
      await deliver(...Object.values(identity.simulate(await startIdentity(a.cookie), { status: 'verified', adult: false })) as [Buffer, string]);
      expect((await get(a.cookie, '/me')).json()).toMatchObject({ identityStatus: 'CANCELED', identityProblem: expect.stringMatching(/18 or over.*not a judgement about your expertise/) });
      expect(isAdult({ day: 1, month: 1, year: 2010 }, new Date('2026-09-26'))).toBe(false);
      expect(isAdult({ day: 26, month: 9, year: 2008 }, new Date('2026-09-26'))).toBe(true);
      expect(isAdult({ day: 27, month: 9, year: 2008 }, new Date('2026-09-26'))).toBe(false);
      expect(isAdult(null)).toBeNull();
    });

    it('#50: a confirmed under-18 result blocks application start/resume and pending checks cannot hide it', async () => {
      const a = await signIn();
      const { opportunityId } = await staffingProjectWithOpportunity();
      const existing = (await post(a.cookie, '/me/enrollments', { opportunityId })).json();
      const attempt = await startIdentity(a.cookie);
      const result = identity.simulate(attempt, { status: 'verified', adult: false });
      await deliver(result.rawBody, result.signature);
      expect((await get(a.cookie, '/me')).json().applicationBlockReason).toMatch(/18 or over/);
      expect((await post(a.cookie, '/me/enrollments', { opportunityId })).json().error).toBe('AGE_RESTRICTION');
      const s = (await get(a.cookie, `/me/enrollments/${existing.id}/conversation`)).json();
      const submit = await post(a.cookie, `/me/enrollments/${existing.id}/submit`, { expectedRevision: s.session.revision, confirmAccuracy: true, evidencePermission: true });
      expect(submit.statusCode).toBe(403);
      expect(submit.json().message).toMatch(/18 or over/);
      const fresh = await staffingProjectWithOpportunity();
      expect((await post(a.cookie, '/me/enrollments', { opportunityId: fresh.opportunityId })).statusCode).toBe(403);
      expect(await db.enrollment.count()).toBe(1);
      const pending = await startIdentity(a.cookie);
      expect((await get(a.cookie, '/me')).json().applicationBlockReason).toMatch(/18 or over/);
      expect((await post(a.cookie, '/me/enrollments', { opportunityId: fresh.opportunityId })).statusCode).toBe(403);
      // A test-only result must not impose a live restriction where live checks are required.
      expect(await applicationBlockReason(db, a.res.json().id, true)).toBeNull();
      const adult = identity.simulate(pending, { status: 'verified', adult: true });
      await deliver(adult.rawBody, adult.signature);
      expect((await get(a.cookie, '/me')).json().applicationBlockReason).toBeNull();
      expect((await post(a.cookie, '/me/enrollments', { opportunityId: fresh.opportunityId })).statusCode).toBe(200);
    });

    it('CF-06: "needs more input" allows a retry and keeps saved progress', async () => {
      const { cookie } = await signIn();
      const { opportunityId } = await staffingProjectWithOpportunity();
      const enrollment = (await post(cookie, '/me/enrollments', { opportunityId })).json();
      const sessionId = await startIdentity(cookie);
      const r = identity.simulate(sessionId, { status: 'requires_input', errorCode: 'document_expired' });
      await deliver(r.rawBody, r.signature);
      const me = (await get(cookie, '/me')).json();
      expect(me.identityStatus).toBe('REQUIRES_INPUT');
      expect(me.identityProblem).toMatch(/document expired.*try again/);
      expect(me.enrollments.map((e: { id: string }) => e.id)).toEqual([enrollment.id]);
      expect((await post(cookie, '/me/identity/session', {})).statusCode).toBe(200);
    });

    it('CF-06: unsupported documents lead to help and an approved alternative, never "Stripe verified"', async () => {
      const { res, cookie } = await signIn();
      const help = await post(cookie, '/me/identity/help', { reason: 'UNSUPPORTED_COUNTRY', note: 'My ID type is not listed' });
      expect(help.json()).toMatchObject({ identityStatus: 'MANUAL_REVIEW_REQUIRED', identityProblem: expect.stringMatching(/alternative/) });
      const queue = (await get(admin, '/review/identity')).json().items;
      expect(queue).toEqual([expect.objectContaining({ smeUserId: res.json().id, reason: 'UNSUPPORTED_COUNTRY' })]);
      expect((await get(pm, '/review/identity')).statusCode).toBe(403);
      const d = await post(admin, `/review/identity/${res.json().id}/decision`, { outcome: 'ALTERNATIVE_VERIFIED', method: 'Live video check with the document shown, not recorded' });
      expect(d.json().identityStatus).toBe('ALTERNATIVE_VERIFIED');
      expect((await get(cookie, '/me')).json().identityLabel).toBe('Identity verified (alternative process)');
      expect(await db.alternativeIdentityCheck.count()).toBe(1);
    });

    it('#69: identity queue and decisions require a current project assignment', async () => {
      const { res, cookie } = await signIn();
      const { projectId, opportunityId } = await staffingProjectWithOpportunity();
      await post(cookie, '/me/enrollments', { opportunityId });
      await post(cookie, '/me/identity/help', { reason: 'UNSUPPORTED_COUNTRY' });
      const decision = `/review/identity/${res.json().id}/decision`;
      const body = { outcome: 'ALTERNATIVE_VERIFIED', method: 'Approved alternative process' };
      expect((await get(reviewer, '/review/identity')).json().items).toEqual([]);
      expect((await post(reviewer, decision, body)).statusCode).toBe(404);
      expect(await db.alternativeIdentityCheck.count()).toBe(0);
      await post(admin, `/projects/${projectId}/reviewers`, { userId: reviewerId });
      expect((await get(reviewer, '/review/identity')).json().items).toEqual([expect.objectContaining({ smeUserId: res.json().id })]);
      await db.projectReviewer.deleteMany({ where: { projectId, userId: reviewerId } });
      expect((await post(reviewer, decision, body)).statusCode).toBe(404);
      expect((await get(cookie, '/me')).json().identityStatus).toBe('MANUAL_REVIEW_REQUIRED');
      await post(admin, `/projects/${projectId}/reviewers`, { userId: reviewerId });
      expect((await post(reviewer, decision, body)).statusCode).toBe(200);
      expect(await db.alternativeIdentityCheck.count()).toBe(1);
      const foreign = await db.smeUser.create({ data: { clientId: (await createClient()).id, displayName: 'Other tenant', identityStatus: 'MANUAL_REVIEW_REQUIRED' } });
      expect((await get(admin, '/review/identity')).json().items).toEqual([]);
      expect((await post(admin, `/review/identity/${foreign.id}/decision`, body)).statusCode).toBe(404);
      expect((await post(reviewer, `/review/identity/${foreign.id}/decision`, body)).statusCode).toBe(404);
      expect(await db.alternativeIdentityCheck.count()).toBe(1);
    });

    it('the dev simulation endpoint only works on the caller’s own session', async () => {
      const a = await signIn();
      const b = await signIn();
      const sessionId = await startIdentity(a.cookie);
      expect((await post(b.cookie, `/dev/identity/${sessionId}/simulate`, { status: 'verified' })).statusCode).toBe(401);
      expect((await post(a.cookie, `/dev/identity/${sessionId}/simulate`, { status: 'verified' })).json().result).toBe('processed');
    });
  });

  // ─────────────── CF-07: opportunity ───────────────

  describe('CF-07 opportunity: candidates read the published version; only the owner imports, edits and publishes', () => {
    it('the draft is pre-filled from the project and JD, including wage and never invented terms', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const view = (await get(pm, `/projects/${projectId}/opportunity`)).json();
      expect(view.status).toBe('PUBLISHED');
      expect(view.draft.brief).toMatchObject({ title: 'KYC Analyst', compensation: '40 GBP per accepted task', contributionRoles: ['TASK_AUTHOR'] });
      expect(view.draft.brief.doNotDisclose).toMatch(/real customer information/);
    });

    it('public readers see the published version only, without signing in', async () => {
      const { projectId, opportunityId } = await staffingProjectWithOpportunity();
      const brief = (await get(pm, `/projects/${projectId}/opportunity`)).json().draft.brief;
      await put(pm, `/projects/${projectId}/opportunity/draft`, { brief: { ...brief, title: 'Unpublished edit' }, criteria: [{ id: 'kyc', text: 'KYC casework', kind: 'REQUIRED' }] });
      const pub = await get('', `/opportunities/${opportunityId}`);
      expect(pub.statusCode).toBe(200);
      expect(pub.json()).toMatchObject({ version: 1, brief: { title: 'KYC Analyst' } });
      expect(JSON.stringify(pub.json())).not.toMatch(/ownerId|clientId|projectId/);
      await post(pm, `/projects/${projectId}/opportunity/publish`);
      expect((await get('', `/opportunities/${opportunityId}`)).json()).toMatchObject({ version: 2, brief: { title: 'Unpublished edit' } });
    });

    it('only the owning PM or an Admin can edit or publish; candidates and other PMs cannot', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
      const { cookie } = await signIn();
      expect((await post(otherPm, `/projects/${projectId}/opportunity/publish`)).statusCode).toBe(404);
      expect((await post(cookie, `/projects/${projectId}/opportunity/publish`)).statusCode).toBe(401);
      expect((await post(reviewer, `/projects/${projectId}/opportunity/publish`)).statusCode).toBe(403);
      expect((await post(admin, `/projects/${projectId}/opportunity/publish`)).statusCode).toBe(200);
    });

    it('publishing needs the parts candidates must read before committing', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const brief = (await get(pm, `/projects/${projectId}/opportunity`)).json().draft.brief;
      await put(pm, `/projects/${projectId}/opportunity/draft`, { brief: { ...brief, whatWeWillAsk: '', contributionRoles: [] }, criteria: [] });
      const res = await post(pm, `/projects/${projectId}/opportunity/publish`);
      expect(res.statusCode).toBe(422);
      expect(res.json().details.problems.join()).toMatch(/contribution role.*What we will ask.*criterion/);
    });

    it('an imported document must be reviewed and confirmed before it is used; publishing waits for it', async () => {
      const { projectId, opportunityId } = await staffingProjectWithOpportunity();
      const upload = await uploadDocument(projectId, pdfWithText('KYC Analyst. Review onboarding files for corporate customers. Escalate high risk cases to the MLRO.'), 'jd.pdf');
      expect(upload.statusCode, upload.body).toBe(201);
      const doc = upload.json().documents[0];
      expect(doc).toMatchObject({ status: 'PENDING_REVIEW', filename: 'jd.pdf' });
      expect(doc.extractedText).toMatch(/Escalate high risk cases/);
      expect((await post(pm, `/projects/${projectId}/opportunity/publish`)).json().error).toBe('DOCUMENT_PENDING_REVIEW');

      const confirmed = await post(pm, `/projects/${projectId}/opportunity/documents/${doc.id}/confirm`, { text: `${doc.extractedText}\n(Checked by the PM.)` });
      expect(confirmed.json().draft.brief.fullDescription).toMatch(/Checked by the PM/);
      await post(pm, `/projects/${projectId}/opportunity/publish`);
      expect((await get('', `/opportunities/${opportunityId}`)).json().brief.fullDescription).toMatch(/Checked by the PM/);
    });

    it('unreadable or unsupported files are refused with a request to paste text', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const scanned = await uploadDocument(projectId, pdfWithText(''), 'scan.pdf');
      expect(scanned.statusCode).toBe(422);
      expect(scanned.json().error).toBe('NO_TEXT_FOUND');
      const exe = await uploadDocument(projectId, Buffer.from('MZ\x90\x00 not a document'), 'jd.pdf');
      expect(exe.statusCode).toBe(415);
      expect(await db.opportunityDocument.count()).toBe(0);
    });

    it('DOCX files are read too', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const res = await uploadDocument(projectId, await docxWithText('Senior EDD reviewer. Assess source of wealth evidence for high-risk customers.'), 'jd.docx');
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().documents[0].extractedText).toMatch(/source of wealth/);
    });

    it('a closed opportunity accepts no new enrollments', async () => {
      const { projectId, opportunityId } = await staffingProjectWithOpportunity();
      await post(pm, `/projects/${projectId}/opportunity/close`);
      const { cookie } = await signIn();
      expect((await post(cookie, '/me/enrollments', { opportunityId })).json().error).toBe('OPPORTUNITY_CLOSED');
    });
  });

  // ─────────────── CF-03 and SPEC FLOW 2 campaign criteria ───────────────

  describe('campaigns and the apply path', () => {
    it('launching a campaign produces a post with wage, location and a tracked apply link', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const res = await post(pm, `/projects/${projectId}/campaigns`, { channel: 'LINKEDIN_MANUAL' });
      expect(res.statusCode, res.body).toBe(201);
      const c = res.json();
      expect(c).toMatchObject({ status: 'LIVE', channel: 'LINKEDIN_MANUAL', applyUrl: `http://localhost:3101/apply/${c.id}` });
      expect(c.postText).toContain('Pay: 40 GBP per accepted task');
      expect(c.postText).toContain('Location: Hybrid (London, UK)');
      expect(c.postText).toContain(c.applyUrl);
      expect(c.instructions).toMatch(/Apply on company website/);
      expect((await post(pm, `/projects/${projectId}/campaigns`, {})).json().error).toBe('CAMPAIGN_ACTIVE');
    });

    it('needs a published opportunity; Apply Connect is not enabled', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      await post(pm, `/projects/${projectId}/opportunity/close`);
      expect((await post(pm, `/projects/${projectId}/campaigns`, {})).json().error).toBe('OPPORTUNITY_NOT_PUBLISHED');
      const other = await staffingProjectWithOpportunity();
      expect((await post(pm, `/projects/${other.projectId}/campaigns`, { channel: 'LINKEDIN_APPLY_CONNECT' })).statusCode).toBe(501);
    });

    it('CF-03: the tracked link counts clicks and every applicant is attributed to the campaign', async () => {
      const { projectId, opportunityId } = await staffingProjectWithOpportunity();
      const c = (await post(pm, `/projects/${projectId}/campaigns`, {})).json();
      const click = await app.inject({ method: 'POST', url: `/api/v1/public/campaigns/${c.id}/click`, payload: {} });
      expect(click.json()).toEqual({ opportunityId, live: true });

      const { cookie } = await signIn();
      const e = await post(cookie, '/me/enrollments', { opportunityId, campaignId: c.id });
      expect(e.json()).toMatchObject({ status: 'DRAFT', opportunityId, version: 1 });
      // Resuming does not create a second enrollment or application.
      expect((await post(cookie, '/me/enrollments', { opportunityId, campaignId: c.id })).json().id).toBe(e.json().id);
      const metrics = (await get(pm, `/campaigns/${c.id}`)).json().metrics;
      expect(metrics).toMatchObject({ clicks: 1, applies: 1, kycCompleted: 0 });
    });

    it('pause, resume and close; clicks on a paused campaign are not counted', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const c = (await post(pm, `/projects/${projectId}/campaigns`, {})).json();
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/campaigns/${c.id}`, headers: { cookie: pm, ...idem() }, payload: { status: 'PAUSED' } })).json().status).toBe('PAUSED');
      await app.inject({ method: 'POST', url: `/api/v1/public/campaigns/${c.id}/click`, payload: {} });
      expect((await post(pm, `/campaigns/${c.id}/close`)).json()).toMatchObject({ status: 'CLOSED', metrics: { clicks: 0 } });
    });

    it('the campaign closes automatically when the project is STAFFED', async () => {
      const { projectId } = await staffingProjectWithOpportunity();
      const c = (await post(pm, `/projects/${projectId}/campaigns`, {})).json();
      const a = await createCandidate(clientId);
      const b = await createCandidate(clientId);
      await post(pm, `/projects/${projectId}/match`);
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id, b.id] })).json().status).toBe('STAFFED');
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'project.staffed' } });
      await processDomainEvent(db, defaultHandlers(), ev.id);
      expect((await get(pm, `/campaigns/${c.id}`)).json().status).toBe('CLOSED');
      expect(await db.auditEvent.count({ where: { entityId: c.id, action: 'campaign.closed', actorType: 'SYSTEM' } })).toBe(1);
    });

    it('auto-launches when enabled on the project and there is a shortfall', async () => {
      const { projectId } = await staffingProjectWithOpportunity({ autoLaunchCampaign: true });
      // The opportunity was published after the first match; the next match run launches it.
      await post(pm, `/projects/${projectId}/match`);
      const list = (await get(pm, `/projects/${projectId}/campaigns`)).json().items;
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe('LIVE');
    });
  });

  // ─── helpers: tiny real PDF and DOCX files ───

  async function uploadDocument(projectId: string, buf: Buffer, filename: string) {
    const boundary = `----praxis${randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/opportunity/documents`,
      headers: { cookie: pm, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }
});
