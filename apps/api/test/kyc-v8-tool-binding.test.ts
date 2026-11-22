import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { buildGenericPackages } from '../src/anvil/generic-package';
import { jcs } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { declaredToolIds, TOOL_UNDECLARED, undeclaredTools } from '../src/anvil/tool-binding';
import { readZip, writeZip } from '../src/anvil/zip';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { actorPrivateFields, CHANGE_RECORD_SCHEMA, conformanceProblems, offlineExport, packageProblems } from '../src/jobs/authored-export';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { applyBindings, KYC_V8_TOOL_BINDING, kycV8ToolBinding, parseToolBindingArgs, type ToolBindingSpec } from '../src/jobs/kyc-v8-tool-binding';
import { MemoryEmailSender } from '../src/lib/email';
import { exportPackageChecks } from '../src/tasks/revalidation';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { fakeRlGym, qualifyForRlGym, RLGYM_CONFIG } from './rlgym-helpers';

/**
 * KYC v8 tool-binding correction (RL Gym's request and the owner's APR-13a-d, 20 Nov 2026): the job that submits
 * successor revisions of the 3 affected approved v8 tasks (only the listed S5 step tools change), the console approval
 * by a person, the recurrence check at approval and in both exports, and the offline export's change records and
 * conformance checks. The approved v8 tasks are rebuilt from the embedded v8 successor candidates (their original tools,
 * as approved before the check existed). Mocks only; nothing calls RL Gym.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';

type Sections = Record<string, Record<string, unknown>>;
const stepsOf = (output: unknown) => ((output as { sections: Sections }).sections.S5!.steps as { action: string; tool: string; failureBehaviour: string }[]);

describe('KYC v8 tool-binding correction', () => {
  let app: FastifyInstance;
  const rlgym = fakeRlGym();
    const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);

  beforeAll(async () => {
    app = await buildApp({
      rlgymFetch: rlgym.fetch, config: testConfig({ ...RLGYM_CONFIG, ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage,
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
    });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, ADMIN_EMAIL, 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym QA', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const anvil = (body: object) => app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });

  /** A published v8 (the embedded spec on this test's v7 lineage). */
  async function publishedV8(): Promise<Template> {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await anvil(structuredClone(V7));
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

  /**
   * The QA state RL Gym exported: a v8 project (SME -> PM/Admin) whose four tasks were approved with the candidates'
   * original S5 tools (before the APR-13d check). Returns the binding spec re-pointed at this test's IDs.
   */
  async function approvedV8() {
    const v8 = await publishedV8();
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: `KYC v8 ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const projectId = created.json().id as string;
    const submitted = await post(pm, `/projects/${projectId}/submit`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    const reviewer = await createUser(clientId, ['ADMIN']);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const byType = new Map<string, { taskId: string; record: ApprovedTaskRecord }>();
    for (const { candidate } of EMBEDDED.successors.values()) {
      const value = candidate.output.sections.S1!.applicationType as string;
      const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === value)!;
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${value}@sme.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: candidate.output as unknown as Prisma.InputJsonValue, checks: { results: [], keyInputs: [], similar: [], embeddingModel: null, options: { rubricChecks: false, suggestionChecks: false } } } });
      await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: candidate.output as unknown as Prisma.InputJsonValue, checks: {} } });
      if (task.slotId) await db.coverageSlot.update({ where: { id: task.slotId }, data: { status: 'FILLED', assignedToId: cand.id } });
      const record = await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
      byType.set(value, { taskId: task.id, record });
    }
    const spec: ToolBindingSpec = {
      ...structuredClone(KYC_V8_TOOL_BINDING),
      projectId,
      templateVersionId: v8.id,
      templateSha256: jointHashes(jointTemplateSpec(v8)!).template_sha256,
    };
    spec.tasks = spec.tasks.map((t) => ({ ...t, taskId: byType.get(t.applicationType)!.taskId, predecessorRecordId: byType.get(t.applicationType)!.record.id }));
    spec.unchanged = spec.unchanged.map((u) => ({ ...u, taskId: byType.get(u.applicationType)!.taskId, recordId: byType.get(u.applicationType)!.record.id }));
    return { v8, projectId, spec, byType };
  }

  const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  const snapshot = async (projectId: string) => ({
    records: ser(await db.approvedTaskRecord.findMany({ where: { projectId }, orderBy: { seq: 'asc' } })),
    tasks: ser(await db.taskInstance.findMany({ where: { projectId }, orderBy: { id: 'asc' } })),
    submissions: await db.taskSubmission.count({ where: { taskInstance: { projectId } } }),
    audits: await db.auditEvent.count({ where: { action: 'task.tool_binding_revision_submitted' } }),
  });

  async function approveInConsole(projectId: string, taskId: string) {
    const view = (await call(app, 'GET', admin, `/projects/${projectId}/forge-tasks/${taskId}`)).json();
    return post(admin, `/projects/${projectId}/tasks/${taskId}/decision`, { decision: 'APPROVE', expectedVersion: view.expectedVersion, expectedRevision: view.expectedRevision, checklist: Object.fromEntries((view.checklist as { key: string }[]).map((c) => [c.key, true])) });
  }

  it('embedded decisions: 7 rebindings and 2 blanks (CG-01), every new tool declared by v8, pointers are S5 step tools', () => {
    const declared = declaredToolIds(EMBEDDED.spec.execution)!;
    const changes = KYC_V8_TOOL_BINDING.tasks.flatMap((t) => t.changes);
    expect(changes.length).toBe(9);
    expect(changes.filter((c) => c.new !== '').every((c) => declared.includes(c.new) && c.approval === 'APR-13a')).toBe(true);
    expect(changes.filter((c) => c.new === '').map((c) => [c.approval, c.capabilityGap])).toEqual([['APR-13b', 'CG-01'], ['APR-13b', 'CG-01']]);
    expect(changes.every((c) => /^\/authored\/sections\/S5\/steps\/\d+\/tool$/.test(c.pointer))).toBe(true);
    expect(KYC_V8_TOOL_BINDING.templateSha256).toBe('8449adb008b6ecea7858b594dd5765f60b9b9596b57568d25f5e0598a334f7d5');
    // The old values are exactly what the embedded candidates (the content approved in QA) carry.
    for (const t of KYC_V8_TOOL_BINDING.tasks) {
      const c = [...EMBEDDED.successors.values()].find((s) => s.candidate.output.sections.S1!.applicationType === t.applicationType)!;
      for (const ch of t.changes) expect(stepsOf(c.candidate.output)[Number(ch.pointer.split('/')[5])]!.tool).toBe(ch.old);
    }
    const adult = [...EMBEDDED.successors.values()].find((s) => s.candidate.output.sections.S1!.applicationType === 'adult_joint')!;
    expect(undeclaredTools(EMBEDDED.spec.execution, adult.candidate.output.sections)).toEqual([]);
  });

  it('dry run prints the plan and writes nothing; apply submits 3 revisions for review; originals untouched; re-run is a no-op', async () => {
    const h = await approvedV8();
    const before = await snapshot(h.projectId);

    const dry = await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: false, spec: h.spec });
    expect(dry.outcome, JSON.stringify(dry)).toBe('ok');
    expect(dry.tasks.map((t) => [t.title, t.outcome, t.changes.length])).toEqual([['Individual', 'would_submit', 5], ['Teen joint', 'would_submit', 2], ['Custodial', 'would_submit', 2]]);
    expect(dry.tasks[1]!.changes[1]).toEqual({ pointer: '/authored/sections/S5/steps/2/tool', old: 'document.verify', new: '', approval: 'APR-13b', capabilityGap: 'CG-01' });
    for (const t of dry.tasks) {
      expect(t.successor!.outputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(t.successor!.outputSha256).not.toBe(t.predecessor!.outputSha256);
      expect(t.successor!.referenceSha256).not.toBe(t.predecessor!.referenceSha256);
      expect(t.predecessorContentHash).toBe((await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: t.predecessorRecordId } })).contentHash);
    }
    expect(dry.unchanged).toEqual([expect.objectContaining({ title: 'Adult joint', toolCheck: 'pass' })]);
    expect(dry).toMatchObject({ approvals: ['APR-13a', 'APR-13b', 'APR-13c'], capabilityGaps: ['CG-01'] });
    expect(await snapshot(h.projectId)).toEqual(before);

    const r = await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec });
    expect(r.outcome, JSON.stringify(r)).toBe('ok');
    expect(r.tasks.map((t) => t.outcome)).toEqual(['submitted', 'submitted', 'submitted']);
    expect(r.tasks.map((t) => t.successor!.outputSha256)).toEqual(dry.tasks.map((t) => t.successor!.outputSha256));
    // The approved records are never modified and none is added.
    const after = await snapshot(h.projectId);
    expect(after.records).toBe(before.records);
    expect(after.submissions).toBe(before.submissions + 3);
    expect(after.audits).toBe(3);

    for (const bt of h.spec.tasks) {
      const rec = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: bt.predecessorRecordId } });
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: bt.taskId }, include: { submissions: { orderBy: { version: 'asc' } } } });
      expect(task.status).toBe('SUBMITTED');
      expect(task.submissions.at(-1)!.version).toBe(2);
      expect(jcs(task.submissions.at(-1)!.output)).toBe(jcs(task.output));
      // Only the listed pointers changed: putting the old values back gives the approved bytes exactly.
      for (const ch of bt.changes) expect(stepsOf(task.output)[Number(ch.pointer.split('/')[5])]!.tool).toBe(ch.new);
      const back = applyBindings(task.output, bt.changes.map((c) => ({ ...c, old: c.new, new: c.old })));
      expect('output' in back && jcs(back.output)).toBe(jcs(rec.output));
      const out = task.output as { header: unknown; profile: unknown; sections: Sections };
      const prev = rec.output as { header: unknown; profile: unknown; sections: Sections };
      expect(jcs(out.header)).toBe(jcs(prev.header));
      expect(jcs(out.profile)).toBe(jcs(prev.profile));
      for (const k of Object.keys(prev.sections).filter((x) => x !== 'S5')) expect(jcs(out.sections[k]), k).toBe(jcs(prev.sections[k]));
      expect(stepsOf(task.output).map((s) => [s.action, s.failureBehaviour])).toEqual(stepsOf(rec.output).map((s) => [s.action, s.failureBehaviour]));
      // Lineage in the revision input; the earlier input is kept.
      const input = task.input as Record<string, any>;
      expect(jcs({ ...input, toolBindingCorrection: undefined })).toBe(jcs({ ...(rec.input as object), toolBindingCorrection: undefined }));
      const l = input.toolBindingCorrection;
      expect(l.schema).toBe('adi-forge.tool-binding-correction.v1');
      expect(l.predecessor).toMatchObject({ recordId: rec.id, taskId: rec.taskInstanceId, contentHash: rec.contentHash });
      expect(l.changes.map((c: { pointer: string; old: string; new: string }) => [c.pointer, c.old, c.new])).toEqual(bt.changes.map((c) => [c.pointer, c.old, c.new]));
      expect(l.changes.every((c: { justification: string }) => c.justification.length > 20)).toBe(true);
      expect(l.approvals).toEqual([
        { id: 'APR-13a', what: expect.any(String), decision: 'Approved', approvedAt: '2026-11-20', status: 'approved' },
        { id: 'APR-13b', what: expect.any(String), decision: 'Approved', approvedAt: '2026-11-20', status: 'approved' },
        { id: 'APR-13c', what: expect.any(String), decision: 'Approved', approvedAt: '2026-11-20', status: 'approved' },
      ]);
      expect(l.capabilityGaps.map((g: { id: string }) => g.id)).toEqual(bt.changes.some((c) => c.capabilityGap) ? ['CG-01'] : []);
      const ev = await db.auditEvent.findFirstOrThrow({ where: { entityId: task.id, action: 'task.tool_binding_revision_submitted' } });
      expect(ev).toMatchObject({ actorType: 'SYSTEM', actorId: 'kyc-v8-tool-binding' });
      expect(ev.after).toMatchObject({ status: 'SUBMITTED', recordKept: true, approvals: ['APR-13a', 'APR-13b', 'APR-13c'] });
    }
    // The adult-joint task is unchanged.
    const adult = h.byType.get('adult_joint')!;
    expect(JSON.stringify(await db.taskInstance.findUniqueOrThrow({ where: { id: adult.taskId } }))).toBe(JSON.stringify(JSON.parse(before.tasks).find((t: { id: string }) => t.id === adult.taskId)));

    // Idempotent.
    const mid = await snapshot(h.projectId);
    const again = await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec });
    expect(again.outcome).toBe('ok');
    expect(again.tasks.map((t) => [t.outcome, t.successorRecordId])).toEqual([['already_submitted', null], ['already_submitted', null], ['already_submitted', null]]);
    expect(await snapshot(h.projectId)).toEqual(mid);
  });

  it('a person approves each revision in the console: new records on the chain; the offline export validates and carries change records', async () => {
    const h = await approvedV8();
    // Before the correction both exports refuse the undeclared tools.
    const blocked = await offlineExport(db, { projectId: h.projectId, apply: true, write: async () => { throw new Error('nothing may be written'); } });
    expect(blocked.outcome).toBe('refused');
    expect(blocked.reason).toMatch(/GENERIC_TOOL_UNDECLARED/);
    expect(blocked.problems.filter((p) => p.code === TOOL_UNDECLARED).length).toBe(3);

    expect((await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec })).outcome).toBe('ok');
    const adminUser = await db.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    for (const bt of h.spec.tasks) {
      const res = await approveInConsole(h.projectId, bt.taskId);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status, res.body).toBe('ACCEPTED');
    }
    const records = await db.approvedTaskRecord.findMany({ where: { projectId: h.projectId }, orderBy: { seq: 'asc' } });
    expect(records.length).toBe(7);
    const successors = new Map<string, ApprovedTaskRecord>();
    for (const bt of h.spec.tasks) {
      const s = records.filter((r) => r.taskInstanceId === bt.taskId).at(-1)!;
      expect(s.id).not.toBe(bt.predecessorRecordId);
      expect(s.reviewerId).toBe(adminUser.id);
      expect((s.input as { toolBindingCorrection: { predecessor: { recordId: string } } }).toolBindingCorrection.predecessor.recordId).toBe(bt.predecessorRecordId);
      successors.set(bt.taskId, s);
    }
    // The job now reports each approval.
    const re = await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: false, spec: h.spec });
    expect(re.tasks.map((t) => t.successorRecordId)).toEqual(h.spec.tasks.map((t) => successors.get(t.taskId)!.id));

    const written = new Map<string, Buffer>();
    const ex = await offlineExport(db, { projectId: h.projectId, apply: true, write: async (f, b) => (written.set(f, b), `mem:${f}`) });
    expect(ex.outcome, JSON.stringify(ex)).toBe('written');
    expect(ex.parts.length).toBe(1);
    const zip = written.get(`${ex.parts[0]!.packageId}.zip`)!;
    expect(packageProblems(zip)).toEqual([]);
    expect(conformanceProblems(zip, () => h.v8 && jointTemplateSpec(h.v8)!.execution)).toEqual([]);
    const files = readZip(zip);
    const manifest = JSON.parse(files.get('praxis-export.json')!.toString('utf8'));
    expect(manifest.tasks.map((t: { revision_id: string }) => t.revision_id).sort()).toEqual([...successors.values()].map((r) => r.id).concat(h.byType.get('adult_joint')!.record.id).sort());
    for (const t of manifest.tasks) expect(undeclaredTools(jointTemplateSpec(h.v8)!.execution, JSON.parse(files.get(t.private_assets[0].path)!.toString('utf8')).authored.sections)).toEqual([]);

    // The change record: one entry per corrected task.
    expect(ex.changeRecords.length).toBe(1);
    const cr = JSON.parse(written.get(`${ex.parts[0]!.packageId}.change-record.json`)!.toString('utf8'));
    expect(cr).toMatchObject({ schema: CHANGE_RECORD_SCHEMA, package_id: ex.parts[0]!.packageId, zip_sha256: ex.parts[0]!.zipSha256, package_sha256: ex.parts[0]!.packageSha256, request: { errorCode: 'PX_TOOL_CALL_MISSING' } });
    expect(cr.tasks.length).toBe(3);
    for (const bt of h.spec.tasks) {
      const c = cr.tasks.find((x: { task_id: string }) => x.task_id === bt.taskId);
      const pred = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: bt.predecessorRecordId } });
      const entry = manifest.tasks.find((t: { task_id: string }) => t.task_id === bt.taskId);
      expect(c.predecessor).toMatchObject({ record_id: pred.id, content_hash: pred.contentHash, actor_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), reference_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(c.successor).toEqual({ record_id: successors.get(bt.taskId)!.id, content_hash: successors.get(bt.taskId)!.contentHash, actor_sha256: entry.actor.sha256, reference_sha256: entry.private_assets[0].sha256, receipt_ref: entry.review.receipt_ref });
      expect(c.predecessor.reference_sha256).not.toBe(c.successor.reference_sha256);
      expect(c.changes.map((x: { pointer: string; old: string; new: string; approval: string; justification: string }) => [x.pointer, x.old, x.new, x.approval, !!x.justification])).toEqual(bt.changes.map((x) => [x.pointer, x.old, x.new, x.approval, true]));
      expect(c.approvals.map((a: { id: string }) => a.id)).toEqual(['APR-13a', 'APR-13b', 'APR-13c']);
      expect(c.capability_gaps.map((g: { id: string }) => g.id)).toEqual(bt.changes.some((x) => x.capabilityGap) ? ['CG-01'] : []);
    }
    expect(ex.changeRecords[0]!.taskIds.sort()).toEqual(h.spec.tasks.map((t) => t.taskId).sort());
  });

  it('refuses with a clear reason and writes nothing when a precondition differs', async () => {
    const h = await approvedV8();
    const before = await snapshot(h.projectId);
    const run = (spec: ToolBindingSpec, requestedBy = ADMIN_EMAIL) => kycV8ToolBinding(db, { requestedBy, apply: true, spec });

    // An expected old value differs from the approved content.
    const oldDiffers = structuredClone(h.spec);
    oldDiffers.tasks[2]!.changes[0]!.old = 'address.verify';
    const r1 = await run(oldDiffers);
    expect(r1.outcome).toBe('refused');
    expect(r1.tasks[2]!.reason).toMatch(/is "address_verification\.check", not the expected old value "address\.verify"/);
    expect(r1.tasks.slice(0, 2).map((t) => t.outcome)).toEqual(['would_submit', 'would_submit']);

    // A new tool the template does not declare.
    const undeclared = structuredClone(h.spec);
    undeclared.tasks[0]!.changes[0]!.new = 'application.fetch';
    expect((await run(undeclared)).reason).toMatch(/"application\.fetch" is not one of the template's execution\.tools IDs/);

    // A pointer outside S5 step tools.
    const elsewhere = structuredClone(h.spec);
    elsewhere.tasks[0]!.changes[0]!.pointer = '/authored/sections/S5/steps/0/action';
    expect((await run(elsewhere)).tasks[0]!.reason).toMatch(/only S5\.steps\[i\]\.tool may change/);

    // Not an active Admin.
    const pmUser = await createUser(clientId, ['PM']);
    expect((await run(h.spec, pmUser.email)).reason).toMatch(/active Admin/);

    // The template version changed (another hash).
    expect((await run({ ...h.spec, templateSha256: '0'.repeat(64) })).reason).toMatch(/must be unchanged/);

    // A missing approval.
    expect((await run({ ...h.spec, approvals: h.spec.approvals.filter((a) => a.id !== 'APR-13b') })).reason).toMatch(/APR-13b/);

    expect(await snapshot(h.projectId)).toEqual(before);

    // The predecessor is not the latest approved revision.
    const indiv = h.spec.tasks[0]!;
    await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: indiv.taskId, reviewerId: (h.byType.get('individual')!.record).reviewerId, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
    const r2 = await run(h.spec);
    expect(r2.outcome).toBe('refused');
    expect(r2.tasks[0]!.reason).toMatch(/not the latest approved revision/);
    expect(await db.taskInstance.count({ where: { projectId: h.projectId, status: 'SUBMITTED' } })).toBe(0);
  });

  it('APR-13d at approval: an undeclared S5 tool blocks the console approval (Rework, S5); a blank tool is allowed', async () => {
    const h = await approvedV8();
    const custodial = h.spec.tasks[2]!;
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: custodial.taskId } });
    // Back as submitted work with its original (undeclared) tools, as an author might submit it.
    await db.taskInstance.update({ where: { id: task.id }, data: { status: 'SUBMITTED', revision: { increment: 1 } } });
    await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 2, output: task.output as Prisma.InputJsonValue, checks: {} } });
    const res = await approveInConsole(h.projectId, task.id);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error).toBe('APPROVAL_BLOCKED');
    const checks = res.json().details.checks as { id: string; section: string; message: string }[];
    expect(checks).toEqual([expect.objectContaining({ id: `export.${TOOL_UNDECLARED}`, section: 'S5', message: expect.stringMatching(/step 2 "address_verification\.check", step 3 "tin_verification\.check".*or leave the tool blank/) })]);
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('REWORK');

    // The same task with the APR-13 bindings (one blank) passes the approval checks.
    const fixed = applyBindings(task.output, custodial.changes);
    expect('output' in fixed && exportPackageChecks(h.v8, task, fixed.output)).toEqual([]);
    expect(exportPackageChecks(h.v8, task, task.output).map((c) => c.id)).toEqual([`export.${TOOL_UNDECLARED}`]);
  });

  it('APR-13d in the live RL Gym export: the export is blocked and the 3 tasks go to Rework; the job still corrects them from Rework', async () => {
    const h = await approvedV8();
    await qualifyForRlGym(h.v8.id);
    const res = await post(admin, `/projects/${h.projectId}/exports`, {});
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error).toBe('EXPORT_BLOCKED_REWORK');
    expect(rlgym.sent).toHaveLength(0);
    expect((res.json().details.problems as string[]).join('\n')).toMatch(/S5: RL Gym export: S5 procedure steps name tools this template does not declare/);
    const statuses = await Promise.all(h.spec.tasks.map(async (t) => (await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskId } })).status));
    expect(statuses).toEqual(['REWORK', 'REWORK', 'REWORK']);
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: h.byType.get('adult_joint')!.taskId } })).status).toBe('ACCEPTED');
    // The package builder the live export uses leaves them out with the same code.
    const v8 = h.v8;
    const records = await db.approvedTaskRecord.findMany({ where: { projectId: h.projectId } });
    const built = buildGenericPackages(records.map((record) => ({ record, template: v8 })), { projectId: h.projectId });
    expect(built.problems.map((p) => p.code)).toEqual([TOOL_UNDECLARED, TOOL_UNDECLARED, TOOL_UNDECLARED]);
    expect(built.parts[0]!.taskIds).toEqual([h.byType.get('adult_joint')!.taskId]);

    const r = await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec });
    expect(r.outcome, JSON.stringify(r)).toBe('ok');
    expect(r.tasks.map((t) => t.outcome)).toEqual(['submitted', 'submitted', 'submitted']);
  });

  // ── Units ──

  it('undeclaredTools: generic over execution.tools; blank allowed; exact IDs only; no tools list, no check', () => {
    const execution = { tools: [{ id: 'a.read' }, { id: 'b.check' }] };
    const sections = (tools: unknown[]) => ({ S5: { steps: tools.map((tool) => ({ action: 'x', tool })) } });
    expect(undeclaredTools(execution, sections(['a.read', '', '   ', null, undefined, 'b.check']))).toEqual([]);
    expect(undeclaredTools(execution, sections(['A.read', ' a.read', 'c.write', 3]))).toEqual([
      { step: 0, pointer: '/sections/S5/steps/0/tool', value: 'A.read' },
      { step: 1, pointer: '/sections/S5/steps/1/tool', value: ' a.read' },
      { step: 2, pointer: '/sections/S5/steps/2/tool', value: 'c.write' },
      { step: 3, pointer: '/sections/S5/steps/3/tool', value: 3 },
    ]);
    expect(undeclaredTools({ rules: [] }, sections(['anything']))).toEqual([]);
    expect(undeclaredTools(execution, {})).toEqual([]);
    expect(declaredToolIds({ tools: [] })).toEqual([]);
  });

  it('applyBindings changes only the listed values; conformance catches a private field in actor.json', () => {
    const out = { header: { title: 'T' }, sections: { S5: { steps: [{ action: 'a', tool: 'x', failureBehaviour: 'f' }, { action: 'b', tool: 'y' }] }, S6: { n: 1 } } };
    const r = applyBindings(out, [{ pointer: '/authored/sections/S5/steps/1/tool', old: 'y', new: 'b.check', justification: 'j', approval: 'A' }]);
    expect('output' in r && r.output).toEqual({ ...out, sections: { ...out.sections, S5: { steps: [out.sections.S5.steps[0], { action: 'b', tool: 'b.check' }] } } });
    expect(out.sections.S5.steps[1]!.tool).toBe('y');
    expect(applyBindings(out, [{ pointer: '/authored/sections/S5/steps/9/tool', old: 'y', new: '', justification: 'j', approval: 'A' }])).toEqual({ problems: [expect.stringMatching(/does not exist/)] });

    const form = { profileId: 'f', version: 1, sections: [{ key: 'S1', fields: [{ key: 'title', type: 'text' }, { key: 'secret', type: 'text', visibility: 'private_reference' }, { key: 'list', type: 'repeated_array', itemFields: [{ key: 'pub', type: 'text' }, { key: 'why', type: 'text', visibility: 'private_rubric' }] }] }] };
    expect(actorPrivateFields(form, { sections: { S1: { title: 'x', list: [{ pub: 'p' }] } } })).toEqual([]);
    expect(actorPrivateFields(form, { sections: { S1: { secret: 's', list: [{ pub: 'p', why: 'w' }], extra: 1 }, S9: {} } })).toEqual(['/sections/S1/secret is a private field', '/sections/S1/list/0/why is a private field', '/sections/S1/extra is not a field of the form', '/sections/S9 is not a section of the form']);

    // A package whose actor.json leaks a private field, and whose reference names an undeclared tool.
    const jsonb = (v: unknown) => Buffer.from(jcs(v), 'utf8');
    const authored = { profile: { id: 'f', version: 1 }, sections: { S1: { title: 'x', secret: 's' }, S5: { steps: [{ tool: 'nope' }] } } };
    const manifest = { tasks: [{ task_id: 't1', template: { id: 'tpl', version: 1 }, form: { path: 'forms/f.json' }, actor: { path: 'tasks/t1/actor.json' }, private_assets: [{ path: 'private/t1/reference.json' }] }] };
    const zip = writeZip([
      { path: 'praxis-export.json', bytes: jsonb(manifest) },
      { path: 'forms/f.json', bytes: jsonb(form) },
      { path: 'tasks/t1/actor.json', bytes: jsonb({ profile: { id: 'f', version: 1 }, title: 'x', sections: { S1: { title: 'x', secret: 's' } } }) },
      { path: 'private/t1/reference.json', bytes: jsonb({ authored }) },
    ]);
    const problems = conformanceProblems(zip, () => ({ tools: [{ id: 'ok' }] })).join('\n');
    expect(problems).toMatch(/GENERIC_TOOL_UNDECLARED \/authored\/sections\/S5\/steps\/0\/tool "nope"/);
    expect(problems).toMatch(/actor\.json \/sections\/S1\/secret is a private field/);
    expect(problems).toMatch(/actor\.json is not the public projection/);
  });

  it('command line: --requested-by is required; --apply optional; unknown arguments refused', () => {
    expect(parseToolBindingArgs(['--requested-by', 'a@b.test'])).toEqual({ requestedBy: 'a@b.test', apply: false });
    expect(parseToolBindingArgs(['--requested-by', 'a@b.test', '--apply'])).toEqual({ requestedBy: 'a@b.test', apply: true });
    expect(() => parseToolBindingArgs([])).toThrow(/requested-by/);
    expect(() => parseToolBindingArgs(['--requested-by'])).toThrow(/needs a value/);
    expect(() => parseToolBindingArgs(['--requested-by', 'a@b.test', '--force'])).toThrow(/Unknown argument/);
  });
});
