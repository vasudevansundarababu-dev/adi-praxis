import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_ITEMS, ONBOARDING_VERSION, RETAKE_COOLDOWN_HOURS, TIER_DEFAULTS, type SmeTier } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MockCurriculumGenerator } from '../src/cert/generator';
import { FLAG_AFTER, keyOf } from '../src/cert/items';
import { MockSelfieCheck } from '../src/cert/selfie';
import { MemoryEmailSender } from '../src/lib/email';
import { secretBox } from '../src/lib/secrets';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

/** Synthetic KYC guidelines: a threshold, workflow steps, document rules and an escalation rule, each in a section. */
const GUIDELINES = `# 1. Scope
These guidelines cover onboarding of corporate customers for know-your-customer checks at a synthetic bank called Northwind Mutual.

# 2. Beneficial ownership
Any person who holds 25% or more of the customer, directly or through other entities, is a beneficial owner. Beneficial owners must always be identified and verified before approval.

# 3. Workflow
First check the company registry for the customer. Then resolve the ownership structure. Next screen every controller against sanctions lists. Then rate the risk of the relationship. Finally escalate or recommend the decision.

# 4. Documents
A utility bill older than 3 months must be replaced. An expired passport must never be accepted as proof of identity.

# 5. Escalation
A high-risk rating must be escalated to the approver for sign-off before any approval is recorded.
`;

describe('M10b guidelines, courses and certification (docs/SME-SUPPLY.md sections 6, 7 and 13)', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig({ SME_SUPPLY_ENABLED: 'true' });
  const box = secretBox(config);
  const embeddings = new HashingEmbeddingProvider();
  // Families listed here get a solver that disagrees with the derived key (check 2 fails).
  const badSolver = new Set<string>();
  const gen = new MockCurriculumGenerator({ wrongSolverFor: (id) => badSolver.has(id) });
  const selfie = new MockSelfieCheck();
  const handlers = defaultHandlers({ config, cert: { gen, box, embeddings } });
  let clientId: string;
  let admin: string;
  let adminId: string;
  let pm: string;
  let validator: string;
  let validator2: string;

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, selectionGate: stubSelectionGate, email, storage: new MemoryStorage(), embeddings, curriculum: gen, selfie });
  });
  beforeEach(async () => {
    await resetDb();
    email.sent.length = 0;
    badSolver.clear();
    const { client, admin: a } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    adminId = a.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    validator = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    validator2 = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const put = (cookie: string, url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const api = (token: string, url: string, payload: object) => app.inject({ method: 'POST', url: `/partner/v1${url}`, headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, payload });

  /** Runs every queued generation run (the worker's job). */
  async function drain() {
    for (const ev of await db.outboxEvent.findMany({ where: { name: 'guidelines.generate' }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers, ev.id);
  }

  async function upload(packageId: string, text = GUIDELINES) {
    const boundary = `----praxis${randomUUID()}`;
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="major"\r\n\r\ntrue\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="kyc-guidelines.md"\r\nContent-Type: text/markdown\r\n\r\n`),
      Buffer.from(text),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({ method: 'POST', url: `/api/v1/guidelines/packages/${packageId}/versions`, headers: { cookie: admin, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  }

  /** Package + uploaded version, generated by the (mock) pipeline. */
  async function guidelines() {
    const p = await post(admin, '/guidelines/packages', { domain: 'banking', taskFamily: 'KYC onboarding', name: 'Northwind KYC guidelines' });
    expect(p.statusCode, p.body).toBe(201);
    const v = await upload(p.json().id);
    expect(v.statusCode, v.body).toBe(201);
    await drain();
    return { packageId: p.json().id as string, versionId: v.json().id as string };
  }

  const version = async (id: string) => (await get(admin, `/guidelines/versions/${id}`)).json();

  /** Approves the course, blueprint and every family of a tier (Expert families also by a Validator), then publishes. */
  async function publishTier(versionId: string, tier: SmeTier) {
    const t = (await version(versionId)).tiers.find((x: { tier: string }) => x.tier === tier);
    expect((await post(admin, `/courses/${t.course.id}/decision`, { decision: 'APPROVE' })).statusCode).toBe(200);
    expect((await post(admin, `/blueprints/${t.blueprint.id}/decision`, { decision: 'APPROVE' })).statusCode).toBe(200);
    const bp = (await get(admin, `/blueprints/${t.blueprint.id}`)).json();
    for (const f of bp.families.filter((x: { status: string }) => x.status === 'DRAFT')) {
      const a = await post(admin, `/item-families/${f.id}/decision`, { decision: 'APPROVE' });
      expect(a.statusCode, a.body).toBe(200);
      if (tier === 'EXPERT') {
        expect(a.json().status).toBe('DRAFT');
        expect((await post(validator, `/item-families/${f.id}/decision`, { decision: 'APPROVE' })).json().status).toBe('APPROVED');
      } else expect(a.json().status).toBe('APPROVED');
    }
    const res = await post(admin, `/guidelines/versions/${versionId}/tiers/${tier}/publish`);
    expect(res.statusCode, res.body).toBe(200);
    return bp;
  }

  // ── Requisition and a selected candidate who came through it (M10a flow, selection as a fixture) ──
  async function supplyProject() {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    await post(admin, `/templates/${t.id}/publish`);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author synthetic KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { templateId: t.id, name: `P ${randomUUID().slice(0, 6)}`, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['IN', 'GB'], required: false }] })).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/opportunity/publish`)).statusCode).toBe(200);
    await post(pm, `/projects/${p.id}/sme-supply`, { enabled: true });
    return p.id as string;
  }

  async function livePartner() {
    const p = (await post(admin, '/partners', { name: `Partner ${randomUUID().slice(0, 4)}`, businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] })).json();
    const userEmail = `ops.${randomUUID().slice(0, 6)}@partner.example`;
    await post(admin, `/partners/${p.id}/users`, { email: userEmail, name: 'Ops Lead', password: 'partner-password-1' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/partner-portal/login', payload: { email: userEmail, password: 'partner-password-1' } });
    const portal = `praxis_partner=${res.cookies.find((c) => c.name === 'praxis_partner')!.value}`;
    const c = (await post(portal, '/partner-portal/clients', { environment: 'LIVE' })).json();
    const tok = await app.inject({ method: 'POST', url: '/partner/v1/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `grant_type=client_credentials&client_id=${c.clientId}&client_secret=${c.clientSecret}` });
    return { id: p.id as string, token: tok.json().access_token as string };
  }

  async function requisition(projectId: string, partnerId: string, tier: SmeTier, packageId: string, extra: object = {}) {
    const r = (await post(pm, '/requisitions', { projectId, title: `KYC ${tier.toLowerCase()}s (India)`, summary: 'Label KYC onboarding decisions.', domain: 'banking', tier, headcount: 10, languages: ['en'], jurisdictions: ['IN'], minimumRequirements: { minYears: 2, qualifications: [], licenceRequired: false }, allowedPartnerIds: [partnerId], maxPerPartner: 50, ...extra })).json();
    expect(r.id, JSON.stringify(r)).toBeTruthy();
    expect((await put(pm, `/requisitions/${r.id}/guidelines`, { packageId })).statusCode).toBe(200);
    expect((await post(pm, `/requisitions/${r.id}/transition`, { to: 'OPEN' })).statusCode).toBe(200);
    return r.id as string;
  }

  const mobile = () => `+91 9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  /** A person submitted by the partner, invited, signed in and (as a fixture) selected by a person, with a C07 checklist. */
  async function candidate(requisitionId: string, partner: { token: string }) {
    const who = { partnerRef: `ref-${randomUUID().slice(0, 8)}`, name: 'Priya Raman', email: `priya.${randomUUID().slice(0, 6)}@example.test`, phone: mobile(), country: 'IN', experienceSummary: 'Four years of KYC onboarding review at a retail bank, including beneficial ownership checks.', experienceYears: 4, qualifications: ['CAMS'], languages: ['en'], partnerTrainingAttestation: true, candidateConsent: true };
    const sent = email.sent.length;
    const sub = await api(partner.token, `/requisitions/${requisitionId}/candidates`, who);
    expect(sub.statusCode, sub.body).toBe(201);
    const token = email.sent.slice(sent).find((m) => m.to === who.email)!.text.match(/\/partner-invite\/(\S+)/)![1]!;
    const credential = google.mint({ subject: `sub-${who.email}`, email: who.email, name: who.name });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential, adultAttested: true } });
    const cookie = `praxis_candidate=${res.cookies.find((c) => c.name === 'praxis_candidate')!.value}`;
    const smeUserId = res.json().id as string;
    const red = await post(cookie, '/me/partner-invites/redeem', { token });
    expect(red.statusCode, red.body).toBe(200);
    const enrollmentId = red.json().enrollmentId as string;
    // Selection is FLOW 2's human decision (tested in selection.test.ts); here it is a fixture.
    const last = await db.profileVersion.findFirst({ where: { smeUserId }, orderBy: { version: 'desc' } });
    const pv = await db.profileVersion.create({ data: { clientId, smeUserId, enrollmentId, version: (last?.version ?? 0) + 1, data: {}, contentHash: randomUUID(), submittedAt: new Date() } });
    const d = await db.selectionDecision.create({ data: { clientId, enrollmentId, reviewerId: adminId, outcome: 'SELECTED', reasons: [], profileVersionId: pv.id, criteriaRef: {} } });
    await db.qualificationScope.create({ data: { clientId, enrollmentId, selectionDecisionId: d.id, domain: 'Banking', specialty: 'KYC', jurisdictions: ['IN'], languages: ['en'], contributionRoles: ['TASK_AUTHOR'] } });
    await db.enrollment.update({ where: { id: enrollmentId }, data: { status: 'SELECTED', profileVersionId: pv.id } });
    await db.onboardingChecklist.create({ data: { clientId, enrollmentId, checklistVersion: ONBOARDING_VERSION, items: ONBOARDING_ITEMS.map((i) => i.key), status: 'NOT_STARTED' } });
    return { cookie, smeUserId, enrollmentId };
  }
  type Cand = Awaited<ReturnType<typeof candidate>>;

  async function certificationOf(c: Cand, tier: SmeTier) {
    const list = await get(c.cookie, '/me/certifications');
    expect(list.statusCode, list.body).toBe(200);
    const cert = list.json().items.find((x: { tier: string }) => x.tier === tier);
    expect(cert, list.body).toBeTruthy();
    return cert.id as string;
  }

  async function train(c: Cand, certId: string) {
    const course = (await get(c.cookie, `/me/certifications/${certId}/course`)).json();
    for (const m of course.modules) {
      const res = await post(c.cookie, `/me/certifications/${certId}/modules/${m.id}/complete`, { answers: [0, 0] });
      expect(res.json().passed, res.body).toBe(true);
    }
    return course;
  }

  async function start(c: Cand, certId: string) {
    const s = await post(c.cookie, `/me/certifications/${certId}/selfie`);
    expect(s.statusCode, s.body).toBe(201);
    const res = await post(c.cookie, `/me/certifications/${certId}/test/start`, { sessionRef: s.json().sessionRef });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { attemptId: string; deadlineAt: string; startedAt: string; items: { id: string; itemType: string; stem: string }[] };
  }

  const WRITTEN = ['JUSTIFICATION', 'CRITIQUE', 'AUTHORING'];
  /** Answers every item: correct (from the derived key) or deliberately wrong; written items get `writing`. */
  async function answerAll(c: Cand, attempt: Awaited<ReturnType<typeof start>>, correct: boolean, writing = 'Short answer.') {
    const answers: Record<string, string | string[]> = {};
    for (const item of attempt.items) {
      if (WRITTEN.includes(item.itemType)) {
        answers[item.id] = writing;
        continue;
      }
      const key = keyOf(box, (await db.itemInstance.findUniqueOrThrow({ where: { id: item.id } })).keyEnc) as string | string[];
      answers[item.id] = correct ? key : Array.isArray(key) ? ['not-a-step'] : 'not an option';
    }
    const res = await put(c.cookie, `/me/test-attempts/${attempt.attemptId}/answers`, { answers });
    expect(res.statusCode, res.body).toBe(200);
    const sub = await post(c.cookie, `/me/test-attempts/${attempt.attemptId}/submit`);
    expect(sub.statusCode, sub.body).toBe(200);
    return sub.json() as { status: string; result: string };
  }

  const certState = async (id: string) => db.certification.findUniqueOrThrow({ where: { id } });

  describe('feature flag', () => {
    it('with the flag off no guidelines, certification or test route and no generation handler exist', async () => {
      const off = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
      for (const [method, url] of [['GET', '/api/v1/guidelines/packages'], ['POST', '/api/v1/guidelines/packages'], ['GET', '/api/v1/me/certifications'], ['GET', '/api/v1/certifications/review-queue'], [`POST`, `/api/v1/me/test-attempts/${randomUUID()}/submit`]] as const) {
        expect((await off.inject({ method, url, payload: {} })).statusCode, url).toBe(404);
      }
      await off.close();
      expect(defaultHandlers({ config: testConfig(), cert: { gen, box, embeddings } }).for('guidelines.generate')).toEqual([]);
      expect(handlers.for('guidelines.generate').map((h) => h.name)).toEqual(['m10.guidelines-generate']);
    });
  });

  describe('guidelines to course, blueprint and item families', () => {
    it('uploading guidelines produces, per tier, a cited knowledge map, course, blueprint and item families; nothing is served until approved and published', async () => {
      const { packageId, versionId } = await guidelines();
      const v = await version(versionId);
      expect(v.status).toBe('IN_REVIEW');
      expect(v.runs[0]).toMatchObject({ scope: 'FULL', status: 'SUCCEEDED', model: 'mock-curriculum-1' });
      const anchors = new Set(v.sections.map((s: { anchor: string }) => s.anchor));
      expect(v.knowledge.length).toBeGreaterThan(5);
      expect(v.knowledge.every((k: { citation: string }) => anchors.has(k.citation))).toBe(true);
      for (const tier of ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] as const) {
        const t = v.tiers.find((x: { tier: string }) => x.tier === tier);
        expect(t.course).toMatchObject({ status: 'DRAFT' });
        expect(t.course.modules).toBeGreaterThan(1);
        expect(t.blueprint).toMatchObject({ status: 'DRAFT', itemCount: TIER_DEFAULTS[tier].itemCount, timeLimitMinutes: TIER_DEFAULTS[tier].timeLimitMinutes });
        expect(t.published).toBe(false);
        expect(t.readyToPublish).toBe(false);
        const bp = (await get(admin, `/blueprints/${t.blueprint.id}`)).json();
        expect(bp.competencies.reduce((n: number, c: { weight: number }) => n + c.weight, 0)).toBe(100);
        for (const f of bp.families) {
          expect(anchors.has(f.citation)).toBe(true);
          expect(f.samples.length).toBeGreaterThan(0);
          // Reviewers see each sample's derived key and its four checks.
          expect(f.samples[0].validation).toMatchObject({ rule: true, solver: true, citation: true, difficulty: true, nearCopy: false });
        }
        const course = (await get(admin, `/courses/${t.course.id}`)).json();
        expect(course.modules.every((m: { citations: string[] }) => m.citations.every((a) => anchors.has(a)))).toBe(true);
      }

      // Publishing needs the approvals first.
      const early = await post(admin, `/guidelines/versions/${versionId}/tiers/ANNOTATOR/publish`);
      expect(early.statusCode).toBe(409);
      expect(early.json().error).toBe('NOT_READY_TO_PUBLISH');
      // Only an Admin publishes; a Validator cannot.
      expect((await post(validator, `/guidelines/versions/${versionId}/tiers/ANNOTATOR/publish`)).statusCode).toBe(403);

      // A selected candidate gets no certification (so no course or test) until the tier is published.
      const projectId = await supplyProject();
      const partner = await livePartner();
      const r = await requisition(projectId, partner.id, 'ANNOTATOR', packageId);
      const c = await candidate(r, partner);
      expect((await get(c.cookie, '/me/certifications')).json().items).toEqual([]);
      expect(await db.testForm.count()).toBe(0);

      const detail = async () => (await app.inject({ method: 'GET', url: `/partner/v1/requisitions/${r}`, headers: { authorization: `Bearer ${partner.token}` } })).json();
      expect(await detail()).toMatchObject({ guidelinesSummary: null, courseOutline: null });
      await publishTier(versionId, 'ANNOTATOR');
      expect((await version(versionId)).tiers.find((x: { tier: string }) => x.tier === 'ANNOTATOR')).toMatchObject({ published: true });
      // Partners see the summary and the course outline, never items, answers or scoring rules.
      const d = await detail();
      expect(d.guidelinesSummary).toMatchObject({ name: 'Northwind KYC guidelines', version: 1, sections: expect.arrayContaining(['2. Beneficial ownership']) });
      expect(d.courseOutline).toMatchObject({ tier: 'ANNOTATOR', test: { questions: 25, timeLimitMinutes: 40 } });
      expect(d.courseOutline.modules.length).toBeGreaterThan(1);
      expect(JSON.stringify(d)).not.toMatch(/passRules|answerRule|stem|quiz|overallPct/);
      const certId = await certificationOf(c, 'ANNOTATOR');
      expect((await get(c.cookie, `/me/certifications/${certId}/course`)).statusCode).toBe(200);
      // A published tier cannot be regenerated or edited; a new version is needed.
      expect((await post(admin, `/guidelines/versions/${versionId}/regenerate`, { scope: 'COURSE', tier: 'ANNOTATOR' })).json().error).toBe('TIER_PUBLISHED');

      const audit = (await db.auditEvent.findMany({ where: { action: { startsWith: 'cert.' } } })).map((a) => a.action);
      expect(audit).toEqual(expect.arrayContaining(['cert.package_created', 'cert.guidelines_uploaded', 'cert.generation_completed', 'cert.course_approved', 'cert.blueprint_approved', 'cert.family_approved', 'cert.tier_published', 'cert.opened']));
    });

    it('guidelines without enough text are refused, and the source file is kept privately for Admins', async () => {
      const p = (await post(admin, '/guidelines/packages', { domain: 'banking', taskFamily: 'KYC onboarding', name: 'Short' })).json();
      const res = await upload(p.id, '# Title\nToo short.');
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('GUIDELINES_TOO_SHORT');
      const { versionId } = await guidelines().catch(() => ({ versionId: '' }));
      expect(versionId).toBe(''); // the package already exists for this domain and task family
      const v = await upload(p.id);
      expect((await get(admin, `/guidelines/versions/${v.json().id}/source`)).body).toContain('Beneficial ownership');
      expect((await get(validator, `/guidelines/versions/${v.json().id}/source`)).statusCode).toBe(403);
    });
  });

  describe('item validation', () => {
    it('every served item passed all four checks; failed items are discarded and regenerated, and a family is flagged after repeated failures', async () => {
      const { versionId } = await guidelines();
      const t = (await version(versionId)).tiers.find((x: { tier: string }) => x.tier === 'ANNOTATOR');
      const bp = (await get(admin, `/blueprints/${t.blueprint.id}`)).json();
      const fam = bp.families[0];
      badSolver.add(fam.id);
      // Each sample request tries three times; after FLAG_AFTER consecutive failures the family is flagged.
      for (let i = 0; i < Math.ceil(FLAG_AFTER / 3); i++) {
        expect((await post(admin, `/item-families/${fam.id}/samples`)).statusCode).toBe(202);
        await drain();
      }
      const flagged = await db.itemFamily.findUniqueOrThrow({ where: { id: fam.id } });
      expect(flagged.status).toBe('FLAGGED');
      expect(flagged.stats).toMatchObject({ consecutiveFailures: FLAG_AFTER });
      const discarded = await db.itemInstance.findMany({ where: { familyId: fam.id, status: 'DISCARDED' } });
      expect(discarded).toHaveLength(FLAG_AFTER);
      expect(discarded.every((d) => (d.validation as { solver: boolean }).solver === false)).toBe(true);
      expect((await db.generationRun.findFirstOrThrow({ where: { scope: 'SAMPLE' }, orderBy: { createdAt: 'desc' } })).status).toBe('FAILED');
      expect(await db.auditEvent.count({ where: { action: 'cert.family_flagged', entityId: fam.id } })).toBe(1);
      const approve = await post(admin, `/item-families/${fam.id}/decision`, { decision: 'APPROVE' });
      expect(approve.json().error).toBe('FAMILY_FLAGGED');

      // An Admin edits the flagged family; it goes back to draft and needs new samples and approval.
      badSolver.clear();
      expect((await app.inject({ method: 'PATCH', url: `/api/v1/item-families/${fam.id}`, headers: { cookie: admin, ...idem() }, payload: { difficultyMin: 1 } })).statusCode).toBe(200);
      expect((await post(admin, `/item-families/${fam.id}/decision`, { decision: 'APPROVE' })).json().error).toBe('NO_SAMPLES');
      await post(admin, `/item-families/${fam.id}/samples`);
      await drain();
      await publishTier(versionId, 'ANNOTATOR');

      // Served forms only ever contain VALID instances that passed every check, with the answer hidden from candidates.
      const { packageId } = { packageId: (await db.guidelinesVersion.findUniqueOrThrow({ where: { id: versionId } })).packageId };
      const partner = await livePartner();
      const r = await requisition(await supplyProject(), partner.id, 'ANNOTATOR', packageId);
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'ANNOTATOR');
      await train(c, certId);
      const attempt = await start(c, certId);
      expect(JSON.stringify(attempt)).not.toMatch(/keyEnc|"key"|answerRule/);
      const served = await db.itemInstance.findMany({ where: { id: { in: attempt.items.map((i) => i.id) } } });
      expect(served).toHaveLength(attempt.items.length);
      for (const i of served) {
        expect(i.status).toBe('VALID');
        expect(i.validation).toMatchObject({ rule: true, solver: true, citation: true, difficulty: true, nearCopy: false });
      }
    });
  });

  describe('taking a certification', () => {
    async function annotatorSetup() {
      const { packageId, versionId } = await guidelines();
      await publishTier(versionId, 'ANNOTATOR');
      const partner = await livePartner();
      const r = await requisition(await supplyProject(), partner.id, 'ANNOTATOR', packageId);
      return { packageId, versionId, partner, r };
    }

    it('the course enforces module order and the test needs the course and a fresh selfie check', async () => {
      const { partner, r } = await annotatorSetup();
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'ANNOTATOR');
      const course = (await get(c.cookie, `/me/certifications/${certId}/course`)).json();
      expect(course.modules[0].locked).toBe(false);
      expect(course.modules[1]).toMatchObject({ locked: true });
      expect(course.modules[1].explanation).toBeUndefined();
      expect(JSON.stringify(course)).not.toContain('answerIndex');
      const skip = await post(c.cookie, `/me/certifications/${certId}/modules/${course.modules[1].id}/complete`, { answers: [0, 0] });
      expect(skip.json().error).toBe('MODULE_LOCKED');
      // Before the course is done, no test.
      expect((await post(c.cookie, `/me/certifications/${certId}/selfie`)).json().error).toBe('NOT_READY');
      const wrong = await post(c.cookie, `/me/certifications/${certId}/modules/${course.modules[0].id}/complete`, { answers: [1, 1] });
      expect(wrong.json()).toMatchObject({ passed: false });
      expect(wrong.json().feedback[0]).toContain('says so');
      await train(c, certId);
      expect((await certState(certId)).state).toBe('TEST_READY');

      // The selfie check must be verified, and each attempt needs a new one.
      const s = (await post(c.cookie, `/me/certifications/${certId}/selfie`)).json();
      selfie.set(s.sessionRef, 'pending');
      expect((await post(c.cookie, `/me/certifications/${certId}/test/start`, { sessionRef: s.sessionRef })).json().error).toBe('SELFIE_CHECK_REQUIRED');
      selfie.set(s.sessionRef, 'verified');
      const ok = await post(c.cookie, `/me/certifications/${certId}/test/start`, { sessionRef: s.sessionRef });
      expect(ok.statusCode, ok.body).toBe(201);
      const attempt = await db.testAttempt.findUniqueOrThrow({ where: { id: ok.json().attemptId } });
      expect(attempt.identityCheck).toMatchObject({ provider: 'mock', sessionRef: s.sessionRef, result: 'verified' });
      // Nothing identifying is stored: only the provider reference and the result.
      expect(Object.keys(attempt.identityCheck as object).sort()).toEqual(['at', 'provider', 'result', 'sessionRef']);
      // Integrity events are logged.
      expect((await post(c.cookie, `/me/test-attempts/${attempt.id}/integrity`, { events: [{ type: 'PASTE', at: new Date().toISOString() }, { type: 'BLUR', at: new Date().toISOString() }] })).statusCode).toBe(200);
      expect((await db.testAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).integrityEvents).toHaveLength(2);
      // Another candidate cannot see or answer this attempt.
      const other = await candidate(r, partner);
      expect((await put(other.cookie, `/me/test-attempts/${attempt.id}/answers`, { answers: {} })).statusCode).toBe(404);
    });

    it('two candidates on the same blueprint never get the same item instance, and a retake never repeats one the candidate saw', async () => {
      const { partner, r } = await annotatorSetup();
      const a = await candidate(r, partner);
      const b = await candidate(r, partner);
      const certA = await certificationOf(a, 'ANNOTATOR');
      const certB = await certificationOf(b, 'ANNOTATOR');
      await train(a, certA);
      await train(b, certB);
      const [ta, tb] = [await start(a, certA), await start(b, certB)];
      expect(ta.items).toHaveLength(TIER_DEFAULTS.ANNOTATOR.itemCount);
      const idsA = new Set(ta.items.map((i) => i.id));
      expect(tb.items.some((i) => idsA.has(i.id))).toBe(false);
      // No stem is repeated either (a different instance with the same wording would be a near-copy).
      expect(tb.items.some((i) => ta.items.some((j) => j.stem === i.stem))).toBe(false);
      const forms = await db.testForm.findMany({ where: { status: 'USED' } });
      expect(new Set(forms.map((f) => f.usedBy)).size).toBe(2);

      // A fails; the retake gets a new form with none of the instances A saw.
      expect((await answerAll(a, ta, false)).result).toBe('FAIL');
      await db.certification.update({ where: { id: certA }, data: { retakeAvailableAt: new Date(Date.now() - 1000) } });
      const retake = await start(a, certA);
      expect(retake.items.some((i) => idsA.has(i.id))).toBe(false);
      expect(await db.itemInstance.count({ where: { servedTo: a.smeUserId } })).toBe(TIER_DEFAULTS.ANNOTATOR.itemCount * 2);
    });

    it('a failed test offers a retake after 48 hours; after two retakes a person decides', async () => {
      const { partner, r } = await annotatorSetup();
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'ANNOTATOR');
      await train(c, certId);
      const first = await start(c, certId);
      expect(await answerAll(c, first, false)).toMatchObject({ status: 'FAILED', result: 'FAIL' });
      let cert = await certState(certId);
      expect(cert.state).toBe('RETAKE_AVAILABLE');
      const hours = (cert.retakeAvailableAt!.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(RETAKE_COOLDOWN_HOURS - 0.1);
      expect(hours).toBeLessThanOrEqual(RETAKE_COOLDOWN_HOURS);
      expect((await post(c.cookie, `/me/certifications/${certId}/selfie`)).json().error).toBe('RETAKE_COOLDOWN');
      // The candidate sees pass or fail and a band per section, never the items or keys.
      const result = (await get(c.cookie, `/me/certifications/${certId}/test`)).json();
      expect(result.attempt).toMatchObject({ result: 'FAIL', status: 'FAILED' });
      expect(result.attempt.items).toBeUndefined();
      expect(Object.values(result.attempt.sections).every((b) => ['Strong', 'Meets', 'Developing', 'Below'].includes(b as string))).toBe(true);

      for (let n = 2; n <= 3; n++) {
        await db.certification.update({ where: { id: certId }, data: { retakeAvailableAt: new Date(Date.now() - 1000) } });
        expect((await answerAll(c, await start(c, certId), false)).result).toBe('FAIL');
      }
      cert = await certState(certId);
      expect(cert).toMatchObject({ state: 'REVIEW_REQUIRED', attemptsUsed: 3 });
      expect((await post(c.cookie, `/me/certifications/${certId}/selfie`)).json().error).toBe('NOT_READY');
      // A person decides: another retake is allowed.
      const queue = (await get(validator, '/certifications/review-queue')).json();
      expect(JSON.stringify(queue)).toContain(certId);
      expect((await post(validator, `/certifications/${certId}/decision`, { decision: 'ALLOW_RETAKE', reason: 'Close on each attempt; one more try.' })).statusCode).toBe(200);
      expect((await certState(certId)).state).toBe('RETAKE_AVAILABLE');
      expect((await answerAll(c, await start(c, certId), true)).result).toBe('PASS');
      expect((await certState(certId)).state).toBe('PASSED');
      const actions = (await db.auditEvent.findMany({ where: { OR: [{ entityId: certId }, { entityType: 'TestAttempt' }] } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['cert.module_completed', 'cert.selfie_started', 'cert.test_started', 'cert.answers_saved', 'cert.test_submitted', 'cert.test_failed', 'cert.test_passed', 'cert.certified']));
    });

    it('the C07 checklist cannot complete until the certification is PASSED; then it completes by itself', async () => {
      const { partner, r } = await annotatorSetup();
      const c = await candidate(r, partner);
      const view = async () => (await get(c.cookie, `/me/onboarding?enrollmentId=${c.enrollmentId}`)).json();
      const ack = async (itemKey: string, extra: object = {}) => {
        const item = (await view()).items.find((i: { key: string }) => i.key === itemKey);
        return post(c.cookie, '/me/onboarding/acknowledgements', { enrollmentId: c.enrollmentId, itemKey, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...extra });
      };
      expect((await view()).items.map((i: { key: string }) => i.key)).toContain('certification');
      for (const key of ['confirm_scope', 'terms:contributor', 'terms:confidentiality_ip', 'terms:data_use', 'guidance']) expect((await ack(key)).statusCode).toBe(200);
      expect((await ack('conflicts', { data: { hasConflicts: false, authorizedToContribute: true } })).statusCode).toBe(200);
      const last = await ack('preferences', { data: { country: 'IN', languages: [{ language: 'en', level: 'C2' }], timezone: 'Asia/Kolkata', hoursPerWeek: 20, emailNotifications: true } });
      expect(last.statusCode, last.body).toBe(200);
      expect((await view()).status).not.toBe('COMPLETE');
      // The candidate cannot tick the certification item.
      expect((await ack('certification')).json().error).toBe('AUTOMATIC_ITEM');

      const certId = await certificationOf(c, 'ANNOTATOR');
      await train(c, certId);
      expect(await answerAll(c, await start(c, certId), true)).toMatchObject({ status: 'PASSED', result: 'PASS' });
      const cert = await certState(certId);
      expect(cert.state).toBe('PASSED');
      expect(cert.expiresAt!.getTime() - cert.issuedAt!.getTime()).toBeGreaterThan(360 * 86_400_000);
      const v = await view();
      expect(v.status).toBe('COMPLETE');
      expect(v.items.find((i: { key: string }) => i.key === 'certification')).toMatchObject({ done: true });
      expect(await db.smeStanding.findFirst({ where: { smeUserId: c.smeUserId } })).toMatchObject({ standing: 'PROBATION', tier: 'ANNOTATOR', domain: 'banking' });
      expect(await db.outboxEvent.count({ where: { name: 'cert.certified' } })).toBe(1);
      // The partner's history shows the certification states.
      const states = await db.candidateStateEvent.findMany({ where: { dimension: 'certification' }, orderBy: { at: 'asc' } });
      expect(states.map((s) => s.toState)).toEqual(expect.arrayContaining(['IN_TRAINING', 'TEST_READY', 'PASSED', 'CERTIFIED']));
      expect(await db.auditEvent.count({ where: { action: 'onboarding.completed' } })).toBe(1);
    });
  });

  describe('tiers, written answers and people confirming grades', () => {
    it('each tier applies its own length and pass rules; the Expert certification needs a Reviewer certificate in the domain', async () => {
      const { packageId, versionId } = await guidelines();
      for (const tier of ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] as const) {
        const bp = await publishTier(versionId, tier);
        expect(bp).toMatchObject({ itemCount: TIER_DEFAULTS[tier].itemCount, timeLimitMinutes: TIER_DEFAULTS[tier].timeLimitMinutes, authoringTask: tier === 'EXPERT' });
        expect(bp.passRules).toMatchObject(TIER_DEFAULTS[tier].passRules);
      }
      const partner = await livePartner();
      const projectId = await supplyProject();
      const rExpert = await requisition(projectId, partner.id, 'EXPERT', packageId);
      const c = await candidate(rExpert, partner);
      const certId = await certificationOf(c, 'EXPERT');
      await train(c, certId);
      expect((await post(c.cookie, `/me/certifications/${certId}/selfie`)).json().error).toBe('PREREQUISITE_MISSING');
      // With a Reviewer certificate in banking the Expert test opens: 20 items plus the authoring task, 120 minutes.
      const reviewerVersion = (await db.certification.findUniqueOrThrow({ where: { id: certId } })).versionId;
      await db.certification.create({ data: { clientId, smeUserId: c.smeUserId, domain: 'banking', tier: 'REVIEWER_SME', versionId: reviewerVersion, state: 'PASSED', issuedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
      const t = await start(c, certId);
      expect(t.items).toHaveLength(TIER_DEFAULTS.EXPERT.itemCount + 1);
      expect(t.items.filter((i) => i.itemType === 'AUTHORING')).toHaveLength(1);
      expect(new Date(t.deadlineAt).getTime() - new Date(t.startedAt).getTime()).toBe(120 * 60_000);

      // Reviewer tier: 35 items, 60 minutes, with planted-error trajectory reviews.
      const rReviewer = await requisition(projectId, partner.id, 'REVIEWER_SME', packageId);
      const rc = await candidate(rReviewer, partner);
      const rCert = await certificationOf(rc, 'REVIEWER_SME');
      await train(rc, rCert);
      const rt = await start(rc, rCert);
      expect(rt.items).toHaveLength(TIER_DEFAULTS.REVIEWER_SME.itemCount);
      expect(new Date(rt.deadlineAt).getTime() - new Date(rt.startedAt).getTime()).toBe(60 * 60_000);
      expect(rt.items.some((i) => i.itemType === 'TRAJECTORY_REVIEW')).toBe(true);
    });

    it('written answers get a model recommendation only; people confirm them, and a low model score alone never refuses', async () => {
      const { packageId, versionId } = await guidelines();
      await publishTier(versionId, 'REVIEWER_SME');
      const partner = await livePartner();
      const r = await requisition(await supplyProject(), partner.id, 'REVIEWER_SME', packageId);
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'REVIEWER_SME');
      await train(c, certId);
      const t = await start(c, certId);
      const written = t.items.filter((i) => i.itemType === 'JUSTIFICATION');
      expect(written.length).toBeGreaterThan(0);
      // Objective items all right, written answers very short: the mock grader recommends a low score.
      const res = await answerAll(c, t, true, 'Escalate it.');
      expect(res).toMatchObject({ status: 'NEEDS_REVIEW', result: 'PENDING_REVIEW' });
      const attempt = await db.testAttempt.findUniqueOrThrow({ where: { id: t.attemptId } });
      const grading = attempt.grading as Record<string, { written?: boolean; recommendation?: { score: number; model: string }; confirmedScore: number | null }>;
      for (const w of written) expect(grading[w.id]).toMatchObject({ written: true, recommendation: { model: 'mock-curriculum-1' }, confirmedScore: null });
      expect(grading[written[0]!.id]!.recommendation!.score).toBeLessThan(0.7);
      expect((await certState(certId)).state).toBe('IN_TEST');

      // The candidate's result view waits for people.
      expect((await get(c.cookie, `/me/certifications/${certId}/test`)).json().attempt.result).toBe('PENDING_REVIEW');
      // Candidates and PMs cannot confirm grades.
      expect((await post(pm, `/test-attempts/${t.attemptId}/grades`, { itemId: written[0]!.id, score: 1 })).statusCode).toBe(403);
      // A Validator reads the answers, disagrees with the model, and confirms full marks.
      const queue = (await get(validator, '/certifications/review-queue')).json();
      expect(JSON.stringify(queue)).toContain(t.attemptId);
      for (const [n, w] of written.entries()) {
        const g = await post(validator, `/test-attempts/${t.attemptId}/grades`, { itemId: w.id, score: 1 });
        expect(g.statusCode, g.body).toBe(200);
        if (n === 0) expect((await post(validator, `/test-attempts/${t.attemptId}/grades`, { itemId: w.id, score: 1 })).json().error).toBe('ALREADY_CONFIRMED');
      }
      const done = await db.testAttempt.findUniqueOrThrow({ where: { id: t.attemptId } });
      expect(done.status).toBe('PASSED');
      expect((await certState(certId)).state).toBe('PASSED');
      expect(await db.auditEvent.count({ where: { action: 'cert.grade_confirmed', entityId: t.attemptId } })).toBe(written.length);
    });

    it('the Expert authoring task needs two confirmations from an Admin and a Validator until the domain has two certified Experts', async () => {
      const { packageId, versionId } = await guidelines();
      await publishTier(versionId, 'EXPERT');
      const partner = await livePartner();
      const r = await requisition(await supplyProject(), partner.id, 'EXPERT', packageId);
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'EXPERT');
      const cert = await certState(certId);
      await db.certification.create({ data: { clientId, smeUserId: c.smeUserId, domain: 'banking', tier: 'REVIEWER_SME', versionId: cert.versionId, state: 'PASSED', issuedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86_400_000) } });
      await train(c, certId);
      const t = await start(c, certId);
      const long = 'The task approves the customer although the registry filing is stale. '.repeat(10);
      expect((await answerAll(c, t, true, long)).status).toBe('NEEDS_REVIEW');
      const authoring = t.items.find((i) => i.itemType === 'AUTHORING')!;
      for (const w of t.items.filter((i) => i.itemType === 'CRITIQUE')) expect((await post(admin, `/test-attempts/${t.attemptId}/grades`, { itemId: w.id, score: 0.9 })).statusCode).toBe(200);
      // First confirmation by a Validator; a second Validator is refused (the other role must confirm).
      expect((await post(validator, `/test-attempts/${t.attemptId}/grades`, { itemId: authoring.id, score: 0.9 })).json()).toMatchObject({ done: false, confirmations: 1, required: 2 });
      expect((await db.testAttempt.findUniqueOrThrow({ where: { id: t.attemptId } })).status).toBe('NEEDS_REVIEW');
      expect((await post(validator2, `/test-attempts/${t.attemptId}/grades`, { itemId: authoring.id, score: 0.9 })).json().error).toBe('SECOND_ROLE_NEEDED');
      expect((await post(admin, `/test-attempts/${t.attemptId}/grades`, { itemId: authoring.id, score: 0.8 })).json()).toMatchObject({ done: true, confirmations: 2 });
      expect((await db.testAttempt.findUniqueOrThrow({ where: { id: t.attemptId } })).status).toBe('PASSED');
      expect((await certState(certId)).state).toBe('PASSED');
    });

    it('a model score never refuses: a failed written grade only fails when people confirm it, and the failure goes to retake, not rejection', async () => {
      const { packageId, versionId } = await guidelines();
      await publishTier(versionId, 'REVIEWER_SME');
      const partner = await livePartner();
      const r = await requisition(await supplyProject(), partner.id, 'REVIEWER_SME', packageId);
      const c = await candidate(r, partner);
      const certId = await certificationOf(c, 'REVIEWER_SME');
      await train(c, certId);
      const t = await start(c, certId);
      await answerAll(c, t, true, '');
      // Nothing was decided by the model, even for empty answers.
      expect((await db.testAttempt.findUniqueOrThrow({ where: { id: t.attemptId } })).status).toBe('NEEDS_REVIEW');
      expect(await db.auditEvent.count({ where: { action: 'cert.test_failed' } })).toBe(0);
      for (const w of t.items.filter((i) => i.itemType === 'JUSTIFICATION')) await post(validator, `/test-attempts/${t.attemptId}/grades`, { itemId: w.id, score: 0 });
      const cert = await certState(certId);
      expect(['RETAKE_AVAILABLE', 'PASSED']).toContain(cert.state);
      expect(cert.state).not.toBe('NOT_CERTIFIED');
    });
  });
});
