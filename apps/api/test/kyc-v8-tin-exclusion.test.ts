import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jcs } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { readZip } from '../src/anvil/zip';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { CHANGE_RECORD_SCHEMA, conformanceProblems, offlineExport, packageProblems, TASK_CHANGE_RECORD_SCHEMA } from '../src/jobs/authored-export';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { applyTinExclusion, KYC_V8_TIN_EXCLUSION, kycV8TinExclusion, parseTinExclusionArgs, revertTinExclusion, TIN_LIMITATION, type TinExclusionSpec } from '../src/jobs/kyc-v8-tin-exclusion';
import { applyBindings, KYC_V8_TOOL_BINDING, kycV8ToolBinding, type ToolBindingSpec } from '../src/jobs/kyc-v8-tool-binding';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC v8 pending-TIN exclusion (owner decision APR-14, 21 Nov 2026): the job that submits successor revisions of the
 * Teen joint and Custodial tasks (after their APR-13 tool-binding revisions were approved) without the pending-TIN
 * step and its dependent text, the console approval by a person, and the offline 4-task export with its task change
 * record. The QA state is rebuilt from the embedded v8 candidates through the APR-13 job. Mocks only.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';
const RULE = 'R-CONFIRM-PENDING-TIN-APPLICATION';

type Sections = Record<string, Record<string, unknown>>;
type Step = { action: string; tool: string; failureBehaviour: string };
const sectionsOf = (output: unknown) => (output as { sections: Sections }).sections;
const stepsOf = (output: unknown) => sectionsOf(output).S5!.steps as Step[];
const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/** The embedded candidate for an application type, with its APR-13 tool bindings applied (the content approved in QA on 21 Nov). */
function afterApr13(applicationType: string) {
  const c = [...EMBEDDED.successors.values()].find((s) => s.candidate.output.sections.S1!.applicationType === applicationType)!;
  const bt = KYC_V8_TOOL_BINDING.tasks.find((t) => t.applicationType === applicationType)!;
  const r = applyBindings(c.candidate.output, bt.changes);
  if (!('output' in r)) throw new Error(r.problems.join(' '));
  return r.output;
}

describe('KYC v8 pending-TIN exclusion (APR-14)', () => {
  // ── Units on the approved content ──

  it('the embedded change list applies exactly to the APR-13 content: 3 steps, limitation verbatim, no TIN rule left', () => {
    expect(KYC_V8_TIN_EXCLUSION.templateSha256).toBe('8449adb008b6ecea7858b594dd5765f60b9b9596b57568d25f5e0598a334f7d5');
    expect(TIN_LIMITATION).toBe('Pending-TIN verification is excluded from this benchmark; results do not establish TIN verification or complete regulatory compliance.');
    for (const t of KYC_V8_TIN_EXCLUSION.tasks) {
      const before = afterApr13(t.applicationType);
      const r = applyTinExclusion(before, t);
      if (!('output' in r)) throw new Error(r.problems.join(' '));
      const s = sectionsOf(r.output);
      const p = sectionsOf(before);
      expect(stepsOf(r.output).map((x) => x.tool)).toEqual(['application.read', 'address.check', 'finding.write']);
      expect(stepsOf(before)[2]).toMatchObject({ tool: '' });
      expect(JSON.stringify(s)).not.toContain(RULE);
      expect(s.S1!.scope).toBe(`${p.S1!.scope as string} ${TIN_LIMITATION}`);
      expect((s.S8!.reviewerNotes as string).endsWith(` ${TIN_LIMITATION}`)).toBe(true);
      // Unchanged fields are byte-identical.
      expect(jcs(s.S3!.tools)).toBe(jcs(p.S3!.tools));
      expect(jcs(s.S4)).toBe(jcs(p.S4));
      expect(jcs(s.S7!.criteria)).toBe(jcs(p.S7!.criteria));
      expect(jcs((r.output as Record<string, unknown>).header)).toBe(jcs((before as Record<string, unknown>).header));
      expect(jcs((r.output as Record<string, unknown>).profile)).toBe(jcs((before as Record<string, unknown>).profile));
      const touched = new Set(t.fields.map((f) => f.pointer.split('/').slice(3).join('/')));
      for (const [sec, fields] of Object.entries(p))
        for (const k of Object.keys(fields)) if (!touched.has(`${sec}/${k}`) && !(sec === 'S5' && k === 'steps')) expect(jcs(s[sec]![k]), `${sec}.${k}`).toBe(jcs(fields[k]));
      // Steps 0 and 1 unchanged; old step 3 is new step 2.
      expect(jcs(stepsOf(r.output).slice(0, 2))).toBe(jcs(stepsOf(before).slice(0, 2)));
      expect(stepsOf(r.output)[2]!.failureBehaviour).toBe(stepsOf(before)[3]!.failureBehaviour);
      // Reverting gives the approved bytes exactly; the change list records every field and the removed step.
      expect(jcs(revertTinExclusion(r.output, r.changes))).toBe(jcs(before));
      expect(r.changes.map((c) => c.op)).toEqual([...t.fields.map(() => 'replace'), 'remove']);
    }
  });

  it('the exact new texts follow the owner’s change list', () => {
    const [teen, cust] = KYC_V8_TIN_EXCLUSION.tasks.map((t) => {
      const r = applyTinExclusion(afterApr13(t.applicationType), t);
      if (!('output' in r)) throw new Error(r.problems.join(' '));
      return sectionsOf(r.output);
    }) as [Sections, Sections];
    expect(teen.S1!.deliverable).toBe('A structured KYC findings report for each assigned case, detailing verified identification attributes, unresolved information gaps, and an evidence-based recommendation for risk review and final approval handoff.');
    expect(teen.S1!.businessContext).toMatch(/under R-COLLECT-ADDRESS prior to account opening\.$/);
    expect(teen.S2!.inputContract).toContain('- Minor applicant details: Declared legal name, residential address and date of birth.\n');
    expect(teen.S2!.inputContract).toContain('submitted identity credentials and address verifications.\n');
    expect(stepsOf({ sections: teen })[2]!.action).toBe('Synthesize all verified identification attributes and remaining exceptions into the structured KYC findings report, preparing the case for risk review and final sign-off.');
    expect(teen.S6!.outputContract).toContain('compliance with R-COLLECT-ADDRESS.\n3. Unresolved Gaps & Discrepancies: Granular identification of any missing fields, tool failures, or conflicting identity data.');
    const tr = teen.S7!.scoringRule as string;
    expect(tr).toContain('1. Core Attribute Collection & Validation (50 points)');
    expect(tr).toContain('\n\n2. Discrepancy Handling & Information Gathering (25 points)');
    expect(tr).toContain('\n\n3. Report Completeness & Recommendation Quality (25 points)');
    expect(tr).toContain('is missing or unverified; or (b) fabricating, halluncinating, or assuming unverifiable applicant data.');
    expect(tr).not.toMatch(/Pending TIN|\(c\)/);
    expect(teen.S8!.sourcesUsed).toMatch(/incorporating requirements for R-COLLECT-CUSTOMER-NAME and R-COLLECT-ADDRESS\.$/);

    expect(cust.S1!.businessContext).toMatch(/customer name is obtained \(R-COLLECT-CUSTOMER-NAME\) and customer address is collected prior to opening \(R-COLLECT-ADDRESS\)\.$/);
    expect(cust.S1!.deliverable).toBe('A completed review record for each assigned custodian application containing customer identity and address verification findings, unresolved information gaps, and a risk-based recommendation for account approval, escalation, or follow-up.');
    expect(cust.S2!.inputContract).not.toContain('Tax identification');
    expect((cust.S3!.failureBehaviour as string).match(/^\d\. [^:]+:/gm)).toEqual(['1. Incomplete or Missing Core Data:', '2. Tool Unavailability or System Errors:', '3. Discrepancies and Conflicts:']);
    expect(cust.S6!.outputContract).not.toContain('TIN Status');
    expect(cust.S6!.outputContract).toContain('missing mandatory data, unverified identity elements or invalid addresses.');
    const cr = cust.S7!.scoringRule as string;
    expect([...cr.matchAll(/\((\d+) Points\)/g)].map((m) => Number(m[1]))).toEqual([35, 35, 20, 10]);
    expect(cr).toContain('- Hallucinating customer details, fabricating TIN records, or claiming TIN verification was performed.');
    expect(cust.S8!.reviewerNotes).not.toContain('third-party database');
    expect(cust.S8!.sourcesUsed).toContain('2. Project rules: R-COLLECT-ADDRESS (mandatory collection of address prior to account opening) and R-COLLECT-CUSTOMER-NAME (mandatory collection of customer name prior to account opening).\n');
  });

  it('refuses a mismatched old text, a protected field and a removed step that is not the blank pending-TIN step', () => {
    const t = KYC_V8_TIN_EXCLUSION.tasks[0]!;
    const before = afterApr13(t.applicationType);
    const bad = structuredClone(t);
    bad.fields[1]!.edits[0]!.find = 'validation of pending TIN filings, ';
    expect(applyTinExclusion(before, bad)).toEqual({ problems: [expect.stringMatching(/S1\/deliverable does not contain the expected old text/)] });
    const prot = structuredClone(t);
    prot.fields.push({ pointer: '/authored/sections/S7/criteria', edits: [] });
    expect((applyTinExclusion(before, prot) as { problems: string[] }).problems.join()).toMatch(/must stay unchanged/);
    const tooled = structuredClone(before);
    stepsOf(tooled)[2]!.tool = 'document.verify';
    expect((applyTinExclusion(tooled, t) as { problems: string[] }).problems.join()).toMatch(/is not the pending-TIN step with a blank tool/);
    expect((applyTinExclusion(before, { ...t, removeStep: 1 }) as { problems: string[] }).problems.join()).toMatch(/is not the pending-TIN step/);
  });

  it('command line: --requested-by is required; --apply optional; unknown arguments refused', () => {
    expect(parseTinExclusionArgs(['--requested-by', 'a@b.test'])).toEqual({ requestedBy: 'a@b.test', apply: false });
    expect(parseTinExclusionArgs(['--requested-by', 'a@b.test', '--apply'])).toEqual({ requestedBy: 'a@b.test', apply: true });
    expect(() => parseTinExclusionArgs([])).toThrow(/requested-by/);
    expect(() => parseTinExclusionArgs(['--requested-by'])).toThrow(/needs a value/);
    expect(() => parseTinExclusionArgs(['--requested-by', 'a@b.test', '--force'])).toThrow(/Unknown argument/);
  });

  // ── The job against the database ──

  describe('job', () => {
    let app: FastifyInstance;
    const google = new MockGoogleVerifier(SECRET);
    let clientId: string;
    let admin: string;
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
        storage: new MemoryStorage(),
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

    async function approveInConsole(projectId: string, taskId: string) {
      const view = (await call(app, 'GET', admin, `/projects/${projectId}/forge-tasks/${taskId}`)).json();
      return post(admin, `/projects/${projectId}/tasks/${taskId}/decision`, { decision: 'APPROVE', expectedVersion: view.expectedVersion, expectedRevision: view.expectedRevision, checklist: Object.fromEntries((view.checklist as { key: string }[]).map((c) => [c.key, true])) });
    }

    /** The QA state of 21 Nov: four approved v8 tasks, three of them re-approved after the APR-13 tool-binding revision. */
    async function qaState() {
      const v8 = await publishedV8();
      await setFlow(true);
      const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
      const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: `KYC v8 ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
      expect(created.statusCode, created.body).toBe(201);
      const projectId = created.json().id as string;
      expect((await post(pm, `/projects/${projectId}/submit`)).statusCode).toBe(200);
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
      const sha = jointHashes(jointTemplateSpec(v8)!).template_sha256;
      const tb: ToolBindingSpec = { ...structuredClone(KYC_V8_TOOL_BINDING), projectId, templateVersionId: v8.id, templateSha256: sha };
      tb.tasks = tb.tasks.map((t) => ({ ...t, taskId: byType.get(t.applicationType)!.taskId, predecessorRecordId: byType.get(t.applicationType)!.record.id }));
      tb.unchanged = tb.unchanged.map((u) => ({ ...u, taskId: byType.get(u.applicationType)!.taskId, recordId: byType.get(u.applicationType)!.record.id }));
      expect((await kycV8ToolBinding(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: tb })).outcome).toBe('ok');
      for (const t of tb.tasks) expect((await approveInConsole(projectId, t.taskId)).json().status).toBe('ACCEPTED');
      const latest = async (taskId: string) => (await db.approvedTaskRecord.findMany({ where: { taskInstanceId: taskId }, orderBy: { seq: 'desc' }, take: 1 }))[0]!;
      const spec: TinExclusionSpec = { ...structuredClone(KYC_V8_TIN_EXCLUSION), projectId, templateVersionId: v8.id, templateSha256: sha };
      spec.tasks = await Promise.all(spec.tasks.map(async (t) => ({ ...t, taskId: byType.get(t.applicationType)!.taskId, predecessorRecordId: (await latest(byType.get(t.applicationType)!.taskId)).id })));
      // Individual by its 8-character prefix (as the change list gives it), Adult joint by its full ID.
      spec.unchanged = await Promise.all(spec.unchanged.map(async (u) => {
        const id = (await latest(byType.get(u.applicationType)!.taskId)).id;
        return { ...u, taskId: byType.get(u.applicationType)!.taskId, recordId: u.applicationType === 'individual' ? id.slice(0, 8) : id };
      }));
      return { v8, projectId, spec, byType };
    }

    const snapshot = async (projectId: string) => ({
      records: ser(await db.approvedTaskRecord.findMany({ where: { projectId }, orderBy: { seq: 'asc' } })),
      tasks: ser(await db.taskInstance.findMany({ where: { projectId }, orderBy: { id: 'asc' } })),
      submissions: await db.taskSubmission.count({ where: { taskInstance: { projectId } } }),
      audits: await db.auditEvent.count({ where: { action: 'task.tin_exclusion_revision_submitted' } }),
    });

    it('dry run plans 2 revisions with hashes; apply submits them (no record); re-run is idempotent; console approval; 4-task export with change record', async () => {
      const h = await qaState();
      const before = await snapshot(h.projectId);

      const dry = await kycV8TinExclusion(db, { requestedBy: ADMIN_EMAIL, apply: false, spec: h.spec });
      expect(dry.outcome, JSON.stringify(dry)).toBe('ok');
      expect(dry).toMatchObject({ approval: 'APR-14', limitation: TIN_LIMITATION, template_sha256: h.spec.templateSha256 });
      expect(dry.tasks.map((t) => [t.title, t.outcome, t.steps])).toEqual([['Teen joint', 'would_submit', { before: 4, after: 3 }], ['Custodial', 'would_submit', { before: 4, after: 3 }]]);
      for (const t of dry.tasks) {
        expect(t.predecessorContentHash).toBe((await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: t.predecessorRecordId } })).contentHash);
        expect(t.predecessor!.actorSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(t.successor!.actorSha256).not.toBe(t.predecessor!.actorSha256);
        expect(t.successor!.referenceSha256).not.toBe(t.predecessor!.referenceSha256);
        expect(t.changes.at(-1)).toEqual({ op: 'remove', pointer: '/authored/sections/S5/steps/2' });
      }
      expect(dry.unchanged.map((u) => [u.title, u.check])).toEqual([['Individual', 'pass'], ['Adult joint', 'pass']]);
      expect(await snapshot(h.projectId)).toEqual(before);

      const r = await kycV8TinExclusion(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec });
      expect(r.outcome, JSON.stringify(r)).toBe('ok');
      expect(r.tasks.map((t) => [t.outcome, t.status])).toEqual([['submitted', 'SUBMITTED'], ['submitted', 'SUBMITTED']]);
      expect(r.tasks.map((t) => t.successor)).toEqual(dry.tasks.map((t) => t.successor));
      const after = await snapshot(h.projectId);
      expect(after.records).toBe(before.records); // no ApprovedTaskRecord written or changed
      expect(after.submissions).toBe(before.submissions + 2);
      expect(after.audits).toBe(2);
      for (const tt of h.spec.tasks) {
        const task = await db.taskInstance.findUniqueOrThrow({ where: { id: tt.taskId } });
        const rec = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: tt.predecessorRecordId } });
        expect(task.status).toBe('SUBMITTED');
        expect(stepsOf(task.output).length).toBe(3);
        const input = task.input as Record<string, any>;
        expect(jcs({ ...input, tinExclusion: undefined })).toBe(jcs(rec.input)); // APR-13 lineage and the rest kept
        expect(input.tinExclusion).toMatchObject({ schema: 'adi-forge.tin-exclusion-revision.v1', predecessor: { recordId: rec.id, contentHash: rec.contentHash }, limitation: TIN_LIMITATION, approvals: [{ id: 'APR-14', status: 'approved' }] });
        const ev = await db.auditEvent.findFirstOrThrow({ where: { entityId: task.id, action: 'task.tin_exclusion_revision_submitted' } });
        expect(ev).toMatchObject({ actorType: 'SYSTEM', actorId: 'kyc-v8-tin-exclusion' });
        expect(ev.after).toMatchObject({ status: 'SUBMITTED', recordKept: true, approval: 'APR-14', limitation: TIN_LIMITATION });
      }
      // The unchanged tasks are untouched.
      for (const type of ['individual', 'adult_joint']) {
        const id = h.byType.get(type)!.taskId;
        expect(ser(await db.taskInstance.findUniqueOrThrow({ where: { id } }))).toBe(ser(JSON.parse(before.tasks).find((t: { id: string }) => t.id === id)));
      }

      const mid = await snapshot(h.projectId);
      const again = await kycV8TinExclusion(db, { requestedBy: ADMIN_EMAIL, apply: true, spec: h.spec });
      expect(again.tasks.map((t) => [t.outcome, t.successorRecordId])).toEqual([['already_submitted', null], ['already_submitted', null]]);
      expect(await snapshot(h.projectId)).toEqual(mid);

      // A person approves each revision in the console; the job then reports the record.
      const adminUser = await db.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
      for (const tt of h.spec.tasks) expect((await approveInConsole(h.projectId, tt.taskId)).json().status).toBe('ACCEPTED');
      const re = await kycV8TinExclusion(db, { requestedBy: ADMIN_EMAIL, apply: false, spec: h.spec });
      const successors = new Map<string, ApprovedTaskRecord>();
      for (const [i, tt] of h.spec.tasks.entries()) {
        const s = (await db.approvedTaskRecord.findMany({ where: { taskInstanceId: tt.taskId }, orderBy: { seq: 'desc' }, take: 1 }))[0]!;
        expect(s.reviewerId).toBe(adminUser.id);
        expect(re.tasks[i]).toMatchObject({ outcome: 'already_submitted', successorRecordId: s.id });
        successors.set(tt.taskId, s);
      }

      // Offline export: one 4-task ZIP, conformant, plus the task change record.
      const written = new Map<string, Buffer>();
      const ex = await offlineExport(db, { projectId: h.projectId, apply: true, write: async (f, b) => (written.set(f, b), `mem:${f}`) });
      expect(ex.outcome, JSON.stringify(ex)).toBe('written');
      expect(ex.parts.length).toBe(1);
      const part = ex.parts[0]!;
      const zip = written.get(`${part.packageId}.zip`)!;
      expect(packageProblems(zip)).toEqual([]);
      expect(conformanceProblems(zip, () => jointTemplateSpec(h.v8)!.execution)).toEqual([]);
      const files = readZip(zip);
      const manifest = JSON.parse(files.get('praxis-export.json')!.toString('utf8'));
      const unchangedIds = await Promise.all(['individual', 'adult_joint'].map(async (t) => (await db.approvedTaskRecord.findMany({ where: { taskInstanceId: h.byType.get(t)!.taskId }, orderBy: { seq: 'desc' }, take: 1 }))[0]!.id));
      expect(manifest.tasks.map((t: { revision_id: string }) => t.revision_id).sort()).toEqual([...[...successors.values()].map((s) => s.id), ...unchangedIds].sort());
      // Actor and private copies: the actor file has 3 steps without the TIN rule, and the reference has the limitation.
      for (const tt of h.spec.tasks) {
        const entry = manifest.tasks.find((t: { task_id: string }) => t.task_id === tt.taskId);
        const actor = files.get(entry.actor.path)!.toString('utf8');
        const ref = JSON.parse(files.get(entry.private_assets[0].path)!.toString('utf8'));
        expect(actor).not.toContain(RULE);
        expect(JSON.stringify(ref)).not.toContain(RULE);
        expect(ref.authored.sections.S5.steps.length).toBe(3);
        expect(ref.authored.sections.S8.reviewerNotes.endsWith(TIN_LIMITATION)).toBe(true);
      }

      expect(ex.changeRecords.map((c) => c.schema).sort()).toEqual([CHANGE_RECORD_SCHEMA, TASK_CHANGE_RECORD_SCHEMA].sort());
      // The APR-13 record now covers only Individual (its record is still the tool-binding revision).
      const tb = JSON.parse(written.get(`${part.packageId}.change-record.json`)!.toString('utf8'));
      expect(tb.tasks.map((t: { task_id: string }) => t.task_id)).toEqual([h.byType.get('individual')!.taskId]);

      const cr = JSON.parse(written.get(`${part.packageId}.task-change-record.json`)!.toString('utf8'));
      expect(cr).toMatchObject({ schema: TASK_CHANGE_RECORD_SCHEMA, package_id: part.packageId, zip_sha256: part.zipSha256, package_sha256: part.packageSha256 });
      expect(cr.decisions).toEqual([expect.objectContaining({ id: 'APR-14', decision: 'Approved', approvedAt: '2026-11-21', status: 'approved', limitation: TIN_LIMITATION, capability_gap: 'CG-01' })]);
      expect(cr.unchanged.map((u: { record_id: string }) => u.record_id).sort()).toEqual([...unchangedIds].sort());
      expect(cr.tasks.length).toBe(2);
      for (const [i, tt] of h.spec.tasks.entries()) {
        const c = cr.tasks.find((x: { task_id: string }) => x.task_id === tt.taskId);
        const pred = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: tt.predecessorRecordId } });
        const succ = successors.get(tt.taskId)!;
        const entry = manifest.tasks.find((t: { task_id: string }) => t.task_id === tt.taskId);
        expect(c.predecessor).toEqual({ record_id: pred.id, content_hash: pred.contentHash, actor_sha256: dry.tasks[i]!.predecessor!.actorSha256, reference_sha256: dry.tasks[i]!.predecessor!.referenceSha256 });
        expect(c.successor).toEqual({ record_id: succ.id, content_hash: succ.contentHash, actor_sha256: entry.actor.sha256, reference_sha256: entry.private_assets[0].sha256, receipt_ref: entry.review.receipt_ref });
        expect(c.successor.actor_sha256).toBe(dry.tasks[i]!.successor!.actorSha256);
        expect(c.successor.reference_sha256).toBe(dry.tasks[i]!.successor!.referenceSha256);
        expect(c.approvals).toEqual(['APR-14']);
        expect(c.limitation).toBe(TIN_LIMITATION);
        expect(c.approval_receipts.successor).toEqual({ record_id: succ.id, approver_user_id: adminUser.id, approver_roles: expect.arrayContaining(['ADMIN']), approved_at: succ.reviewDecisionAt.toISOString(), receipt_ref: entry.review.receipt_ref });
        expect(c.approval_receipts.predecessor).toMatchObject({ record_id: pred.id, approver_user_id: pred.reviewerId, approved_at: pred.reviewDecisionAt.toISOString() });
        expect(c.changes.map((x: { op: string; pointer: string }) => [x.op, x.pointer])).toEqual([...tt.fields.map((f) => ['replace', f.pointer]), ['remove', '/authored/sections/S5/steps/2']]);
        const removed = c.changes.at(-1);
        expect(removed).toMatchObject({ new: null, old: { tool: '' } });
        expect(removed.old.action).toContain(RULE);
        const scope = c.changes.find((x: { pointer: string }) => x.pointer.endsWith('/S1/scope'));
        expect(scope.new).toBe(`${scope.old} ${TIN_LIMITATION}`);
        if (tt.applicationType === 'teen_joint') expect(c.changes.find((x: { pointer: string }) => x.pointer.endsWith('/steps/3/action')).successor_pointer).toBe('/authored/sections/S5/steps/2/action');
      }
    });

    it('refuses (writes nothing) when an old text differs, a step is not blank, or the requester is not an Admin', async () => {
      const h = await qaState();
      const before = await snapshot(h.projectId);
      const run = (spec: TinExclusionSpec, requestedBy = ADMIN_EMAIL) => kycV8TinExclusion(db, { requestedBy, apply: true, spec });

      const oldDiffers = structuredClone(h.spec);
      oldDiffers.tasks[1]!.fields[0]!.edits[0]!.find = 'customer name is collected (R-COLLECT-CUSTOMER-NAME)';
      const r1 = await run(oldDiffers);
      expect(r1.outcome).toBe('refused');
      expect(r1.tasks[1]!.reason).toMatch(/S1\/businessContext does not contain the expected old text/);
      expect(r1.tasks[0]!.outcome).toBe('would_submit');

      expect((await run({ ...h.spec, limitation: 'TIN excluded.' })).reason).toMatch(/limitation/);
      expect((await run({ ...h.spec, templateSha256: '0'.repeat(64) })).reason).toMatch(/must be unchanged/);
      const pmUser = await createUser(clientId, ['PM']);
      expect((await run(h.spec, pmUser.email)).reason).toMatch(/active Admin/);
      const prot = structuredClone(h.spec);
      prot.tasks[0]!.fields.push({ pointer: '/authored/sections/S4/policies', edits: [] });
      expect((await run(prot)).reason).toMatch(/S3\.tools, S4 and S7\.criteria/);
      // Predecessor that is not the APR-13 revision (the original record).
      const orig = structuredClone(h.spec);
      orig.tasks[0]!.predecessorRecordId = h.byType.get('teen_joint')!.record.id;
      expect((await run(orig)).tasks[0]!.reason).toMatch(/not the APR-13 tool-binding revision|not the latest/);
      expect(await snapshot(h.projectId)).toEqual(before);

      // A pending-TIN step that carries a tool again.
      const teen = await db.taskInstance.findUniqueOrThrow({ where: { id: h.spec.tasks[0]!.taskId } });
      const out = structuredClone(teen.output) as Record<string, unknown>;
      stepsOf(out)[2]!.tool = 'tin.check';
      await db.taskInstance.update({ where: { id: teen.id }, data: { output: out as Prisma.InputJsonValue } });
      const r2 = await run(h.spec);
      expect(r2.tasks[0]!.reason).toMatch(/differs from its approved record/);
      expect(await db.taskInstance.count({ where: { projectId: h.projectId, status: 'SUBMITTED' } })).toBe(0);
      expect(await db.auditEvent.count({ where: { action: 'task.tin_exclusion_revision_submitted' } })).toBe(0);
    });
  });
});
