import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { buildRlGymExport } from '../src/anvil/rlgym-export';
import { cancelTestProject, createTestProject, createTestTask, importTemplate, retireDraft, syntheticSections, TEST_PROJECT_NAME } from '../src/jobs/kyc-judgment-test-project';
import { snapshotProblems } from '../src/tasks/task-integrity';
import type { Template } from '@prisma/client';
import type { TemplateProfile } from '@praxis/shared';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1 end-to-end integration (coordinator, 25 Nov 2026): import the template, create the test-only project
 * with only the federal document, create ONE synthetic task covering all four types and submit it; a person (the owner,
 * as Admin) approves it through the console's decision route. Nothing in the job approves anything. The proposal is
 * exactly Studio's (e14116d), with S4 expectedRules optional (coordinator: advisory). Mocks only.
 */
const PROPOSAL = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-v1.proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
// Studio e14116d: the six form changes are in (expectedRules optional among them); the proposal is used as it is.
const pending = (p: Record<string, any>) => p;
const POLICY = ['Synthetic federal KYC policy', 'Each customer must give a taxpayer identification number.'].join('\n');
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };

describe('KYC Judgment v1 integration test project (test-only)', () => {
  let app: FastifyInstance;
  let storage: MemoryStorage;
  let admin: string;
  let v8: string;
  const ADMIN = 'admin@test.local';
  const api = () => ({
    post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: admin, ...idem() }, payload: payload as object }),
    put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie: admin, ...idem() }, payload: payload as object }),
    get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: admin } }),
  });

  beforeAll(async () => {
    storage = new MemoryStorage();
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage });
  });
  beforeEach(async () => {
    await resetDb();
    await seed(db, { SEED_ADMIN_EMAIL: ADMIN, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, ADMIN, 'admin-password-123');
    expect((await api().post('/api-clients', { name: 'Studio', kind: 'ANVIL' })).statusCode).toBe(201);
    // A stand-in for the v8 project: the federal document and an approved rule set citing it.
    const owner = await db.user.findFirstOrThrow({ where: { email: ADMIN } });
    const domain = await db.domain.create({ data: { clientId: owner.clientId, name: 'KYC old' } });
    const t = await db.template.create({ data: { clientId: owner.clientId, domainId: domain.id, lineageId: crypto.randomUUID(), workflowName: 'KYC old' } });
    v8 = (await db.project.create({ data: { clientId: owner.clientId, ownerId: owner.id, templateId: t.id, templateVersion: 1, name: 'v8' } })).id;
    const d = await api().post(`/projects/${v8}/policy/documents/text`, { title: 'Synthetic federal KYC policy', text: POLICY, format: 'txt', granularity: 'line', jurisdiction: 'US' });
    const quote = POLICY.split('\n')[1]!;
    const r = await api().post(`/projects/${v8}/policy/rules`, { documentVersionId: d.json().version.id, ruleKey: 'TIN', body: { ...BASE, title: 'TIN', requirement: quote }, citations: [{ fieldPath: 'requirement', role: 'supports', quote }] });
    await api().put(`/projects/${v8}/policy/rules/${r.json().ruleId}/applied`, { applied: true, expectedContentHash: r.json().contentHash });
    expect((await api().post(`/projects/${v8}/policy/rule-set`, { expectedLatestVersion: null })).statusCode).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('an unused draft is retired (owner’s words as the reason) so a correctly identified proposal becomes the next version; nothing else is retired here', async () => {
    const first = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body: pending(structuredClone(PROPOSAL)) });
    const second = structuredClone(PROPOSAL);
    second.authoring.profile.profileId = 'kyc-judgment-v1-xcbc2brsxg-v1';
    second.requirement.studio_template_id = 'tpl_xcbc2brsxg';
    second.requirement.studio_version = 1;
    // While the first draft exists, the next version can't be stored.
    expect(await importTemplate(db, { requestedBy: ADMIN, file: '', apply: false, body: second })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('still a draft') });
    expect((await importTemplate(db, { requestedBy: ADMIN, file: '', apply: false, body: pending(structuredClone(PROPOSAL)) })).outcome).toBe('already_created');
    expect(await retireDraft(db, { requestedBy: ADMIN, templateId: first.templateId as string, reason: 'x', apply: true })).toMatchObject({ outcome: 'refused' });
    expect(await retireDraft(db, { requestedBy: ADMIN, templateId: first.templateId as string, reason: 'Owner: "Authoring may retire it"', apply: false })).toMatchObject({ outcome: 'would_create' });
    expect(await retireDraft(db, { requestedBy: ADMIN, templateId: first.templateId as string, reason: 'Owner: "Authoring may retire it"', apply: true })).toMatchObject({ outcome: 'created', status: 'RETIRED' });
    expect((await db.auditEvent.findFirstOrThrow({ where: { action: 'template.draft_retired' } })).after).toMatchObject({ reason: 'Owner: "Authoring may retire it"' });
    const next = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body: second });
    expect(next).toMatchObject({ outcome: 'created', version: 2, status: 'DRAFT' });
    expect((await db.template.findUniqueOrThrow({ where: { id: next.templateId as string } })).profileId).toBe('kyc-judgment-v1-xcbc2brsxg-v1');
    // A published version is never retired by this job.
    expect((await api().post(`/templates/${next.templateId as string}/publish`, {})).statusCode).toBe(200);
    expect(await retireDraft(db, { requestedBy: ADMIN, templateId: next.templateId as string, reason: 'Owner: "Authoring may retire it"', apply: true })).toMatchObject({ outcome: 'refused' });
  });

  it('a faulty test-only project is cancelled (owner’s words as the reason) and its tasks are left as they are; a real project never is; the next run makes a fresh one', async () => {
    const imported = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body: pending(structuredClone(PROPOSAL)) });
    expect((await api().post(`/templates/${imported.templateId as string}/publish`, {})).statusCode).toBe(200);
    const first = await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true });
    const id = first.projectId as string;
    // Stand-in for the faulty one made before the fix: still a draft.
    await db.project.update({ where: { id }, data: { status: 'DRAFT' } });
    const tasksBefore = await db.taskInstance.findMany({ where: { projectId: id }, orderBy: { id: 'asc' } });
    const reason = 'Owner: "Authoring may cancel it"';
    expect(await cancelTestProject(db, { requestedBy: ADMIN, projectId: id, reason: 'x', apply: true })).toMatchObject({ outcome: 'refused' });
    expect(await cancelTestProject(db, { requestedBy: ADMIN, projectId: v8, reason, apply: true })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('test-only') });
    expect(await cancelTestProject(db, { requestedBy: ADMIN, projectId: id, reason, apply: false })).toMatchObject({ outcome: 'would_create', status: 'DRAFT' });
    expect((await db.project.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
    expect(await cancelTestProject(db, { requestedBy: ADMIN, projectId: id, reason, apply: true })).toMatchObject({ outcome: 'created', status: 'CANCELLED' });
    expect(await cancelTestProject(db, { requestedBy: ADMIN, projectId: id, reason, apply: true })).toMatchObject({ outcome: 'already_created' });
    const ev = await db.auditEvent.findFirstOrThrow({ where: { action: 'project.cancelled', entityId: id } });
    expect(ev).toMatchObject({ actorType: 'SYSTEM', before: { status: 'DRAFT' }, after: { status: 'CANCELLED', reason } });
    expect(await db.taskInstance.findMany({ where: { projectId: id }, orderBy: { id: 'asc' } })).toEqual(tasksBefore);
    expect((await db.project.findUniqueOrThrow({ where: { id: v8 } })).status).not.toBe('CANCELLED');
    const next = await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true });
    expect(next).toMatchObject({ outcome: 'created', tasks: 1, name: `${TEST_PROJECT_NAME} — run 2` });
    expect(next.projectId).not.toBe(id);
    // The cancelled one keeps its name; a further run finds the live one.
    expect((await db.project.findUniqueOrThrow({ where: { id } })).name).toBe(TEST_PROJECT_NAME);
    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: false })).toMatchObject({ outcome: 'already_created', projectId: next.projectId });
  });

  it('cycle 2: the next Studio version (new decision not_eligible, new request types) imports as the next version, gets its own test project beside the earlier one, and its task follows the SOP', async () => {
    const v1 = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body: pending(structuredClone(PROPOSAL)) });
    expect((await api().post(`/templates/${v1.templateId as string}/publish`, {})).statusCode).toBe(200);
    const first = await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true });
    await createTestTask(db, { requestedBy: ADMIN, projectId: first.projectId as string, apply: true });

    const next = structuredClone(PROPOSAL);
    next.authoring.profile.profileId = 'kyc-judgment-v1-xcbc2brsxg-v2';
    next.requirement.studio_template_id = 'tpl_xcbc2brsxg';
    next.requirement.studio_version = 2;
    next.execution.output_schema.properties.recommendation.enum.push('not_eligible');
    const req = next.execution.tools.find((t: { id: string }) => t.id === 'information.request');
    req.input_schema.properties.type.enum.push('custodian_appointment', 'minor_birth_record');
    expect(await importTemplate(db, { requestedBy: ADMIN, file: '', apply: false, body: next })).toMatchObject({ outcome: 'would_create' });
    const v2 = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body: next });
    expect(v2).toMatchObject({ outcome: 'created', version: 2, status: 'DRAFT' });
    const t2 = await db.template.findUniqueOrThrow({ where: { id: v2.templateId as string } });
    expect(t2.lineageId).toBe((await db.template.findUniqueOrThrow({ where: { id: v1.templateId as string } })).lineageId);
    // The decision values and request types live in the execution part, which Authoring keeps exactly as Studio sent it.
    const stored = t2.anvilSpec as { execution: { output_schema: { properties: { recommendation: { enum: string[] } } }; tools: { id: string; input_schema: { properties: { type?: { enum: string[] } } } }[] } };
    expect(stored.execution.output_schema.properties.recommendation.enum).toContain('not_eligible');
    expect(stored.execution.tools.find((t) => t.id === 'information.request')!.input_schema.properties.type!.enum).toEqual(expect.arrayContaining(['custodian_appointment', 'minor_birth_record']));
    // Until v2 is published, the existing test project (on v1) is the one there.
    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: false })).toMatchObject({ outcome: 'already_created', projectId: first.projectId });
    expect((await api().post(`/templates/${t2.id}/publish`, {})).statusCode).toBe(200);

    // A new test project on v2, beside the v1 one (which is left as it is).
    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: false })).toMatchObject({ outcome: 'would_create', template: { id: t2.id, version: 2 }, name: `${TEST_PROJECT_NAME} — run 2` });
    const proj = await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true });
    expect(proj).toMatchObject({ outcome: 'created', tasks: 1 });
    expect(await db.project.findUniqueOrThrow({ where: { id: proj.projectId as string } })).toMatchObject({ templateId: t2.id, templateVersion: 2, testOnly: true, status: 'IN_PROGRESS' });
    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: false })).toMatchObject({ outcome: 'already_created', projectId: proj.projectId });
    expect((await db.project.findUniqueOrThrow({ where: { id: first.projectId as string } })).templateVersion).toBe(1);

    const made = await createTestTask(db, { requestedBy: ADMIN, projectId: proj.projectId as string, apply: true });
    expect(made, JSON.stringify(made)).toMatchObject({ outcome: 'created' });
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: made.taskId as string } });
    expect(task.status).toBe('SUBMITTED');
    const steps = (task.output as { sections: { S5: { steps: { tool: string; action: string }[] } } }).sections.S5.steps;
    // The SOP: every check the procedure needs, in order, stated as duties (never "if X, refer").
    const tools = steps.map((s) => s.tool);
    for (const t of ['application.read', 'policy.read', 'documents.list', 'document.read', 'document.check', 'document.compare', 'identity.check', 'address.check', 'screening.check', 'authority.check', 'operation.read', 'finding.write', 'information.request', 'specialist.refer', 'recommend']) expect(tools, t).toContain(t);
    expect(tools.indexOf('document.check')).toBeLessThan(tools.indexOf('identity.check'));
    expect(tools.at(-1)).toBe('recommend');
    for (const s of steps) expect(s.action).not.toMatch(/individual|adult joint|teen|custodial|CUTMA/i);
    // On this form S4 is a list of documents, so the task names the federal file: Validate warns (Haiku pilot, 25 Nov).
    expect(snapshotProblems(t2, task.output).map((p) => p.code)).toContain('POLICY_DOCUMENT_NAMED');
  });

  it('Haiku pilot (25 Nov): when the form’s S4 policy library is text, the task describes the library (read with policy.read by rule id) and names no document', () => {
    const profile = structuredClone(PROPOSAL.authoring.profile) as TemplateProfile & { sections: { key: string; fields: Record<string, unknown>[] }[] };
    const s4 = profile.sections.find((s) => s.key === 'S4')!;
    s4.fields = s4.fields.map((x) => (x.key === 'policyLibrary' ? { key: 'policyLibrary', type: 'long_text', label: 'Policy library in force', required: true, visibility: 'author_and_agent', help: 'Describe the bank’s policy library.' } : x));
    const template = { id: '00000000-0000-4000-8000-0000000000aa', version: 1, workflowName: 'KYC Judgment v1', profileId: profile.profileId, anvilSpec: { ...PROPOSAL, authoring: { ...PROPOSAL.authoring, profile } }, caseSelector: null } as unknown as Template;
    const doc = { documentId: 'de1b78fa-6c1e-4f8e-9d1a-0123456789ab', version: 1, title: '00-US-federal-KYC-policy.md' };
    const lib = syntheticSections(profile, template, doc).S4!.policyLibrary;
    expect(typeof lib).toBe('string');
    expect(lib).toMatch(/policy\.read/);
    expect(lib).toMatch(/rule id/);
    expect(lib).toMatch(/federal/);
    expect(lib).not.toContain(doc.title);
    expect(lib).not.toContain(doc.documentId.slice(0, 8));
    expect(lib).not.toMatch(/\.(md|pdf|docx?|txt)\b/i);
    // The old form (a list of documents) is written as before.
    const old = syntheticSections(PROPOSAL.authoring.profile as TemplateProfile, { ...template, anvilSpec: PROPOSAL } as unknown as Template, doc).S4!.policyLibrary;
    expect(old).toEqual([{ documentId: doc.documentId, documentVersion: 1, title: doc.title }]);
  });

  it('import → Admin publishes → test project (testOnly, federal document only) → one synthetic task submitted → the owner approves → export says test_only and the covered types', async () => {
    const body = pending(structuredClone(PROPOSAL));
    expect(await importTemplate(db, { requestedBy: ADMIN, file: '', apply: false, body })).toMatchObject({ outcome: 'would_create' });
    const imported = await importTemplate(db, { requestedBy: ADMIN, file: '', apply: true, body });
    expect(imported).toMatchObject({ outcome: 'created', status: 'DRAFT' });
    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('not published') });
    // The Admin's click: Templates → KYC Judgment v1 → Publish.
    expect((await api().post(`/templates/${imported.templateId as string}/publish`, {})).statusCode).toBe(200);

    expect(await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: false })).toMatchObject({ outcome: 'would_create', testOnly: true });
    const proj = await createTestProject(db, { storage }, { requestedBy: ADMIN, sourceProjectId: v8, apply: true });
    expect(proj).toMatchObject({ outcome: 'created', tasks: 1 });
    const p = await db.project.findUniqueOrThrow({ where: { id: proj.projectId as string } });
    expect(p).toMatchObject({ name: TEST_PROJECT_NAME, testOnly: true, distinctTarget: 1, status: 'IN_PROGRESS' });
    expect(await db.coverageSlot.count({ where: { projectId: p.id } })).toBe(1);
    // A live project: the export gate never refuses it as a draft.
    expect((await api().get(`/projects/${p.id}/rlgym-export`)).json().reason ?? '').not.toContain('draft');
    expect(await db.policyRule.count({ where: { projectId: p.id } })).toBe(0);
    expect((await db.policyDocumentVersion.findMany({ where: { projectId: p.id } })).length).toBe(1);

    const dry = await createTestTask(db, { requestedBy: ADMIN, projectId: p.id, apply: false });
    expect(dry, JSON.stringify(dry)).toMatchObject({ outcome: 'would_create' });
    const made = await createTestTask(db, { requestedBy: ADMIN, projectId: p.id, apply: true });
    expect(made).toMatchObject({ outcome: 'created' });
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: made.taskId as string } });
    expect(task.status).toBe('SUBMITTED');
    expect(await createTestTask(db, { requestedBy: ADMIN, projectId: p.id, apply: true })).toMatchObject({ outcome: 'already_created' });
    expect(await db.approvedTaskRecord.count({ where: { projectId: p.id } })).toBe(0);
    // Never on a real project.
    expect(await createTestTask(db, { requestedBy: ADMIN, projectId: v8, apply: true })).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('test-only') });

    // The owner's click: the task's review page → Approve (the console's review flow is on in the dev stack).
    expect((await api().put('/admin/forge-settings', { newFlow: true })).statusCode).toBe(200);
    const view = (await api().get(`/projects/${p.id}/tasks/${task.id}`)).json();
    const approved = await api().post(`/projects/${p.id}/tasks/${task.id}/decision`, { decision: 'APPROVE', expectedVersion: view.expectedVersion ?? 1, expectedRevision: view.expectedRevision ?? task.revision, checklist: Object.fromEntries(['realistic', 'correct', 'coversSlot', 'difficultyFair', 'distinct', 'rubricCatches'].map((k) => [k, true])) });
    expect(approved.statusCode, approved.body).toBe(200);
    const rec = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: task.id } });
    expect((rec.output as { sections: { S1: { coveredApplicationTypes: string[] } } }).sections.S1.coveredApplicationTypes).toEqual(['individual', 'adult_joint', 'teen_joint', 'custodial']);
    // The RL Gym export: test_only at the top, and the one task's covered types as a list.
    const pt = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    const built = await db.$transaction((tx) => buildRlGymExport(tx, pt, [rec], { id: 'tpl_kyc_judgment_test', version: 1, specSha256: 'c'.repeat(64) }, { exported: false, policyIdMap: null }));
    expect(built.notSent).toEqual([]);
    expect(built.body.test_only).toBe(true);
    expect((built.body.tasks as { case_selector: unknown }[])[0]!.case_selector).toEqual({ application_types: ['individual', 'adult_joint', 'teen_joint', 'custodial'], edge_cases: [] });
  });
});
