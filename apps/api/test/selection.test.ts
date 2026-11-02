import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { runAssessment } from '../src/candidate/selection-service';
import { MemoryStorage } from '../src/candidate/storage';
import { MockSuitabilityEvaluator, type SuitabilityEvaluator, type SuitabilityInput } from '../src/candidate/suitability';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
type AssessmentOutput = Awaited<ReturnType<SuitabilityEvaluator['evaluate']>>;

/** Local rules by default; a test can script the "model" output instead. Never calls a live service. */
class ScriptedEvaluator implements SuitabilityEvaluator {
  readonly modelVersion = 'scripted-test';
  private readonly base = new MockSuitabilityEvaluator();
  next: ((input: SuitabilityInput, base: AssessmentOutput) => AssessmentOutput | Promise<AssessmentOutput>) | null = null;
  async evaluate(input: SuitabilityInput) {
    const out = await this.base.evaluate(input);
    return this.next ? this.next(input, out) : out;
  }
}

type Cand = { cookie: string; smeUserId: string; enrollmentId: string };

describe('M4c: selection, onboarding and assignment acceptance (FLOW2 CF-19 to CF-30)', () => {
  let app: FastifyInstance;
  const evaluator = new ScriptedEvaluator();
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  let reviewer: string;
  let reviewerId: string;
  let projectId: string;
  let opportunityId: string;

  const post = (cookie: string, url: string, payload: object = {}, headers: Record<string, string> = idem()) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...headers }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });

  async function makeOpportunity(name: string) {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    let t = await db.template.findFirst({ where: { clientId, status: 'PUBLISHED' } });
    if (!t) {
      const created = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
      await post(admin, `/templates/${created.id}/publish`);
      t = await db.template.findUniqueOrThrow({ where: { id: created.id } });
    }
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC', 'EDD'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { templateId: t.id, name, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] })).json();
    await post(pm, `/projects/${p.id}/submit`);
    await post(pm, `/projects/${p.id}/match`);
    expect((await post(pm, `/projects/${p.id}/opportunity/publish`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: reviewerId })).statusCode).toBe(200);
    return { projectId: p.id as string, opportunityId: (await db.opportunity.findUniqueOrThrow({ where: { projectId: p.id } })).id };
  }

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig(),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      evaluator,
      // The real selection gate (the default): selected + onboarded + eligible.
    });
  });

  beforeEach(async () => {
    await resetDb();
    evaluator.next = null;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    const r = await createUser(clientId, ['REVIEWER']);
    reviewerId = r.id;
    reviewer = await login(app, r.email);
    ({ projectId, opportunityId } = await makeOpportunity('P1'));
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  // ── candidate journey helpers ──
  async function signUp(): Promise<{ cookie: string; smeUserId: string }> {
    const email = `${randomUUID().slice(0, 8)}@example.test`;
    const credential = google.mint({ subject: `sub-${email}`, email, name: 'Grace Hopper' });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential, adultAttested: true } });
    const cookie = `praxis_candidate=${res.cookies.find((c) => c.name === 'praxis_candidate')!.value}`;
    await db.smeUser.update({ where: { id: res.json().id }, data: { identityStatus: 'VERIFIED' } });
    return { cookie, smeUserId: res.json().id };
  }
  async function enroll(u: { cookie: string; smeUserId: string }, opp = opportunityId): Promise<Cand> {
    const e = await post(u.cookie, '/me/enrollments', { opportunityId: opp });
    expect(e.statusCode, e.body).toBe(200);
    return { ...u, enrollmentId: e.json().id };
  }
  const state = async (c: Cand) => (await get(c.cookie, `/me/enrollments/${c.enrollmentId}/conversation`)).json();
  /** The accessible form path (CF-30): every question answered in the form, no chat. */
  async function completeViaForm(c: Cand) {
    const s = await state(c);
    const fields = s.questions.flatMap((q: { fields: string[] }) => q.fields).filter((f: string) => f !== 'roles');
    const res = await post(c.cookie, '/me/profile/corrections', {
      enrollmentId: c.enrollmentId,
      expectedRevision: s.session.revision,
      fields: [...new Set<string>(fields)].map((fieldKey) => ({ fieldKey, action: 'EDIT', value: fieldKey.endsWith('_years') || fieldKey === 'hours_per_week' ? 10 : `answer for ${fieldKey}` })),
      roles: [{ action: 'ADD', role: { title: 'KYC Analyst', start: '2016-03', end: null } }],
    });
    expect(res.statusCode).toBe(200);
  }
  async function submit(c: Cand) {
    const s = await state(c);
    const res = await post(c.cookie, `/me/enrollments/${c.enrollmentId}/submit`, { expectedRevision: s.session.revision, confirmAccuracy: true, evidencePermission: true });
    expect(res.statusCode, res.body).toBe(200);
  }
  /** Delivers the latest enrollment.submitted event to the production handler registry (the worker's path). */
  async function deliverSubmitted(c: Cand) {
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'enrollment.submitted', aggregateId: c.enrollmentId }, orderBy: { createdAt: 'desc' } });
    await processDomainEvent(db, defaultHandlers({ evaluator }), ev.id);
  }
  async function reviewPending(u?: { cookie: string; smeUserId: string }, opp = opportunityId) {
    const c = await enroll(u ?? (await signUp()), opp);
    await completeViaForm(c);
    await submit(c);
    await deliverSubmitted(c);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('REVIEW_PENDING');
    return c;
  }
  const scope = { domain: 'Banking', specialty: 'KYC', jurisdictions: ['GB'], languages: ['en'], contributionRoles: ['TASK_AUTHOR'], expiresAt: null };
  const decide = (c: Cand, outcome: string, extra: object = {}, cookie = reviewer) =>
    post(cookie, `/review/enrollments/${c.enrollmentId}/decision`, {
      outcome,
      reasons: [{ criterionId: null, text: 'Reviewed the confirmed profile against the published criteria.' }],
      candidateMessage: outcome === 'SELECTED' ? 'Welcome to the KYC pool.' : 'Thank you. For this pool we need recent EDD casework.',
      ...(outcome === 'SELECTED' ? { scope } : {}),
      ...extra,
    });
  const onboarding = async (c: Cand) => (await get(c.cookie, `/me/onboarding?enrollmentId=${c.enrollmentId}`)).json();
  const preferences = { country: 'GB', languages: [{ language: 'en', level: 'C2' }], timezone: 'Europe/London', hoursPerWeek: 20, emailNotifications: true };
  async function ack(c: Cand, itemKey: string, extra: object = {}) {
    const view = await onboarding(c);
    const item = view.items.find((i: { key: string }) => i.key === itemKey);
    return post(c.cookie, '/me/onboarding/acknowledgements', { enrollmentId: c.enrollmentId, itemKey, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...extra });
  }
  async function completeOnboarding(c: Cand) {
    for (const key of ['confirm_scope', 'terms:contributor', 'terms:confidentiality_ip', 'terms:data_use', 'guidance']) expect((await ack(c, key)).statusCode).toBe(200);
    expect((await ack(c, 'conflicts', { data: { hasConflicts: false, authorizedToContribute: true } })).statusCode).toBe(200);
    const last = await ack(c, 'preferences', { data: preferences });
    expect(last.statusCode, last.body).toBe(200);
    return last.json();
  }
  async function onboarded(u?: { cookie: string; smeUserId: string }, opp = opportunityId) {
    const c = await reviewPending(u, opp);
    expect((await decide(c, 'SELECTED')).statusCode).toBe(200);
    await completeOnboarding(c);
    return c;
  }
  const candidateId = async (c: Cand) => (await db.candidate.findUniqueOrThrow({ where: { smeUserId: c.smeUserId } })).id;
  async function propose(c: Cand, project = projectId) {
    const res = await post(pm, `/projects/${project}/assignments`, { candidateIds: [await candidateId(c)] });
    expect(res.statusCode, res.body).toBe(200);
    return db.smeAssignment.findFirstOrThrow({ where: { smeUserId: c.smeUserId, projectId: project }, orderBy: { createdAt: 'desc' } });
  }
  const accept = (c: Cand, id: string, revision = 0, headers = idem()) => post(c.cookie, `/me/assignments/${id}/accept`, { expectedRevision: revision }, headers);

  describe('CF-19 AI recommends; only a human decides', () => {
    it('a submitted profile is assessed by the worker, then waits for a reviewer, whatever the recommendation', async () => {
      const c = await reviewPending();
      const a = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      expect(a).toMatchObject({ status: 'FIT_RECOMMENDED', modelVersion: 'scripted-test' });
      expect(await db.selectionDecision.count()).toBe(0);
      const status = (await get(c.cookie, `/me/enrollments/${c.enrollmentId}/status`)).json();
      expect(status).toMatchObject({ status: 'REVIEW_PENDING', message: null, scope: null });
      expect(JSON.stringify(status)).not.toMatch(/FIT|recommend/i);
    });

    it('an adverse recommendation still leaves the application awaiting human review', async () => {
      evaluator.next = (input, base) => ({ ...base, findings: base.findings.map((f) => ({ ...f, result: 'NOT_MET', citations: f.citations.length ? f.citations : [input.items[0]!.id] })) });
      const c = await reviewPending();
      expect((await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } })).status).toBe('NOT_FIT_RECOMMENDED');
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('REVIEW_PENDING');
      // The reviewer can select regardless: the decision is theirs, recorded with the recommendation it overrode.
      expect((await decide(c, 'SELECTED')).statusCode).toBe(200);
      const d = await db.selectionDecision.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      expect(d).toMatchObject({ outcome: 'SELECTED', reviewerId });
      const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: c.enrollmentId, action: 'enrollment.decided' } });
      expect(audit).toMatchObject({ actorType: 'USER', actorId: reviewerId });
      expect(audit.after).toMatchObject({ recommendation: 'NOT_FIT_RECOMMENDED', status: 'SELECTED' });
    });

    it('the queue shows assigned pools only; the decision needs REVIEWER or ADMIN, and a candidate cannot call it', async () => {
      const c = await reviewPending();
      const q = (await get(reviewer, '/review/enrollments')).json();
      expect(q.items.map((i: { id: string }) => i.id)).toEqual([c.enrollmentId]);
      expect((await decide(c, 'SELECTED', {}, pm)).statusCode).toBe(403);
      expect((await decide(c, 'SELECTED', {}, c.cookie)).statusCode).toBe(401);
      const other = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
      expect((await get(other, '/review/enrollments')).json().items).toEqual([]);
      expect((await get(other, `/review/enrollments/${c.enrollmentId}`)).statusCode).toBe(404);
      expect((await decide(c, 'SELECTED', {}, other)).statusCode).toBe(404);
    });

    it('a selection needs an approved scope; decisions are replay-safe and cannot be made twice', async () => {
      const c = await reviewPending();
      expect((await decide(c, 'SELECTED', { scope: undefined })).statusCode).toBe(400);
      const key = idem();
      const first = await post(reviewer, `/review/enrollments/${c.enrollmentId}/decision`, { outcome: 'NOT_SELECTED', reasons: [{ criterionId: null, text: 'x' }], candidateMessage: 'Not this time.' }, key);
      const replay = await post(reviewer, `/review/enrollments/${c.enrollmentId}/decision`, { outcome: 'NOT_SELECTED', reasons: [{ criterionId: null, text: 'x' }], candidateMessage: 'Not this time.' }, key);
      expect(first.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
      expect((await decide(c, 'SELECTED')).json().error).toBe('NOT_AWAITING_DECISION');
      expect(await db.selectionDecision.count()).toBe(1);
    });
  });

  describe('CF-20 invented criteria or invalid citations', () => {
    it('invalid model output is a recoverable error, never a decision; the reviewer can retry or review without it', async () => {
      evaluator.next = (_input, base) => ({ ...base, findings: [...base.findings, { criterionId: 'made_up', result: 'MET', citations: ['field:nope'], rationale: 'x' }] });
      const c = await enroll(await signUp());
      await completeViaForm(c);
      await submit(c);
      const a = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      expect(await runAssessment(db, evaluator, a.id)).toBe('error');
      const failed = await db.suitabilityAssessment.findUniqueOrThrow({ where: { id: a.id } });
      expect(failed).toMatchObject({ status: 'ERROR', errorCode: 'INVALID_OUTPUT', findings: null });
      expect(failed.limitations).toMatch(/made_up|nope/);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('SUBMITTED');
      // The worker path throws so the queue retries with backoff.
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'enrollment.submitted', aggregateId: c.enrollmentId } });
      await expect(processDomainEvent(db, defaultHandlers({ evaluator }), ev.id)).rejects.toThrow(/retry/);
      expect(await db.selectionDecision.count()).toBe(0);

      evaluator.next = null;
      expect((await post(reviewer, `/review/enrollments/${c.enrollmentId}/assessment/retry`, {})).json()).toEqual({ result: 'done' });
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('REVIEW_PENDING');
    });

    it('review without a recommendation after a model outage', async () => {
      evaluator.next = () => {
        throw new Error('vertex down');
      };
      const c = await enroll(await signUp());
      await completeViaForm(c);
      await submit(c);
      const a = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      await runAssessment(db, evaluator, a.id);
      expect((await db.suitabilityAssessment.findUniqueOrThrow({ where: { id: a.id } })).errorCode).toBe('MODEL_UNAVAILABLE');
      expect((await post(reviewer, `/review/enrollments/${c.enrollmentId}/assessment/retry`, { withoutRecommendation: true })).json()).toEqual({ result: 'REVIEW_PENDING' });
      expect((await decide(c, 'SELECTED')).statusCode).toBe(200);
      expect((await db.selectionDecision.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } })).assessmentId).toBe(a.id);
    });

    it('a reviewer’s reasons can only cite published criteria', async () => {
      const c = await reviewPending();
      const res = await decide(c, 'NOT_SELECTED', { reasons: [{ criterionId: 'invented', text: 'x' }] });
      expect(res.json().error).toBe('UNKNOWN_CRITERION');
      expect(await db.selectionDecision.count()).toBe(0);
    });
  });

  describe('CF-21 corrections during evaluation', () => {
    it('a result for a withdrawn or changed application is superseded, never applied', async () => {
      const c = await enroll(await signUp());
      await completeViaForm(c);
      await submit(c);
      evaluator.next = async (_input, base) => {
        // The candidate withdraws while the model is still running.
        expect((await post(c.cookie, `/me/enrollments/${c.enrollmentId}/withdraw`)).statusCode).toBe(200);
        return base;
      };
      const a = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      expect(await runAssessment(db, evaluator, a.id)).toBe('superseded');
      expect((await db.suitabilityAssessment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('SUPERSEDED');
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('WITHDRAWN');
    });

    it('more information: the candidate amends a new draft, resubmits, and the new version is assessed with history kept', async () => {
      const c = await reviewPending();
      const first = await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } });
      expect((await decide(c, 'NEEDS_INFORMATION', { informationRequest: 'Which EDD cases have you led?' })).statusCode).toBe(200);
      const status = (await get(c.cookie, `/me/enrollments/${c.enrollmentId}/status`)).json();
      expect(status).toMatchObject({ status: 'NEEDS_INFORMATION', informationRequest: 'Which EDD cases have you led?', canAmend: true });

      expect((await post(c.cookie, `/me/enrollments/${c.enrollmentId}/amend`)).statusCode).toBe(200);
      const s = await state(c);
      expect(s.editable).toBe(true);
      const key = s.questions[0].fields[0];
      expect((await post(c.cookie, '/me/profile/corrections', { enrollmentId: c.enrollmentId, expectedRevision: s.session.revision, fields: [{ fieldKey: key, action: 'EDIT', value: 'Led 40 EDD reviews for PEPs' }], roles: [] })).statusCode).toBe(200);
      await submit(c);
      const after = await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } });
      expect(after.status).toBe('SUBMITTED');
      expect(after.profileVersionId).not.toBe(first.profileVersionId);
      // The earlier version stays frozen; its decision stays on record.
      expect((await db.profileVersion.findUniqueOrThrow({ where: { id: first.profileVersionId! } })).submittedAt).not.toBeNull();
      expect(await db.selectionDecision.count({ where: { enrollmentId: c.enrollmentId } })).toBe(1);
      await deliverSubmitted(c);
      const assessments = await db.suitabilityAssessment.findMany({ where: { enrollmentId: c.enrollmentId }, orderBy: { createdAt: 'asc' } });
      expect(assessments.map((a) => a.profileVersionId)).toEqual([first.profileVersionId, after.profileVersionId]);
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('REVIEW_PENDING');
    });

    it('a stale assessment for an older version is superseded after resubmission', async () => {
      const c = await enroll(await signUp());
      await completeViaForm(c);
      await submit(c);
      const stale = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      // Move the enrollment to a newer version (as a resubmission would) before the old job runs.
      const v = await db.profileVersion.findUniqueOrThrow({ where: { id: stale.profileVersionId } });
      const newer = await db.profileVersion.create({ data: { clientId, smeUserId: c.smeUserId, enrollmentId: c.enrollmentId, version: v.version + 1, data: v.data as object, contentHash: 'x', submittedAt: new Date() } });
      await db.enrollment.update({ where: { id: c.enrollmentId }, data: { profileVersionId: newer.id } });
      expect(await runAssessment(db, evaluator, stale.id)).toBe('superseded');
      expect((await db.enrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } })).status).toBe('SUBMITTED');
    });
  });

  describe('CF-22 not selected for one pool', () => {
    it('task-specific message, a review route, and no global block on other pools', async () => {
      const u = await signUp();
      const c = await reviewPending(u);
      expect((await decide(c, 'NOT_SELECTED')).statusCode).toBe(200);
      const status = (await get(c.cookie, `/me/enrollments/${c.enrollmentId}/status`)).json();
      expect(status).toMatchObject({ status: 'NOT_SELECTED', message: 'Thank you. For this pool we need recent EDD casework.', canRequestReview: true });
      expect(status.statusText).not.toMatch(/unfit|reject/i);
      expect((await db.smeUser.findUniqueOrThrow({ where: { id: c.smeUserId } })).accountStatus).toBe('ACTIVE');

      // A second pool is open to the same expert.
      const other = await makeOpportunity('P2');
      const c2 = await reviewPending(u, other.opportunityId);
      expect((await decide(c2, 'SELECTED')).statusCode).toBe(200);

      // Reconsideration: the earlier decision is kept and a new one is appended.
      expect((await post(c.cookie, `/me/enrollments/${c.enrollmentId}/review-request`, { reason: 'I led EDD casework in 2025.' })).statusCode).toBe(200);
      expect((await get(reviewer, '/review/enrollments')).json().items.map((i: { status: string }) => i.status)).toEqual(['REVIEW_REQUESTED']);
      expect((await post(reviewer, `/review/enrollments/${c.enrollmentId}/reopen`, { to: 'REVIEW_PENDING' })).statusCode).toBe(200);
      expect((await decide(c, 'SELECTED')).statusCode).toBe(200);
      expect((await db.selectionDecision.findMany({ where: { enrollmentId: c.enrollmentId }, orderBy: { decidedAt: 'asc' } })).map((d) => d.outcome)).toEqual(['NOT_SELECTED', 'SELECTED']);
    });
  });

  describe('CF-23 selected but onboarding incomplete', () => {
    it('the checklist explains what is outstanding and the expert is not assignable yet', async () => {
      const c = await reviewPending();
      expect((await get(c.cookie, `/me/onboarding?enrollmentId=${c.enrollmentId}`)).json().error).toBe('NOT_SELECTED');
      expect((await decide(c, 'SELECTED')).statusCode).toBe(200);
      const view = await onboarding(c);
      expect(view.status).toBe('NOT_STARTED');
      expect(view.items.map((i: { key: string; done: boolean }) => [i.key, i.done])).toEqual([
        ['confirm_scope', false],
        ['terms:contributor', false],
        ['terms:confidentiality_ip', false],
        ['terms:data_use', false],
        ['conflicts', false],
        ['guidance', false],
        ['preferences', false],
      ]);
      expect(view.items[1].terms).toMatchObject({ placeholder: true, version: 1 });
      expect(await db.candidate.count({ where: { smeUserId: c.smeUserId } })).toBe(0);
      expect(await db.outboxEvent.count({ where: { name: 'candidate.approved' } })).toBe(0);

      for (const key of ['confirm_scope', 'terms:contributor']) await ack(c, key);
      expect((await onboarding(c)).status).toBe('IN_PROGRESS');
      // Terms must be the current version, and answers must be valid.
      expect((await post(c.cookie, '/me/onboarding/acknowledgements', { enrollmentId: c.enrollmentId, itemKey: 'terms:data_use', termsHash: 'a'.repeat(64) })).json().error).toBe('TERMS_CHANGED');
      expect((await ack(c, 'preferences', { data: { ...preferences, country: 'XX' } })).statusCode).toBe(400);
      for (const invalid of [
        { ...preferences, timezone: 'Mars/Phobos' },
        { ...preferences, languages: [{ language: 'en', level: 'GODLIKE' }] },
        { ...preferences, languages: [{ language: 'en', level: 'C2' }, { language: 'en', level: 'B2' }] },
      ]) {
        expect((await ack(c, 'preferences', { data: invalid })).statusCode).toBe(400);
        expect((await onboarding(c)).items.find((i: { key: string }) => i.key === 'preferences').done).toBe(false);
        expect(await db.onboardingAcknowledgement.count({ where: { itemKey: 'preferences' } })).toBe(0);
      }
      expect((await ack(c, 'conflicts', { data: { hasConflicts: true, authorizedToContribute: true } })).statusCode).toBe(400);
    });

    it('completing onboarding builds the matching record and emits candidate.approved', async () => {
      const c = await reviewPending();
      await decide(c, 'SELECTED', { scope: { ...scope, specialty: 'Corporate onboarding' } });
      const done = await completeOnboarding(c);
      expect(done.status).toBe('COMPLETE');
      const rec = await db.candidate.findUniqueOrThrow({ where: { smeUserId: c.smeUserId } });
      expect(rec).toMatchObject({ country: 'GB', timezone: 'Europe/London', hoursPerWeek: 20, jurisdictions: ['GB'], poolStatus: 'SELECTED' });
      // Selection covers the pool's template skills, so the expert matches the project that selected them.
      expect(rec.specialties).toEqual(expect.arrayContaining(['KYC']));
      const match = (await post(pm, `/projects/${projectId}/match`)).json();
      expect(match.items.map((i: { candidateId: string }) => i.candidateId)).toContain(rec.id);
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'candidate.approved' } });
      expect(ev.payload).toEqual({ projectId, candidateId: rec.id, enrollmentId: c.enrollmentId });
    });

    it('in production, placeholder terms block onboarding instead of being accepted', async () => {
      const prodApp = await buildApp({
        config: { ...testConfig(), NODE_ENV: 'production' } as ReturnType<typeof testConfig>,
        db,
        pingRedis: async () => true,
        google,
        identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
        resolveClientId: async () => clientId,
        storage: new MemoryStorage(),
        evaluator,
      });
      try {
        const c = await reviewPending();
        await decide(c, 'SELECTED');
        const view = await onboarding(c);
        const res = await prodApp.inject({ method: 'POST', url: '/api/v1/me/onboarding/acknowledgements', headers: { cookie: c.cookie, ...idem() }, payload: { enrollmentId: c.enrollmentId, itemKey: 'terms:contributor', termsHash: view.items[1].terms.sha256 } });
        expect(res.json().error).toBe('TERMS_PLACEHOLDER');
        expect((await onboarding(c)).status).toBe('BLOCKED');
        // An Admin publishes approved text; it is a new version the candidate must accept.
        expect((await post(admin, '/terms', { key: 'contributor', title: 'Contributor agreement', body: 'Approved contributor agreement text, version two.' })).statusCode).toBe(201);
        const again = await onboarding(c);
        expect(again.items[1].terms).toMatchObject({ version: 2, placeholder: false });
      } finally {
        await prodApp.close();
      }
    });
  });

  describe('CF-24 all gates complete but no work yet', () => {
    it('home shows an honest empty state: no assignments are invented', async () => {
      const c = await onboarded();
      expect((await get(c.cookie, '/me/assignments')).json()).toEqual({ items: [] });
      expect(await db.smeAssignment.count()).toBe(0);
    });
  });

  describe('C08 proposals: accept, decline, staffing and the workbench handoff', () => {
    it('a PM proposal is not staffing until accepted; acceptance counts, emits candidate.assigned and can staff the project', async () => {
      const a = await onboarded();
      const b = await onboarded();
      const pa = await propose(a);
      expect(pa).toMatchObject({ status: 'PROPOSED', requirementsVersion: 1 });
      const board = (await get(pm, `/projects/${projectId}/matches`)).json();
      expect(board).toMatchObject({ status: 'STAFFING', assigned: 0, proposed: 1, shortfall: 1 });
      const pb = await propose(b);

      const card = (await get(a.cookie, '/me/assignments')).json().items[0];
      expect(card).toMatchObject({ id: pa.id, status: 'PROPOSED', title: expect.any(String), contributionRoles: ['TASK_AUTHOR'] });
      expect((await accept(a, pa.id)).statusCode).toBe(200);
      expect((await get(pm, `/projects/${projectId}/matches`)).json()).toMatchObject({ status: 'STAFFING', assigned: 1, proposed: 1 });
      expect((await accept(b, pb.id)).statusCode).toBe(200);
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('STAFFED');
      expect(await db.outboxEvent.count({ where: { name: 'candidate.assigned' } })).toBe(2);
      expect(await db.outboxEvent.count({ where: { name: 'project.staffed' } })).toBe(1);
    });

    it('declining frees the slot; the decline is recorded without penalty', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      const res = await post(a.cookie, `/me/assignments/${pa.id}/decline`, { reason: 'Not available this month' });
      expect(res.json()).toMatchObject({ status: 'DECLINED', declineReason: 'Not available this month' });
      expect((await get(pm, `/projects/${projectId}/matches`)).json()).toMatchObject({ proposed: 0, shortfall: 2 });
      expect((await db.candidate.findUniqueOrThrow({ where: { smeUserId: a.smeUserId } })).poolStatus).toBe('SELECTED');
      expect((await accept(a, pa.id)).json().error).toBe('NOT_PROPOSED');
    });

    it('proposals expire after 7 days and release the slot', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      await db.smeAssignment.update({ where: { id: pa.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await get(a.cookie, '/me/assignments')).json().items[0].status).toBe('EXPIRED');
      expect((await get(pm, `/projects/${projectId}/matches`)).json()).toMatchObject({ proposed: 0, shortfall: 2 });
    });

    it('the workbench opens with a short-lived single-use handoff for the same candidate only', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      expect((await post(a.cookie, `/me/assignments/${pa.id}/open-workbench`)).json().error).toBe('NOT_ACCEPTED');
      await accept(a, pa.id);
      const { url } = (await post(a.cookie, `/me/assignments/${pa.id}/open-workbench`)).json();
      const token = new URL(url).searchParams.get('token')!;
      const stored = await db.smeAssignment.findUniqueOrThrow({ where: { id: pa.id } });
      expect(stored.status).toBe('HANDED_OFF');
      expect(stored.handoffTokenHash).not.toContain(token);
      const other = await signUp();
      expect((await post(other.cookie, '/workbench/handoff', { token })).statusCode).toBe(401);
      expect((await post(a.cookie, '/workbench/handoff', { token })).json()).toEqual({ assignmentId: pa.id, projectId });
      expect((await post(a.cookie, '/workbench/handoff', { token })).statusCode).toBe(401);
    });
  });

  describe('CF-25 wrong scope, changed requirements or expired prerequisites', () => {
    it('an expired scope blocks acceptance', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      await db.qualificationScope.updateMany({ where: { enrollmentId: a.enrollmentId }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
      const res = await accept(a, pa.id);
      expect(res.json()).toMatchObject({ error: 'NOT_ELIGIBLE', message: expect.stringMatching(/expired/) });
      expect((await db.smeAssignment.findUniqueOrThrow({ where: { id: pa.id } })).status).toBe('PROPOSED');
    });

    it('new terms published after onboarding must be accepted before acceptance', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      await post(admin, '/terms', { key: 'data_use', title: 'Data use', body: 'Updated data use terms: version two of the approved text.' });
      expect((await accept(a, pa.id)).json().message).toMatch(/terms/);
      expect((await ack(a, 'terms:data_use')).statusCode).toBe(200);
      expect((await accept(a, pa.id)).statusCode).toBe(200);
    });

    it('changed requirements need a new proposal', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      const view = (await get(pm, `/projects/${projectId}/opportunity`)).json();
      await app.inject({ method: 'PUT', url: `/api/v1/projects/${projectId}/opportunity/draft`, headers: { cookie: pm, ...idem() }, payload: { brief: { ...view.draft.brief, exampleOutputs: 'Changed outputs' }, criteria: view.draft.criteria } });
      expect((await post(pm, `/projects/${projectId}/opportunity/publish`)).statusCode).toBe(200);
      expect((await accept(a, pa.id)).json().error).toBe('REQUIREMENTS_CHANGED');
    });

    it('a scope without the needed contribution role blocks acceptance', async () => {
      const brief = (await db.opportunityVersion.findFirstOrThrow({ where: { opportunityId }, orderBy: { version: 'desc' } })).brief as { contributionRoles: string[] };
      const c = await reviewPending();
      const roles = ['TASK_AUTHOR', 'ANNOTATOR', 'REVIEWER', 'RUBRIC_DESIGNER', 'SCENARIO_VALIDATOR'].filter((r) => !brief.contributionRoles.includes(r));
      expect(roles.length).toBeGreaterThan(0);
      await decide(c, 'SELECTED', { scope: { ...scope, contributionRoles: [roles[0]] } });
      await completeOnboarding(c);
      const pa = await propose(c);
      expect((await accept(c, pa.id)).json().error).toBe('OUT_OF_SCOPE');
    });

    it('an unresolved declared conflict blocks proposal until a reviewer resolves it', async () => {
      const c = await reviewPending();
      await decide(c, 'SELECTED');
      await completeOnboarding(c);
      await ack(c, 'conflicts', { data: { hasConflicts: true, details: 'Worked at a bank that is a client of this project', authorizedToContribute: true } });
      const res = await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [await candidateId(c)] });
      expect(res.json()).toMatchObject({ error: 'NOT_ASSIGNABLE', message: expect.stringMatching(/conflict/) });
      const conflicts = (await get(reviewer, '/review/conflicts')).json().items;
      expect(conflicts).toHaveLength(1);
      expect((await post(reviewer, `/review/conflicts/${conflicts[0].id}/resolve`, { resolution: 'Different business unit; no overlap.' })).statusCode).toBe(200);
      await propose(c);
    });
  });

  describe('CF-26 duplicate accepts and concurrent capacity', () => {
    it('concurrent accepts of one proposal produce exactly one acceptance', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      const results = await Promise.all([accept(a, pa.id), accept(a, pa.id), accept(a, pa.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
      expect(await db.auditEvent.count({ where: { entityId: pa.id, action: 'assignment.accepted' } })).toBe(1);
      expect(await db.outboxEvent.count({ where: { name: 'candidate.assigned' } })).toBe(1);
    });

    it('a retried accept with the same idempotency key replays the first result', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      const key = idem();
      const first = await accept(a, pa.id, 0, key);
      const again = await accept(a, pa.id, 0, key);
      expect(again.json()).toEqual(first.json());
      expect(again.headers['idempotent-replayed']).toBe('true');
    });

    it('two projects cannot both be accepted past the candidate’s concurrent-project limit', async () => {
      const u = await signUp();
      const a = await onboarded(u);
      const p2 = await makeOpportunity('P2');
      const a2 = await onboarded(u, p2.opportunityId);
      const one = await propose(a);
      const two = await propose(a2, p2.projectId);
      // Matching already counts proposals toward capacity; lower the limit afterwards to race the two acceptances.
      await db.candidate.update({ where: { smeUserId: u.smeUserId }, data: { concurrentProjectLimit: 1 } });
      const results = await Promise.all([accept(a, one.id), accept(a2, two.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error).toBe('AT_CAPACITY');
    });
  });

  describe('CF-28 another user’s object ids', () => {
    it('status, onboarding, assignments and handoff deny other candidates without leaking data', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      const b = await signUp();
      for (const url of [`/me/enrollments/${a.enrollmentId}/status`, `/me/onboarding?enrollmentId=${a.enrollmentId}`, `/me/assignments/${pa.id}`]) {
        const res = await get(b.cookie, url);
        expect(res.statusCode, url).toBe(404);
        expect(res.body).not.toContain(a.smeUserId);
      }
      for (const url of [`/me/assignments/${pa.id}/accept`, `/me/assignments/${pa.id}/decline`, `/me/assignments/${pa.id}/open-workbench`, `/me/enrollments/${a.enrollmentId}/withdraw`, `/me/enrollments/${a.enrollmentId}/amend`]) {
        expect((await post(b.cookie, url, url.endsWith('accept') ? { expectedRevision: 0 } : {})).statusCode, url).toBe(404);
      }
      expect((await post(b.cookie, '/me/onboarding/acknowledgements', { enrollmentId: a.enrollmentId, itemKey: 'guidance' })).statusCode).toBe(404);
      expect((await db.smeAssignment.findUniqueOrThrow({ where: { id: pa.id } })).status).toBe('PROPOSED');
    });

    it('a reviewer who declares a conflict can no longer see or decide that application', async () => {
      const c = await reviewPending();
      expect((await post(reviewer, '/review/conflicts', { enrollmentId: c.enrollmentId, details: 'Former colleague' })).statusCode).toBe(201);
      expect((await get(reviewer, '/review/enrollments')).json().items).toEqual([]);
      expect((await get(reviewer, `/review/enrollments/${c.enrollmentId}`)).statusCode).toBe(403);
      expect((await decide(c, 'SELECTED')).statusCode).toBe(403);
      expect((await decide(c, 'SELECTED', {}, admin)).statusCode).toBe(200);
    });

    it('evidence opens only for an assigned reviewer and every access is audited', async () => {
      const c = await reviewPending();
      const other = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
      const x = await db.evidenceArtifact.create({ data: { clientId, smeUserId: c.smeUserId, filename: 'cert.pdf', mimeType: 'application/pdf', sizeBytes: 3, sha256: 'x', storageKey: 'missing', scanStatus: 'PENDING', retentionCategory: 'evidence' } });
      expect((await get(other, `/review/evidence/${x.id}?enrollmentId=${c.enrollmentId}`)).statusCode).toBe(404);
      expect((await get(reviewer, `/review/evidence/${x.id}?enrollmentId=${c.enrollmentId}`)).json().error).toBe('NOT_SCANNED');
      expect(await db.auditEvent.count({ where: { action: 'evidence.accessed' } })).toBe(0);
    });
  });

  describe('CF-29 withdrawal', () => {
    it('withdrawing stops pending proposals, releases the slot and keeps the history', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      expect((await post(a.cookie, `/me/enrollments/${a.enrollmentId}/withdraw`)).statusCode).toBe(200);
      expect((await db.smeAssignment.findUniqueOrThrow({ where: { id: pa.id } })).status).toBe('CANCELED');
      expect((await get(pm, `/projects/${projectId}/matches`)).json()).toMatchObject({ proposed: 0, shortfall: 2 });
      expect(await db.selectionDecision.count({ where: { enrollmentId: a.enrollmentId } })).toBe(1);
      expect((await get(a.cookie, `/me/enrollments/${a.enrollmentId}/status`)).json()).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false });
      expect((await post(a.cookie, `/me/enrollments/${a.enrollmentId}/withdraw`)).json().error).toBe('ALREADY_WITHDRAWN');
      // The gate now refuses this expert for the project.
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [await candidateId(a)] })).statusCode).toBe(409);
    });

    it('withdrawing after acceptance asks the coordinator for a handback', async () => {
      const a = await onboarded();
      const pa = await propose(a);
      await accept(a, pa.id);
      await post(a.cookie, `/me/enrollments/${a.enrollmentId}/withdraw`);
      expect(await db.auditEvent.count({ where: { entityId: pa.id, action: 'assignment.handback_required' } })).toBe(1);
    });
  });

  describe('CF-30 form path and short answers', () => {
    it('a profile completed only through the accessible form is assessed on the same criteria', async () => {
      const c = await reviewPending();
      const a = await db.suitabilityAssessment.findFirstOrThrow({ where: { enrollmentId: c.enrollmentId } });
      expect(a.status).toBe('FIT_RECOMMENDED');
      const criteria = (await db.opportunityVersion.findFirstOrThrow({ where: { opportunityId } })).criteria as { id: string }[];
      expect((a.findings as { criterionId: string }[]).map((f) => f.criterionId).sort()).toEqual(criteria.map((c) => c.id).sort());
      expect(await db.conversationTurn.count({ where: { speaker: 'CANDIDATE' } })).toBe(0);
    });
  });
});
