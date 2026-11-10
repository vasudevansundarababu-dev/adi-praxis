import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { appendRecord } from '../src/dataset/approved-records';
import { policySeed, SEED_ACTOR, SEED_PREFIX, SEED_PROJECTS } from '../src/jobs/policy-seed';
import { previewRuleSet } from '../src/policy/rule-sets';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';

/** Seed (OD7, AC19, OD6), SME read-only view (OD9) and the export sidecar (AC11, AC16, A09). No provider is involved. */
const SECRET = 'test-mock-secret';
let app: FastifyInstance;
const storage = new MemoryStorage();
const google = new MockGoogleVerifier(SECRET);
let clientId: string;
let pmId: string;
let adminCookie: string;

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId });
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
  adminCookie = await login(app, (await createUser(clientId, ['ADMIN'])).email);
  const domain = await db.domain.create({ data: { clientId, name: 'Seeded' } });
  for (const sp of SEED_PROJECTS) await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: sp.workflow, status: 'PUBLISHED' } });
});

const runSeed = (appEnv = 'local') => policySeed(db, { storage, appEnv, clientId, ownerId: pmId });

describe('policy seed (OD7, AC19, OD6, PR-S05)', () => {
  it('creates 5 projects with 2 draft tasks, a published set each and one unpublished conflict; a second run creates nothing', async () => {
    const first = await runSeed();
    expect(first.created).toHaveLength(5);
    const projects = await db.project.findMany({ where: { clientId }, include: { tasks: true } });
    expect(projects).toHaveLength(5);
    for (const p of projects) {
      expect(p.name.startsWith(SEED_PREFIX)).toBe(true);
      expect(p.tasks).toHaveLength(2);
      expect(p.tasks.every((t) => t.status === 'CREATED' && t.assignedToId === null)).toBe(true);
      expect(await db.projectRuleSet.count({ where: { projectId: p.id } })).toBe(1);
      expect(await db.taskPolicySnapshot.count({ where: { taskInstanceId: { in: p.tasks.map((t) => t.id) } } })).toBe(2);
      expect(await db.taskPolicyChange.count({ where: { taskInstanceId: { in: p.tasks.map((t) => t.id) } } })).toBe(1);
    }
    const blocked = await Promise.all(projects.map(async (p) => ({ name: p.name, preview: await previewRuleSet(db, clientId, p.id) })));
    const withConflict = blocked.filter((b) => b.preview.conflicts.length > 0);
    expect(withConflict.map((b) => b.name)).toEqual([`${SEED_PREFIX}Phone launch`]);
    expect(withConflict[0]!.preview.conflicts[0]!.kind).toBe('same_rule_id_different_content');

    const counts = async () => ({ p: await db.project.count(), r: await db.policyRuleVersion.count(), s: await db.projectRuleSet.count(), t: await db.taskInstance.count(), snap: await db.taskPolicySnapshot.count(), d: await db.policyDocumentVersion.count() });
    const before = await counts();
    const second = await runSeed();
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(5);
    expect(await counts()).toEqual(before);
  });

  it('refuses production', async () => {
    await expect(runSeed('production')).rejects.toThrow(/production/);
    expect(await db.project.count()).toBe(0);
  });

  it('labels everything as a fixture: SEED documents, rules reviewed by the seed actor, no reviews or people invented, no Healthcare', async () => {
    await runSeed();
    const docs = await db.policyDocumentVersion.findMany();
    expect(docs.every((d) => d.origin === 'SEED')).toBe(true);
    const reviewed = await db.policyRuleVersion.findMany({ where: { state: 'REVIEWED' } });
    expect(reviewed.length).toBeGreaterThanOrEqual(15);
    expect(reviewed.every((v) => v.reviewedById === SEED_ACTOR && v.editedById === SEED_ACTOR)).toBe(true);
    expect(await db.taskReview.count()).toBe(0);
    expect(await db.taskSubmission.count()).toBe(0);
    expect(JSON.stringify(SEED_PROJECTS).toLowerCase()).not.toContain('healthcare');
    // Blueprint hard-fail invariant IDs are kept as the source rule ID (PR-S02); Praxis keys add the usual R- prefix.
    const keys = (await db.policyRule.findMany({ select: { sourceKey: true } })).map((r) => r.sourceKey);
    expect(keys).toEqual(expect.arrayContaining(['weekly_spend_cap', 'no_unsubstantiated_claims', 'no_auto_approval', 'no_identity_numbers', 'no_tipping_off', 'no_customer_exit']));
  });

  it('every seeded rule resolves to the exact document version and hash it quotes (AC05)', async () => {
    await runSeed();
    const snaps = await db.taskPolicySnapshot.findMany();
    for (const s of snaps) {
      const rules = (s.content as { rules: Array<{ sources: Array<{ document_version_id: string; sha256: string; quote: string }> }> }).rules;
      for (const src of rules.flatMap((r) => r.sources)) {
        const v = await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: src.document_version_id } });
        expect(v.sha256).toBe(src.sha256);
      }
    }
  });

  it('skips a project whose template is missing and says so', async () => {
    await db.template.updateMany({ where: { workflowName: 'KYC onboarding and refresh' }, data: { status: 'RETIRED' } });
    const r = await runSeed();
    expect(r.missingTemplates).toEqual(['KYC onboarding and refresh']);
    expect(r.created).toHaveLength(4);
  });
});

describe('SME read-only rules (OD9)', () => {
  async function expert() {
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYB'], skills: ['KYB'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London' } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, candidateId: c.id };
  }
  const kybTask = async () => {
    const p = await db.project.findFirstOrThrow({ where: { name: `${SEED_PREFIX}KYB and beneficial ownership` } });
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id }, select: { id: true } });
    const change = await db.taskPolicyChange.findFirstOrThrow({ where: { taskInstanceId: { in: tasks.map((t) => t.id) } } });
    return db.taskInstance.findUniqueOrThrow({ where: { id: change.taskInstanceId } });
  };

  it('the assigned SME sees agent-visible rules only, without changes on evaluator-only rules, and has no write route', async () => {
    await runSeed();
    const me = await expert();
    const t = await kybTask();
    await db.taskInstance.update({ where: { id: t.id }, data: { assignedToId: me.candidateId, status: 'ASSIGNED' } });
    const r = await app.inject({ method: 'GET', url: `/api/v1/me/tasks/${t.id}/policy`, headers: { cookie: me.cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.readOnly).toBe(true);
    expect(body.rules.map((x: { rule_key: string }) => x.rule_key).sort()).toEqual(['R-no_auto_approval', 'R-no_identity_numbers']);
    expect(body.rules.every((x: { visibility: string }) => x.visibility === 'agent_visible')).toBe(true);
    // The seeded change is on ubo_25, which is evaluator-only.
    expect(body.task_changes).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('25% or more');
    const write = await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${t.id}/policy`, headers: { cookie: me.cookie, 'idempotency-key': randomUUID() }, payload: {} });
    expect([404, 405]).toContain(write.statusCode);
  });

  it('another SME cannot read it', async () => {
    await runSeed();
    const owner = await expert();
    const stranger = await expert();
    const t = await kybTask();
    await db.taskInstance.update({ where: { id: t.id }, data: { assignedToId: owner.candidateId, status: 'ASSIGNED' } });
    const r = await app.inject({ method: 'GET', url: `/api/v1/me/tasks/${t.id}/policy`, headers: { cookie: stranger.cookie } });
    expect(r.statusCode).toBe(404);
  });

  it('a task without policy says so instead of inventing rules (AC16)', async () => {
    const me = await expert();
    const tpl = await db.template.findFirstOrThrow({ where: { clientId } });
    const p = await db.project.create({ data: { clientId, ownerId: pmId, templateId: tpl.id, templateVersion: 1, name: 'Legacy' } });
    const t = await db.taskInstance.create({ data: { clientId, projectId: p.id, taskType: 'AUTHORING', assignedToId: me.candidateId, status: 'ASSIGNED' } });
    const r = await app.inject({ method: 'GET', url: `/api/v1/me/tasks/${t.id}/policy`, headers: { cookie: me.cookie } });
    expect(r.json()).toEqual({ configured: false, readOnly: true, rules: [], task_changes: [] });
  });
});

describe('export sidecar (AC11, AC16, A09)', () => {
  async function approvedRecord(task: { id: string; projectId: string }, candidateId: string, withSnapshot: boolean) {
    const project = await db.project.findUniqueOrThrow({ where: { id: task.projectId } });
    const snap = withSnapshot ? await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: task.id } }) : null;
    const submittedAt = new Date(Date.now() - 60_000);
    await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: { a: 1 }, policySnapshotId: snap?.id ?? null, submittedAt } });
    return db.$transaction((tx) =>
      appendRecord(tx, {
        schemaVersion: 1, supersedesId: null, taskInstanceId: task.id, taskMode: 'AUTHORING', input: {}, output: { a: 1 }, activeSeconds: 60, submittedAt,
        slotId: null, coverageTags: null, isOpenSlot: false, nearestDuplicateId: null, nearestDuplicateScore: null, authorTaskIndex: null,
        inputSource: null, inputBatchId: null, uploadedById: null, apiClientId: null, candidateId, identityRef: null, projectAssignmentId: null,
        qualificationSnapshot: null, reviewerId: pmId, reviewDecisionAt: new Date(), reviewNotes: null, reworkCount: 0, duplicateDecision: null,
        clientId, projectId: project.id, templateId: project.templateId, templateVersion: project.templateVersion, workflow: 'x', domain: 'y', provenance: null,
        jdSnapshotId: null, workerTermsVersion: null,
      }),
    );
  }

  it('dataset export carries the frozen snapshot for a policy task and leaves a legacy task unchanged', async () => {
    await runSeed();
    const cand = await db.candidate.create({ data: { clientId, smeUserId: (await db.smeUser.create({ data: { clientId, displayName: 'X' } })).id, country: 'GB' } });
    const pTask = await db.taskInstance.findFirstOrThrow({ where: { project: { name: `${SEED_PREFIX}Phone launch` } } });
    const tpl = await db.template.findFirstOrThrow({ where: { clientId } });
    const legacyProject = await db.project.create({ data: { clientId, ownerId: pmId, templateId: tpl.id, templateVersion: 1, name: 'Legacy' } });
    const lTask = await db.taskInstance.create({ data: { clientId, projectId: legacyProject.id, taskType: 'AUTHORING' } });
    await approvedRecord(pTask, cand.id, true);
    await approvedRecord(lTask, cand.id, false);

    const frozen = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: pTask.id } });

    const r = await app.inject({ method: 'GET', url: '/api/v1/dataset/export', headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    const rows = r.body.trim().split('\n').map((l) => JSON.parse(l));
    const policyRow = rows.find((x) => x.taskInstanceId === pTask.id);
    const legacyRow = rows.find((x) => x.taskInstanceId === lTask.id);
    expect(policyRow.policy).toMatchObject({ snapshot_id: frozen.id, digest: frozen.digest, task_id: pTask.id });
    expect(policyRow.policy.rules.length).toBeGreaterThan(0);
    expect(Object.hasOwn(legacyRow, 'policy')).toBe(false);
  });

  it('the sidecar matches contracts/praxis/policy-snapshot.schema.json (keys and closed objects)', async () => {
    await runSeed();
    const schema = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../contracts/praxis/policy-snapshot.schema.json'), 'utf8'));
    const snap = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: { in: (await db.taskPolicyChange.findMany()).map((c) => c.taskInstanceId) } } });
    const { sidecar } = await import('../src/policy/task-policy');
    const out = sidecar(snap) as unknown as Record<string, unknown>;
    const closed = (obj: Record<string, unknown>, def: { required: string[]; properties: Record<string, unknown>; additionalProperties?: boolean }, where: string) => {
      for (const k of def.required) expect(Object.hasOwn(obj, k), `${where}.${k} missing`).toBe(true);
      if (def.additionalProperties === false) for (const k of Object.keys(obj)) expect(Object.hasOwn(def.properties, k), `${where}.${k} not in schema`).toBe(true);
    };
    closed(out, schema, 'sidecar');
    expect(out.schema_version).toBe(schema.properties.schema_version.const);
    closed(out.project_rule_set as Record<string, unknown>, schema.properties.project_rule_set, 'project_rule_set');
    const rules = out.rules as Array<Record<string, unknown>>;
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      closed(r, schema.$defs.Rule, 'rule');
      for (const src of r.sources as Array<Record<string, unknown>>) closed(src, schema.$defs.Rule.properties.sources.items, 'source');
    }
    const changes = out.task_changes as Array<Record<string, unknown>>;
    expect(changes).toHaveLength(1);
    closed(changes[0]!, schema.$defs.TaskChange, 'task_change');
    expect(out.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('studio task export adds the policy sidecar only to tasks frozen with a snapshot', async () => {
    await runSeed();
    const pTask = await db.taskInstance.findFirstOrThrow({ where: { project: { name: `${SEED_PREFIX}Phone launch` } } });
    const project = await db.project.findUniqueOrThrow({ where: { id: pTask.projectId } });
    const snap = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: pTask.id } });
    const cand = await db.candidate.create({ data: { clientId, smeUserId: (await db.smeUser.create({ data: { clientId, displayName: 'X' } })).id, country: 'GB' } });
    const admin = await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'ADMIN' } } });
    const run = await db.compilerGenerationRun.create({ data: { clientId, templateId: project.templateId, templateVersion: 1, provider: 'mock', model: 'mock', promptHash: 'h', requestedById: admin.id, status: 'SUCCEEDED' } });
    const ver = await db.compilerVerificationRun.create({ data: { clientId, generationRunId: run.id, requestedById: admin.id, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 1 } });
    const tpl = await db.template.findUniqueOrThrow({ where: { id: project.templateId } });
    const dep = await db.studioDeployment.create({ data: { clientId, templateId: tpl.id, templateLineageId: tpl.lineageId, templateVersion: 1, projectId: project.id, candidateId: cand.id, verificationRunId: ver.id, studioKey: `k-${randomUUID().slice(0, 8)}`, deployedById: admin.id } });
    const authored = (taskInstanceId: string, policySnapshotId: string | null) =>
      db.smeAuthoredTask.create({ data: { clientId, taskInstanceId, submissionVersion: 1, deploymentId: dep.id, templateId: tpl.id, templateVersion: 1, projectId: project.id, candidateId: cand.id, externalTaskId: `T-${randomUUID().slice(0, 6)}`, title: 'Synthetic', executionMode: 'HERMETIC_MCP', taskJson: { id: 'x' }, bundleRef: 'b', bundleSha256: 'h', dataClassification: 'SYNTHETIC', policySnapshotId } });
    const other = await db.taskInstance.create({ data: { clientId, projectId: project.id, taskType: 'AUTHORING' } });
    const withPolicy = await authored(pTask.id, snap.id);
    const without = await authored(other.id, null);
    const r = await app.inject({ method: 'GET', url: '/api/v1/studio-tasks/export', headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    const items = r.json().items as Array<{ task: { id: string }; policy?: { snapshot_id: string; digest: string } }>;
    expect(items.find((i) => i.task.id === withPolicy.id)!.policy).toMatchObject({ snapshot_id: snap.id, digest: snap.digest });
    expect(Object.hasOwn(items.find((i) => i.task.id === without.id)!, 'policy')).toBe(false);
  });
});
