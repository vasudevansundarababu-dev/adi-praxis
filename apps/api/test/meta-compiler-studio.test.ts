import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmeAuthoredTaskDto, StudioConfigResponse, type HarborBlueprint, type StudioAnswers } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MemoryStorage } from '../src/candidate/storage';
import { MockRunner } from '../src/harbor/runner';
import { defaultAnswers } from '../src/meta-compiler/deps';
import { readTarGz } from '../src/harbor/runner';
import type { SelectionGate } from '../src/staffing/selection-gate';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { api, generateAndVerify, seedProject, seedTemplate, workerFor } from './meta-compiler-fixtures';

const SECRET = 'test-mock-secret';

describe('A8 candidate studio: config, autosave, atomic Save & Commit, own tasks (S4-01, S4-02, S4-08 to S4-10, S4-13, D-10, D-11, D-13, D-14)', () => {
  const storage = new MemoryStorage();
  const google = new MockGoogleVerifier(SECRET);
  const faults: { afterUpload?: () => Promise<void>; beforeRecord?: () => Promise<void> } = {};
  let gate: SelectionGate = stubSelectionGate;
  let config = testConfig({ MOCK_SECRET: SECRET });
  const runner = new MockRunner(storage);
  const work = workerFor({ config, storage, runner });
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let adminId: string;
  let admin: string;
  let reviewer: string;

  async function start() {
    await app?.close();
    app = await buildApp({
      config, db, pingRedis: async () => true, google, resolveClientId: async () => clientId, storage, embeddings: new HashingEmbeddingProvider(),
      selectionGate: { check: (tx, a) => gate.check(tx, a) },
      metaCompiler: { runner, studioFaults: { afterUpload: () => faults.afterUpload?.() ?? Promise.resolve(), beforeRecord: () => faults.beforeRecord?.() ?? Promise.resolve() } },
    });
    http = api(app);
  }

  async function sme(email = `${randomUUID().slice(0, 8)}@example.test`) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${email}`, email, name: 'Sam Studio' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED', contactEmail: email } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['Marketing'], skills: ['Marketing'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id, email };
  }

  /** A deployed studio for one assigned SME, plus a second SME on the same project without a studio. */
  async function deployed() {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED' });
    const project = await seedProject(clientId, adminId, t, `PRJ-${randomUUID().slice(0, 6)}`);
    const author = await sme();
    const other = await sme();
    for (const s of [author, other]) await db.projectAssignment.create({ data: { clientId, projectId: project.id, candidateId: s.candidateId } });
    const rv = await createUser(clientId, ['REVIEWER']);
    await db.projectReviewer.create({ data: { clientId, projectId: project.id, userId: rv.id, assignedById: adminId } });
    reviewer = await login(app, rv.email);
    const { verificationId } = await generateAndVerify(http, admin, work, t.id);
    const d = await http.post(admin, `/templates/${t.id}/deployments`, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: author.candidateId });
    expect(d.statusCode, d.body).toBe(201);
    return { t, project, author, other, studioKey: d.json().studioKey as string, bp: t.blueprint as unknown as HarborBlueprint };
  }
  const studio = (cookie: string, key: string, suffix = '') => app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${key}${suffix}`, headers: { cookie } });
  const saveDraft = (cookie: string, key: string, answers: StudioAnswers, expectedRevision: number) => http.put(cookie, `/candidate/studio/${key}/draft`, { answers, expectedRevision });
  const commit = (cookie: string, key: string, expectedRevision: number, k = idem(), dataClassification = 'SYNTHETIC') => http.post(cookie, `/candidate/studio/${key}/commit`, { expectedRevision, dataClassification }, k);
  const answersFor = (bp: HarborBlueprint): StudioAnswers => ({ ...defaultAnswers(bp), fields: { ...defaultAnswers(bp).fields, title: 'Synthetic launch week plan' }, inputs: { queries: 'keyword\nquiet phone\n' } });

  beforeAll(async () => {
    await start();
  });
  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    gate = stubSelectionGate;
    delete faults.afterUpload;
    delete faults.beforeRecord;
    clientId = (await createClient()).id;
    const a = await createUser(clientId, ['ADMIN']);
    adminId = a.id;
    admin = await login(app, a.email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('the assigned SME opens the studio: one task is allocated, hidden paths are removed from the blueprint (S4-01, D-21)', async () => {
    const { t, project, author, studioKey } = await deployed();
    const res = await studio(author.cookie, studioKey);
    expect(res.statusCode, res.body).toBe(200);
    const body = StudioConfigResponse.parse(res.json());
    expect(body).toMatchObject({ studioKey, deploymentStatus: 'ACTIVE', workflowName: t.workflowName, templateVersion: 1, projectName: project.name, revision: expect.any(Number), answers: null, realDataEnabled: false });
    expect(body.blueprint.authored_content.solve_sh).toBe('');
    expect(body.blueprint.step_2_data_panels.oracle_annotator.target_path).toBe('');
    expect(body.blueprint.step_5_default_rubric.milestones.every((m) => m.verifier_body === '')).toBe(true);
    expect(res.body).not.toContain('/eval/');
    expect(res.body).not.toContain('echo solved');
    const again = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    expect(again.taskInstanceId).toBe(body.taskInstanceId);
    expect(await db.taskInstance.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: body.taskInstanceId, action: { in: ['task.issued', 'studio.task_opened'] } } })).toBe(2);
  });

  it('only the assigned SME gets in: other SMEs and other clients get 404; signed-out callers get 401 (S4-02)', async () => {
    const { other, studioKey } = await deployed();
    expect((await studio(other.cookie, studioKey)).statusCode).toBe(404);
    expect((await studio(other.cookie, studioKey, '/tasks')).statusCode).toBe(404);
    expect((await saveDraft(other.cookie, studioKey, defaultAnswers((await db.template.findFirstOrThrow()).blueprint as never), 0)).statusCode).toBe(404);
    expect((await commit(other.cookie, studioKey, 0)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${studioKey}` })).statusCode).toBe(401);
    // An internal Admin session is a different audience and never opens the candidate studio.
    expect((await studio(admin, studioKey)).statusCode).toBe(401);
    expect((await studio(other.cookie, 'no-such-studio')).statusCode).toBe(404);
  });

  it('S3-10 an Admin stops a studio: its SME sees "closed" (410), others still get 404, work is kept, stop is audited and idempotent, redeploy reopens the URL', async () => {
    const { t, project, author, other, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    const rev = (await saveDraft(author.cookie, studioKey, answersFor(bp), open.revision)).json().revision;
    expect((await commit(author.cookie, studioKey, rev)).statusCode).toBe(200);
    const d = await db.studioDeployment.findFirstOrThrow({ where: { studioKey } });

    const pm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await http.post(pm, `/deployments/${d.id}/stop`, {})).statusCode).toBe(403);
    const otherClient = (await createClient()).id;
    const outsider = await login(app, (await createUser(otherClient, ['ADMIN'])).email);
    expect((await http.post(outsider, `/deployments/${d.id}/stop`, {})).statusCode).toBe(404);

    const stop = await http.post(admin, `/deployments/${d.id}/stop`, {});
    expect(stop.statusCode, stop.body).toBe(200);
    expect(stop.json()).toMatchObject({ id: d.id, status: 'STOPPED', studioKey });
    const again = await http.post(admin, `/deployments/${d.id}/stop`, {});
    expect(again.json()).toMatchObject({ status: 'STOPPED' });
    expect(await db.auditEvent.count({ where: { entityId: d.id, action: 'studio.stopped' } })).toBe(1);
    expect(await db.studioDeployment.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'STOPPED', stoppedById: adminId, stoppedAt: expect.any(Date) });

    for (const res of [await studio(author.cookie, studioKey), await studio(author.cookie, studioKey, '/tasks'), await saveDraft(author.cookie, studioKey, answersFor(bp), 0), await commit(author.cookie, studioKey, 0)]) {
      expect(res.statusCode, res.body).toBe(410);
      expect(res.json().error).toBe('STUDIO_CLOSED');
    }
    expect((await studio(other.cookie, studioKey)).statusCode).toBe(404);
    expect(await db.smeAuthoredTask.count({ where: { deploymentId: d.id } })).toBe(1);
    expect((await http.get(admin, `/templates/${t.id}/deployments`)).json().items).toEqual([expect.objectContaining({ id: d.id, status: 'STOPPED' })]);

    const { verificationId } = await generateAndVerify(http, admin, work, t.id);
    const redeploy = await http.post(admin, `/templates/${t.id}/deployments`, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: author.candidateId });
    expect(redeploy.json()).toMatchObject({ id: d.id, studioKey, status: 'ACTIVE' });
    expect((await studio(author.cookie, studioKey)).statusCode).toBe(200);
  });

  it('reuses the work checks: an SME who has not finished onboarding is told the outstanding step', async () => {
    const { author, studioKey } = await deployed();
    gate = { check: async () => ({ ok: false, reason: 'onboarding not complete' }) };
    const res = await studio(author.cookie, studioKey);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'OUTSTANDING_STEP', details: { step: 'onboarding' } });
  });

  it('autosave stores the answers with revision conflict detection', async () => {
    const { author, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    const answers = answersFor(bp);
    const saved = await saveDraft(author.cookie, studioKey, answers, open.revision);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().revision).toBe(open.revision + 1);
    const stale = await saveDraft(author.cookie, studioKey, answers, open.revision);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'STALE_REVISION', details: { revision: open.revision + 1 } });
    expect(StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json()).answers).toEqual(answers);
  });

  it('Save & Commit writes the submission, the authored task, the bundle, audit and outbox together; the task goes to review (S4-10, S4-13, D-10, D-11)', async () => {
    const { t, project, author, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    const rev = (await saveDraft(author.cookie, studioKey, answersFor(bp), open.revision)).json().revision;
    const key = idem();
    const res = await commit(author.cookie, studioKey, rev, key);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'SUBMITTED', version: 1, externalTaskId: expect.stringMatching(/^TASK-DIGI-[0-9A-F]{10}$/), bundleSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // Repeat clicks with the same key do not duplicate (S4-10).
    const replay = await commit(author.cookie, studioKey, rev, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(body);

    const authored = await db.smeAuthoredTask.findUniqueOrThrow({ where: { id: body.authoredTaskId } });
    expect(authored).toMatchObject({ clientId, taskInstanceId: open.taskInstanceId, submissionVersion: 1, templateId: t.id, templateVersion: 1, projectId: project.id, candidateId: author.candidateId, title: 'Synthetic launch week plan', executionMode: 'HERMETIC_MCP', dataClassification: 'SYNTHETIC', tptEstimate: '45m (12 Wks)' });
    expect(authored.bundleRef).toBe(`bundles/${clientId}/${body.bundleSha256}.tar.gz`);
    const files = readTarGz(await storage.get(authored.bundleRef));
    expect([...files.keys()]).toEqual(expect.arrayContaining(['task.json', 'instruction.md', 'eval/test_verifiers.py', 'solution/solve.sh', 'workspace/inputs/scraped_queries.csv']));
    // S4-08: the stored JSON equals the task.json in the bundle, byte for byte after parsing.
    expect(authored.taskJson).toEqual(JSON.parse(files.get('task.json')!.toString('utf8')));
    expect(body.taskJson).toEqual(authored.taskJson);
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: open.taskInstanceId } });
    expect(task.status).toBe('SUBMITTED');
    expect(await db.taskSubmission.count({ where: { taskInstanceId: task.id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { name: { in: ['task.submitted', 'studio.task_committed'] } } })).toBe(2);
    expect(await db.auditEvent.count({ where: { action: 'studio.task_committed', actorType: 'CANDIDATE', actorId: author.smeUserId } })).toBe(1);

    // The SME sees their own tasks only, without emails (D4).
    const mine = (await studio(author.cookie, studioKey, '/tasks')).json().items.map((x: unknown) => SmeAuthoredTaskDto.parse(x));
    expect(mine).toEqual([expect.objectContaining({ id: authored.id, authoredBy: null, reviewStatus: 'SUBMITTED' })]);

    // S4-13: existing independent review; acceptance reaches the Approved Task Dataset.
    const decide = async (decision: object) => {
      const r = (await http.get(reviewer, `/review/tasks/${task.id}`)).json();
      return http.post(reviewer, `/review/tasks/${task.id}/decision`, { expectedRevision: r.revision, checklist: { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true }, ...decision });
    };
    const rework = await decide({ decision: 'REWORK', checklist: { realistic: true, correct: false, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true }, comments: [{ section: 'W04', text: 'Tag the second keyword.' }] });
    expect(rework.statusCode, rework.body).toBe(200);
    // Returned tasks go back to the studio, on the same task.
    const back = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    expect(back.taskInstanceId).toBe(task.id);
    const rev2 = (await saveDraft(author.cookie, studioKey, { ...answersFor(bp), instructionNotes: 'Second keyword tagged.' }, back.revision)).json().revision;
    const second = await commit(author.cookie, studioKey, rev2);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().version).toBe(2);
    expect(second.json().externalTaskId).not.toBe(body.externalTaskId);
    const accepted = await decide({ decision: 'ACCEPT' });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: task.id } })).toBe(1);
  });

  it('fault injection: a failure after the upload or inside the transaction never leaves a partial task; a retry succeeds', async () => {
    const { author, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    const rev = (await saveDraft(author.cookie, studioKey, answersFor(bp), open.revision)).json().revision;
    const nothingVisible = async () => {
      expect(await db.smeAuthoredTask.count()).toBe(0);
      expect(await db.taskSubmission.count()).toBe(0);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id: open.taskInstanceId } })).status).toBe('IN_PROGRESS');
      expect(await db.outboxEvent.count({ where: { name: { in: ['task.submitted', 'studio.task_committed'] } } })).toBe(0);
      expect(await db.auditEvent.count({ where: { action: { in: ['task.submitted', 'studio.task_committed'] } } })).toBe(0);
    };
    faults.afterUpload = async () => {
      throw new Error('injected: crash after upload');
    };
    expect((await commit(author.cookie, studioKey, rev)).statusCode).toBe(500);
    await nothingVisible();
    delete faults.afterUpload;
    faults.beforeRecord = async () => {
      throw new Error('injected: database failure between submit and record');
    };
    expect((await commit(author.cookie, studioKey, rev)).statusCode).toBe(500);
    await nothingVisible();
    // The uploaded object is left unreferenced (the nightly sweep removes it); retrying rewrites the same key.
    const orphans = [...storage.objects.keys()].filter((k) => k.startsWith(`bundles/${clientId}/`));
    expect(orphans).toHaveLength(1);
    delete faults.beforeRecord;
    const ok = await commit(author.cookie, studioKey, rev);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(`bundles/${clientId}/${ok.json().bundleSha256}.tar.gz`).toBe(orphans[0]);
    expect(await db.smeAuthoredTask.count()).toBe(1);
  });

  it('commit needs a saved, complete task at the current revision', async () => {
    const { author, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    expect((await commit(author.cookie, studioKey, open.revision)).json().error).toBe('EMPTY');
    const bad = { ...answersFor(bp), oracleRows: [{ cells: ['quiet phone deal', 'BUY'], tag: 'NOT-A-TAG' }] };
    const rev = (await saveDraft(author.cookie, studioKey, bad, open.revision)).json().revision;
    const res = await commit(author.cookie, studioKey, rev);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'STUDIO_INCOMPLETE', details: { problems: { data_oracle: ['Tag "NOT-A-TAG" is not allowed'] } } });
    expect((await commit(author.cookie, studioKey, rev - 1)).json().error).toBe('STALE_REVISION');
  });

  it('data classification is SYNTHETIC unless the real-data switch is on (D-14, NFR-05a)', async () => {
    const { author, studioKey, bp } = await deployed();
    const open = StudioConfigResponse.parse((await studio(author.cookie, studioKey)).json());
    const rev = (await saveDraft(author.cookie, studioKey, answersFor(bp), open.revision)).json().revision;
    const res = await commit(author.cookie, studioKey, rev, idem(), 'REAL_PUBLIC');
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('REAL_DATA_DISABLED');
    config = { ...config, metaCompiler: { ...config.metaCompiler, realDataEnabled: true } };
    await start();
    const ok = await commit(author.cookie, studioKey, rev, idem(), 'REAL_PUBLIC');
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await db.smeAuthoredTask.findFirstOrThrow()).dataClassification).toBe('REAL_PUBLIC');
    config = testConfig({ MOCK_SECRET: SECRET });
    await start();
  });
});
