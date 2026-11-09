import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StudioDeploymentDto, TemplateDirectoryResponse, type HarborBlueprint } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { MockRunner, type HarborRunner } from '../src/harbor/runner';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createCandidate, createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';
import { api, assignSme, generateAndVerify, seedProject, seedTemplate, workerFor } from './meta-compiler-fixtures';

describe('A7 studio deployments (S3-05 to S3-07, S3-09, D14)', () => {
  const storage = new MemoryStorage();
  const config = testConfig({ CANDIDATE_APP_URL: 'https://experts.example.test' });
  let runner: HarborRunner = new MockRunner(storage);
  const work = workerFor({ config, storage, get runner() { return runner; } } as never);
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let adminId: string;
  let admin: string;
  let pm: string;

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, metaCompiler: { runner: { kind: 'mock', run: (r, m) => runner.run(r, m) } } });
    http = api(app);
  });
  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    runner = new MockRunner(storage);
    clientId = (await createClient()).id;
    const a = await createUser(clientId, ['ADMIN']);
    adminId = a.id;
    admin = await login(app, a.email);
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function ready() {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED' });
    const project = await seedProject(clientId, adminId, t, 'PRJ-MKTG-101');
    const sme = await assignSme(clientId, project.id);
    const { verificationId } = await generateAndVerify(http, admin, work, t.id);
    return { t, project, sme, verificationId };
  }
  const deploy = (templateId: string, body: { verificationRunId: string; projectId: string; smeCandidateId: string }, key = idem()) => http.post(admin, `/templates/${templateId}/deployments`, body, key);

  it('deploys a verified version for an assigned SME at a candidate-app studio URL; the directory shows Active', async () => {
    const { t, project, sme, verificationId } = await ready();
    const res = await deploy(t.id, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: sme.id });
    expect(res.statusCode, res.body).toBe(201);
    const d = StudioDeploymentDto.parse(res.json());
    expect(d).toMatchObject({ templateId: t.id, templateVersion: 1, projectId: project.id, smeCandidateId: sme.id, status: 'ACTIVE', runtime: 'SHARED' });
    expect(d.studioKey).toMatch(new RegExp(`^${(t.blueprint as HarborBlueprint).studio_id}-[0-9a-f]{8}$`));
    expect(d.studioUrl).toBe(`https://experts.example.test/studio/${d.studioKey}`);
    expect(await db.auditEvent.count({ where: { entityId: d.id, action: 'studio.deployed' } })).toBe(1);
    const dir = TemplateDirectoryResponse.parse((await http.get(admin, '/templates/directory')).json());
    expect(dir.domains[0]!.rows[0]).toMatchObject({ status: 'ACTIVE', deployments: [{ id: d.id, studioUrl: d.studioUrl }] });
    const list = await http.get(admin, `/templates/${t.id}/deployments`);
    expect(list.json().items).toEqual([d]);
  });

  it('is idempotent: the same key replays, and the same deployment again changes nothing', async () => {
    const { t, project, sme, verificationId } = await ready();
    const body = { verificationRunId: verificationId, projectId: project.id, smeCandidateId: sme.id };
    const key = idem();
    const a = await deploy(t.id, body, key);
    expect((await deploy(t.id, body, key)).headers['idempotent-replayed']).toBe('true');
    const again = await deploy(t.id, body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(a.json());
    expect(await db.studioDeployment.count()).toBe(1);
  });

  it('blocks deploy unless the verification passed with 0.00 and 1.00 for this template version (S3-05, D-12)', async () => {
    const { t, project, sme } = await ready();
    runner = new MockRunner(storage, { oracle: 0.5 });
    const { verificationId: failed } = await generateAndVerify(http, admin, work, (await seedTemplate(clientId, { name: 'Other', domainId: t.domainId })).id);
    const otherVersion = await deploy(t.id, { verificationRunId: failed, projectId: project.id, smeCandidateId: sme.id });
    expect(otherVersion.json().error).toBe('VERIFICATION_MISMATCH');
    // A failing verification of this very version.
    await db.template.update({ where: { id: t.id }, data: { blueprintRevision: 9 } });
    const g = await db.compilerGenerationRun.findFirstOrThrow({ where: { templateId: t.id } });
    const v = await db.compilerVerificationRun.create({ data: { clientId, generationRunId: g.id, requestedById: adminId, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 0.5 } });
    const blocked = await deploy(t.id, { verificationRunId: v.id, projectId: project.id, smeCandidateId: sme.id });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('VERIFICATION_REQUIRED');
    const pending = await db.compilerVerificationRun.create({ data: { clientId, generationRunId: g.id, requestedById: adminId } });
    expect((await deploy(t.id, { verificationRunId: pending.id, projectId: project.id, smeCandidateId: sme.id })).json().error).toBe('VERIFICATION_REQUIRED');
    expect(await db.studioDeployment.count()).toBe(0);
  });

  it('needs a project of this client that uses the workflow, and an SME assigned to it (S3-06)', async () => {
    const { t, project, verificationId } = await ready();
    const unassigned = await createCandidate(clientId);
    expect((await deploy(t.id, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: unassigned.id })).json().error).toBe('SME_NOT_ASSIGNED');
    const otherWorkflow = await seedTemplate(clientId, { name: 'Other workflow', status: 'PUBLISHED' });
    const otherProject = await seedProject(clientId, adminId, otherWorkflow);
    const sme2 = await assignSme(clientId, otherProject.id);
    expect((await deploy(t.id, { verificationRunId: verificationId, projectId: otherProject.id, smeCandidateId: sme2.id })).json().error).toBe('PROJECT_NOT_ELIGIBLE');
    const other = await createClient();
    const foreignAdmin = await createUser(other.id, ['ADMIN']);
    const foreignTemplate = await seedTemplate(other.id, { status: 'PUBLISHED' });
    const foreignProject = await seedProject(other.id, foreignAdmin.id, foreignTemplate);
    const foreignSme = await assignSme(other.id, foreignProject.id);
    expect((await deploy(t.id, { verificationRunId: verificationId, projectId: foreignProject.id, smeCandidateId: foreignSme.id })).statusCode).toBe(404);
    const targets = (await http.get(admin, `/templates/${t.id}/deployment-targets`)).json();
    expect(targets.projects.map((p: { id: string }) => p.id)).toEqual([project.id]);
    expect(targets.projects[0].smes).toHaveLength(1);
  });

  it('redeploying a newer version keeps the studio key and URL; the old version stays live until then (S3-09, D14)', async () => {
    const { t, project, sme, verificationId } = await ready();
    const first = StudioDeploymentDto.parse((await deploy(t.id, { verificationRunId: verificationId, projectId: project.id, smeCandidateId: sme.id })).json());
    const v2 = await http.post(admin, `/templates/${t.id}/versions`);
    const v2id = v2.json().id as string;
    // A failing v2 verification cannot replace the live v1 studio.
    runner = new MockRunner(storage, { 'null-agent': 1 });
    const bad = await generateAndVerify(http, admin, work, v2id);
    expect((await deploy(v2id, { verificationRunId: bad.verificationId, projectId: project.id, smeCandidateId: sme.id })).statusCode).toBe(409);
    expect(await db.studioDeployment.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ templateId: t.id, templateVersion: 1, status: 'ACTIVE' });
    runner = new MockRunner(storage);
    const v = await http.post(admin, `/generations/${bad.generationId}/verifications`);
    await work();
    const second = await deploy(v2id, { verificationRunId: v.json().id, projectId: project.id, smeCandidateId: sme.id });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ id: first.id, studioKey: first.studioKey, studioUrl: first.studioUrl, templateId: v2id, templateVersion: 2, status: 'ACTIVE' });
    expect(await db.auditEvent.count({ where: { entityId: first.id, action: 'studio.redeployed' } })).toBe(1);
  });

  it('access: Admin only (D9); other clients get 404', async () => {
    const { t, project, sme, verificationId } = await ready();
    const body = { verificationRunId: verificationId, projectId: project.id, smeCandidateId: sme.id };
    expect((await http.post(pm, `/templates/${t.id}/deployments`, body)).statusCode).toBe(403);
    expect((await http.get(pm, `/templates/${t.id}/deployments`)).statusCode).toBe(403);
    expect((await http.get(pm, `/templates/${t.id}/deployment-targets`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${t.id}/deployments`, headers: idem(), payload: body })).statusCode).toBe(401);
    const otherAdmin = await login(app, (await createUser((await createClient()).id, ['ADMIN'])).email);
    expect((await http.post(otherAdmin, `/templates/${t.id}/deployments`, body)).statusCode).toBe(404);
    expect((await http.get(otherAdmin, `/templates/${t.id}/deployments`)).statusCode).toBe(404);
  });
});
