import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { checkWorkflowGraph, sampleProfileOutput, setFieldValue, WAVE1_PROFILES, type SectionKey } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { verifyApprovedChain } from '../src/dataset/verify';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

/**
 * D18 (owner, 16 Nov 2026): "If validation fails even if its approved then we need make the task needed for re work.
 * So that the Author has to rework." Every approval and every export re-runs the task's checks; a blocking failure
 * sends the task back to its author, with the reasons, instead of approving or exporting it.
 */
const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
type Route = 'SME_PM' | 'SME_EXPERT_PM';
type Sme = { smeUserId: string; cookie: string };

/** A single-agent workflow whose only findings are warnings (rubric references cannot be checked without the rubric). */
const WARNING_GRAPH = {
  schemaVersion: 'praxis.workflow_graph.v1-proposed', templateId: 'T', templateVersion: 1, agentMode: 'SINGLE',
  roles: [{ id: 'analyst', name: 'Analyst', responsibility: 'Analyse.', tools: [], evidenceRefs: [] }],
  artifacts: [{ id: 'brief', label: 'Brief', visibility: 'actor' }, { id: 'analysis', label: 'Analysis', visibility: 'actor' }],
  nodes: [
    { id: 'start', type: 'input', label: 'Start', policyRuleVersionIds: [], rubricCriterionIds: [], provides: ['brief'] },
    { id: 'work', type: 'agent_step', label: 'Analyse', policyRuleVersionIds: [], rubricCriterionIds: ['C1'], roleId: 'analyst', instruction: 'Analyse the brief.', inputRefs: ['brief'], outputArtifact: 'analysis' },
    { id: 'done', type: 'output', label: 'Done', policyRuleVersionIds: [], rubricCriterionIds: [], deliverable: 'analysis', completionCondition: 'Analysed.' },
  ],
  edges: [{ id: 'e1', from: 'start', to: 'work', label: '' }, { id: 'e2', from: 'work', to: 'done', label: '' }],
  loops: [],
  limits: { maxTransitions: 20 },
};

describe('D18: a task that fails validation goes back to its author, at approval and at export', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;
  let pmUserId: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const u = await createUser(clientId, ['PM']);
    pmUserId = u.id;
    pm = await login(app, u.email);
    await setFlow(true);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function project(route: Route) {
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

  const meTask = async (a: Sme, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();
  async function submitted(route: Route) {
    const pid = await project(route);
    const authorMail = `author-${randomUUID().slice(0, 6)}@gmail.test`;
    const author = await signIn(authorMail, `mock-${authorMail}`, 'Ada Author');
    const s = await source(pid, 'SME', { email: authorMail, first: 'Ada', last: 'Author' });
    const t = (await db.taskInstance.findMany({ where: { projectId: pid }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } })).find((x) => !x.slot?.isOpen && x.status === 'CREATED')!;
    expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
    let reviewer: Sme | null = null;
    if (route === 'SME_EXPERT_PM') {
      const rMail = `rev-${randomUUID().slice(0, 6)}@gmail.test`;
      reviewer = await signIn(rMail, `mock-${rMail}`, 'Rita Reviewer');
      const r = await source(pid, 'REVIEWER', { email: rMail, first: 'Rita', last: 'Reviewer' });
      expect((await assign(pid, r.id, t.id)).statusCode).toBe(200);
    }
    const v = await meTask(author, t.id);
    expect((await put(author.cookie, `/me/tasks/${t.id}`, { output: sampleProfileOutput(PROFILE), activeSecondsDelta: 10, expectedRevision: v.revision })).statusCode).toBe(200);
    const sub = await post(author.cookie, `/me/tasks/${t.id}/submit`, { expectedRevision: (await meTask(author, t.id)).revision, syntheticDeclaration: true, flagExplanations: {} });
    expect(sub.statusCode, sub.body).toBe(200);
    return { pid, id: t.id, author, reviewer };
  }

  /** Something changed after submission (here: the stored content loses a required field), so a check now fails. */
  async function breakRequiredField(id: string) {
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id } });
    await setOutput(id, setFieldValue(PROFILE, t.output as Record<string, unknown>, 'S1' as SectionKey, 'businessContext', ''));
  }
  /** The task's coverage cell is no longer one of its template's values: a submit check fails, the content is unchanged. */
  async function breakCoverage(id: string) {
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id } });
    const input = t.input as { slot: { tags: Record<string, string> } };
    await db.taskInstance.update({ where: { id }, data: { input: { ...input, slot: { ...input.slot, tags: { risk_level: 'medium' } } } as Prisma.InputJsonValue } });
  }
  /** The submitted version's content, as stored (task and its latest submission stay bound to the same content). */
  async function setOutput(id: string, output: Record<string, unknown>) {
    const latest = await db.taskSubmission.findFirstOrThrow({ where: { taskInstanceId: id }, orderBy: { version: 'desc' } });
    await db.taskInstance.update({ where: { id }, data: { output: output as Prisma.InputJsonValue } });
    await db.taskSubmission.update({ where: { id: latest.id }, data: { output: output as Prisma.InputJsonValue } });
  }

  const page = async (cookie: string, pid: string, id: string) => (await get(cookie, `/projects/${pid}/forge-tasks/${id}`)).json();
  const decide = async (cookie: string, pid: string, id: string, body: object, key = randomUUID()) => {
    const v = await page(pm, pid, id);
    return app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/tasks/${id}/decision`, headers: { cookie, 'idempotency-key': key }, payload: { expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, ...body } });
  };
  const audits = (id: string, action: string) => db.auditEvent.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });

  it('approval with a failing check is blocked: the task goes to Rework, the author sees why, the Reviewer is told; idempotent and audited', async () => {
    const s = await submitted('SME_PM');
    await breakRequiredField(s.id);
    const v = await page(pm, s.pid, s.id);
    const body = { expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, decision: 'APPROVE', checklist: allTrue };
    const key = randomUUID();
    const send = () => app.inject({ method: 'POST', url: `/api/v1/projects/${s.pid}/tasks/${s.id}/decision`, headers: { cookie: pm, 'idempotency-key': key }, payload: body });

    const res = await send();
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: 'APPROVAL_BLOCKED', details: { status: 'REWORK', version: 1 } });
    expect(res.json().message).toContain('went back to the author for rework');
    const failing = res.json().details.checks as { id: string; section: string; ok: boolean }[];
    expect(failing.some((c) => c.section === 'S1' && !c.ok)).toBe(true);

    // Not approved: no dataset record, no earning event; the task is in Rework with the re-run checks stored.
    expect(await db.approvedTaskRecord.count()).toBe(0);
    expect(await db.outboxEvent.count({ where: { name: 'task.accepted' } })).toBe(0);
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
    expect(t).toMatchObject({ status: 'REWORK', reworkCount: 1, reviewStage: null, reviewerId: pmUserId });
    expect((t.checks as { revalidation: { trigger: string; failing: string[] } }).revalidation).toMatchObject({ trigger: 'approval', failing: failing.map((c) => c.id) });

    // One append-only REWORK decision by the PM, the failing checks pinned to their sections.
    const reviews = await db.taskReview.findMany({ where: { taskInstanceId: s.id } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ decision: 'REWORK', reviewerId: pmUserId, submissionVersion: 1 });
    expect(reviews[0]!.comments).toEqual(failing.map((c) => expect.objectContaining({ section: c.section, checkId: c.id, source: 'validation' })));

    // Audited once; a retry with the same key replays the answer and changes nothing.
    const [a] = await audits(s.id, 'task.rework_validation_failed');
    expect(a).toMatchObject({ actorType: 'USER', actorId: pmUserId, before: { status: 'SUBMITTED' }, after: { status: 'REWORK', trigger: 'approval', version: 1, via: 'tasks_tab' } });
    const again = await send();
    expect(again.statusCode).toBe(422);
    expect(again.json().error).toBe('APPROVAL_BLOCKED');
    expect(await audits(s.id, 'task.rework_validation_failed')).toHaveLength(1);
    expect(await db.taskReview.count({ where: { taskInstanceId: s.id } })).toBe(1);
    // A new approval attempt is refused: the task is no longer awaiting review.
    expect((await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue })).statusCode).toBe(409);

    // The author's task page: Rework, the reasons under their sections, the failing checks; the author can edit again.
    const mine = await meTask(s.author, s.id);
    expect(mine).toMatchObject({ status: 'REWORK', readOnly: false, review: { decision: 'REWORK' } });
    expect(mine.review.comments).toEqual(expect.arrayContaining([expect.objectContaining({ section: 'S1' })]));
    expect(mine.review.notes).toContain('Approval blocked');
    expect((mine.checks as { ok: boolean; section: string }[]).some((c) => !c.ok && c.section === 'S1')).toBe(true);
    // The PM's task page shows the decision in the history.
    expect((await page(pm, s.pid, s.id)).reviews).toEqual([expect.objectContaining({ decision: 'REWORK', version: 1 })]);

    // The author fixes it and resubmits; the next approval goes through.
    const fixed = setFieldValue(PROFILE, mine.output, 'S1' as SectionKey, 'businessContext', 'A synthetic holding company onboarding with two owners.');
    expect((await put(s.author.cookie, `/me/tasks/${s.id}`, { output: fixed, activeSecondsDelta: 5, expectedRevision: mine.revision })).statusCode).toBe(200);
    expect((await post(s.author.cookie, `/me/tasks/${s.id}/submit`, { expectedRevision: (await meTask(s.author, s.id)).revision, syntheticDeclaration: true, flagExplanations: {} })).statusCode).toBe(200);
    const ok = await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'ACCEPTED' });
    expect(await db.approvedTaskRecord.count()).toBe(1);
  });

  it('warnings never block an approval', async () => {
    const s = await submitted('SME_PM');
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
    const r = checkWorkflowGraph(WARNING_GRAPH);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    await setOutput(s.id, { ...(t.output as Record<string, unknown>), workflowGraph: WARNING_GRAPH });
    const ok = await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'ACCEPTED' });
    expect(await audits(s.id, 'task.rework_validation_failed')).toHaveLength(0);
  });

  it('the external Reviewer’s pass (candidate app) and the PM’s final approval are both re-checked', async () => {
    // Reviewer pass blocked.
    const s = await submitted('SME_EXPERT_PM');
    const r = s.reviewer!;
    await breakRequiredField(s.id);
    const rv = (await get(r.cookie, `/me/reviews/${s.id}`)).json();
    const pass = await post(r.cookie, `/me/reviews/${s.id}/decision`, { decision: 'PASS', expectedVersion: rv.expectedVersion, expectedRevision: rv.expectedRevision });
    expect(pass.statusCode, pass.body).toBe(422);
    expect(pass.json()).toMatchObject({ error: 'APPROVAL_BLOCKED', details: { status: 'REWORK' } });
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: 'REWORK', reviewStage: null, reworkCount: 1 });
    expect(await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: s.id } })).toMatchObject({ decision: 'REWORK', stage: 'EXPERT_REVIEW', reviewerId: r.smeUserId });
    expect((await audits(s.id, 'task.rework_validation_failed'))[0]).toMatchObject({ actorType: 'CANDIDATE', after: { trigger: 'approval', reviewer: 'external', responsibility: 'EXPERT' } });
    expect((await get(r.cookie, '/me/reviews')).json().items[0].status).toBe('Sent back');
    expect((await meTask(s.author, s.id)).review).toMatchObject({ decision: 'REWORK', stage: 'EXPERT_REVIEW' });

    // PM approval blocked after a clean pass (something changed between the pass and the approval).
    const s2 = await submitted('SME_EXPERT_PM');
    const rv2 = (await get(s2.reviewer!.cookie, `/me/reviews/${s2.id}`)).json();
    expect((await post(s2.reviewer!.cookie, `/me/reviews/${s2.id}/decision`, { decision: 'PASS', expectedVersion: rv2.expectedVersion, expectedRevision: rv2.expectedRevision })).statusCode).toBe(200);
    // The pass is bound to the content, so here the task's coverage cell changes instead (not its content).
    await breakCoverage(s2.id);
    const appr = await decide(pm, s2.pid, s2.id, { decision: 'APPROVE' });
    expect(appr.statusCode, appr.body).toBe(422);
    expect(appr.json().error).toBe('APPROVAL_BLOCKED');
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s2.id } })).toMatchObject({ status: 'REWORK' });
    expect(await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: s2.id, decision: 'REWORK' } })).toMatchObject({ stage: 'PM_APPROVAL', reviewerId: pmUserId });
    expect((await audits(s2.id, 'task.rework_validation_failed'))[0]!.after).toMatchObject({ trigger: 'approval', responsibility: 'PM', via: 'tasks_tab' });
    expect(await db.approvedTaskRecord.count()).toBe(0);
  });

  it('the earlier console review routes re-check too (old flow)', async () => {
    const s = await submitted('SME_PM');
    await setFlow(false);
    await breakRequiredField(s.id);
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
    const res = await post(admin, `/review/tasks/${s.id}/decision`, { decision: 'ACCEPT', expectedRevision: t.revision, checklist: allTrue, comments: [] });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error).toBe('APPROVAL_BLOCKED');
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: 'REWORK' });
    expect(await db.approvedTaskRecord.count()).toBe(0);
  });

  it('export re-checks every approved task: a failing one goes to Rework, nothing is exported, its approved record is untouched', async () => {
    const s = await submitted('SME_PM');
    expect((await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue })).statusCode).toBe(200);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.id } });
    // Export on the earlier rules (all approved records, project ended).
    await setFlow(false);
    await db.project.update({ where: { id: s.pid }, data: { distinctTarget: 1, endDate: new Date('2020-01-01') } });
    expect((await get(pm, `/projects/${s.pid}/export`)).json()).toMatchObject({ canExport: true, tasks: [{ recordId: record.id }] });

    // After approval, the task's coverage cell no longer exists in its template's values: a submit check now fails.
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
    await breakCoverage(s.id);

    const ex = await post(pm, `/projects/${s.pid}/exports`);
    expect(ex.statusCode, ex.body).toBe(422);
    expect(ex.json()).toMatchObject({ error: 'EXPORT_BLOCKED_REWORK', details: { tasks: [{ taskId: s.id, recordId: record.id }] } });
    expect(ex.json().details.tasks[0].checks).toEqual([expect.objectContaining({ id: 'coverage.values', ok: false })]);
    expect(await db.projectValidationRun.count({ where: { projectId: s.pid, kind: 'EXPORT' } })).toBe(0);

    // The task is in Rework as a new revision; its slot is open to it again.
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.id }, include: { slot: true } })).toMatchObject({ status: 'REWORK', reworkCount: 1, revision: t.revision + 1, slot: { status: 'IN_PROGRESS' } });
    expect(await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: s.id, decision: 'REWORK' } })).toMatchObject({ reviewerId: pmUserId, notes: expect.stringContaining('Export blocked') });
    expect((await audits(s.id, 'task.rework_validation_failed'))[0]).toMatchObject({ actorId: pmUserId, before: { status: 'ACCEPTED' }, after: { status: 'REWORK', trigger: 'export', recordId: record.id, recordKept: true, failingChecks: ['coverage.values'] } });
    expect(await audits(s.pid, 'project.export_blocked')).toHaveLength(1);

    // Append-only: the record is exactly as it was, the chain verifies, and the database refuses to change it.
    expect(await db.approvedTaskRecord.findMany()).toEqual([record]);
    expect(await verifyApprovedChain(db)).toMatchObject({ checked: 1, breaks: [] });
    await expect(db.approvedTaskRecord.update({ where: { id: record.id }, data: { reviewNotes: 'changed' } })).rejects.toThrow();
    await expect(db.approvedTaskRecord.delete({ where: { id: record.id } })).rejects.toThrow();

    // The reworked task is not exported until it is approved again.
    expect((await get(pm, `/projects/${s.pid}/export`)).json()).toMatchObject({ canExport: false, tasks: [] });
  });
});
