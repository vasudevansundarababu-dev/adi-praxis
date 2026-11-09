import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmeAuthoredTaskDto, StudioConfigResponse, type HarborBlueprint, type StudioAnswers } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MemoryStorage } from '../src/candidate/storage';
import { MockRunner, RunnerError, type HarborRunner } from '../src/harbor/runner';
import { defaultAnswers } from '../src/meta-compiler/deps';
import { processAuthoredTaskVerification, taskVerificationLogKey } from '../src/meta-compiler/task-verification';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';
import { api, generateAndVerify, seedProject, seedTemplate, workerFor } from './meta-compiler-fixtures';

const SECRET = 'test-mock-secret';

describe('A9 per-task verification and the task store (S4-11, S4-12, D-12)', () => {
  const storage = new MemoryStorage();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig({ MOCK_SECRET: SECRET });
  /** The runner the worker uses; swapped per test. Deploys always verify with the plain mock runner. */
  let taskRunner: HarborRunner = new MockRunner(storage);
  const deployWork = workerFor({ config, storage, runner: new MockRunner(storage) });
  const runner: HarborRunner = { kind: 'mock', run: (ref, mode) => taskRunner.run(ref, mode) };
  const work = workerFor({ config, storage, runner });
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let adminId: string;
  let admin: string;

  async function sme() {
    const email = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${email}`, email, name: 'Sam Studio' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED', contactEmail: email } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['Marketing'], skills: ['Marketing'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, candidateId: c.id, email };
  }

  /** A deployed studio whose SME has committed one task (mock drafter and runner). */
  async function committed() {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED' });
    const project = await seedProject(clientId, adminId, t);
    const author = await sme();
    await db.projectAssignment.create({ data: { clientId, projectId: project.id, candidateId: author.candidateId } });
    const { verificationId } = await generateAndVerify(http, admin, deployWork, t.id);
    const studioKey = (await http.post(admin, `/templates/${t.id}/deployments`, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: author.candidateId })).json().studioKey as string;
    const open = StudioConfigResponse.parse((await app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${studioKey}`, headers: { cookie: author.cookie } })).json());
    const bp = t.blueprint as unknown as HarborBlueprint;
    const answers: StudioAnswers = { ...defaultAnswers(bp), fields: { ...defaultAnswers(bp).fields, title: 'Synthetic launch week plan' } };
    const rev = (await http.put(author.cookie, `/candidate/studio/${studioKey}/draft`, { answers, expectedRevision: open.revision })).json().revision;
    const res = await http.post(author.cookie, `/candidate/studio/${studioKey}/commit`, { expectedRevision: rev, dataClassification: 'SYNTHETIC' });
    expect(res.statusCode, res.body).toBe(200);
    return { t, project, author, studioKey, authoredTaskId: res.json().authoredTaskId as string };
  }

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, resolveClientId: async () => clientId, storage, embeddings: new HashingEmbeddingProvider(), selectionGate: stubSelectionGate, metaCompiler: { runner } });
    http = api(app);
  });
  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    taskRunner = new MockRunner(storage);
    clientId = (await createClient()).id;
    const a = await createUser(clientId, ['ADMIN']);
    adminId = a.id;
    admin = await login(app, a.email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  describe('per-task verification after commit', () => {
    it('the worker measures the committed bundle and records scores with evidence, once (D-12)', async () => {
      const { authoredTaskId } = await committed();
      expect((await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } })).oracleScore).toBeNull();
      await work();
      const t = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      expect(Number(t.zeroBaselineScore)).toBe(0);
      expect(Number(t.oracleScore)).toBe(1);
      const evidence = t.verificationEvidence as Record<string, unknown>;
      expect(evidence).toMatchObject({ status: 'MEASURED', passed: true, runner: 'mock', error: null, verifyBundleRef: `bundles/verify/${clientId}/${t.bundleSha256}.tar.gz`, logRef: taskVerificationLogKey(clientId, t.id) });
      expect(evidence.runnerRefs).toEqual([expect.stringMatching(/:null-agent$/), expect.stringMatching(/:oracle$/)]);
      expect(Date.parse(evidence.verifiedAt as string)).not.toBeNaN();
      expect((await storage.get(evidence.logRef as string)).toString()).toMatch(/null agent: 0\.00[\s\S]*oracle: 1\.00/);
      expect(await db.auditEvent.count({ where: { entityId: t.id, action: 'studio.task_verified', actorType: 'SYSTEM' } })).toBe(1);

      // Idempotent: running it again does nothing.
      let calls = 0;
      taskRunner = { kind: 'mock', run: async () => (calls++, { score: 0.5, log: '', runnerRef: 'x' }) };
      await processAuthoredTaskVerification({ db, storage, config, runner }, authoredTaskId);
      expect(calls).toBe(0);
      expect(Number((await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } })).oracleScore)).toBe(1);
    });

    it('records a failing measurement as evidence, not as a pass', async () => {
      const { authoredTaskId } = await committed();
      taskRunner = new MockRunner(storage, { oracle: 0.5 });
      await work();
      const t = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      expect(Number(t.oracleScore)).toBe(0.5);
      expect(t.verificationEvidence).toMatchObject({ status: 'MEASURED', passed: false, error: expect.stringMatching(/oracle 1\.00/) });
    });

    it('a runner failure is recorded and retried by the outbox; the content stays unchanged', async () => {
      const { authoredTaskId } = await committed();
      const before = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      taskRunner = { kind: 'mock', run: async () => { throw new RunnerError('sandbox unavailable token=abc123'); } };
      await expect(work()).rejects.toThrow('sandbox unavailable');
      const failed = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      expect(failed.oracleScore).toBeNull();
      expect(failed.verificationEvidence).toMatchObject({ status: 'NOT_MEASURED', error: 'sandbox unavailable token=[redacted]' });
      expect(failed.bundleSha256).toBe(before.bundleSha256);
      expect(failed.taskJson).toEqual(before.taskJson);
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'studio.task_committed' } });
      expect(ev.attempts).toBeGreaterThan(0);
      taskRunner = new MockRunner(storage);
      await work();
      expect(Number((await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } })).oracleScore)).toBe(1);
    });

    it('in staging or production the mock runner never records scores (D-12)', async () => {
      const { authoredTaskId } = await committed();
      await processAuthoredTaskVerification({ db, storage, config: { ...config, appEnv: 'staging' }, runner: new MockRunner(storage) }, authoredTaskId);
      const t = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      expect(t.oracleScore).toBeNull();
      expect(t.zeroBaselineScore).toBeNull();
      expect(t.verificationEvidence).toMatchObject({ status: 'NOT_MEASURED', error: expect.stringMatching(/HARBOR_RUNNER=job/) });
    });
  });

  describe('task store routes', () => {
    it('lists every task of the client with the author (Admin view), paginates and filters; other clients never appear (S4-11)', async () => {
      const a = await committed();
      const b = await committed();
      await work();
      const res = await http.get(admin, '/studio-tasks');
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().items.map((x: unknown) => SmeAuthoredTaskDto.parse(x));
      expect(items.map((x: SmeAuthoredTaskDto) => x.id)).toEqual([b.authoredTaskId, a.authoredTaskId]);
      expect(items[0]).toMatchObject({ authoredBy: b.author.email, projectId: b.project.id, reviewStatus: 'SUBMITTED', oracleScore: 1, zeroBaselineScore: 0, dataClassification: 'SYNTHETIC' });
      const page1 = (await http.get(admin, '/studio-tasks?limit=1')).json();
      expect(page1.items).toHaveLength(1);
      const page2 = (await http.get(admin, `/studio-tasks?limit=1&cursor=${page1.nextCursor}`)).json();
      expect(page2).toMatchObject({ items: [expect.objectContaining({ id: a.authoredTaskId })], nextCursor: null });
      expect((await http.get(admin, `/studio-tasks?projectId=${a.project.id}`)).json().items.map((x: { id: string }) => x.id)).toEqual([a.authoredTaskId]);
      expect((await http.get(admin, `/studio-tasks?templateId=${b.t.id}`)).json().items.map((x: { id: string }) => x.id)).toEqual([b.authoredTaskId]);

      // Another client's Admin sees none of them, and cannot open, download or export them.
      const other = await createClient();
      const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
      expect((await http.get(otherAdmin, '/studio-tasks')).json().items).toEqual([]);
      expect((await http.get(otherAdmin, `/studio-tasks/${a.authoredTaskId}`)).statusCode).toBe(404);
      expect((await http.get(otherAdmin, `/studio-tasks/${a.authoredTaskId}/bundle`)).statusCode).toBe(404);
      expect((await http.get(otherAdmin, '/studio-tasks/export')).json().items).toEqual([]);
    });

    it('Inspect JSON returns the stored task.json and the verification evidence', async () => {
      const { authoredTaskId } = await committed();
      await work();
      const res = await http.get(admin, `/studio-tasks/${authoredTaskId}`);
      expect(res.statusCode, res.body).toBe(200);
      const row = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      expect(res.json()).toMatchObject({ task: { id: authoredTaskId, externalTaskId: row.externalTaskId }, taskJson: row.taskJson, verificationEvidence: { status: 'MEASURED', passed: true } });
    });

    it('downloads the bundle byte for byte, checks its SHA-256 and audits the download', async () => {
      const { authoredTaskId } = await committed();
      const row = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      const res = await http.get(admin, `/studio-tasks/${authoredTaskId}/bundle`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/gzip');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="${row.externalTaskId}.tar.gz"`);
      expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(row.bundleSha256);
      expect(await db.auditEvent.count({ where: { entityId: authoredTaskId, action: 'studio_task.bundle_downloaded' } })).toBe(1);
      // A tampered object is refused rather than served.
      await storage.put(row.bundleRef, Buffer.from('tampered'), 'application/gzip');
      expect((await http.get(admin, `/studio-tasks/${authoredTaskId}/bundle`)).json().error).toBe('BUNDLE_MISMATCH');
      storage.objects.delete(row.bundleRef);
      expect((await http.get(admin, `/studio-tasks/${authoredTaskId}/bundle`)).json().error).toBe('BUNDLE_MISSING');
    });

    it('exports the whole store as streamed JSON, in pages, audited (S4-12)', async () => {
      const { authoredTaskId } = await committed();
      const row = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: authoredTaskId } });
      // 250 more synthetic rows (more than one export page) on the same task instance, as later submission versions.
      const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = row;
      await db.smeAuthoredTask.createMany({
        data: Array.from({ length: 250 }, (_, i) => ({ ...copy, taskJson: copy.taskJson as object, verificationEvidence: undefined, submissionVersion: i + 2, externalTaskId: `${row.externalTaskId}-${i + 2}` })),
      });
      const res = await http.get(admin, '/studio-tasks/export');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="studio-tasks-\d{4}-\d{2}-\d{2}\.json"$/);
      expect(res.headers['content-length']).toBeUndefined();
      const body = res.json();
      expect(body.schema).toBe('praxis.studio-tasks.export.v1');
      expect(body.items).toHaveLength(251);
      expect(new Set(body.items.map((x: { task: { id: string } }) => x.task.id)).size).toBe(251);
      expect(body.items[0]).toMatchObject({ task: { id: authoredTaskId }, taskJson: row.taskJson });
      expect(SmeAuthoredTaskDto.parse(body.items[250].task).authoredBy).toMatch(/@example\.test$/);
      const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'studio_task.store_exported' } });
      expect(audit).toMatchObject({ clientId, entityId: clientId, after: { count: 251 } });
    });

    it('is Admin only: PMs, Reviewers and SMEs are refused (RBAC)', async () => {
      const { author, authoredTaskId } = await committed();
      for (const role of ['PM', 'REVIEWER'] as const) {
        const cookie = await login(app, (await createUser(clientId, [role])).email);
        for (const url of ['/studio-tasks', `/studio-tasks/${authoredTaskId}`, `/studio-tasks/${authoredTaskId}/bundle`, '/studio-tasks/export']) {
          expect((await http.get(cookie, url)).statusCode, `${role} ${url}`).toBe(403);
        }
      }
      expect((await http.get(author.cookie, '/studio-tasks')).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/v1/studio-tasks/export' })).statusCode).toBe(401);
      expect(await db.auditEvent.count({ where: { action: { in: ['studio_task.store_exported', 'studio_task.bundle_downloaded'] } } })).toBe(0);
    });
  });
});
