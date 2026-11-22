import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { applyBindings, KYC_V8_TOOL_BINDING } from '../src/jobs/kyc-v8-tool-binding';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { fakeRlGym, qualifyForRlGym, RLGYM_CONFIG } from './rlgym-helpers';

/**
 * New RL Gym part 3 (docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.1 b, §3.2 b): the RL Gym sends an SME
 * review batch into the project; the project's Reviewers, its PM and Admins decide each item (final); decisions go back
 * to the RL Gym; "task needs correction" is a normal Rework whose corrected revision returns in the re-export. Mocks only.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';
const REF = { id: 'tpl_x5rwt6d5eu', version: 9, spec: 'f'.repeat(64) };

/** The RL Gym's hash (anvil.rlgym.common.sha): sorted keys, compact JSON, UTF-8. */
function rlGymSha(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(sort(value)), 'utf8').digest('hex');
}

/** The embedded v8 candidate for an application type, with its APR-13 tool bindings (so every task can be packaged). */
function boundOutput(applicationType: string) {
  const c = [...EMBEDDED.successors.values()].find((s) => s.candidate.output.sections.S1!.applicationType === applicationType)!;
  const bt = KYC_V8_TOOL_BINDING.tasks.find((t) => t.applicationType === applicationType);
  if (!bt) return c.candidate.output;
  const r = applyBindings(c.candidate.output, bt.changes);
  if (!('output' in r)) throw new Error(r.problems.join(' '));
  return r.output;
}

describe('benchmark review', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const rlgym = fakeRlGym();
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);
  const exportNow = (key = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/exports`, headers: { cookie: pm, 'idempotency-key': key }, payload: {} });
  let pid: string;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ ...RLGYM_CONFIG, ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
      rlgymFetch: rlgym.fetch,
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
    });
  });
  beforeEach(async () => {
    await resetDb();
    rlgym.sent.length = 0;
    rlgym.state.mode = 'ok';
    rlgym.state.answer = null;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, ADMIN_EMAIL, 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym local', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function publishedV8(): Promise<Template> {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(V7) });
    expect(res.statusCode, res.body).toBe(201);
    const v7Id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${v7Id}/publish`)).statusCode).toBe(200);
    const v7 = await db.template.findUniqueOrThrow({ where: { id: v7Id } });
    const spec = structuredClone(EMBEDDED.spec) as JointTemplateSpec;
    spec.template_id = v7.lineageId;
    spec.version = v7.version + 1;
    spec.requirement.successor_of = { template_id: v7.lineageId, version: v7.version, template_sha256: jointHashes(jointTemplateSpec(v7)!).template_sha256 };
    const made = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec });
    expect(made.outcome, JSON.stringify(made)).toBe('created');
    expect((await post(admin, `/templates/${made.v8!.templateVersionId}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id: made.v8!.templateVersionId! } });
  }

  /** A KYC v8 project with four tasks, none approved yet. */
  async function v8Project() {
    const v8 = await publishedV8();
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: 'KYC November', taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    pid = created.json().id as string;
    expect((await post(pm, `/projects/${pid}/submit`)).statusCode).toBe(200);
    return v8;
  }

  /** A person approves the task for an application type (writeApprovedRecord, as the console does). */
  async function approve(applicationType: string, output: unknown = boundOutput(applicationType)): Promise<ApprovedTaskRecord> {
    const tasks = await db.taskInstance.findMany({ where: { projectId: pid } });
    const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === applicationType)!;
    const reviewer = await createUser(clientId, ['ADMIN']);
    if (!task.assignedToId) {
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${applicationType}-${randomUUID().slice(0, 4)}@sme.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      await db.taskInstance.update({ where: { id: task.id }, data: { assignedToId: cand.id, assignedAt: new Date() } });
    }
    await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', submittedAt: new Date(), output: output as Prisma.InputJsonValue } });
    const version = (await db.taskSubmission.count({ where: { taskInstanceId: task.id } })) + 1;
    await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version, output: output as Prisma.InputJsonValue, checks: {} } });
    return db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
  }

  /** A batch as the RL Gym builds it (rlgym.results.sme), for the given approved records. */
  function batch(records: ApprovedTaskRecord[], over: Record<string, unknown> = {}) {
    return {
      schema: 'rlgym.sme-review-package.v1',
      batch_id: 'smr-0001',
      run_id: 'run-0001',
      project_id: pid,
      template: { id: REF.id, version: REF.version, spec_sha256: REF.spec },
      scoring_pass: { pass: 1, reason: 'first scoring' },
      rubric: [
        { criterion_id: 'decision', configuration_id: 'cfg-decision', version: 1, weight: 5, is_gate: false, skill_group: 'judgement' },
        { criterion_id: 'findings', configuration_id: 'cfg-findings', version: 1, weight: 5, is_gate: false, skill_group: 'evidence' },
      ],
      tasks: records.map((r, i) => ({
        task_id: r.taskInstanceId,
        revision: 1,
        episodes: [
          {
            item_id: `item-${i + 1}`,
            episode_id: `ep-${i + 1}`,
            system: { id: 'sys-a', version: '1', name: 'Model A' },
            attempt: 1,
            case_id: `case-${i + 1}`,
            score: 60,
            criteria: [{ criterion_id: 'decision', verdict: 'fail', points: 0, evaluator: 'rule', detail: 'Wrong decision', nodes: [] }],
            path: { order: ['read', 'decide'], failed_node: 'decide', failed_why: 'missed the pending TIN', summary: 'Read, then decided too early' },
            timeline: [{ step: 1, tool: 'application.read', args: {}, status: 'ok', node: 'read' }],
            final_output: { decision: 'approve' },
            evidence: { sealed_sha256: 'e'.repeat(64), manifest_sha256: 'm'.repeat(64) },
            suspected_cause: 'task_ambiguous',
            suspected_cause_source: 'heuristic',
          },
        ],
      })),
      synthetic: true,
      note: 'Synthetic data only.',
      batch_sha256: 'b'.repeat(64),
      ...over,
    };
  }
  const sendBatch = (body: object, key = anvilKey) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/run-reviews`, headers: { authorization: `Bearer ${key}`, 'idempotency-key': randomUUID() }, payload: body });
  const decide = (cookie: string, reviewId: string, body: object) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/benchmark-reviews/${reviewId}/decisions`, headers: { cookie, ...idem() }, payload: body });
  const send = (cookie: string, reviewId: string, decisionId: string) => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/benchmark-reviews/${reviewId}/decisions/${decisionId}/send`, headers: { cookie, ...idem() }, payload: {} });

  async function exported() {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    const a = await approve('individual');
    const b = await approve('adult_joint');
    expect((await exportNow()).statusCode).toBe(201);
    return { a, b };
  }

  it('the RL Gym sends a batch: 202 with forge_batch_ref, the same batch again gives the same ref, other content conflicts', async () => {
    const { a, b } = await exported();
    const res = await sendBatch(batch([a, b]));
    expect(res.statusCode, res.body).toBe(202);
    const ref = res.json().forge_batch_ref as string;
    expect(ref).toMatch(/^fbr-[0-9a-f]{16}$/);
    expect(Object.keys(res.json())).toEqual(['forge_batch_ref']);
    expect((await sendBatch(batch([a, b]))).json()).toEqual({ forge_batch_ref: ref });
    expect((await sendBatch(batch([a, b], { note: 'changed' }))).statusCode).toBe(409);
    expect(await db.rlGymReviewBatch.count()).toBe(1);
    // Refused: another project in the path, a malformed batch, a PM instead of the RL Gym key.
    expect((await sendBatch({ ...batch([a]), project_id: randomUUID() })).statusCode).toBe(422);
    expect((await sendBatch({ ...batch([a]), schema: 'other' })).statusCode).toBe(422);
    expect((await sendBatch({ ...batch([a]), synthetic: false })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/run-reviews`, headers: { cookie: pm, ...idem() }, payload: batch([a]) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${randomUUID()}/run-reviews`, headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: { ...batch([a]), batch_id: 'smr-x' } })).statusCode).toBe(422);
  });

  it('who sees it: the owning PM, Admins and the project’s assigned Reviewers; not another PM or an unassigned Reviewer', async () => {
    const { a } = await exported();
    await sendBatch(batch([a]));
    const list = (await get(pm, `/projects/${pid}/benchmark-reviews`)).json();
    expect(list).toMatchObject({ connected: true, items: [{ batchId: 'smr-0001', runId: 'run-0001', items: 1, decided: 0, undelivered: 0 }] });
    const reviewId = list.items[0].id;
    const detail = (await get(pm, `/projects/${pid}/benchmark-reviews/${reviewId}`)).json();
    expect(detail).toMatchObject({ canDecide: true, connected: true, tasks: [{ taskId: a.taskInstanceId, revision: 1 }], rubric: [{ criterion_id: 'decision' }, { criterion_id: 'findings' }] });
    expect(detail.tasks[0].episodes[0]).toMatchObject({ item_id: 'item-1', suspected_cause: 'task_ambiguous', path: { failed_node: 'decide' } });
    expect(JSON.stringify(detail)).not.toMatch(/reference_answers/);

    const assignedUser = await createUser(clientId, ['REVIEWER']);
    await db.projectReviewer.create({ data: { clientId, projectId: pid, userId: assignedUser.id, assignedById: assignedUser.id } });
    const assigned = await login(app, assignedUser.email);
    expect((await get(assigned, `/projects/${pid}/benchmark-reviews/${reviewId}`)).statusCode).toBe(200);
    const unassigned = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await get(unassigned, `/projects/${pid}/benchmark-reviews`)).statusCode).toBe(404);
    const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await get(otherPm, `/projects/${pid}/benchmark-reviews`)).statusCode).toBe(404);
    expect((await get(admin, `/projects/${pid}/benchmark-reviews`)).statusCode).toBe(200);
  });

  it('a decision is final, needs a reason (and a criterion for rubric or grader), and goes back to the RL Gym once', async () => {
    const { a, b } = await exported();
    await sendBatch(batch([a, b]));
    const reviewId = (await get(pm, `/projects/${pid}/benchmark-reviews`)).json().items[0].id;
    expect((await decide(pm, reviewId, { itemId: 'item-1', decision: 'agent_failure', rationale: '  ' })).statusCode).toBe(400);
    expect((await decide(pm, reviewId, { itemId: 'item-1', decision: 'grader_wrong', rationale: 'The rule misread the field.' })).statusCode).toBe(400);
    expect((await decide(pm, reviewId, { itemId: 'item-1', decision: 'grader_wrong', rationale: 'x', criterionId: 'nope' })).statusCode).toBe(422);
    expect((await decide(pm, reviewId, { itemId: 'item-9', decision: 'agent_failure', rationale: 'x' })).statusCode).toBe(404);

    const d = await decide(pm, reviewId, { itemId: 'item-1', decision: 'grader_wrong', rationale: 'The rule misread the field.', criterionId: 'decision' });
    expect(d.statusCode, d.body).toBe(201);
    expect(d.json()).toMatchObject({ itemId: 'item-1', decision: 'grader_wrong', criterionId: 'decision', delivery: null });
    const again = await decide(pm, reviewId, { itemId: 'item-1', decision: 'agent_failure', rationale: 'Changed my mind.' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('DECISION_FINAL');

    // Sent once: the RL Gym's contract, an opaque decided_by, its key and a stable Idempotency-Key.
    const sent = await send(pm, reviewId, d.json().id);
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().delivery).toMatchObject({ outcome: 'delivered', httpStatus: 201 });
    const call = rlgym.sent.at(-1)!;
    expect(call.url).toBe('http://127.0.0.1:8200/api/v1/workspaces/adi-labs-research/sme-review-batches/smr-0001/decisions');
    expect(call.headers).toMatchObject({ Authorization: 'Bearer test-rlgym-forge-key', 'Idempotency-Key': `forge-decision-${d.json().id}` });
    expect(call.body).toEqual({ schema: 'rlgym.sme-decisions.v1', batch_id: 'smr-0001', decisions: [{ item_id: 'item-1', decision: 'grader_wrong', rationale: 'The rule misread the field.', decided_by: expect.stringMatching(/^adi-forge-user:[0-9a-f-]{36}$/), criterion_id: 'decision' }] });
    expect(JSON.stringify(call.body)).not.toMatch(/@/);
    expect((await send(pm, reviewId, d.json().id)).json().error).toBe('ALREADY_DELIVERED');

    // A refused send is kept and can be sent again.
    const d2 = (await decide(pm, reviewId, { itemId: 'item-2', decision: 'agent_failure', rationale: 'The agent skipped a step.' })).json();
    rlgym.state.mode = 'error';
    expect((await send(pm, reviewId, d2.id)).json().delivery).toMatchObject({ outcome: 'rejected', error: { code: 'TEMPLATE_NOT_ACTIVE' } });
    rlgym.state.mode = 'ok';
    expect((await send(pm, reviewId, d2.id)).json().delivery).toMatchObject({ outcome: 'delivered' });
    expect((await get(pm, `/projects/${pid}/benchmark-reviews`)).json().items[0]).toMatchObject({ decided: 2, undelivered: 0 });

    // Final in the database too; every table is append-only.
    await expect(db.rlGymReviewDecision.create({ data: { clientId, projectId: pid, reviewBatchId: reviewId, batchId: 'smr-0001', itemId: 'item-1', episodeId: 'ep-1', taskId: a.taskInstanceId, taskRevision: 1, decision: 'agent_failure', rationale: 'x', decidedById: randomUUID() } })).rejects.toThrow();
    for (const t of ['RlGymReviewBatch', 'RlGymReviewDecision', 'RlGymDecisionDelivery']) await expect(db.$executeRawUnsafe(`DELETE FROM "${t}"`)).rejects.toThrow();
    expect(await db.auditEvent.count({ where: { entityId: pid, action: 'project.benchmark_review_decided' } })).toBe(2);
  });

  it('"task needs correction" is a normal Rework; the corrected revision returns in the re-export with corrects_revision and sme_batch_id', async () => {
    const { a, b } = await exported();
    await sendBatch(batch([a, b]));
    const reviewId = (await get(pm, `/projects/${pid}/benchmark-reviews`)).json().items[0].id;
    const d = await decide(pm, reviewId, { itemId: 'item-1', decision: 'task_correction', rationale: 'The case should say the TIN is pending.' });
    expect(d.statusCode, d.body).toBe(201);
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: a.taskInstanceId } });
    expect(task).toMatchObject({ status: 'REWORK', reviewNotes: 'Benchmark review: The case should say the TIN is pending.' });
    expect(await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: a.taskInstanceId, decision: 'REWORK' } })).toMatchObject({ notes: 'Benchmark review: The case should say the TIN is pending.' });
    // The approved record is kept (append-only); the task is not exported until approved again.
    expect(await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: a.id } })).toEqual(a);
    expect((await get(pm, `/projects/${pid}/export`)).json().tasks.map((t: { recordId: string }) => t.recordId)).toEqual([b.id]);

    // The author fixes it (same workbench); a person approves it again; Re-export carries the correction.
    const corrected = structuredClone(boundOutput('individual')) as Record<string, any>;
    corrected.sections.S8.reviewerNotes = `${String(corrected.sections.S8.reviewerNotes ?? '')} TIN pending stated.`.trim();
    await approve('individual', corrected);
    const re = await exportNow();
    expect(re.statusCode, re.body).toBe(201);
    const t = (rlgym.sent.at(-1)!.body.tasks as Record<string, any>[]).find((x) => x.task_id === a.taskInstanceId)!;
    expect(t).toMatchObject({ revision: 2, corrects_revision: 1, sme_batch_id: 'smr-0001' });
  });
});
