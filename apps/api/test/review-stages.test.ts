import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProfileOutput, setFieldValue, WAVE1_PROFILES, type SectionKey } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
type Who = { cookie: string; smeUserId: string; candidateId: string };
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
const pin = (text: string) => [{ section: 'S1', text }, { target: { kind: 'field' as const, id: 'sections.S1.businessContext' }, text: 'Name the trigger.' }];

describe('Authoring v2.1 Wave 2: SME -> Expert -> PM review route', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;

  const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  async function deliver(name: string, handlers = defaultHandlers({ email, config })) {
    for (const ev of await db.outboxEvent.findMany({ where: { name }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers, ev.id);
  }

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** A KYB authoring task on a project with the given review route; the PM owns it and one Validator is assigned. */
  async function setup(route: 'SME_PM' | 'SME_EXPERT_PM' = 'SME_EXPERT_PM', pmRoles: ('PM' | 'REVIEWER')[] = ['PM']) {
    const pmUser = await createUser(clientId, pmRoles);
    const pm = await login(app, pmUser.email);
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
    expect(p.reviewRoute).toBe(route);
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const expertUser = await createUser(clientId, ['REVIEWER']);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: expertUser.id })).statusCode).toBe(200);
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    const a: Who = { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id };
    expect((await post(pm, `/projects/${p.id}/assignments`, { candidateIds: [c.id] })).statusCode).toBe(200);
    await deliver('candidate.assigned');
    const mine = await db.taskInstance.findMany({ where: { projectId: p.id, assignedToId: c.id }, include: { slot: true } });
    const t = mine.find((x) => !x.slot?.isOpen) ?? mine[0]!;
    return { a, id: t.id, projectId: p.id as string, pm, pmUser, expert: await login(app, expertUser.email), expertUser };
  }

  const view = async (a: Who, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();
  async function save(a: Who, id: string, output: object) {
    const t = await view(a, id);
    return put(a.cookie, `/me/tasks/${id}`, { output, activeSecondsDelta: 10, expectedRevision: t.revision });
  }
  async function submit(a: Who, id: string) {
    const t = await view(a, id);
    return post(a.cookie, `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations: {} });
  }
  const reviewView = async (cookie: string, id: string) => (await get(cookie, `/review/tasks/${id}`)).json();
  async function stage(cookie: string, id: string, body: object, seen?: { revision: number; currentVersion: number }) {
    const r = seen ?? (await reviewView(cookie, id));
    return post(cookie, `/review/tasks/${id}/stage-decision`, { expectedRevision: r.revision, expectedVersion: r.currentVersion, ...body });
  }
  const pass = (cookie: string, id: string, seen?: { revision: number; currentVersion: number }) => stage(cookie, id, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue }, seen);
  const approve = (cookie: string, id: string, seen?: { revision: number; currentVersion: number }) => stage(cookie, id, { stage: 'PM_APPROVAL', decision: 'APPROVE' }, seen);
  async function edit(cookie: string, id: string, businessContext: string, material: boolean, reason = 'Clarify the business trigger for the review.') {
    const r = await reviewView(cookie, id);
    const output = setFieldValue(PROFILE, r.output, 'S1' as SectionKey, 'businessContext', businessContext);
    return post(cookie, `/review/tasks/${id}/edit`, { expectedRevision: r.revision, expectedVersion: r.currentVersion, output, reason, material });
  }
  async function submitted(route: 'SME_PM' | 'SME_EXPERT_PM' = 'SME_EXPERT_PM', pmRoles: ('PM' | 'REVIEWER')[] = ['PM']) {
    const s = await setup(route, pmRoles);
    expect((await save(s.a, s.id, sampleProfileOutput(PROFILE))).statusCode).toBe(200);
    const sub = await submit(s.a, s.id);
    expect(sub.statusCode, sub.body).toBe(200);
    return s;
  }
  const audits = (id: string, action: string) => db.auditEvent.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });

  /** Rate card and DIRECT requisition so `task.accepted` records an earning (M10c ledger). */
  async function payable(projectId: string, smeUserId: string, by: string) {
    const supply = await db.supplyCandidate.create({ data: { clientId, emailNorm: `${randomUUID()}@example.test`, name: 'Ada Author', smeUserId } });
    const card = await db.rateCard.create({ data: { clientId, name: 'Std', version: 1, currency: 'USD', perTask: { AUTHORING: '40.00' }, createdById: by } });
    const req = await db.requisition.create({ data: { clientId, projectId, title: 'KYB authors', domain: 'banking', tier: 'EXPERT', headcount: 1, createdById: by, rateCardId: card.id, payRoute: 'DIRECT' } });
    await db.partnerSubmission.create({ data: { clientId, requisitionId: req.id, candidateId: supply.id, channel: 'DIRECT', state: 'INVITED' } });
  }

  it('the full two-stage path approves the exact passed version: one approved record, one earning', async () => {
    const s = await submitted();
    await payable(s.projectId, s.a.smeUserId, s.pmUser.id);
    expect((await view(s.a, s.id)).phase).toEqual({ phase: 'PENDING', stage: 'EXPERT_REVIEW', label: 'Review pending: Expert review' });
    const r = await reviewView(s.expert, s.id);
    expect(r).toMatchObject({ reviewRoute: 'SME_EXPERT_PM', stage: 'EXPERT_REVIEW', currentVersion: 1, actions: ['PASS', 'REWORK', 'REJECT', 'EDIT'], viewer: { canExpert: true, canPm: false } });
    // Expert queue shows it; the PM queue does not yet.
    expect((await get(s.expert, '/review/tasks')).json().items.map((x: { id: string; stage: string }) => [x.id, x.stage])).toEqual([[s.id, 'EXPERT_REVIEW']]);
    expect((await get(s.pm, '/review/tasks')).json().items).toEqual([]);
    // The one-step decision is refused on this route: it would skip a responsibility.
    const oneStep = await post(s.expert, `/review/tasks/${s.id}/decision`, { expectedRevision: r.revision, decision: 'ACCEPT', checklist: allTrue });
    expect(oneStep.statusCode).toBe(409);
    expect(oneStep.json().error).toBe('STAGE_DECISION_REQUIRED');
    // PM cannot approve before the Expert passed.
    const early = await approve(s.pm, s.id);
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe('WRONG_STAGE');

    const passed = await pass(s.expert, s.id);
    expect(passed.statusCode, passed.body).toBe(200);
    expect(passed.json()).toMatchObject({ stage: 'PM_APPROVAL', version: 1 });
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(0);
    expect(await db.outboxEvent.count({ where: { name: 'task.accepted', aggregateId: s.id } })).toBe(0);
    expect((await view(s.a, s.id)).phase).toEqual({ phase: 'PENDING', stage: 'PM_APPROVAL', label: 'Approval pending: PM approval' });
    expect((await view(s.a, s.id)).review).toBeNull();
    expect((await get(s.pm, '/review/tasks')).json().items.map((x: { stage: string }) => x.stage)).toEqual(['PM_APPROVAL']);

    const pmView = await reviewView(s.pm, s.id);
    expect(pmView).toMatchObject({ stage: 'PM_APPROVAL', actions: ['APPROVE', 'REWORK', 'REJECT'], expertPass: { version: 1 }, viewer: { canExpert: false, canPm: true } });
    expect(pmView.stageHistory).toEqual([expect.objectContaining({ stage: 'EXPERT_REVIEW', decision: 'PASS', version: 1, void: false })]);
    const key = { 'idempotency-key': randomUUID() };
    const body = { stage: 'PM_APPROVAL', decision: 'APPROVE', expectedRevision: pmView.revision, expectedVersion: 1 };
    const ok = await app.inject({ method: 'POST', url: `/api/v1/review/tasks/${s.id}/stage-decision`, headers: { cookie: s.pm, ...key }, payload: body });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'ACCEPTED', version: 1 });
    // Idempotent replay of the same request returns the same result and writes nothing new.
    const replay = await app.inject({ method: 'POST', url: `/api/v1/review/tasks/${s.id}/stage-decision`, headers: { cookie: s.pm, ...key }, payload: body });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(ok.json());
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(1);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.id } });
    expect(record.reviewerId).toBe(s.pmUser.id);
    expect((await view(s.a, s.id)).phase).toMatchObject({ phase: 'APPROVED' });
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
    expect(task).toMatchObject({ status: 'ACCEPTED', reviewStage: null });
    const accepted = await audits(s.id, 'task.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.after).toMatchObject({ responsibility: 'PM', stage: 'PM_APPROVAL', version: 1, expertId: s.expertUser.id, samePersonAsExpert: false });
    // One earning, even when the event is delivered twice.
    const pay = defaultHandlers({ smeSupply: true });
    await deliver('task.accepted', pay);
    await deliver('task.accepted', pay);
    expect(await db.earningEntry.count({ where: { sourceId: s.id } })).toBe(1);
    // Nothing more can be decided on an approved task.
    expect((await approve(s.pm, s.id)).statusCode).toBe(409);
  });

  it('Expert return keeps the same task; resubmission is a new version back at Expert review; rework never adds a payable unit', async () => {
    const s = await submitted();
    const returned = await stage(s.expert, s.id, { stage: 'EXPERT_REVIEW', decision: 'REWORK', checklist: { ...allTrue, correct: false }, comments: pin('The trigger is missing.') });
    expect(returned.statusCode, returned.body).toBe(200);
    const v = await view(s.a, s.id);
    expect(v.phase).toEqual({ phase: 'AUTHORING', stage: null, label: 'Authoring: returned for rework' });
    expect(v.review).toMatchObject({ decision: 'REWORK', stage: 'EXPERT_REVIEW', comments: [{ section: 'S1' }, { target: { kind: 'field', id: 'sections.S1.businessContext' } }] });
    // Unpinned comments are refused.
    expect((await stage(s.expert, s.id, { stage: 'EXPERT_REVIEW', decision: 'REWORK', checklist: allTrue, comments: [{ text: 'vague' }] })).statusCode).toBe(400);
    expect((await save(s.a, s.id, setFieldValue(PROFILE, v.output, 'S1' as SectionKey, 'businessContext', 'A synthetic onboarding triggered by a new holding company.'))).statusCode).toBe(200);
    expect((await submit(s.a, s.id)).statusCode).toBe(200);
    const r = await reviewView(s.expert, s.id);
    expect(r).toMatchObject({ id: s.id, stage: 'EXPERT_REVIEW', currentVersion: 2, reworkCount: 1, diff: { fromVersion: 1, toVersion: 2 } });
    expect(r.diff.changes.map((c: { path: string }) => c.path)).toContain('sections.S1.businessContext');
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    // PM returns too: back to Authoring, same task.
    const pmReturn = await stage(s.pm, s.id, { stage: 'PM_APPROVAL', decision: 'REWORK', comments: [{ target: { kind: 'node', id: 'review_ownership' }, text: 'Explain the ownership join.' }] });
    expect(pmReturn.statusCode, pmReturn.body).toBe(200);
    expect((await view(s.a, s.id)).review).toMatchObject({ decision: 'REWORK', stage: 'PM_APPROVAL' });
    expect((await submit(s.a, s.id)).statusCode).toBe(200);
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    expect((await approve(s.pm, s.id)).statusCode).toBe(200);
    expect(await db.taskInstance.count({ where: { projectId: s.projectId, assignedToId: s.a.candidateId, status: 'ACCEPTED' } })).toBe(1);
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { name: 'task.accepted', aggregateId: s.id } })).toBe(1);
    expect((await audits(s.id, 'task.rework_requested')).map((e) => (e.after as { stage: string }).stage)).toEqual(['EXPERT_REVIEW', 'PM_APPROVAL']);
  });

  it('an Expert edit needs a reason, creates a new version, re-runs the checks and voids the earlier pass', async () => {
    const s = await submitted();
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    const pmSeen = await reviewView(s.pm, s.id);
    expect(pmSeen.currentVersion).toBe(1);
    // A reason is required.
    expect((await edit(s.expert, s.id, 'Shorter context for the case.', false, '')).statusCode).toBe(400);
    // An edit that breaks the task's checks is refused and stores nothing.
    const broken = await edit(s.expert, s.id, '', false);
    expect(broken.statusCode).toBe(422);
    expect(broken.json().error).toBe('CHECKS_FAILED');
    expect(await db.taskSubmission.count({ where: { taskInstanceId: s.id } })).toBe(1);
    // A minor edit at PM approval: new version 2, back to Expert review, the pass on version 1 is void.
    const ok = await edit(s.expert, s.id, 'A synthetic onboarding of a trading company with a layered holding structure.', false);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'SUBMITTED', stage: 'EXPERT_REVIEW', version: 2, material: false });
    expect(await db.taskSubmission.count({ where: { taskInstanceId: s.id } })).toBe(2);
    const r = await reviewView(s.expert, s.id);
    expect(r.stageHistory.map((h: { decision: string; version: number; void: boolean }) => [h.decision, h.version, h.void])).toEqual([['PASS', 1, true], ['EDIT', 2, false]]);
    expect(r.stageHistory[1]).toMatchObject({ reason: 'Clarify the business trigger for the review.', material: false, stage: 'PM_APPROVAL' });
    expect(r.diff.changes).toEqual([expect.objectContaining({ path: 'sections.S1.businessContext' })]);
    expect(r.checks.length).toBeGreaterThan(0);
    const editAudit = await audits(s.id, 'task.expert_edited');
    expect(editAudit[0]!.after).toMatchObject({ responsibility: 'EXPERT', version: 2, material: false, changedPaths: ['sections.S1.businessContext'] });
    expect((editAudit[0]!.after as { voidedDecisions: string[] }).voidedDecisions).toHaveLength(1);

    // The PM's approval of version 1 is stale: refused with a precise 409, nothing written.
    const stale = await approve(s.pm, s.id, pmSeen);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'STALE_STAGE_DECISION', details: { expectedVersion: 1, currentVersion: 2 } });
    expect(stale.json().message).toContain('Expert edit');
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(0);
    // The author's SME view does not show a minor edit as something to act on.
    expect((await view(s.a, s.id)).phase.stage).toBe('EXPERT_REVIEW');
    // Re-pass version 2, then the PM approves exactly version 2.
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    const done = await approve(s.pm, s.id);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().version).toBe(2);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.id } });
    expect(JSON.stringify(record.output)).toContain('layered holding structure');
  });

  it('a material Expert edit returns the task to the author to reconfirm before review continues', async () => {
    const s = await submitted();
    const res = await edit(s.expert, s.id, 'A synthetic onboarding where the beneficial owner is a discretionary trust.', true, 'The ownership case changes what the agent must find.');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'REWORK', stage: null, version: 2, material: true });
    const v = await view(s.a, s.id);
    expect(v.phase.phase).toBe('AUTHORING');
    expect(v.review).toMatchObject({ decision: 'EDIT', editReason: 'The ownership case changes what the agent must find.', version: 2 });
    expect(JSON.stringify(v.output)).toContain('discretionary trust');
    // The edit is not the author's rework.
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).reworkCount).toBe(0);
    // Nobody can decide while the author reconfirms.
    expect((await pass(s.expert, s.id)).statusCode).toBe(409);
    // The author reconfirms by resubmitting: version 3, back at Expert review.
    expect((await submit(s.a, s.id)).statusCode).toBe(200);
    expect((await reviewView(s.expert, s.id))).toMatchObject({ stage: 'EXPERT_REVIEW', currentVersion: 3 });
  });

  it('refuses the author, an unassigned Validator and a PM acting as Expert', async () => {
    const s = await submitted();
    // The author holds an internal Validator account too (same email): never reviews their own task.
    const sme = await db.smeUser.findUniqueOrThrow({ where: { id: s.a.smeUserId } });
    const authorUser = await createUser(clientId, ['REVIEWER', 'PM'], sme.contactEmail!);
    await db.projectReviewer.create({ data: { clientId, projectId: s.projectId, userId: authorUser.id, assignedById: s.pmUser.id } });
    const authorCookie = await login(app, authorUser.email);
    expect((await get(authorCookie, `/review/tasks/${s.id}`)).statusCode).toBe(403);
    expect((await get(authorCookie, '/review/tasks')).json().items).toEqual([]);
    const seen = await reviewView(s.expert, s.id);
    expect((await pass(authorCookie, s.id, seen)).statusCode).toBe(403);
    // A Validator not assigned to the project cannot see or act.
    const other = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await get(other, `/review/tasks/${s.id}`)).statusCode).toBe(404);
    expect((await pass(other, s.id, seen)).statusCode).toBe(404);
    // The PM may open the task but may not act as Expert without being assigned.
    const asExpert = await pass(s.pm, s.id, seen);
    expect(asExpert.statusCode).toBe(403);
    expect(asExpert.json().error).toBe('NOT_PROJECT_EXPERT');
    const pmEdit = await post(s.pm, `/review/tasks/${s.id}/edit`, { expectedRevision: seen.revision, expectedVersion: 1, output: seen.output, reason: 'A PM edit attempt', material: false });
    expect(pmEdit.statusCode).toBe(403);
    // The Expert may not give PM approval.
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    const asPm = await approve(s.expert, s.id);
    expect(asPm.statusCode).toBe(403);
    expect(asPm.json().error).toBe('NOT_PROJECT_PM');
    // Another PM (not the owner) cannot approve.
    const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await approve(otherPm, s.id, await reviewView(s.pm, s.id))).statusCode).toBe(404);
    expect(await db.taskReview.count({ where: { taskInstanceId: s.id } })).toBe(1);
  });

  it('the same person may be Expert and PM: two decisions and two audit events, both responsibilities visible', async () => {
    const s = await submitted('SME_EXPERT_PM', ['PM', 'REVIEWER']);
    expect((await post(s.pm, `/projects/${s.projectId}/reviewers`, { userId: s.pmUser.id })).statusCode).toBe(200);
    const r = await reviewView(s.pm, s.id);
    expect(r.viewer).toEqual({ canExpert: true, canPm: true, bothResponsibilities: true });
    expect((await pass(s.pm, s.id)).statusCode).toBe(200);
    expect((await reviewView(s.pm, s.id)).actions).toEqual(['APPROVE', 'REWORK', 'REJECT', 'EDIT']);
    expect((await approve(s.pm, s.id)).statusCode).toBe(200);
    const passed = await audits(s.id, 'task.expert_passed');
    const accepted = await audits(s.id, 'task.accepted');
    expect(passed).toHaveLength(1);
    expect(accepted).toHaveLength(1);
    expect(passed[0]).toMatchObject({ actorId: s.pmUser.id, after: expect.objectContaining({ responsibility: 'EXPERT' }) });
    expect(accepted[0]).toMatchObject({ actorId: s.pmUser.id, after: expect.objectContaining({ responsibility: 'PM', samePersonAsExpert: true }) });
    const decisions = await db.taskReview.findMany({ where: { taskInstanceId: s.id }, orderBy: { createdAt: 'asc' } });
    expect(decisions.map((d) => [d.stage, d.decision, d.reviewerId])).toEqual([['EXPERT_REVIEW', 'PASS', s.pmUser.id], ['PM_APPROVAL', 'ACCEPT', s.pmUser.id]]);
    // Stage decisions are append-only like every review decision.
    await expect(db.taskReview.update({ where: { id: decisions[0]!.id }, data: { notes: 'changed' } })).rejects.toThrow();
  });

  it('an Expert rejects; the slot is released and nothing is approved', async () => {
    const s = await submitted();
    const res = await stage(s.expert, s.id, { stage: 'EXPERT_REVIEW', decision: 'REJECT', checklist: { ...allTrue, realistic: false }, rejectReason: 'NOT_REALISTIC' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await view(s.a, s.id)).phase.phase).toBe('REJECTED');
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(0);
  });

  it('the PM may reject at PM approval (owner decision, 11 Nov 2026): audited as the PM, nothing approved', async () => {
    const s = await submitted();
    expect((await pass(s.expert, s.id)).statusCode).toBe(200);
    expect((await reviewView(s.pm, s.id)).actions).toEqual(expect.arrayContaining(['APPROVE', 'REWORK', 'REJECT']));
    expect((await stage(s.pm, s.id, { stage: 'PM_APPROVAL', decision: 'REJECT' })).statusCode).toBe(400);
    const res = await stage(s.pm, s.id, { stage: 'PM_APPROVAL', decision: 'REJECT', rejectReason: 'INCORRECT' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'REJECTED' });
    expect((await view(s.a, s.id)).phase.phase).toBe('REJECTED');
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(0);
    expect((await audits(s.id, 'task.rejected'))[0]!.after).toMatchObject({ stage: 'PM_APPROVAL', responsibility: 'PM' });
  });

  it('an edit to the rubric or reference answer is always material (owner decision, 11 Nov 2026)', async () => {
    const s = await submitted();
    const r = await reviewView(s.expert, s.id);
    const output = structuredClone(r.output) as { sections: Record<string, Record<string, unknown>> };
    const criteria = output.sections.S7!.criteria as { name?: string }[];
    criteria[0]!.name = `${criteria[0]!.name ?? 'Criterion'} (tightened by the Expert)`;
    // The Expert says "minor", but a rubric change is material: the task goes back to the author to reconfirm.
    const res = await post(s.expert, `/review/tasks/${s.id}/edit`, { expectedRevision: r.revision, expectedVersion: r.currentVersion, output, reason: 'Tighten the first criterion.', material: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ material: true, materialBecause: 'rubric or reference answer changed', status: 'REWORK' });
    const a = (await audits(s.id, 'task.expert_edited'))[0]!.after as { material: boolean; materialDeclared: boolean; materialPaths: string[] };
    expect(a).toMatchObject({ material: true, materialDeclared: false });
    expect(a.materialPaths[0]).toMatch(/^sections\.S7\./);
  });

  it('SME -> PM projects behave exactly as before; stage endpoints refuse them', async () => {
    const s = await submitted('SME_PM');
    expect((await view(s.a, s.id)).phase).toEqual({ phase: 'PENDING', stage: 'PM_APPROVAL', label: 'Approval pending: PM approval' });
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).reviewStage).toBeNull();
    const r = await reviewView(s.expert, s.id);
    expect(r).toMatchObject({ reviewRoute: 'SME_PM', stage: 'PM_APPROVAL', actions: [], stageHistory: [] });
    // A PM without the Validator role is refused on this route, as before.
    expect((await get(s.pm, `/review/tasks/${s.id}`)).statusCode).toBe(403);
    expect((await get(s.pm, '/review/tasks')).json().items).toEqual([]);
    const staged = await pass(s.expert, s.id, { revision: r.revision, currentVersion: 1 });
    expect(staged.statusCode).toBe(409);
    expect(staged.json().error).toBe('NOT_TWO_STAGE');
    const accepted = await post(s.expert, `/review/tasks/${s.id}/decision`, { expectedRevision: r.revision, decision: 'ACCEPT', checklist: allTrue });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.id } })).toBe(1);
    const review = await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: s.id } });
    expect(review).toMatchObject({ decision: 'ACCEPT', stage: null, contentHash: null });
  });

  it('the review route is frozen once tasks exist', async () => {
    const s = await setup('SME_EXPERT_PM');
    await db.project.update({ where: { id: s.projectId }, data: { status: 'DRAFT' } });
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/projects/${s.projectId}`, headers: { cookie: s.pm, ...idem() }, payload: { reviewRoute: 'SME_PM' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('REVIEW_ROUTE_FROZEN');
  });
  describe('QA project cleanup job (owner, 13 Nov 2026: delete all projects, keep SMEs)', () => {
    it('dry run changes nothing; apply deletes a staffed project with no protected history, keeps and cancels one with approved records; SMEs, templates and audit stay', async () => {
      const { cleanupProjects } = await import('../src/jobs/qa-project-cleanup');
      // A staffed project: slots, matches, reviewer, assignment, task instance, submission.
      const staffed = await submitted();
      // An approved project: append-only approved record and reviews.
      const approved = await submitted();
      expect((await pass(approved.expert, approved.id)).statusCode).toBe(200);
      expect((await approve(approved.pm, approved.id)).statusCode).toBe(200);
      expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: approved.id } })).toBe(1);
      const before = { projects: await db.project.count(), users: await db.smeUser.count(), candidates: await db.candidate.count(), templates: await db.template.count(), audits: await db.auditEvent.count() };

      const dry = await cleanupProjects(db, { apply: false });
      expect(dry.find((o) => o.id === approved.projectId)).toMatchObject({ outcome: 'would_keep_and_cancel' });
      expect(dry.find((o) => o.id === approved.projectId)!.reasons.join(' ')).toMatch(/approved task records/);
      expect(await db.project.count()).toBe(before.projects);
      expect(await db.auditEvent.count()).toBe(before.audits);

      const staffedOutcome = dry.find((o) => o.id === staffed.projectId)!;
      const r = await cleanupProjects(db, { apply: true });
      const s = r.find((o) => o.id === staffed.projectId)!;
      if (staffedOutcome.outcome === 'would_delete') {
        expect(s.outcome, JSON.stringify(s)).toBe('deleted');
        expect(await db.project.count({ where: { id: staffed.projectId } })).toBe(0);
        expect(await db.taskInstance.count({ where: { projectId: staffed.projectId } })).toBe(0);
        expect(await db.coverageSlot.count({ where: { projectId: staffed.projectId } })).toBe(0);
        expect(await db.projectAssignment.count({ where: { projectId: staffed.projectId } })).toBe(0);
        expect(await db.auditEvent.count({ where: { entityId: staffed.projectId, action: 'project.hard_deleted', actorType: 'SYSTEM' } })).toBe(1);
      } else {
        // Submission wrote protected history (for example a policy snapshot): kept and cancelled, never forced.
        expect(s.outcome).toBe('kept_cancelled');
      }
      expect(r.find((o) => o.id === approved.projectId)).toMatchObject({ outcome: 'kept_cancelled' });
      expect((await db.project.findUniqueOrThrow({ where: { id: approved.projectId } })).status).toBe('CANCELLED');
      expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: approved.id } })).toBe(1);
      expect(await db.auditEvent.count({ where: { entityId: approved.projectId, action: 'project.cancelled', actorType: 'SYSTEM' } })).toBe(1);
      // SMEs, candidates and templates untouched; audit only grows.
      expect(await db.smeUser.count()).toBe(before.users);
      expect(await db.candidate.count()).toBe(before.candidates);
      expect(await db.template.count()).toBe(before.templates);
      expect(await db.auditEvent.count()).toBeGreaterThan(before.audits);

      // Idempotent: a second run deletes nothing more and does not cancel again.
      const again = await cleanupProjects(db, { apply: true });
      expect(again.find((o) => o.id === approved.projectId)).toMatchObject({ outcome: 'kept_already_cancelled' });
      expect(await db.auditEvent.count({ where: { entityId: approved.projectId, action: 'project.cancelled', actorType: 'SYSTEM' } })).toBe(1);
    });

    it('a draft project with nothing under it is deleted', async () => {
      const { cleanupProjects } = await import('../src/jobs/qa-project-cleanup');
      const pmUser = await createUser(clientId, ['PM']);
      const pm = await login(app, pmUser.email);
      const domainId = (await post(admin, '/domains', { name: 'Draftland' })).json().id;
      const tpl = (await post(admin, '/templates', { domainId, workflowName: 'Draft only', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 30, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
      await post(admin, `/templates/${tpl.id}/publish`);
      const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
      const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: tpl.id, name: 'Draft P', taskMode: 'AUTHORING', distinctTarget: 1, maxPerExpert: 1, tptMinutes: 30, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id });
      expect(created.statusCode, created.body).toBe(201);
      const p = created.json();
      const r = await cleanupProjects(db, { apply: true });
      expect(r.find((o) => o.id === p.id)).toMatchObject({ outcome: 'deleted' });
      expect(await db.project.count({ where: { id: p.id } })).toBe(0);
      expect(await db.template.count({ where: { id: tpl.id } })).toBe(1);
    });
  });
});
