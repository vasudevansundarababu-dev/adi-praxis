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
 * New RL Gym part 2 (docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.2 a): the PM exports the approved tasks
 * so far as one `rlgym.project-export.v1`, re-exports after more approvals or a correction, and sees the RL Gym's
 * receipt. The RL Gym is a recorded fake (mocks only); its package fetch goes through ADI Forge's real route.
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

describe('project export to the new RL Gym', () => {
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

  it('first export: the approved tasks so far, the exact RL Gym contract, packages fetchable by hash, receipt kept', async () => {
    const v8 = await v8Project();
    expect((await get(pm, `/projects/${pid}/export`)).json()).toMatchObject({ canExport: false, connected: true, reason: 'RL Gym hasn’t qualified this template version yet.', rlgymTemplate: null });
    await qualifyForRlGym(v8.id, REF);
    expect((await get(pm, `/projects/${pid}/export`)).json()).toMatchObject({ canExport: false, reason: 'Export needs at least one approved task.' });

    const a = await approve('individual');
    const b = await approve('adult_joint');
    const before = (await get(pm, `/projects/${pid}/export`)).json();
    expect(before).toMatchObject({ canExport: true, reason: null, exported: false, rlgymTemplate: { id: REF.id, version: REF.version, specSha256: REF.spec } });
    expect(before.tasks.map((t: { recordId: string; inRlGym: boolean }) => [t.recordId, t.inRlGym]).sort()).toEqual([[a.id, false], [b.id, false]].sort());

    const res = await exportNow();
    expect(res.statusCode, res.body).toBe(201);
    const run = res.json();
    expect(run).toMatchObject({ outcome: 'received', httpStatus: 201, requestId: 'req-1', reason: 'first export of KYC November', notSent: [], receipt: { new: 2, superseding: 0, unchanged: 0, blocked: [], replayed: false } });

    // Exactly the RL Gym's contract, sent once with its key and the export hash as Idempotency-Key.
    expect(rlgym.sent).toHaveLength(1);
    const [sent] = rlgym.sent;
    expect(sent!.url).toBe(`http://127.0.0.1:8200/api/v1/workspaces/adi-labs-research/projects/${pid}/exports`);
    expect(sent!.headers).toMatchObject({ Authorization: 'Bearer test-rlgym-forge-key', 'Idempotency-Key': sent!.body.export_sha256 });
    const { export_sha256, ...rest } = sent!.body;
    expect(rlGymSha(rest)).toBe(export_sha256);
    expect(run.exportSha256).toBe(export_sha256);
    expect(sent!.body).toMatchObject({ schema: 'rlgym.project-export.v1', project_id: pid, project_name: 'KYC November', template: { id: REF.id, version: REF.version, spec_sha256: REF.spec, forge_template_id: v8.lineageId, forge_version: v8.version }, project_config: { mode: 'single_agent' }, export_id: run.exportId });
    expect(sent!.body.tasks).toHaveLength(2);
    for (const t of sent!.body.tasks as Record<string, any>[]) {
      const record = [a, b].find((r) => r.taskInstanceId === t.task_id)!;
      const slotValue = (record.input as { slot: { case: { value: string } } }).slot.case.value;
      expect(t).toMatchObject({ schema: 'praxis.authored-task-export.v1', revision: 1, package_ref: `forge://packages/${t.package_sha256}`, case_selector: { application_type: slotValue, edge_cases: [] } });
      expect(t).not.toHaveProperty('corrects_revision');
      expect(t).not.toHaveProperty('package');
      // The RL Gym fetches the package from ADI Forge by hash: committed before the call, bytes match the hash.
      const pkg = await app.inject({ method: 'GET', url: `/api/v1/packages/${t.package_sha256}`, headers: { authorization: `Bearer ${anvilKey}` } });
      expect(pkg.statusCode).toBe(200);
      expect(createHash('sha256').update(pkg.rawPayload).digest('hex')).toBe(t.package_sha256);
    }

    const after = (await get(pm, `/projects/${pid}/export`)).json();
    expect(after).toMatchObject({ exported: true, runs: [{ id: run.id, outcome: 'received' }] });
    expect(after.tasks.every((t: { inRlGym: boolean }) => t.inRlGym)).toBe(true);
    expect(await db.auditEvent.count({ where: { entityId: pid, action: 'project.exported_to_rlgym' } })).toBe(1);
  });

  it('re-export: more approvals and a correction (revision 2, corrects revision 1); a repeat key replays without calling RL Gym', async () => {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    const first = await approve('individual');
    expect((await exportNow()).statusCode).toBe(201);
    await approve('adult_joint');
    // The SME corrects the individual task after review; a person approves it again.
    const corrected = structuredClone(boundOutput('individual')) as Record<string, any>;
    corrected.sections.S8.reviewerNotes = `${String(corrected.sections.S8.reviewerNotes ?? '')} Corrected after benchmark review.`.trim();
    const second = await approve('individual', corrected);
    expect(second.taskInstanceId).toBe(first.taskInstanceId);

    rlgym.state.answer = (body) => ({ project_id: body.project_id, export_id: body.export_id, new: 1, superseding: 1, unchanged: 0, blocked: [], receipt_sha256: 'e'.repeat(64) });
    const key = randomUUID();
    const res = await exportNow(key);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ reason: 're-export of KYC November', receipt: { new: 1, superseding: 1 } });
    const body = rlgym.sent.at(-1)!.body;
    const individual = (body.tasks as Record<string, any>[]).find((t) => t.task_id === first.taskInstanceId)!;
    expect(individual).toMatchObject({ revision: 2, corrects_revision: 1 });
    expect((body.tasks as unknown[]).length).toBe(2);
    expect(res.json().tasks.find((t: { taskId: string }) => t.taskId === first.taskInstanceId)).toMatchObject({ recordId: second.id, revision: 2, correctsRevision: 1 });

    // The same request again (same Idempotency-Key): the stored answer, no second call to the RL Gym.
    const calls = rlgym.sent.length;
    const again = await exportNow(key);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(res.json().id);
    expect(rlgym.sent.length).toBe(calls);
  });

  it('when the RL Gym refuses or does not answer, the run is kept with what happened and no task shows as in RL Gym', async () => {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    await approve('individual');
    rlgym.state.mode = 'error';
    const refused = await exportNow();
    expect(refused.statusCode, refused.body).toBe(201);
    expect(refused.json()).toMatchObject({ outcome: 'rejected', httpStatus: 422, requestId: 'req-err', receipt: null, error: { code: 'TEMPLATE_NOT_ACTIVE' } });
    rlgym.state.mode = 'down';
    const down = await exportNow();
    expect(down.json()).toMatchObject({ outcome: 'unavailable', httpStatus: null, error: { code: 'NETWORK' } });
    const st = (await get(pm, `/projects/${pid}/export`)).json();
    expect(st).toMatchObject({ exported: false, canExport: true });
    expect(st.tasks.every((t: { inRlGym: boolean }) => !t.inRlGym)).toBe(true);
    expect(st.runs.map((r: { outcome: string }) => r.outcome)).toEqual(['unavailable', 'rejected']);
    // Nothing reached the RL Gym twice with different content under one export ID.
    const ids = new Map<string, string>();
    for (const s of rlgym.sent) {
      if (ids.has(s.body.export_id)) expect(s.body.export_sha256).toBe(ids.get(s.body.export_id));
      ids.set(s.body.export_id, s.body.export_sha256);
    }
    // A retry after a failure sends the same export (same ID and hash), so the RL Gym can recognise it.
    expect(new Set(rlgym.sent.map((s) => s.body.export_sha256)).size).toBe(1);
  });

  it('a task the RL Gym blocks is not shown as in RL Gym; export runs are append-only; only the owning PM or an Admin exports', async () => {
    const v8 = await v8Project();
    await qualifyForRlGym(v8.id, REF);
    const a = await approve('individual');
    rlgym.state.answer = (body) => ({ project_id: body.project_id, export_id: body.export_id, new: 1, superseding: 0, unchanged: 0, blocked: [{ task_id: a.taskInstanceId, reason: 'BINDING_UNRESOLVED', alias: 'kyc' }], receipt_sha256: 'b'.repeat(64) });
    const res = await exportNow();
    expect(res.json().receipt.blocked).toEqual([{ taskId: a.taskInstanceId, reason: 'BINDING_UNRESOLVED' }]);
    expect((await get(pm, `/projects/${pid}/export`)).json().tasks[0]).toMatchObject({ recordId: a.id, inRlGym: false });

    const row = await db.rlGymProjectExport.findFirstOrThrow({ where: { projectId: pid } });
    await expect(db.$executeRaw`UPDATE "RlGymProjectExport" SET "outcome" = 'received' WHERE "id" = ${row.id}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "RlGymProjectExport" WHERE "id" = ${row.id}::uuid`).rejects.toThrow();

    const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/exports`, headers: { cookie: otherPm, ...idem() }, payload: {} })).statusCode).toBe(404);
    const reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/exports`, headers: { cookie: reviewer, ...idem() }, payload: {} })).statusCode).toBe(403);
    // A body is not accepted: Export always sends the approved tasks as they stand.
    expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/exports`, headers: { cookie: pm, ...idem() }, payload: { recordIds: [a.id] } })).statusCode).toBe(400);
  });
});
