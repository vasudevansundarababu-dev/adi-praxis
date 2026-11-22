import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { buildTaskPackage, TASK_PACKAGE_SCHEMA, taskPackageProblem } from '../src/anvil/generic-package';
import { jcs } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { storeTaskPackage } from '../src/anvil/task-package-store';
import { readZip } from '../src/anvil/zip';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * New RL Gym part 1 (docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.1 a): every approved task revision is
 * kept as a `praxis.authored-task-package.v1` and served to the RL Gym's key at GET /api/v1/packages/{sha256}. The RL
 * Gym stores the package's `actor` and `private` parts and checks SHA-256 over sorted-key compact JSON. Mocks only.
 */

// ── Unit: the package builder, on RL Gym's own synthetic reference files ──

const F = join(__dirname, 'fixtures', 'anvil-generic');
const json = (f: string) => JSON.parse(readFileSync(join(F, f), 'utf8'));
const SPEC = json('synthetic-template-spec.json');
const ZIP = readZip(readFileSync(join(F, 'synthetic-non-Golden-export.zip')));
const zipFile = (p: string) => JSON.parse(ZIP.get(p)!.toString('utf8'));
const AUTHORED = zipFile('private/NEW-SME-9001/reference.json').authored;
const { template_id, version, ...parts } = SPEC;
const template = (over: Partial<Template> = {}) => ({ id: '11111111-1111-4111-8111-111111111111', lineageId: template_id, version, status: 'PUBLISHED', agentMode: 'SINGLE', anvilSpec: parts, ...over }) as unknown as Template;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const record = (over: Partial<ApprovedTaskRecord> = {}) => ({ id: '00000000-0000-4000-8000-000000000001', taskInstanceId: '10000000-0000-4000-8000-000000000001', contentHash: 'c'.repeat(64), templateId: '11111111-1111-4111-8111-111111111111', output: AUTHORED, ...over }) as unknown as ApprovedTaskRecord;

/** The RL Gym's hash (anvil.rlgym.common.sha): sorted keys, compact separators, UTF-8, no ASCII escaping. */
function rlGymSha(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(sort(value)), 'utf8').digest('hex');
}

describe('authored task package (praxis.authored-task-package.v1)', () => {
  it('has the actor and private parts RL Gym stores: the agent view and the grader-only reference of the export', () => {
    const built = buildTaskPackage({ record: record(), template: template() }, 1);
    if ('code' in built) throw new Error(built.message);
    const p = built.package as Record<string, any>;
    expect(p).toMatchObject({ schema: TASK_PACKAGE_SCHEMA, task_id: record().taskInstanceId, revision: 1, revision_id: record().id, agent_mode: 'SINGLE', content_classification: 'synthetic', review: { status: 'approved' } });
    expect(p.template).toMatchObject({ id: template_id, version });
    // The ZIP's actor.json plus `tools`: the template's declared operations, the only ones RL Gym lets the agent call.
    const { tools, ...actor } = p.actor;
    expect(actor).toEqual(zipFile('tasks/NEW-SME-9001/actor.json'));
    const declared = ((SPEC.execution.tools ?? []) as { id: string }[]).map((t) => t.id);
    if (declared.length) expect(tools).toEqual(declared);
    else expect(tools).toBeUndefined();
    // With declared tools, the list is exactly those IDs.
    const withTools = clone(parts);
    withTools.execution.tools = [{ id: 'application.read' }, { id: 'finding.write' }];
    const t2 = buildTaskPackage({ record: record(), template: template({ anvilSpec: withTools }) }, 1);
    if (!('code' in t2)) expect((t2.package.actor as { tools?: unknown }).tools).toEqual(['application.read', 'finding.write']);
    expect(jcs(p.private)).toBe(jcs(zipFile('private/NEW-SME-9001/reference.json')));
    // The private part stays out of the actor part.
    expect(JSON.stringify(p.actor)).not.toContain('grader_only_reference_and_rubric');
  });

  it('the hash is the SHA-256 of the stored bytes and equals the RL Gym’s own hash of the parsed package', () => {
    const built = buildTaskPackage({ record: record(), template: template() }, 1);
    if ('code' in built) throw new Error(built.message);
    expect(built.packageSha256).toBe(createHash('sha256').update(built.bytes).digest('hex'));
    expect(built.bytes.toString('utf8')).toBe(jcs(built.package));
  });

  it('is deterministic; another revision or other content is another package', () => {
    const a = buildTaskPackage({ record: record(), template: template() }, 1);
    const b = buildTaskPackage({ record: record(), template: template() }, 1);
    const r2 = buildTaskPackage({ record: record({ id: '00000000-0000-4000-8000-000000000002' }), template: template() }, 2);
    if ('code' in a || 'code' in b || 'code' in r2) throw new Error('package problem');
    expect(b.packageSha256).toBe(a.packageSha256);
    expect(r2.packageSha256).not.toBe(a.packageSha256);
    expect(r2.package.revision).toBe(2);
  });

  it('a template that declares no tools sends no tools list', () => {
    const noTools = clone(parts);
    delete noTools.execution.tools;
    const a = buildTaskPackage({ record: record(), template: template({ anvilSpec: noTools }) }, 1);
    if ('code' in a) throw new Error(a.message);
    expect(a.package.actor).not.toHaveProperty('tools');
  });

  it('decimals (criterion weights) stay numbers in RFC 8785 bytes: RL Gym must hash the raw body, as agreed 22 Nov', () => {
    const built = buildTaskPackage({ record: record(), template: template() }, 1);
    if ('code' in built) throw new Error(built.message);
    const text = built.bytes.toString('utf8');
    expect(text).toMatch(/"weight":\d+\.\d+/);
    expect(createHash('sha256').update(built.bytes).digest('hex')).toBe(built.packageSha256);
  });

  it('a task the export cannot package has no package, with the same reason', () => {
    expect(buildTaskPackage({ record: record(), template: template({ status: 'DRAFT' }) }, 1)).toMatchObject({ code: 'GENERIC_TEMPLATE_NOT_PUBLISHED' });
    expect(buildTaskPackage({ record: record({ output: { body: 'free text' } as never }), template: template() }, 1)).toMatchObject({ code: 'GENERIC_TASK_NOT_PROFILE' });
  });
});

// ── Integration: stored on approval, served by hash, append-only ──

const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';

describe('packages stored on approval and served to the RL Gym', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const fetchPackage = (sha: string, headers: Record<string, string> = { authorization: `Bearer ${anvilKey}` }) => app.inject({ method: 'GET', url: `/api/v1/packages/${sha}`, headers });

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

  /** A KYC v8 project whose four tasks are approved by a person (writeApprovedRecord, as the console does). */
  async function approvedProject() {
    const v8 = await publishedV8();
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v8.id, name: `KYC v8 ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const projectId = created.json().id as string;
    expect((await post(pm, `/projects/${projectId}/submit`)).statusCode).toBe(200);
    const reviewer = await createUser(clientId, ['ADMIN']);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const records: ApprovedTaskRecord[] = [];
    for (const { candidate } of EMBEDDED.successors.values()) {
      const value = candidate.output.sections.S1!.applicationType as string;
      const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === value)!;
      const sme = await db.smeUser.create({ data: { clientId, contactEmail: `${value}@sme.test` } });
      const cand = await db.candidate.create({ data: { clientId, smeUserId: sme.id } });
      await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: candidate.output as unknown as Prisma.InputJsonValue } });
      await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: candidate.output as unknown as Prisma.InputJsonValue, checks: {} } });
      records.push(await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() })));
    }
    const templates = new Map((await db.template.findMany()).map((t) => [t.id, t]));
    const packable = records.filter((r) => !taskPackageProblem({ record: r, template: templates.get(r.templateId)! }));
    return { projectId, records, packable };
  }

  it('each approval keeps one package (revision 1); RL Gym’s key gets the exact bytes; the hash matches its own check', async () => {
    const { projectId, records } = await approvedProject();
    const rows = await db.authoredTaskPackage.findMany({ where: { projectId } });
    // A record has a package exactly when the export could package it (the raw v8 candidates with undeclared tools,
    // corrected later by APR-13, cannot).
    const templates = new Map((await db.template.findMany()).map((t) => [t.id, t]));
    const packable = records.filter((r) => !taskPackageProblem({ record: r, template: templates.get(r.templateId)! }));
    expect(packable.length).toBeGreaterThan(0);
    expect(rows.map((x) => x.recordId).sort()).toEqual(packable.map((r) => r.id).sort());
    for (const r of packable) {
      const row = rows.find((x) => x.recordId === r.id)!;
      expect(row).toMatchObject({ clientId, taskInstanceId: r.taskInstanceId, revision: 1, schema: TASK_PACKAGE_SCHEMA });
      const res = await fetchPackage(row.packageSha256);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(row.packageSha256);
      const pkg = JSON.parse(res.body);
      expect(rlGymSha(pkg)).toBe(row.packageSha256);
      expect(pkg).toMatchObject({ schema: TASK_PACKAGE_SCHEMA, task_id: r.taskInstanceId, revision: 1, revision_id: r.id });
      expect(Object.keys(pkg.actor).length).toBeGreaterThan(0);
      expect(Object.keys(pkg.private).length).toBeGreaterThan(0);
    }
  });

  it('a later approved record of the same task is revision 2, with its own package; earlier packages stay', async () => {
    const { packable } = await approvedProject();
    const first = packable[0]!;
    const before = await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: first.id } });
    const reviewer = await createUser(clientId, ['ADMIN']);
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: first.taskInstanceId } });
    const output = structuredClone(task.output) as Record<string, any>;
    output.sections.S8.reviewerNotes = `${String(output.sections.S8.reviewerNotes ?? '')} Corrected after review.`.trim();
    await db.taskInstance.update({ where: { id: task.id }, data: { output } });
    const second = await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: 'correction', duplicateDecision: null, decidedAt: new Date() }));
    const after = await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: second.id } });
    expect(after.revision).toBe(2);
    expect(after.packageSha256).not.toBe(before.packageSha256);
    expect((await fetchPackage(before.packageSha256)).statusCode).toBe(200);
    expect(JSON.parse((await fetchPackage(after.packageSha256)).body).revision).toBe(2);
  });

  it('storing again is idempotent: the same record keeps its one package', async () => {
    const { packable } = await approvedProject();
    const r = packable[0]!;
    const row = await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: r.id } });
    expect(await storeTaskPackage(db, r)).toEqual({ status: 'existing', packageSha256: row.packageSha256, revision: 1 });
    expect(await db.authoredTaskPackage.count({ where: { recordId: r.id } })).toBe(1);
  });

  it('packages are append-only in the database', async () => {
    const { packable } = await approvedProject();
    const row = await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: packable[0]!.id } });
    await expect(db.$executeRaw`UPDATE "AuthoredTaskPackage" SET "content" = '{}' WHERE "record_id" = ${row.recordId}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "AuthoredTaskPackage" WHERE "record_id" = ${row.recordId}::uuid`).rejects.toThrow();
    expect((await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: row.recordId } })).content).toBe(row.content);
  });

  it('unknown or malformed hash: 404; no key, a PM, or another kind of key: refused', async () => {
    const { packable } = await approvedProject();
    const sha = (await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId: packable[0]!.id } })).packageSha256;
    expect((await fetchPackage('a'.repeat(64))).statusCode).toBe(404);
    expect((await fetchPackage('not-a-hash')).statusCode).toBe(404);
    expect((await fetchPackage(sha, {})).statusCode).toBe(401);
    expect((await fetchPackage(sha, { cookie: pm })).statusCode).toBe(403);
    const gymKey = (await post(admin, '/api-clients', { name: 'Client API', kind: 'CLIENT_API' })).json().key;
    expect((await fetchPackage(sha, { authorization: `Bearer ${gymKey}` })).statusCode).toBe(403);
  });

  it('a package approval never depends on packaging: a task that cannot be packaged is still approved, with no package', async () => {
    const { projectId, packable } = await approvedProject();
    // Free-text output (not a sections form) cannot be packaged; its approval still succeeds.
    const r = packable[0]!;
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: r.taskInstanceId } });
    await db.taskInstance.update({ where: { id: task.id }, data: { output: { body: 'free text' } } });
    const reviewer = await createUser(clientId, ['ADMIN']);
    const next = await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
    expect(next.id).toBeTruthy();
    expect(await db.authoredTaskPackage.findUnique({ where: { recordId: next.id } })).toBeNull();
    expect(await db.authoredTaskPackage.count({ where: { projectId } })).toBe(packable.length);
  });
});
