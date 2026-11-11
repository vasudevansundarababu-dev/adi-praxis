import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { PRAXIS_STAGED_EXAMPLE, PRAXIS_SYNTHETIC_EXAMPLE, ProjectPolicyManifest, validateProjectPolicyManifest } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { appendRecord } from '../src/dataset/approved-records';
import { policySeed, SEED_PREFIX, SEED_PROJECTS } from '../src/jobs/policy-seed';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';

/** Anvil project policy manifest v1: emitter, validation, source bytes, authorisation and audit (real database). */
const SECRET = 'test-mock-secret';
let app: FastifyInstance;
const storage = new MemoryStorage();
let clientId: string;
let pmId: string;
let pmCookie: string;
let adminCookie: string;
let candidateId: string;

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, google: new MockGoogleVerifier(SECRET), identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  storage.objects.clear();
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  pmId = pm.id;
  pmCookie = await login(app, pm.email);
  adminCookie = await login(app, (await createUser(clientId, ['ADMIN'])).email);
  const domain = await db.domain.create({ data: { clientId, name: 'Seeded' } });
  for (const sp of SEED_PROJECTS) await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: sp.workflow, status: 'PUBLISHED' } });
  await policySeed(db, { storage, appEnv: 'local', clientId, ownerId: pmId });
  candidateId = (await db.candidate.create({ data: { clientId, smeUserId: (await db.smeUser.create({ data: { clientId, displayName: 'Synthetic author' } })).id, country: 'GB' } })).id;
});

const seedProject = (name: string) => db.project.findFirstOrThrow({ where: { clientId, name: `${SEED_PREFIX}${name}` } });
const url = (projectId: string, suffix = '') => `/api/v1/projects/${projectId}/anvil/project-policy${suffix}`;
const get = (path: string, headers: Record<string, string> = { cookie: adminCookie }) => app.inject({ method: 'GET', url: path, headers });

/** An approved record carrying an executable contract, approved after a submission frozen with `snapshotId`. */
async function approve(task: { id: string; projectId: string }, contract: object, snapshotId: string | null) {
  const project = await db.project.findUniqueOrThrow({ where: { id: task.projectId } });
  const submittedAt = new Date(Date.now() - 60_000);
  const output = { header: { title: 'Synthetic decision' }, body: 'Synthetic fixture; no customer data.', praxisContract: structuredClone(contract) };
  await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output, policySnapshotId: snapshotId, submittedAt } });
  return db.$transaction((tx) =>
    appendRecord(tx, {
      schemaVersion: 1, supersedesId: null, taskInstanceId: task.id, taskMode: 'AUTHORING', input: {}, output, activeSeconds: 60, submittedAt,
      slotId: null, coverageTags: null, isOpenSlot: false, nearestDuplicateId: null, nearestDuplicateScore: null, authorTaskIndex: null,
      inputSource: null, inputBatchId: null, uploadedById: null, apiClientId: null, candidateId, identityRef: null, projectAssignmentId: null,
      qualificationSnapshot: null, reviewerId: pmId, reviewDecisionAt: new Date(), reviewNotes: null, reworkCount: 0, duplicateDecision: null,
      clientId, projectId: project.id, templateId: project.templateId, templateVersion: project.templateVersion, workflow: 'KYC onboarding and refresh', domain: 'Banking', provenance: null,
      jdSnapshotId: null, workerTermsVersion: null,
    }),
  );
}

async function kycWithRecords() {
  const project = await seedProject('KYC onboarding and refresh');
  const tasks = await db.taskInstance.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
  const snaps = await Promise.all(tasks.map((t) => db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: t.id } })));
  const r1 = await approve(tasks[0]!, PRAXIS_SYNTHETIC_EXAMPLE, snaps[0]!.id);
  const r2 = await approve(tasks[1]!, PRAXIS_STAGED_EXAMPLE, snaps[1]!.id);
  return { project, tasks, records: [r1, r2] };
}

/** Downloads the manifest, every source and every envelope, and validates all of it with the shared validator. */
async function fetchAll(projectId: string, recordIds: string[], headers?: Record<string, string>) {
  const res = await get(url(projectId), headers);
  expect(res.statusCode, res.body).toBe(200);
  const manifest = ProjectPolicyManifest.parse(res.json());
  const sources = new Map<string, Uint8Array>();
  for (const s of manifest.sources) {
    const src = await get(url(projectId, `/sources/${s.path}`), headers);
    expect(src.statusCode, src.body).toBe(200);
    sources.set(s.path, new Uint8Array(src.rawPayload));
    expect(src.headers['x-praxis-source-sha256']).toBe(s.sha256);
    expect(src.headers['content-type']).toContain(s.media_type);
  }
  const envelopes = await Promise.all(recordIds.map(async (id) => (await get(`/api/v1/dataset/records/${id}/praxis-contract?envelope=true`)).json()));
  return { res, manifest, sources, envelopes, problems: validateProjectPolicyManifest(new Uint8Array(res.rawPayload), sources, { exports: envelopes }) };
}

describe('GET /projects/:id/anvil/project-policy', () => {
  it('exports a valid manifest for a published rule set and approved KYC records, bound byte for byte to their envelopes', async () => {
    const { project, records } = await kycWithRecords();
    const { res, manifest, sources, envelopes, problems } = await fetchAll(project.id, records.map((r) => r.id));
    expect(problems).toEqual([]);
    expect(res.headers['x-praxis-schema-version']).toBe('praxis.anvil.project_policy.v1');
    expect(res.headers['x-praxis-manifest-sha256']).toBe(createHash('sha256').update(res.rawPayload).digest('hex'));

    const doc = await db.policyDocumentVersion.findFirstOrThrow({ where: { projectId: project.id } });
    const set = await db.projectRuleSet.findFirstOrThrow({ where: { projectId: project.id } });
    const ref = { policy_id: doc.documentId, version: `rs${set.version}.d${doc.version}` };
    expect(manifest.source_project).toMatchObject({ id: project.id, name: project.name });
    expect(manifest.source_project.version).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.project_default_policy_refs).toEqual([ref]);
    expect(manifest.sources).toEqual([{ id: doc.id, path: `policies/${doc.documentId}/v${doc.version}.md`, media_type: 'text/markdown', size_bytes: doc.sizeBytes, sha256: doc.sha256 }]);
    expect(Buffer.from(sources.get(manifest.sources[0]!.path)!).equals(storage.objects.get(doc.storageKey)!.data)).toBe(true);
    expect(manifest.policies).toHaveLength(1);
    expect(manifest.policies[0]).toMatchObject({ ...ref, title: 'KYC onboarding checklist (fictional)', source_id: doc.id });
    expect(manifest.policies[0]!.rules.map((r) => [r.rule_id, r.severity, r.visibility])).toEqual([
      ['R-address_recency', 'high', 'agent_instruction'], ['R-high_risk_refresh', 'high', 'agent_instruction'], ['R-screen_before_open', 'high', 'agent_instruction'],
    ]);
    expect(manifest.policies[0]!.rules[0]).toMatchObject({ requirement: 'Proof of address is dated within the last three months.', source_location: expect.stringMatching(/^document version 1: /) });

    expect(manifest.task_bindings).toHaveLength(2);
    for (const [i, b] of manifest.task_bindings.entries()) {
      expect(b.payload_sha256).toBe(envelopes[i].payload_sha256);
      expect(b).toMatchObject({ policy_refs: [ref], excluded_project_policy_refs: [] });
    }
    expect(manifest.task_bindings.map((b) => [b.task_id, b.task_version])).toEqual([[PRAXIS_SYNTHETIC_EXAMPLE.task_id, PRAXIS_SYNTHETIC_EXAMPLE.task_version], [PRAXIS_STAGED_EXAMPLE.task_id, PRAXIS_STAGED_EXAMPLE.task_version]]);

    // Deterministic and read-only: the same state gives the same bytes, and only audit events were written.
    const before = await db.approvedTaskRecord.count();
    const again = await get(url(project.id));
    expect(again.rawPayload.equals(res.rawPayload)).toBe(true);
    expect(await db.approvedTaskRecord.count()).toBe(before);
    const events = await db.auditEvent.findMany({ where: { entityId: project.id, action: { startsWith: 'anvil.' } } });
    expect(events.filter((e) => e.action === 'anvil.project_policy_exported')).toHaveLength(2);
    expect(events.filter((e) => e.action === 'anvil.project_policy_source_downloaded')).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', clientId });
  });

  it('maps evaluator-only rules and binds a task frozen under an older rule set with explicit exclusions', async () => {
    const project = await seedProject('KYB and beneficial ownership');
    const [t1] = await db.taskInstance.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
    const snap = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: t1!.id } });
    const record = await approve(t1!, PRAXIS_SYNTHETIC_EXAMPLE, snap.id);
    const v1 = await db.projectRuleSet.findFirstOrThrow({ where: { projectId: project.id } });
    const content = v1.content as { rules: Array<{ ruleKey: string }> };
    const v2Content = { ...content, rules: content.rules.filter((r) => r.ruleKey !== 'R-no_identity_numbers') };
    await db.projectRuleSet.create({ data: { clientId, projectId: project.id, version: 2, ruleVersionIds: [], content: v2Content as Prisma.InputJsonValue, digest: 'x'.repeat(64), publishedById: pmId } });

    const { manifest, problems } = await fetchAll(project.id, [record.id]);
    expect(problems).toEqual([]);
    const doc = await db.policyDocumentVersion.findFirstOrThrow({ where: { projectId: project.id } });
    const old = { policy_id: doc.documentId, version: 'rs1.d1' };
    const current = { policy_id: doc.documentId, version: 'rs2.d1' };
    expect(manifest.project_default_policy_refs).toEqual([current]);
    expect(manifest.policies.map((p) => [p.version, p.rules.length])).toEqual([['rs1.d1', 3], ['rs2.d1', 2]]);
    expect(manifest.task_bindings[0]).toMatchObject({ policy_refs: [old], excluded_project_policy_refs: [current] });
    const vis = Object.fromEntries(manifest.policies[0]!.rules.map((r) => [r.rule_id, r.visibility]));
    expect(vis).toEqual({ 'R-no_auto_approval': 'agent_instruction', 'R-no_identity_numbers': 'agent_instruction', 'R-ubo_25': 'evaluator_only' });
  });

  it('a project with no policies yields a valid manifest with empty arrays; its tasks bind to nothing', async () => {
    const tpl = await db.template.findFirstOrThrow({ where: { clientId } });
    const project = await db.project.create({ data: { clientId, ownerId: pmId, templateId: tpl.id, templateVersion: 1, name: 'No policy project' } });
    const empty = await fetchAll(project.id, []);
    expect(empty.problems).toEqual([]);
    expect(empty.manifest).toMatchObject({ project_default_policy_refs: [], sources: [], policies: [], task_bindings: [] });

    const task = await db.taskInstance.create({ data: { clientId, projectId: project.id, taskType: 'AUTHORING' } });
    const record = await approve(task, PRAXIS_SYNTHETIC_EXAMPLE, null);
    const one = await fetchAll(project.id, [record.id]);
    expect(one.problems).toEqual([]);
    expect(one.manifest.task_bindings).toEqual([{ task_id: PRAXIS_SYNTHETIC_EXAMPLE.task_id, task_version: PRAXIS_SYNTHETIC_EXAMPLE.task_version, payload_sha256: one.envelopes[0].payload_sha256, policy_refs: [], excluded_project_policy_refs: [] }]);
    expect(one.manifest.source_project.version).not.toBe(empty.manifest.source_project.version);
  });

  it('authorises like the praxis-contract export plus the owning PM: others get 401, 403 or 404', async () => {
    const { project, records } = await kycWithRecords();
    expect((await fetchAll(project.id, records.map((r) => r.id), { cookie: pmCookie })).problems).toEqual([]);
    const key = `pk_${randomUUID()}${randomUUID()}`;
    const rl = await db.apiClient.create({ data: { clientId, name: 'RL Gym', kind: 'RL_GYM', keyHash: createHash('sha256').update(key).digest('hex') } });
    const asRl = await get(url(project.id), { authorization: `Bearer ${key}` });
    expect(asRl.statusCode, asRl.body).toBe(200);
    expect(await db.auditEvent.count({ where: { action: 'anvil.project_policy_exported', actorType: 'SERVICE', actorId: rl.id } })).toBe(1);
    const path = asRl.json().sources[0].path;
    expect((await get(url(project.id, `/sources/${path}`), { authorization: `Bearer ${key}` })).statusCode).toBe(200);

    const otherKey = `pk_${randomUUID()}${randomUUID()}`;
    await db.apiClient.create({ data: { clientId, name: 'Client API', kind: 'CLIENT_API', keyHash: createHash('sha256').update(otherKey).digest('hex') } });
    expect((await get(url(project.id), { authorization: `Bearer ${otherKey}` })).statusCode).toBe(403);
    expect((await get(url(project.id), {})).statusCode).toBe(401);
    const reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await get(url(project.id), { cookie: reviewer })).statusCode).toBe(403);
    const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await get(url(project.id), { cookie: otherPm })).statusCode).toBe(404);
    expect((await get(url(project.id, `/sources/${path}`), { cookie: otherPm })).statusCode).toBe(404);
    const outsider = await db.client.create({ data: { name: `Other tenant ${randomUUID()}` } });
    const foreignAdmin = await login(app, (await createUser(outsider.id, ['ADMIN'])).email);
    expect((await get(url(project.id), { cookie: foreignAdmin })).statusCode).toBe(404);
    const foreignKey = `pk_${randomUUID()}${randomUUID()}`;
    await db.apiClient.create({ data: { clientId: outsider.id, name: 'Foreign RL', kind: 'RL_GYM', keyHash: createHash('sha256').update(foreignKey).digest('hex') } });
    expect((await get(url(project.id), { authorization: `Bearer ${foreignKey}` })).statusCode).toBe(404);
    expect((await get(url(randomUUID()))).statusCode).toBe(404);
  });

  it('serves only sources declared in the manifest', async () => {
    const { project } = await kycWithRecords();
    for (const p of ['policies/../x.md', 'policies/nope.md', '.env']) expect((await get(url(project.id, `/sources/${p}`))).statusCode, p).toBe(404);
  });

  it('refuses with 409 and the problem codes when stored source bytes no longer match', async () => {
    const { project } = await kycWithRecords();
    const doc = await db.policyDocumentVersion.findFirstOrThrow({ where: { projectId: project.id } });
    storage.objects.set(doc.storageKey, { data: Buffer.from('tampered'), contentType: 'text/markdown' });
    const res = await get(url(project.id));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROJECT_POLICY_INVALID' });
    const codes = res.json().details.problems.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['SOURCE_SIZE_MISMATCH', 'SOURCE_SHA256_MISMATCH']));
    expect((await get(url(project.id, `/sources/policies/${doc.documentId}/v1.md`))).statusCode).toBe(409);
    const blocked = await db.auditEvent.findFirstOrThrow({ where: { entityId: project.id, action: 'anvil.project_policy_blocked' } });
    expect((blocked.after as { codes: string[] }).codes).toEqual(expect.arrayContaining(['SOURCE_SHA256_MISMATCH']));
    expect(await db.auditEvent.count({ where: { action: 'anvil.project_policy_exported' } })).toBe(0);
  });

  it('refuses a task whose frozen policy has an exemption, and duplicate task id+version', async () => {
    const project = await seedProject('KYC onboarding and refresh');
    const [t1, t2] = await db.taskInstance.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
    const snap = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: t1!.id } });
    const content = snap.content as { task_changes: unknown[]; rules: Array<{ rule_version_id: string }> };
    const exempt = await db.taskPolicySnapshot.create({ data: { clientId, taskInstanceId: t1!.id, version: snap.version + 1, ruleSetId: snap.ruleSetId, rubricVersion: snap.rubricVersion, digest: 'e'.repeat(64), publishedById: pmId, content: { ...content, task_changes: [{ id: randomUUID(), rule_version_id: content.rules[0]!.rule_version_id, type: 'EXEMPTION', requirement: 'x', scope: {}, reason: 'x', source_citation_id: null, exception_index: 0 }] } as Prisma.InputJsonValue } });
    await approve(t1!, PRAXIS_SYNTHETIC_EXAMPLE, exempt.id);
    await approve(t2!, PRAXIS_SYNTHETIC_EXAMPLE, null);
    const res = await get(url(project.id));
    expect(res.statusCode).toBe(409);
    expect(res.json().details.problems.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['TASK_EXEMPTION_NOT_REPRESENTABLE', 'DUPLICATE_TASK_BINDING']));
  });

  it('a corrected record is exported once, as its latest version', async () => {
    const { project, records } = await kycWithRecords();
    const corrected = structuredClone(PRAXIS_SYNTHETIC_EXAMPLE);
    corrected.title = 'Revised synthetic decision title';
    corrected.task_version = '9.0.0';
    corrected.revision_id = 'corrected-revision';
    corrected.provenance.review.reviewed_revision_id = 'corrected-revision';
    const prev = records[0]!;
    const res = await app.inject({ method: 'POST', url: `/api/v1/dataset/records/${prev.id}/corrections`, headers: { cookie: adminCookie, 'idempotency-key': randomUUID() }, payload: { reason: 'Update synthetic example', output: { ...(prev.output as object), praxisContract: corrected } } });
    expect(res.statusCode, res.body).toBe(201);
    const { manifest, problems } = await fetchAll(project.id, [res.json().id, records[1]!.id]);
    expect(problems).toEqual([]);
    expect(manifest.task_bindings.map((b) => `${b.task_id}@${b.task_version}`).sort()).toEqual([`${PRAXIS_STAGED_EXAMPLE.task_id}@${PRAXIS_STAGED_EXAMPLE.task_version}`, `${PRAXIS_SYNTHETIC_EXAMPLE.task_id}@9.0.0`].sort());
  });

  it('both routes are in the generated OpenAPI document', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    const paths = Object.keys(doc.paths).filter((p) => p.includes('/anvil/project-policy'));
    expect(paths.sort()).toEqual(['/api/v1/projects/{id}/anvil/project-policy', expect.stringMatching(/^\/api\/v1\/projects\/\{id\}\/anvil\/project-policy\/sources\//)]);
    for (const p of paths) expect(doc.paths[p].get.security).toEqual([{ session: [] }, { serviceToken: [] }]);
  });
});
