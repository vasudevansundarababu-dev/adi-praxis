import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MockSuitabilityEvaluator } from '../src/candidate/suitability';
import { acceptProposals, defaultEmails, emailList, optionsFromEnv, parseQaUsersArgs, personaPlan, poolName, qaUsers, spread, type Http, type QaUsersOptions } from '../src/jobs/qa-users';
import { PERSONAS, trackOf } from '../src/jobs/qa-personas';
import { cleanupSmes } from '../src/jobs/qa-sme-cleanup';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { assessOnSubmit } from '../src/candidate/selection-service';
import { db, idem, login, resetDb, testConfig } from './helpers';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

const SECRET = 'test-mock-secret';
const ADMIN_PW = 'demo-admin-password-1';
const PM_PW = 'demo-pm-password-123';
const REVIEWER_PW = 'qa-seed-reviewer-pass-9';
const evaluator = new MockSuitabilityEvaluator();
/** The worker's path for enrollment.submitted, delivered in-process (QA relies on the deployed worker). */
const worker = new HandlerRegistry().register(assessOnSubmit(evaluator));

describe('qa-users: QA seed of 30 staffing-ready SMEs and 10 Reviewers', () => {
  let app: FastifyInstance;
  let clientId: string;
  let templateA: string;
  let templateB: string;
  let existingProjectId: string;
  const logs: string[] = [];
  const log = (level: string, message: string, extra: object = {}) => logs.push(JSON.stringify({ level, message, ...extra }));

  const http: Http = async ({ method, path: p, body, cookie }) => {
    const r = await app.inject({ method: method as 'GET', url: `/api/v1${p}`, headers: { cookie: cookie ?? '', ...idem() }, payload: body as object | undefined });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, cookies: r.cookies.map((c) => `${c.name}=${c.value}`), retryAfterSeconds: null };
  };
  const onPoll = async () => {
    for (const ev of await db.outboxEvent.findMany({ where: { name: 'enrollment.submitted' } })) await processDomainEvent(db, worker, ev.id);
  };
  const env = { DEMO_ADMIN_PASSWORD: ADMIN_PW, DEMO_PM_PASSWORD: PM_PW, QA_SEED_REVIEWER_PASSWORD: REVIEWER_PW };
  const options = (over: Partial<QaUsersOptions> = {}): QaUsersOptions => ({ ...optionsFromEnv(env, 'demo', false, http), assessmentTimeoutMs: 5000, pollMs: 1, onPoll, ...over });

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig(),
      db,
      pingRedis: async () => true,
      google: new MockGoogleVerifier(SECRET),
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      evaluator,
    });
  });

  beforeEach(async () => {
    await resetDb();
    logs.length = 0;
    // As demo-setup leaves QA: the demo client, its Admin and PM, and published templates.
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: ADMIN_PW, TASKFLOW_PATH: '/none' });
    clientId = client.id;
    await db.user.create({ data: { clientId, email: 'pm@praxis.demo', name: 'Pat Morgan', roles: ['PM'], passwordHash: await hashPassword(PM_PW) } });
    await db.user.create({ data: { clientId, email: 'reviewer@praxis.demo', name: 'Riley Chen', roles: ['REVIEWER'], passwordHash: await hashPassword('demo-reviewer-pass-1') } });
    const admin = await login(app, 'admin@praxis.demo', ADMIN_PW);
    const pm = await login(app, 'pm@praxis.demo', PM_PW);
    const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const template = async (workflowName: string) => {
      const t = (await post(admin, '/templates', { domainId, workflowName, primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'], defaultDistinctTarget: 8, defaultMaxPerExpert: 4 })).json();
      expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
      return t.id as string;
    };
    templateA = await template('KYC onboarding and refresh');
    templateB = await template('Sanctions screening');
    // A draft template is not covered.
    await post(admin, '/templates', { domainId, workflowName: 'Draft only', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] });
    // Template A already has a project with a published opportunity: the job reuses it as A's pool.
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId: templateA, name: 'KYC authoring demo', distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-12-01', endDate: '2027-01-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] })).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/opportunity/publish`)).statusCode).toBe(200);
    existingProjectId = p.id;
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function counts() {
    return {
      users: await db.user.count(),
      smeUsers: await db.smeUser.count(),
      identities: await db.providerIdentity.count(),
      enrollments: await db.enrollment.count(),
      decisions: await db.selectionDecision.count(),
      projects: await db.project.count(),
      jds: await db.jobDescription.count(),
      projectReviewers: await db.projectReviewer.count(),
      onboardingAcks: await db.onboardingAcknowledgement.count(),
      candidates: await db.candidate.count(),
    };
  }

  it('refuses APP_ENV=production, in the function and as a run.ts job', async () => {
    await expect(qaUsers(db, options({ appEnv: 'production' }), log)).rejects.toThrow(/refuses to run with APP_ENV=production/);
    await expect(qaUsers(db, options({ appEnv: 'production', dryRun: true }), log)).rejects.toThrow(/production/);
    const before = await counts();
    let out = '';
    let code = 0;
    try {
      execFileSync('npx', ['tsx', 'src/jobs/run.ts', 'qa-users', '--dry-run'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, DEMO_ADMIN_PASSWORD: '', QA_SEED_REVIEWER_PASSWORD: '' },
        encoding: 'utf8',
      });
    } catch (err) {
      const e = err as { status: number; stdout: string };
      code = e.status;
      out = e.stdout;
    }
    expect(code).toBe(1);
    expect(out).toMatch(/qa-users refuses to run with APP_ENV=production/);
    expect(await counts()).toEqual(before);
  }, 60_000);

  it('--dry-run prints the plan and writes nothing', async () => {
    const before = await counts();
    const audit = await db.auditEvent.count();
    const r = await qaUsers(db, options({ dryRun: true, adminPassword: undefined, reviewerPassword: undefined }), log);
    expect(await counts()).toEqual(before);
    expect(await db.auditEvent.count()).toBe(audit);
    expect(r.templates.map((t) => t.workflowName).sort()).toEqual(['KYC onboarding and refresh', 'Sanctions screening']);
    expect(r.templates.find((t) => t.id === templateA)!.projectId).toBe(existingProjectId);
    expect(r.templates.find((t) => t.id === templateB)).toMatchObject({ projectId: null, projectName: poolName('Sanctions screening') });
    expect(r.reviewers.map((x) => x.state)).toEqual(Array(10).fill('to create'));
    expect(r.slots).toHaveLength(30);
    expect(new Set(r.slots.map((s) => s.candidateEmail)).size).toBe(30);
    expect(r.slots.every((s) => s.state === 'not signed up')).toBe(true);
    expect(logs.join('\n')).toMatch(/dry run/);
  });

  it('creates 10 Reviewers and 30 staffing-ready SMEs, at least 3 per published template, decided by named Reviewers; re-running creates nothing twice', async () => {
    const r = await qaUsers(db, options(), log);
    expect(r.incomplete).toBe(0);

    // B. Reviewers: role REVIEWER, same client as reviewer@praxis.demo, created through the Admin API (audited).
    const demoReviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer@praxis.demo' } });
    const reviewers = await db.user.findMany({ where: { email: { in: defaultEmails('reviewer', 10) } } });
    expect(reviewers).toHaveLength(10);
    for (const u of reviewers) {
      expect(u).toMatchObject({ roles: ['REVIEWER'], clientId: demoReviewer.clientId, status: 'ACTIVE', mustChangePassword: false });
      expect(u.name).toMatch(/^SYNTHETIC QA Reviewer \d\d$/);
      expect(await db.auditEvent.count({ where: { entityId: u.id, action: { startsWith: 'user.' } } })).toBeGreaterThan(0);
    }
    // They can sign in with the shared password; the password is never logged.
    await login(app, 'reviewer07@praxis.test', REVIEWER_PW);
    expect(logs.join('\n')).not.toContain(REVIEWER_PW);
    // Every live project of each published template has all 10 as Validators (review queues are staffed).
    const pools = await db.project.findMany({ where: { templateId: { in: [templateA, templateB] } }, include: { reviewers: true, opportunities: { where: { role: 'AUTHOR' } } } });
    expect(pools.map((p) => p.name).sort()).toEqual(['KYC authoring demo', poolName('Sanctions screening')]);
    for (const p of pools) {
      expect(p.opportunities[0]!.status).toBe('PUBLISHED');
      for (const u of reviewers) expect(p.reviewers.some((x) => x.userId === u.id)).toBe(true);
    }

    // A. Candidates: mock Google subject, synthetic names, ready for staffing under FLOW2 section 9.
    const smes = await db.providerIdentity.findMany({ where: { subject: { in: defaultEmails('sme', 30).map((e) => `mock-${e}`) } }, include: { smeUser: true } });
    expect(smes).toHaveLength(30);
    for (const s of smes) {
      expect(s.smeUser).toMatchObject({ clientId, accountStatus: 'ACTIVE', identityStatus: 'VERIFIED' });
      expect(s.smeUser.displayName).toMatch(/^SYNTHETIC QA SME \d\d$/);
    }
    // No identity images or ID numbers: only the provider session reference and status are stored; no evidence files.
    expect(await db.evidenceArtifact.count()).toBe(0);
    const attempts = await db.identityAttempt.findMany();
    expect(attempts.every((a) => a.provider === 'stripe' && a.status === 'VERIFIED' && !a.livemode)).toBe(true);

    for (const templateId of [templateA, templateB]) {
      const pool = pools.find((p) => p.templateId === templateId)!;
      const ready = await db.enrollment.findMany({ where: { opportunity: { projectId: pool.id, role: 'AUTHOR' }, status: 'SELECTED', onboarding: { status: 'COMPLETE' } } });
      expect(ready.length).toBeGreaterThanOrEqual(3);
      // The real staffing gate agrees each one can be proposed for work.
      const { assignmentEligibility } = await import('../src/candidate/onboarding-service');
      for (const e of ready) expect((await assignmentEligibility(db, { smeUserId: e.smeUserId, projectId: pool.id })).ok).toBe(true);
    }
    expect(r.slots.every((s) => s.state === 'READY_FOR_STAFFING')).toBe(true);
    expect(await db.candidate.count()).toBe(30);

    // Approvals: every decision is a human SELECTED by one of the seeded Reviewers, with a matching audit event.
    const decisions = await db.selectionDecision.findMany();
    expect(decisions).toHaveLength(30);
    const reviewerIds = new Set(reviewers.map((u) => u.id));
    expect(decisions.every((d) => d.outcome === 'SELECTED' && reviewerIds.has(d.reviewerId))).toBe(true);
    expect(new Set(decisions.map((d) => d.reviewerId)).size).toBe(10);
    const decided = await db.auditEvent.findMany({ where: { action: 'enrollment.decided' } });
    expect(decided).toHaveLength(30);
    expect(decided.every((a) => a.actorType === 'USER' && !!a.actorId && reviewerIds.has(a.actorId))).toBe(true);
    // The AI only recommended (SYSTEM actor); it decided nothing.
    const assessed = await db.auditEvent.findMany({ where: { action: 'enrollment.assessed' } });
    expect(assessed).toHaveLength(30);
    expect(assessed.every((a) => a.actorType === 'SYSTEM')).toBe(true);
    expect(await db.auditEvent.count({ where: { action: 'onboarding.completed' } })).toBe(30);

    // Idempotent: a second run resumes, finds everything done and creates nothing.
    const before = await counts();
    const decidedBefore = decided.length;
    const again = await qaUsers(db, options(), log);
    expect(again.incomplete).toBe(0);
    expect(again.reviewers.every((x) => x.state === 'exists')).toBe(true);
    expect(again.templates.every((t) => !t.created)).toBe(true);
    expect(await counts()).toEqual(before);
    expect(await db.auditEvent.count({ where: { action: 'enrollment.decided' } })).toBe(decidedBefore);
  }, 300_000);

  it('resumes a run that stopped before the assessment: nothing is synthesised, the next run finishes the job', async () => {
    const small = { candidateEmails: defaultEmails('sme', 6), reviewerEmails: defaultEmails('reviewer', 2) };
    // No worker: profiles stay SUBMITTED, so no decision can be made and nothing is approved.
    const first = await qaUsers(db, options({ ...small, onPoll: undefined, assessmentTimeoutMs: 0 }), log);
    expect(first.incomplete).toBe(6);
    expect(first.slots.every((s) => s.state === 'enrollment SUBMITTED')).toBe(true);
    expect(await db.selectionDecision.count()).toBe(0);
    expect(logs.join('\n')).toMatch(/still awaiting the suitability assessment/);
    const second = await qaUsers(db, options(small), log);
    expect(second.incomplete).toBe(0);
    expect(await db.enrollment.count()).toBe(6);
    expect(await db.selectionDecision.count()).toBe(6);
  }, 120_000);

  it('runs failed assessments itself with its own model (QA without Claude quota), then finishes', async () => {
    const small = { candidateEmails: defaultEmails('sme', 6), reviewerEmails: defaultEmails('reviewer', 2) };
    // The worker's model is unavailable: every assessment ends in a recoverable ERROR and nobody is selected.
    const down = { modelVersion: 'claude-opus-5', evaluate: async () => { throw new Error('429 quota'); } };
    const broken = new HandlerRegistry().register(assessOnSubmit(down));
    const workerDown = async () => {
      for (const ev of await db.outboxEvent.findMany({ where: { name: 'enrollment.submitted' } })) await processDomainEvent(db, broken, ev.id).catch(() => undefined);
    };
    const first = await qaUsers(db, options({ ...small, onPoll: workerDown, assessmentTimeoutMs: 0 }), log);
    expect(first.slots.every((s) => s.state === 'enrollment SUBMITTED')).toBe(true);
    expect(await db.suitabilityAssessment.count({ where: { status: 'ERROR' } })).toBe(6);
    // Re-run with a working model for the job: it claims the failed assessments, and Reviewers decide as usual.
    const second = await qaUsers(db, options({ ...small, onPoll: undefined, evaluator: new MockSuitabilityEvaluator() }), log);
    expect(second.incomplete).toBe(0);
    expect(await db.suitabilityAssessment.count({ where: { status: 'FIT_RECOMMENDED', modelVersion: 'mock-rules-1' } })).toBe(6);
    expect(await db.auditEvent.count({ where: { action: 'enrollment.assessed', actorType: 'SYSTEM' } })).toBe(6);
    const reviewerIds = (await db.user.findMany({ where: { email: { in: small.reviewerEmails } } })).map((u) => u.id);
    const decided = await db.auditEvent.findMany({ where: { action: 'enrollment.decided' } });
    expect(decided).toHaveLength(6);
    expect(decided.every((a) => a.actorType === 'USER' && reviewerIds.includes(a.actorId!))).toBe(true);
  }, 120_000);

  it('gives up on an assessment after 3 tries and leaves it undecided', async () => {
    const small = { candidateEmails: defaultEmails('sme', 3), reviewerEmails: defaultEmails('reviewer', 1) };
    let calls = 0;
    const down = { modelVersion: 'gemini:x', evaluate: async () => { calls++; throw new Error('503'); } };
    const r = await qaUsers(db, options({ ...small, onPoll: undefined, evaluator: down, assessmentTimeoutMs: 300 }), log);
    // 3 candidates over 2 templates: 6 pool places, each assessment tried 3 times.
    expect(r.incomplete).toBe(6);
    expect(calls).toBe(18);
    expect(await db.selectionDecision.count()).toBe(0);
    expect(logs.join('\n')).toMatch(/assessment failed/);
  }, 60_000);

  it('waits out the login rate limit (QA allows 10 sign-ins a minute) instead of failing', async () => {
    const waits: number[] = [];
    let limited = 0;
    const flaky: Http = async (req) => {
      if (req.path === '/auth/google' && limited++ < 2) return { status: 429, body: { error: 'RATE_LIMITED' }, cookies: [], retryAfterSeconds: 30 };
      return http(req);
    };
    const r = await qaUsers(db, options({ http: flaky, candidateEmails: defaultEmails('sme', 3), reviewerEmails: defaultEmails('reviewer', 1), sleep: async (ms) => void waits.push(ms) }), log);
    expect(r.incomplete).toBe(0);
    expect(waits.filter((w) => w === 31_000)).toHaveLength(2);
  }, 60_000);

  it('matched mode seeds only the KYC personas into the named project; the PM assigns, the SMEs accept; the SME cleanup then deletes or retires everyone', async () => {
    const kyc = PERSONAS.filter((p) => p.track === 'KYC').map((p) => p.email).sort();
    const matched = { personas: PERSONAS, candidateEmails: PERSONAS.map((p) => p.email), projectIds: [existingProjectId], reviewerEmails: defaultEmails('reviewer', 2) };
    const plan = await qaUsers(db, options({ ...matched, dryRun: true }), log);
    expect(plan.templates.map((t) => t.projectId)).toEqual([existingProjectId]);
    expect(plan.slots.map((s) => s.candidateEmail).sort()).toEqual(kyc);
    expect(await db.smeUser.count()).toBe(0);

    const r = await qaUsers(db, options(matched), log);
    expect(r.incomplete).toBe(0);
    expect(r.slots.map((s) => s.candidateEmail).sort()).toEqual(kyc);
    // No pool for the other template, no Marketing persona on a KYC project.
    expect(await db.project.count()).toBe(1);
    const users = await db.smeUser.findMany();
    expect(users).toHaveLength(8);
    expect(users.map((u) => u.displayName).sort()).toEqual(PERSONAS.filter((p) => p.track === 'KYC').map((p) => p.name).sort());
    // The persona's own answers went through the profile form.
    const il = await db.profileVersion.findFirstOrThrow({ where: { smeUser: { displayName: { contains: 'KYC SME 07' } } }, orderBy: { version: 'desc' } });
    const f = (il.data as { fields: Record<string, { value: unknown }> }).fields;
    expect(f.jurisdictions!.value).toEqual(['United States']);
    expect(f.specialties!.value).toEqual(['KYC / onboarding', 'Enhanced due diligence', 'Sanctions review', 'Compliance testing']);
    expect(f.decision_authority!.value).toBe('Approved outcomes');
    expect(String(f.work_example!.value)).toMatch(/custodial account for a minor/);
    expect(String(f['criterion:skill-1']!.value)).toMatch(/Illinois/);
    expect(JSON.stringify(il)).not.toMatch(/United Kingdom|Synthetic QA test answer/);
    // Every selection is still a named Reviewer's decision.
    expect(await db.selectionDecision.count({ where: { outcome: 'SELECTED' } })).toBe(8);

    // The PM assigns two; the synthetic SMEs accept through the candidate endpoint.
    const pm = await login(app, 'pm@praxis.demo', PM_PW);
    const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: pm, ...idem() }, payload });
    expect((await post(`/projects/${existingProjectId}/match`)).statusCode).toBeLessThan(300);
    expect((await post(`/projects/${existingProjectId}/assignments`, { topN: 2 })).statusCode).toBeLessThan(300);
    const accepted = await acceptProposals(db, { appEnv: 'demo', http, personas: PERSONAS }, log);
    expect(accepted.map((a) => a.outcome)).toEqual(['accepted', 'accepted']);
    expect(await db.smeAssignment.count({ where: { status: 'ACCEPTED' } })).toBe(2);
    await expect(acceptProposals(db, { appEnv: 'production', http, personas: PERSONAS }, log)).rejects.toThrow(/production/);
    // Personas that were never seeded (the Marketing ones here) are skipped, not signed up.
    expect(await db.smeUser.count()).toBe(8);

    // One more SME who only started an application: no protected history, so fully deletable.
    const token = (await http({ method: 'POST', path: '/auth/dev/google-token', body: { email: 'draft@praxis.test', name: 'SYNTHETIC QA draft' } })).body.credential;
    const signIn = await http({ method: 'POST', path: '/auth/google', body: { credential: token, adultAttested: true } });
    const cookie = signIn.cookies.join('; ');
    const opp = await db.opportunity.findFirstOrThrow({ where: { projectId: existingProjectId, role: 'AUTHOR' } });
    expect((await http({ method: 'POST', path: '/me/enrollments', body: { opportunityId: opp.id }, cookie })).status).toBeLessThan(300);
    const draftUser = await db.smeUser.findFirstOrThrow({ where: { displayName: 'SYNTHETIC QA draft' } });

    // Dry run: classifies, writes nothing.
    const before = { smes: await db.smeUser.count(), ids: await db.providerIdentity.count(), audit: await db.auditEvent.count(), decisions: await db.selectionDecision.count() };
    const dry = await cleanupSmes(db, { apply: false });
    expect(dry.filter((o) => o.outcome === 'would_delete').map((o) => o.smeUserId)).toEqual([draftUser.id]);
    expect(dry.filter((o) => o.outcome === 'would_retire')).toHaveLength(8);
    expect(dry.find((o) => o.outcome === 'would_retire')!.reasons.join()).toMatch(/selection decisions/);
    expect({ smes: await db.smeUser.count(), ids: await db.providerIdentity.count(), audit: await db.auditEvent.count(), decisions: await db.selectionDecision.count() }).toEqual(before);

    const done = await cleanupSmes(db, { apply: true });
    expect(done.filter((o) => o.outcome === 'deleted')).toHaveLength(1);
    expect(done.filter((o) => o.outcome === 'retired')).toHaveLength(8);
    expect(await db.smeUser.findUnique({ where: { id: draftUser.id } })).toBeNull();
    expect(await db.enrollment.count({ where: { smeUserId: draftUser.id } })).toBe(0);
    // Protected history is untouched; nobody can sign in with the old account; nothing is left open or counted.
    expect(await db.selectionDecision.count()).toBe(before.decisions);
    expect(await db.providerIdentity.count()).toBe(0);
    expect(await db.session.count({ where: { smeUserId: { not: null } } })).toBe(0);
    for (const u of await db.smeUser.findMany()) expect(u).toMatchObject({ accountStatus: 'CLOSED', displayName: 'Deleted SME', contactEmail: null });
    expect(await db.candidate.count({ where: { deletedAt: null } })).toBe(0);
    expect(await db.smeAssignment.count({ where: { status: { in: ['PROPOSED', 'ACCEPTED'] } } })).toBe(0);
    expect(await db.projectAssignment.count({ where: { releasedAt: null } })).toBe(0);
    // Matches are gone, and the matcher's own filter skips deleted and closed candidates (the project itself is
    // STAFFED here, so its match can't be re-run; QA cancels old projects with qa-project-cleanup).
    expect(await db.projectMatch.count()).toBe(0);
    expect(await db.candidate.count({ where: { deletedAt: null, smeUser: { accountStatus: 'ACTIVE' } } })).toBe(0);
    // Audited as SYSTEM, without names or emails.
    const audits = await db.auditEvent.findMany({ where: { action: { in: ['sme.hard_deleted', 'sme.retired'] } } });
    expect(audits).toHaveLength(9);
    expect(audits.every((a) => a.actorType === 'SYSTEM' && a.actorId === 'qa-sme-cleanup')).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/@praxis\.test|SYNTHETIC QA KYC/);

    // Idempotent.
    const again = await cleanupSmes(db, { apply: true });
    expect(again.every((o) => o.outcome === 'already_retired')).toBe(true);
    expect(await db.auditEvent.count({ where: { action: { in: ['sme.hard_deleted', 'sme.retired'] } } })).toBe(9);

    // The same email later starts a brand-new, clean account; the retired one stays closed.
    const re = (await http({ method: 'POST', path: '/auth/dev/google-token', body: { email: 'kyc01@praxis.test', name: 'again' } })).body.credential;
    expect((await http({ method: 'POST', path: '/auth/google', body: { credential: re, adultAttested: true } })).status).toBe(200);
    expect(await db.smeUser.count({ where: { accountStatus: 'ACTIVE' } })).toBe(1);
  }, 300_000);

  it('matched mode refuses a project without a published opportunity', async () => {
    const draft = await db.project.create({ data: { clientId, name: 'Unpublished', templateId: templateA, templateVersion: 1, ownerId: (await db.user.findUniqueOrThrow({ where: { email: 'pm@praxis.demo' } })).id } as never }).catch(() => null);
    if (draft) await expect(qaUsers(db, options({ personas: PERSONAS, candidateEmails: PERSONAS.map((p) => p.email), projectIds: [draft.id], dryRun: true }), log)).rejects.toThrow(/published opportunity/);
    await expect(qaUsers(db, options({ personas: PERSONAS, candidateEmails: PERSONAS.map((p) => p.email), projectIds: [randomUUID()], dryRun: true }), log)).rejects.toThrow(/not found/);
  });

  it('qa-sme-cleanup as a run.ts job: refuses production, and --apply needs the confirmation phrase', async () => {
    const run = (args: string[], extra: Record<string, string>) => {
      try {
        return { code: 0, out: execFileSync('npx', ['tsx', 'src/jobs/run.ts', 'qa-sme-cleanup', ...args], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, ...extra }, encoding: 'utf8' }) };
      } catch (err) {
        const e = err as { status: number; stdout: string };
        return { code: e.status, out: e.stdout };
      }
    };
    expect(run([], { APP_ENV: 'production' })).toMatchObject({ code: 1, out: expect.stringMatching(/refuses to run with APP_ENV=production/) });
    expect(run(['--apply'], { APP_ENV: 'local', QA_SME_CLEANUP_CONFIRM: '' })).toMatchObject({ code: 1, out: expect.stringMatching(/QA_SME_CLEANUP_CONFIRM=delete-all-smes/) });
    const dry = run([], { APP_ENV: 'local' });
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/"report":"qa-sme-cleanup","apply":false/);
  }, 90_000);

  it('needs the passwords for a real run', async () => {
    await expect(qaUsers(db, options({ reviewerPassword: undefined }), log)).rejects.toThrow(/QA_SEED_REVIEWER_PASSWORD/);
    await expect(qaUsers(db, options({ reviewerPassword: 'short' }), log)).rejects.toThrow(/at least 12/);
    await expect(qaUsers(db, options({ pmPassword: undefined }), log)).rejects.toThrow(/DEMO_PM_PASSWORD/);
    expect(await db.user.count({ where: { email: { endsWith: '@praxis.test' } } })).toBe(0);
  });
});

describe('qa-users: planning', () => {
  it('every template gets at least 3 different candidates and every candidate a pool, for any template count', () => {
    const candidates = defaultEmails('sme', 30);
    const reviewers = defaultEmails('reviewer', 10);
    for (const n of [1, 2, 5, 10, 11, 12, 15, 30, 31]) {
      const templates = Array.from({ length: n }, (_, i) => `t${i}`);
      const slots = spread(templates, candidates, reviewers);
      for (const t of templates) {
        const mine = slots.filter((s) => s.template === t).map((s) => s.candidateEmail);
        expect(mine.length, `template count ${n}`).toBeGreaterThanOrEqual(3);
        expect(new Set(mine).size).toBe(mine.length);
      }
      expect(new Set(slots.map((s) => s.candidateEmail)).size).toBe(30);
      expect(new Set(slots.map((s) => s.reviewerEmail)).size).toBe(Math.min(10, slots.length));
    }
  });

  it('matches personas to templates by track and refuses templates that fit neither', () => {
    expect(trackOf('KYC onboarding and refresh', 'Banking')).toBe('KYC');
    expect(trackOf('Golden KYC reusable', 'Banking')).toBe('KYC');
    expect(trackOf('Campaign brief', 'Marketing')).toBe('MARKETING');
    expect(trackOf('Sanctions screening', 'Banking')).toBeNull();
    const t = (workflowName: string, name: string) => ({ workflowName, domain: { name } });
    const plan = personaPlan([t('KYC onboarding', 'Banking'), t('Launch plan', 'Marketing')], PERSONAS, ['r1', 'r2']);
    expect(plan.filter((s) => s.template.workflowName === 'KYC onboarding')).toHaveLength(8);
    expect(plan.filter((s) => s.template.workflowName === 'Launch plan').map((s) => s.candidateEmail)).toEqual(['mkt01@praxis.test', 'mkt02@praxis.test', 'mkt03@praxis.test', 'mkt04@praxis.test']);
    expect(() => personaPlan([t('Sanctions screening', 'Banking')], PERSONAS, ['r1'])).toThrow(/neither a KYC nor a Marketing/);
    // 12 synthetic personas, KYC spread over the five governing states.
    expect(PERSONAS).toHaveLength(12);
    expect(new Set(PERSONAS.map((p) => p.email)).size).toBe(12);
    expect(PERSONAS.every((p) => p.name.startsWith('SYNTHETIC QA') && p.email.endsWith('@praxis.test'))).toBe(true);
    expect(new Set(PERSONAS.filter((p) => p.track === 'KYC').map((p) => (p.fields.jurisdictions as string[])[1]))).toEqual(new Set(['US-CA', 'US-NY', 'US-TX', 'US-FL', 'US-IL']));
  });

  it('parses the run.ts arguments', () => {
    const id = randomUUID();
    expect(parseQaUsersArgs([])).toEqual({ dryRun: false, matched: false, accept: false, projectIds: [] });
    expect(parseQaUsersArgs(['--matched', '--project', id, '--dry-run'])).toMatchObject({ matched: true, dryRun: true, projectIds: [id] });
    expect(parseQaUsersArgs(['--accept'])).toMatchObject({ accept: true });
    expect(() => parseQaUsersArgs(['--matched'])).toThrow(/at least one --project/);
    expect(() => parseQaUsersArgs(['--project', id])).toThrow(/needs --matched/);
    expect(() => parseQaUsersArgs(['--project', 'x'])).toThrow(/project id/);
    expect(() => parseQaUsersArgs(['--accept', '--dry-run'])).toThrow(/on its own/);
    expect(() => parseQaUsersArgs(['--bogus'])).toThrow(/Unknown/);
  });

  it('reads the email lists from the environment, each address its own identity', () => {
    expect(emailList(undefined, defaultEmails('sme', 30), 30, 'X')[29]).toBe('sme30@praxis.test');
    const custom = Array.from({ length: 10 }, (_, i) => `Rev${i}@Example.test`).join(', ');
    expect(emailList(custom, [], 10, 'X')[0]).toBe('rev0@example.test');
    expect(() => emailList('a@b.test,a@b.test', [], 2, 'X')).toThrow(/exactly 2/);
    expect(() => emailList('not-an-email', [], 1, 'X')).toThrow(/invalid/);
    const o = optionsFromEnv({ QA_SEED_CANDIDATE_EMAILS: Array.from({ length: 30 }, () => `${randomUUID()}@x.test`).join(',') }, 'demo', true, async () => ({ status: 200, body: null, cookies: [], retryAfterSeconds: null }));
    expect(o.candidateEmails).toHaveLength(30);
    expect(o.reviewerEmails[0]).toBe('reviewer01@praxis.test');
  });
});
