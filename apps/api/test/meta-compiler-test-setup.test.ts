import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { StudioConfigResponse, type StudioAnswers } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MemoryStorage } from '../src/candidate/storage';
import type { Config } from '../src/config';
import { MockRunner } from '../src/harbor/runner';
import { defaultAnswers } from '../src/meta-compiler/deps';
import { testSetupBlueprint } from '../src/meta-compiler/test-setup';
import { dbSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { api } from './meta-compiler-fixtures';

const SECRET = 'test-mock-secret';
const URL = '/test-setup/meta-compiler';

describe('A10 Meta-Compiler test setup (S4-14, D4a)', () => {
  const storage = new MemoryStorage();
  const google = new MockGoogleVerifier(SECRET);
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let adminId: string;
  let admin: string;

  async function start(cfg: Config = testConfig({ MOCK_SECRET: SECRET })) {
    await app?.close();
    // The real selection gate: the setup must satisfy the same work checks as any SME.
    app = await buildApp({ config: cfg, db, pingRedis: async () => true, google, resolveClientId: async () => clientId, storage, embeddings: new HashingEmbeddingProvider(), selectionGate: dbSelectionGate, metaCompiler: { runner: new MockRunner(storage) } });
    http = api(app);
    admin = await login(app, (await db.user.findUniqueOrThrow({ where: { id: adminId } })).email);
  }
  const smeSignIn = async (email: string, adultAttested = false) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `mock-${email.toLowerCase()}`, email, name: 'Test SME' }), adultAttested } });
    expect(res.statusCode, res.body).toBe(200);
    return `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`;
  };
  const counts = async () => ({
    templates: await db.template.count(),
    projects: await db.project.count(),
    users: await db.user.count(),
    smes: await db.smeUser.count(),
    enrollments: await db.enrollment.count(),
    decisions: await db.selectionDecision.count(),
    assignments: await db.projectAssignment.count(),
    generations: await db.compilerGenerationRun.count(),
    verifications: await db.compilerVerificationRun.count(),
    deployments: await db.studioDeployment.count(),
  });

  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    clientId = (await createClient()).id;
    adminId = (await createUser(clientId, ['ADMIN'])).id;
    await start();
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('one call creates a deployed synthetic template, project, test SME and separate Reviewer; commit → review → approve works end to end', async () => {
    const res = await http.post(admin, URL);
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ templateVersion: 1, projectName: 'Meta-Compiler test project', studioUrl: expect.stringContaining(s.studioKey), reviewer: { temporaryPassword: expect.any(String) } });
    expect(s.created).toEqual(expect.arrayContaining(['domain', 'template', 'project', 'reviewer', 'sme', 'selection']));
    expect(s.sme.email).toMatch(/@example\.test$/);
    expect(s.reviewer.userId).not.toBe(adminId);
    const v = await db.compilerVerificationRun.findUniqueOrThrow({ where: { id: s.verificationRunId } });
    expect([v.status, Number(v.zeroBaselineScore), Number(v.oracleScore)]).toEqual(['SUCCEEDED', 0, 1]);
    expect(await db.auditEvent.count({ where: { clientId, actorId: adminId, action: { startsWith: 'test_setup.' } } })).toBeGreaterThanOrEqual(7);

    // The test SME signs in (mock Google locally) and authors a task in the studio.
    const sme = await smeSignIn(s.sme.email);
    const open = await app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${s.studioKey}`, headers: { cookie: sme } });
    expect(open.statusCode, open.body).toBe(200);
    const cfg = StudioConfigResponse.parse(open.json());
    const bp = testSetupBlueprint();
    const answers: StudioAnswers = { ...defaultAnswers(bp), fields: { ...defaultAnswers(bp).fields, title: 'Synthetic test task' } };
    const rev = (await http.put(sme, `/candidate/studio/${s.studioKey}/draft`, { answers, expectedRevision: cfg.revision })).json().revision;
    const commit = await http.post(sme, `/candidate/studio/${s.studioKey}/commit`, { expectedRevision: rev, dataClassification: 'SYNTHETIC' });
    expect(commit.statusCode, commit.body).toBe(200);

    // The Admin who ran the setup is not the project's Reviewer; the separate test Reviewer decides.
    let reviewer = await login(app, s.reviewer.email, s.reviewer.temporaryPassword);
    const newPassword = 'synthetic-reviewer-pass-1';
    expect((await http.post(reviewer, '/auth/change-password', { currentPassword: s.reviewer.temporaryPassword, newPassword })).statusCode).toBe(200);
    reviewer = await login(app, s.reviewer.email, newPassword);
    const r = await http.get(reviewer, `/review/tasks/${cfg.taskInstanceId}`);
    expect(r.statusCode, r.body).toBe(200);
    const decision = await http.post(reviewer, `/review/tasks/${cfg.taskInstanceId}/decision`, { expectedRevision: r.json().revision, decision: 'ACCEPT', checklist: { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true } });
    expect(decision.statusCode, decision.body).toBe(200);
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: cfg.taskInstanceId } })).toBe(1);
  });

  it('is idempotent: a second call reuses everything and never shows the password again; a replay returns the stored response', async () => {
    const key = idem();
    const first = (await http.post(admin, URL, {}, key)).json();
    const before = await counts();
    const replay = await http.post(admin, URL, {}, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual({ ...first, reviewer: { ...first.reviewer, temporaryPassword: null } });
    const again = await http.post(admin, URL);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ templateId: first.templateId, projectId: first.projectId, deploymentId: first.deploymentId, studioKey: first.studioKey, verificationRunId: first.verificationRunId, sme: first.sme, reviewer: { userId: first.reviewer.userId, temporaryPassword: null }, created: [] });
    expect(await counts()).toEqual(before);
    expect(await db.auditEvent.count({ where: { action: 'test_setup.meta_compiler_ready' } })).toBe(2);
  });

  it('uses an existing candidate account as the test SME when asked (staging, real sign-in)', async () => {
    const email = 'tester.one@example.test';
    await smeSignIn(email, true);
    const u = await db.smeUser.findFirstOrThrow({ where: { contactEmail: email } });
    expect((await http.post(admin, URL, { smeEmail: email })).json().error).toBe('SME_NOT_READY');
    await db.smeUser.update({ where: { id: u.id }, data: { identityStatus: 'VERIFIED' } });
    await db.candidate.create({ data: { clientId, smeUserId: u.id, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: [], skills: [], jurisdictions: [], domainExperienceYears: 3, hoursPerWeek: 10, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    const res = await http.post(admin, URL, { smeEmail: email });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().sme).toMatchObject({ smeUserId: u.id, email });
    expect(res.json().created).not.toContain('sme');
    expect((await app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${res.json().studioKey}`, headers: { cookie: await smeSignIn(email) } })).statusCode).toBe(200);
    expect((await http.post(admin, URL, { smeEmail: 'nobody@example.test' })).json().error).toBe('SME_NOT_FOUND');
  });

  it('is refused in production, and in staging without the sandbox runner (D-12); nothing is created', async () => {
    const base = testConfig({ MOCK_SECRET: SECRET });
    await start({ ...base, appEnv: 'production' });
    const prod = await http.post(admin, URL);
    expect(prod.statusCode).toBe(403);
    expect(prod.json().error).toBe('TEST_SETUP_DISABLED');
    expect(await db.template.count()).toBe(0);
    await start({ ...base, appEnv: 'staging' });
    const staging = await http.post(admin, URL);
    expect(staging.statusCode).toBe(409);
    expect(staging.json().error).toBe('RUNNER_UNAVAILABLE');
    expect(await counts()).toMatchObject({ templates: 0, projects: 0, smes: 0, generations: 0, deployments: 0 });
  });

  it('is Admin only (RBAC)', async () => {
    for (const role of ['PM', 'REVIEWER'] as const) {
      const cookie = await login(app, (await createUser(clientId, [role])).email);
      expect((await http.post(cookie, URL)).statusCode, role).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: `/api/v1${URL}`, headers: idem(), payload: {} })).statusCode).toBe(401);
    expect(await db.template.count()).toBe(0);
  });
});
