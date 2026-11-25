import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { buildRlGymExport } from '../src/anvil/rlgym-export';
import { createTestProject, createTestTask, importTemplate, TEST_PROJECT_NAME } from '../src/jobs/kyc-judgment-test-project';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1 end-to-end integration (coordinator, 25 Nov 2026): import the template, create the test-only project
 * with only the federal document, create ONE synthetic task covering all four types and submit it; a person (the owner,
 * as Admin) approves it through the console's decision route. Nothing in the job approves anything. The proposal is
 * Studio's, with the changes still pending at Studio applied (see kyc-judgment-import.test.ts) plus the 6th: S4
 * expectedRules is optional (coordinator: advisory). Mocks only.
 */
const PROPOSAL = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-v1.proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const pending = (p: Record<string, any>) => {
  p.authoring.template.defaultTptMinutes ??= 60;
  const fix = (f: Record<string, any>) => {
    f.help ??= f.label;
    delete f.default;
    for (const x of f.itemFields ?? []) fix(x);
  };
  for (const sec of p.authoring.profile.sections) for (const f of sec.fields) fix(f);
  p.authoring.profile.exportCapabilities ??= { formats: ['praxis.authored-task-export.v2'], executable: false, blockers: ['Exact published template and RL Gym qualification required'] };
  for (const sec of p.authoring.profile.sections) for (const f of sec.fields) if (f.type === 'criterion') delete f.itemFields;
  // 6th (coordinator, 25 Nov): expectedRules is advisory, so optional.
  for (const sec of p.authoring.profile.sections) for (const f of sec.fields) if (f.key === 'expectedRules') f.required = false;
  return p;
};
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
    expect(p).toMatchObject({ name: TEST_PROJECT_NAME, testOnly: true, distinctTarget: 1 });
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
