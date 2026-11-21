import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateRule } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jcs, jcsSha256 } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { readZip, writeZip } from '../src/anvil/zip';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage, stubScanner } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { archiveProblems, ARCHIVE_BOUNDS, offlineExport, packageProblems, safeArchivePath } from '../src/jobs/authored-export';
import { kycV8Readback } from '../src/jobs/kyc-v8-readback';
import { applyBindings, KYC_V8_TOOL_BINDING } from '../src/jobs/kyc-v8-tool-binding';
import { APR04_CLAUSES, loadKycV8Inputs, parseKycV8Args, projectNameFor, successorProject, successorS4, successorTasks, successorTemplate, type KycV8Inputs } from '../src/jobs/kyc-v8-successor';
import { MemoryEmailSender } from '../src/lib/email';
import { writeAudit } from '../src/platform/audit';
import { addDocumentVersion, loadVersionText } from '../src/policy/documents';
import { publishRuleSet } from '../src/policy/rule-sets';
import { createRuleFromCandidate, markReviewed } from '../src/policy/rules';
import { authoredContent } from '../src/tasks/profile-output';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC v8 successor (RL Gym's request, 18 Nov 2026): TS-24 (an identical form keeps its ID on a successor version), the
 * three-phase job (v8 DRAFT, mirrored project with the official text, successor task revisions), the console approval
 * by a person, the offline export in RL Gym's import format (TS-17) and the read-only readback. The v7 template is the
 * synthetic v7 proposal fixture; the v8 spec and successor content are the embedded inputs RL Gym reviewed. Mocks only.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const RAW = loadKycV8Inputs();
/**
 * APR-13d: approval now refuses S5 step tools the template does not declare. The embedded candidates carry the 9 tools
 * RL Gym refused (corrected for the real tasks by `kyc-v8-tool-binding`), so this fixture binds them as APR-13a/b did.
 */
const EMBEDDED: KycV8Inputs = {
  ...RAW,
  successors: new Map(
    [...RAW.successors].map(([id, s]) => {
      const t = KYC_V8_TOOL_BINDING.tasks.find((x) => x.applicationType === s.candidate.output.sections.S1!.applicationType);
      if (!t) return [id, s];
      const r = applyBindings({ sections: s.candidate.output.sections }, t.changes);
      if ('problems' in r) throw new Error(r.problems.join(' '));
      return [id, { ...s, candidate: { ...s.candidate, output: { ...s.candidate.output, sections: r.output.sections as typeof s.candidate.output.sections } } }];
    }),
  ),
};
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';
const BANK_POLICY = `Golden Bank KYC policy (synthetic test document)
1. Staff must obtain the customer's full legal name before opening any account.
2. Staff must obtain the customer's residential street address before opening any account.
3. Where a customer has applied for a TIN, staff must confirm the application was filed before the account opens.`;
const RULES: { key: string; quote: string }[] = [
  { key: 'R-COLLECT-CUSTOMER-NAME', quote: "Staff must obtain the customer's full legal name before opening any account." },
  { key: 'R-COLLECT-ADDRESS', quote: "Staff must obtain the customer's residential street address before opening any account." },
  { key: 'R-CONFIRM-PENDING-TIN-APPLICATION', quote: 'Where a customer has applied for a TIN, staff must confirm the application was filed before the account opens.' },
];
const rule = (r: { key: string; quote: string }): CandidateRule => ({
  ruleKey: r.key,
  title: r.key.replace(/^R-/, '').toLowerCase().replace(/-/g, ' '),
  requirement: r.quote,
  requirementType: 'obligation',
  visibility: 'agent_visible',
  applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
  prerequisites: [],
  precedence: [],
  exceptions: { kind: 'none', items: [] },
  effective: { from: null, to: null, conditionText: 'always' },
  evidenceNeeds: [],
  verificationHint: null,
  uncertainty: [],
  citations: [{ fieldPath: 'requirement', role: 'supports', quote: r.quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null }],
});

describe('KYC v8 successor', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  let clientId: string;
  let admin: string;
  let adminId: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
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
    const { client, admin: a } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    adminId = a.id;
    admin = await login(app, ADMIN_EMAIL, 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym QA', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const anvil = (path: 'validate' | 'proposals', body: object) => app.inject({ method: 'POST', url: `/api/v1/integrations/anvil/templates/${path}`, headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });
  const audit = (tx: Parameters<typeof writeAudit>[0]) => (a: Parameters<typeof writeAudit>[2]) => writeAudit(tx, { clientId, actorType: 'USER', actorId: adminId }, a);

  async function publishedV7() {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await anvil('proposals', structuredClone(V7));
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${id}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }

  /** The embedded v8 spec, re-pointed at this test's v7 (lineage, version and published hash). */
  function v8SpecFor(v7: Template): JointTemplateSpec {
    const s = structuredClone(EMBEDDED.spec);
    s.template_id = v7.lineageId;
    s.version = v7.version + 1;
    s.requirement.successor_of = { template_id: v7.lineageId, version: v7.version, template_sha256: jointHashes(jointTemplateSpec(v7)!).template_sha256 };
    return s;
  }

  /** The v7 project: four tasks, a published rule set over a bank policy document, four approved records by an Admin. */
  async function v7History(v7: Template) {
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v7.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v7.id, name: `KYC Project ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p7 = created.json().id as string;
    expect((await post(pm, `/projects/${p7}/submit`)).statusCode).toBe(200);

    const doc = await db.$transaction(async (tx) => {
      const base = { clientId, projectId: p7, actorId: adminId };
      const d = await addDocumentVersion(tx, { storage, scanner: stubScanner, maxPages: 20 }, { ...base, meta: { title: 'Golden Bank KYC policy', category: 'Bank policy', jurisdiction: 'US' }, fileName: 'bank-policy.md', buf: Buffer.from(BANK_POLICY, 'utf8'), origin: 'UPLOAD' }, audit(tx));
      const text = await loadVersionText(storage, d.version);
      for (const r of RULES) {
        const made = await createRuleFromCandidate(tx, { ...base, documentVersion: d.version, doc: { ...text, format: d.version.format }, candidate: rule(r), origin: 'manual', editedById: adminId, ruleKey: r.key });
        await markReviewed(tx, { ...base, ruleVersionId: made.version.id, expectedContentHash: made.version.contentHash }, audit(tx));
      }
      await publishRuleSet(tx, { ...base, expectedLatestVersion: null }, audit(tx));
      return d;
    });
    const s4 = { statePolicies: [{ ruleId: doc.document.id, ruleVersion: 'rs1.d1', locator: 'project rule set v1', contentSha256: doc.version.sha256, appliesTo: '', rationale: '', exception: '' }] };

    const reviewer = await createUser(clientId, ['ADMIN']);
    const tasks = await db.taskInstance.findMany({ where: { projectId: p7 } });
    const records: ApprovedTaskRecord[] = [];
    const successors: KycV8Inputs['successors'] = new Map();
    const idMap: KycV8Inputs['idMap'] = [];
    for (const { candidate, fileSha256 } of EMBEDDED.successors.values()) {
      const value = candidate.output.sections.S1!.applicationType as string;
      const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === value)!;
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${value}@sme.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      const output = { ...candidate.output, sections: { ...candidate.output.sections, S4: s4 } };
      await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: output as unknown as Prisma.InputJsonValue, checks: { results: [], keyInputs: [], similar: [], embeddingModel: null, options: { rubricChecks: false, suggestionChecks: false } } } });
      const rec = await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
      records.push(rec);
      successors.set(rec.id, { candidate: { ...candidate, successor_of_record_id: rec.id, successor_of_task_id: task.id }, fileSha256 });
      idMap.push({ title: candidate.title, v7_record_id: rec.id, v7_task_id: task.id, v7_content_hash: rec.contentHash, successor_output_sha256: 'n/a' });
    }
    const inputs: KycV8Inputs = { ...EMBEDDED, spec: v8SpecFor(v7), idMap, successors };
    return { p7, records, inputs, bankSha: doc.version.sha256 };
  }

  /** Reviews every rule of a project and publishes its rule set, as the Admin in the console. */
  async function reviewAndPublish(projectId: string) {
    const rules = (await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/policy/rules`, headers: { cookie: admin } })).json() as { items?: unknown[] };
    void rules;
    const versions = await db.policyRuleVersion.findMany({ where: { rule: { projectId } } });
    for (const v of versions) {
      const r = await post(admin, `/projects/${projectId}/policy/rule-versions/${v.id}/review`, { expectedContentHash: v.contentHash });
      expect(r.statusCode, r.body).toBe(200);
    }
    const pub = await post(admin, `/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(pub.statusCode, pub.body).toBeLessThan(300);
  }

  // ── TS-24 ──

  it('TS-24: a successor version may keep an identical registered form ID; a changed form under that ID is still refused', async () => {
    await publishedV7();
    const same = await anvil('validate', structuredClone(V7));
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json().data.errors).toEqual([]);
    const changed = structuredClone(V7);
    changed.authoring.profile.sections[0].fields[0].help = 'A changed form.';
    const r = await anvil('validate', changed);
    expect(r.statusCode).toBe(422);
    const err = (r.json().data.errors as { code: string; fix: string }[]).find((e) => e.code === 'TP_FORM_ID_TAKEN');
    expect(err?.fix).toMatch(/byte-identical/);
  });

  it('TS-24: an identical form under a draft (unpublished) template is still taken', async () => {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    expect((await anvil('proposals', structuredClone(V7))).statusCode).toBe(201);
    const again = await anvil('validate', structuredClone(V7));
    expect(again.json().data.errors.map((e: { code: string }) => e.code)).toContain('TP_FORM_ID_TAKEN');
  });

  // ── Phase 1: template ──

  it('template phase: dry run, then v8 DRAFT keeps the form ID and hashes exactly as the spec; v7 unchanged; idempotent', async () => {
    const v7 = await publishedV7();
    const spec = v8SpecFor(v7);
    const before = { forms: await db.uploadedProfile.count(), v7: JSON.stringify(await db.template.findUniqueOrThrow({ where: { id: v7.id } })) };
    const dry = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: false, spec });
    expect(dry.outcome, JSON.stringify(dry)).toBe('would_create');
    expect(dry).toMatchObject({ formKept: true, formId: 'golden-kyc-application-type-v1', changedParts: ['requirement', 'execution'] });
    expect(dry.v8!.part_hashes.authoring).toBe(dry.v7!.part_hashes.authoring);
    expect(await db.template.count({ where: { lineageId: v7.lineageId } })).toBe(2);

    const r = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec });
    expect(r.outcome, JSON.stringify(r)).toBe('created');
    const v8 = await db.template.findUniqueOrThrow({ where: { id: r.v8!.templateVersionId! } });
    expect(v8).toMatchObject({ status: 'DRAFT', version: v7.version + 1, lineageId: v7.lineageId, profileId: v7.profileId });
    expect(jointHashes(jointTemplateSpec(v8)!).template_sha256).toBe(jcsSha256(spec));
    expect(await db.uploadedProfile.count()).toBe(before.forms);
    expect(JSON.stringify(await db.template.findUniqueOrThrow({ where: { id: v7.id } }))).toBe(before.v7);
    const actions = (await db.auditEvent.findMany({ where: { OR: [{ entityId: v8.id }, { action: 'template_profile.reused' }] } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['template_profile.reused', 'template.version_created', 'template.successor_version_created']));

    expect((await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec })).outcome).toBe('already_created');
    const other = structuredClone(spec);
    other.requirement.summary = 'Different';
    expect((await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec: other })).outcome).toBe('refused');
  });

  it('template phase refuses: non-Admin requester, wrong predecessor hash, a changed form under the same ID', async () => {
    const v7 = await publishedV7();
    const pmUser = await createUser(clientId, ['PM']);
    expect((await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: pmUser.email, apply: true, spec: v8SpecFor(v7) })).reason).toMatch(/Admin/);
    const wrong = v8SpecFor(v7);
    (wrong.requirement.successor_of as { template_sha256: string }).template_sha256 = '0'.repeat(64);
    expect((await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec: wrong })).reason).toMatch(/successor_of/);
    const form = v8SpecFor(v7);
    (form.authoring.profile.sections as { fields: { help?: string }[] }[])[0]!.fields[0]!.help = 'Changed.';
    const r = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec: form });
    expect(r.outcome).toBe('refused');
    expect(JSON.stringify(r.errors)).toMatch(/TP_FORM_ID_TAKEN/);
    expect(await db.template.count({ where: { lineageId: v7.lineageId } })).toBe(2);
  });

  // ── Phases 2 and 3, console approval, export, readback ──

  it('end to end: project with the official text, successor tasks as submitted work, a person approves, export and readback', async () => {
    const v7 = await publishedV7();
    const h = await v7History(v7);
    const args = { v7TemplateId: v7.id, v7ProjectId: h.p7, requestedBy: ADMIN_EMAIL };
    const recordsBefore = await db.approvedTaskRecord.count();

    const t = await successorTemplate(db, { ...args, apply: true, spec: h.inputs.spec });
    expect(t.outcome).toBe('created');
    // Before publication nothing else can happen.
    expect((await successorProject(db, { storage }, { ...args, apply: true, inputs: h.inputs })).reason).toMatch(/not published/);
    const v7Hash = jointHashes(jointTemplateSpec(v7)!).template_sha256;
    expect((await post(admin, `/templates/${t.v8!.templateVersionId}/publish`)).statusCode).toBe(200);
    // v7 stays published and unchanged.
    const v7After = await db.template.findUniqueOrThrow({ where: { id: v7.id } });
    expect(v7After.status).toBe('PUBLISHED');
    expect(jointHashes(jointTemplateSpec(v7After)!).template_sha256).toBe(v7Hash);

    // Phase 2.
    const dry = await successorProject(db, { storage }, { ...args, apply: false, inputs: h.inputs });
    expect(dry.outcome, JSON.stringify(dry)).toBe('would_create');
    const p = await successorProject(db, { storage }, { ...args, apply: true, inputs: h.inputs });
    expect(p.outcome, JSON.stringify(p)).toBe('created');
    const p8 = await db.project.findUniqueOrThrow({ where: { id: p.v8Project!.id! } });
    const p7 = await db.project.findUniqueOrThrow({ where: { id: h.p7 } });
    expect(p8).toMatchObject({ name: projectNameFor(p7.name), templateId: t.v8!.templateVersionId, reviewRoute: 'SME_PM', distinctTarget: p7.distinctTarget, ownerId: p7.ownerId, jobDescriptionId: p7.jobDescriptionId, authoringExperience: null });
    expect(await db.taskInstance.count({ where: { projectId: p8.id, status: 'CREATED' } })).toBe(4);
    const docs = await db.policyDocumentVersion.findMany({ where: { projectId: p8.id } });
    expect(docs.map((d) => d.sha256).sort()).toEqual([h.bankSha, EMBEDDED.officialText.sha256].sort());
    const versions = await db.policyRuleVersion.findMany({ where: { rule: { projectId: p8.id } }, include: { rule: true, citations: true } });
    expect(versions.map((v) => v.state).every((s) => s !== 'REVIEWED')).toBe(true);
    const official = docs.find((d) => d.sha256 === EMBEDDED.officialText.sha256)!;
    for (const key of Object.keys(APR04_CLAUSES)) {
      const v = versions.find((x) => x.rule.ruleKey === key)!;
      expect(v.citations.find((c) => c.documentVersionId === official.id)?.resolution, key).toBe('RESOLVED');
    }
    expect((await successorProject(db, { storage }, { ...args, apply: true, inputs: h.inputs })).outcome).toBe('already_created');

    // Phase 3 needs the published rule set.
    expect((await successorTasks(db, { ...args, apply: true, inputs: h.inputs })).reason).toMatch(/rule set/);
    await reviewAndPublish(p8.id);
    const tdry = await successorTasks(db, { ...args, apply: false, inputs: h.inputs });
    expect(tdry.outcome, JSON.stringify(tdry)).toBe('ok');
    expect(tdry.tasks.map((x) => x.outcome)).toEqual(['would_create', 'would_create', 'would_create', 'would_create']);
    expect((await successorTasks(db, { ...args, apply: false, inputs: { ...h.inputs, approvals: h.inputs.approvals.filter((a) => a.id !== 'APR-11') } })).reason).toMatch(/lack APR-11/);
    const tr = await successorTasks(db, { ...args, apply: true, inputs: h.inputs });
    expect(tr.tasks.map((x) => x.outcome)).toEqual(['created', 'created', 'created', 'created']);
    expect(await db.approvedTaskRecord.count()).toBe(recordsBefore);

    for (const rec of h.records) {
      const task = await db.taskInstance.findFirstOrThrow({ where: { projectId: p8.id, input: { path: ['successorOf', 'predecessor', 'recordId'], equals: rec.id } } });
      expect(task.status).toBe('SUBMITTED');
      expect(task.assignedToId).toBe(rec.candidateId);
      const out = authoredContent(task.output) as { sections: Record<string, unknown> };
      const prev = authoredContent(rec.output) as { sections: Record<string, unknown> };
      for (const k of ['S1', 'S2', 'S3', 'S5', 'S6', 'S7', 'S8']) expect(jcs(out.sections[k]), k).toBe(jcs(prev.sections[k]));
      const s4 = (out.sections.S4 as { statePolicies: { contentSha256: string; ruleId: string; ruleVersion: string }[] }).statePolicies;
      expect(s4.map((x) => x.contentSha256)).toEqual([EMBEDDED.officialText.sha256, h.bankSha]);
      expect(s4[0]!.ruleId).toBe(official.documentId);
      expect(s4[0]!.ruleVersion).toMatch(/^rs1\.d1$/);
      const so = (task.input as { successorOf: { predecessor: Record<string, unknown>; approvals: { id: string; decision?: string }[] } }).successorOf;
      expect(so.predecessor).toMatchObject({ recordId: rec.id, taskId: rec.taskInstanceId, contentHash: rec.contentHash, candidateId: rec.candidateId, reviewerId: rec.reviewerId });
      expect(so.approvals.map((a) => a.id)).toEqual(['APR-01', 'APR-04', 'APR-05', 'APR-11', 'APR-12']);
      expect(so.approvals.find((a) => a.id === 'APR-11')).toMatchObject({ decision: expect.stringMatching(/No impact/) });
      const checks = task.checks as { results: { id: string; ok: boolean; severity?: string }[] };
      expect(checks.results.filter((c) => !c.ok && c.severity !== 'warning')).toEqual([]);
    }
    expect((await successorTasks(db, { ...args, apply: true, inputs: h.inputs })).tasks.map((x) => x.outcome)).toEqual(['already_created', 'already_created', 'already_created', 'already_created']);

    // A person approves each task in the console; that writes the append-only record with their identity.
    const shown = (await call(app, 'GET', admin, `/projects/${p8.id}/forge-tasks`)).json().items as { taskId: string; canDecide: boolean }[];
    expect(shown.length).toBe(4);
    for (const row of shown) {
      expect(row.canDecide).toBe(true);
      const view = (await call(app, 'GET', admin, `/projects/${p8.id}/forge-tasks/${row.taskId}`)).json();
      const res = await post(admin, `/projects/${p8.id}/tasks/${row.taskId}/decision`, { decision: 'APPROVE', expectedVersion: view.expectedVersion, expectedRevision: view.expectedRevision, checklist: Object.fromEntries((view.checklist as { key: string }[]).map((c) => [c.key, true])) });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status, res.body).toBe('ACCEPTED');
    }
    const fresh = await db.approvedTaskRecord.findMany({ where: { projectId: p8.id } });
    expect(fresh.length).toBe(4);
    expect(fresh.every((r) => r.reviewerId === adminId && r.templateVersion === v7.version + 1)).toBe(true);

    // Offline export in RL Gym's import format, without calling RL Gym.
    const written = new Map<string, Buffer>();
    const ex = await offlineExport(db, { projectId: p8.id, apply: true, write: async (f, zip) => (written.set(f, zip), `mem:${f}`) });
    expect(ex.outcome, JSON.stringify(ex)).toBe('written');
    expect(ex.parts.length).toBe(1);
    const zip = [...written.values()][0]!;
    expect(archiveProblems(zip)).toEqual([]);
    expect(packageProblems(zip)).toEqual([]);
    const files = readZip(zip);
    const manifest = JSON.parse(files.get('praxis-export.json')!.toString('utf8'));
    expect(manifest).toMatchObject({ schema_version: 'praxis.authored-task-export.v1', execution: { location: 'anvil_only', paid_calls: false }, content_classification: 'synthetic' });
    expect(manifest.tasks.map((x: { revision_id: string }) => x.revision_id).sort()).toEqual(fresh.map((r) => r.id).sort());
    expect(manifest.tasks.every((x: { template: { sha256: string; version: number } }) => x.template.sha256 === jcsSha256(h.inputs.spec) && x.template.version === v7.version + 1)).toBe(true);
    expect(ex.parts[0]!.zipSha256).toBe(createHash('sha256').update(zip).digest('hex'));
    // The dry run writes nothing; the same tasks give the same package.
    const again = await offlineExport(db, { projectId: p8.id, apply: false, write: async () => { throw new Error('no write in a dry run'); } });
    expect(again.parts[0]!.packageSha256).toBe(ex.parts[0]!.packageSha256);

    // Readback: IDs, hashes, actor user IDs and roles; never names or e-mails.
    const rb = await kycV8Readback(db, { v7TemplateId: v7.id, v7ProjectId: h.p7 });
    expect(rb.ok).toBe(true);
    const text = JSON.stringify(rb);
    expect(text).not.toMatch(/@/);
    const r = rb as Extract<typeof rb, { v8: unknown }>;
    expect(r.v8).toMatchObject({ status: 'PUBLISHED', version: v7.version + 1, template_sha256: jcsSha256(h.inputs.spec) });
    expect(r.v8!.events.map((e) => e.action)).toEqual(expect.arrayContaining(['template.successor_version_created']));
    expect(r.successors.length).toBe(4);
    for (const s of r.successors) {
      expect(s.status).toBe('ACCEPTED');
      expect(s.approvedRecords[0]).toMatchObject({ reviewerId: adminId, reviewerRoles: ['ADMIN'] });
      expect(s.approvedRecords[0]!.receiptRef).toMatch(/^praxis-approved-record:/);
      expect(h.records.map((x) => x.id)).toContain(s.predecessor.recordId);
      expect(s.events.map((e) => e.action)).toEqual(expect.arrayContaining(['task.successor_submitted', 'task.accepted']));
    }
    expect(r.project!.ruleSets[0]!.publishedByRoles).toEqual(['ADMIN']);
  });

  it('tasks phase refuses a candidate that changes anything but S4, and never touches the task', async () => {
    const v7 = await publishedV7();
    const h = await v7History(v7);
    const args = { v7TemplateId: v7.id, v7ProjectId: h.p7, requestedBy: ADMIN_EMAIL };
    const t = await successorTemplate(db, { ...args, apply: true, spec: h.inputs.spec });
    await post(admin, `/templates/${t.v8!.templateVersionId}/publish`);
    const p = await successorProject(db, { storage }, { ...args, apply: true, inputs: h.inputs });
    await reviewAndPublish(p.v8Project!.id!);
    const first = h.records[0]!;
    const bad = structuredClone(h.inputs.successors.get(first.id)!);
    bad.candidate.output.sections.S2 = { ...bad.candidate.output.sections.S2, changed: 'x' };
    const inputs = { ...h.inputs, successors: new Map([...h.inputs.successors, [first.id, bad]]) };
    const r = await successorTasks(db, { ...args, apply: true, inputs });
    expect(r.outcome).toBe('refused');
    expect(r.tasks.find((x) => x.predecessorRecordId === first.id)).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/changes S2/) });
    expect(await db.taskInstance.count({ where: { projectId: p.v8Project!.id!, status: 'SUBMITTED' } })).toBe(3);
  });

  // ── Units ──

  it('successorS4 binds the official text first, then each document the predecessor cited, from the published library', () => {
    const lib = [
      { documentVersionId: 'a', title: 'Official', jurisdiction: null, category: null, effectiveFrom: null, policyId: 'doc-official', version: 'rs1.d1', publicationRef: 'project rule set v1', sha256: 'f'.repeat(64), rules: [] },
      { documentVersionId: 'b', title: 'Bank', jurisdiction: null, category: null, effectiveFrom: null, policyId: 'doc-bank', version: 'rs1.d1', publicationRef: 'project rule set v1', sha256: 'b'.repeat(64), rules: [] },
    ];
    const r = successorS4({ predecessorS4: { statePolicies: [{ ruleId: 'old', ruleVersion: 'rs1.d1', locator: 'project rule set v1', contentSha256: 'b'.repeat(64), appliesTo: 'note', rationale: '', exception: '' }] }, candidateS4: { statePolicies: [{ contentSha256: 'f'.repeat(64), appliesTo: 'federal' }] }, library: lib, officialSha256: 'f'.repeat(64) });
    expect('S4' in r && r.S4.statePolicies).toEqual([
      { ruleId: 'doc-official', ruleVersion: 'rs1.d1', locator: 'project rule set v1', contentSha256: 'f'.repeat(64), appliesTo: 'federal', rationale: '', exception: '' },
      { ruleId: 'doc-bank', ruleVersion: 'rs1.d1', locator: 'project rule set v1', contentSha256: 'b'.repeat(64), appliesTo: 'note', rationale: '', exception: '' },
    ]);
    expect(successorS4({ predecessorS4: {}, candidateS4: {}, library: [], officialSha256: 'f'.repeat(64) }).problems[0]).toMatch(/official text/);
  });

  it('embedded inputs: the v8 spec (package rev 2); the official text hash; four successors mapped', () => {
    expect(jcsSha256(EMBEDDED.spec)).toBe('8449adb008b6ecea7858b594dd5765f60b9b9596b57568d25f5e0598a334f7d5');
    for (const id of ['APR-11', 'APR-12']) expect(EMBEDDED.approvals.map((a) => a.id)).toContain(id);
    expect(EMBEDDED.officialText.sha256).toBe('07069b7552403b5b99097a9249d1ed45d940253df1bafa860154e52a097bf1f4');
    expect(EMBEDDED.idMap.length).toBe(4);
    for (const m of EMBEDDED.idMap) expect(EMBEDDED.successors.get(m.v7_record_id)?.candidate.successor_of_task_id).toBe(m.v7_task_id);
    const text = EMBEDDED.officialText.bytes.toString('utf8');
    for (const c of Object.values(APR04_CLAUSES)) expect(text).toContain(c.quote);
  });

  it('archive bounds: safe unique paths, STORE/DEFLATE only, entry and size limits', () => {
    const ok = writeZip([{ path: 'praxis-export.json', bytes: Buffer.from('{}') }]);
    expect(archiveProblems(ok)).toEqual([]);
    for (const p of ['/abs.json', '../up.json', 'a/../b.json', 'a\\b.json', 'dir/', 'a//b.json', './x.json']) expect(safeArchivePath(p), p).toBe(false);
    expect(safeArchivePath('tasks/abc-1/actor.json')).toBe(true);
    // A hand-built archive with a directory entry, a duplicate (by case) and method 12 (bzip2).
    const entry = (name: string, method: number, data: Buffer, size: number) => ({ name: Buffer.from(name), method, data, size });
    const raw = [entry('a.json', 8, deflateRawSync(Buffer.from('{}')), 2), entry('A.JSON', 0, Buffer.from('{}'), 2), entry('d/', 0, Buffer.alloc(0), 0), entry('b.bin', 12, Buffer.from('xx'), 2)];
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const e of raw) {
      const l = Buffer.alloc(30);
      l.writeUInt32LE(0x04034b50, 0);
      l.writeUInt16LE(e.method, 8);
      l.writeUInt32LE(e.data.length, 18);
      l.writeUInt32LE(e.size, 22);
      l.writeUInt16LE(e.name.length, 26);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt32LE(e.data.length, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(offset, 42);
      locals.push(l, e.name, e.data);
      centrals.push(c, e.name);
      offset += 30 + e.name.length + e.data.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(raw.length, 8);
    end.writeUInt16LE(raw.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    const problems = archiveProblems(Buffer.concat([...locals, cd, end]));
    expect(problems.join('\n')).toMatch(/duplicate path "A.JSON"/);
    expect(problems.join('\n')).toMatch(/unsafe path "d\/"/);
    expect(problems.join('\n')).toMatch(/method 12/);
    // Too many entries and too large.
    const many = writeZip(Array.from({ length: ARCHIVE_BOUNDS.entries + 1 }, (_, i) => ({ path: `f${i}.json`, bytes: Buffer.from('{}') })));
    expect(archiveProblems(many).join('\n')).toMatch(/1201 entries exceed 1200/);
    const big = writeZip([{ path: 'big.json', bytes: Buffer.alloc(ARCHIVE_BOUNDS.fileBytes + 1, 32) }]);
    expect(archiveProblems(big).join('\n')).toMatch(/over 10485760/);
    expect(packageProblems(ok).join('\n')).toMatch(/schema_version|execution/);
  });

  it('command line: phase, Admin e-mail and IDs are required; unknown arguments refused', () => {
    expect(parseKycV8Args(['template', '--requested-by', 'a@b.test'])).toMatchObject({ phase: 'template', apply: false, v7TemplateId: '40713870-6421-4d20-b727-eb862927ec72', v7ProjectId: 'f7f3cfae-d6a2-450b-9748-1485047ef4c3' });
    expect(parseKycV8Args(['tasks', '--requested-by', 'a@b.test', '--apply'])).toMatchObject({ phase: 'tasks', apply: true });
    expect(() => parseKycV8Args(['publish', '--requested-by', 'a@b.test'])).toThrow(/template\|project\|tasks/);
    expect(() => parseKycV8Args(['template'])).toThrow(/requested-by/);
    expect(() => parseKycV8Args(['template', '--requested-by', 'a@b.test', '--force'])).toThrow(/Unknown argument/);
    expect(() => parseKycV8Args(['project', '--requested-by', 'a@b.test', '--v7-project', 'nope'])).toThrow(/UUID/);
  });
});
