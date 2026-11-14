import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TemplateDirectoryResponse } from '@praxis/shared';
import { buildTestApp, createCandidate, createClient, createUser, db, login, resetDb } from './helpers';
import { tptLabel } from '../src/meta-compiler/blueprint';
import { api, exampleBlueprint, seedProject, seedTemplate } from './meta-compiler-fixtures';

describe('A1 Templates directory (S1-01 to S1-11, S1-15)', () => {
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let adminId: string;
  let admin: string;
  let pm: string;
  let reviewer: string;

  beforeAll(async () => {
    app = await buildTestApp({ CANDIDATE_APP_URL: 'https://experts.example.test' });
    http = api(app);
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    const a = await createUser(clientId, ['ADMIN']);
    adminId = a.id;
    admin = await login(app, a.email);
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** Digital Marketing: a published v1 with a newer draft v2 and an active studio on v1; Banking: one draft; Empty domain. */
  async function catalog() {
    const mktg = await db.domain.create({ data: { clientId, name: 'Digital Marketing' } });
    const banking = await db.domain.create({ data: { clientId, name: 'Banking' } });
    await db.domain.create({ data: { clientId, name: 'Empty' } });
    await db.domain.create({ data: { clientId, name: 'Old', status: 'RETIRED' } });
    const v1 = await seedTemplate(clientId, { domainId: mktg.id, status: 'PUBLISHED' });
    const v2 = await seedTemplate(clientId, { domainId: mktg.id, lineageId: v1.lineageId, version: 2, status: 'DRAFT', blueprint: v1.blueprint as never });
    const kyb = await seedTemplate(clientId, { domainId: banking.id, name: 'KYB and beneficial ownership', blueprint: null });
    await seedTemplate(clientId, { domainId: banking.id, name: 'Retired workflow', status: 'RETIRED', blueprint: null });
    const project = await seedProject(clientId, adminId, v1, 'PRJ-MKTG-101');
    const sme = await createCandidate(clientId);
    await db.smeUser.update({ where: { id: sme.smeUserId }, data: { contactEmail: 'sme.one@example.test' } });
    const run = await db.compilerGenerationRun.create({ data: { clientId, templateId: v1.id, templateVersion: 1, provider: 'mock', model: 'mock', promptHash: 'h', requestedById: adminId, status: 'SUCCEEDED' } });
    const ver = await db.compilerVerificationRun.create({ data: { clientId, generationRunId: run.id, requestedById: adminId, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 1 } });
    await db.studioDeployment.create({ data: { clientId, templateId: v1.id, templateLineageId: v1.lineageId, templateVersion: 1, projectId: project.id, candidateId: sme.id, verificationRunId: ver.id, studioKey: 'mktg-launch-abc123', deployedById: adminId } });
    return { mktg, banking, v1, v2, kyb, project };
  }

  it('Admin view: domains with counts, newest version per workflow, all columns, retired workflows hidden', async () => {
    const { v2, kyb, project } = await catalog();
    const res = await http.get(admin, '/templates/directory');
    expect(res.statusCode, res.body).toBe(200);
    const body = TemplateDirectoryResponse.parse(res.json());
    expect(body.view).toBe('ADMIN');
    expect(body.domains.map((d) => [d.domainName, d.rows.length])).toEqual([['Banking', 1], ['Digital Marketing', 1], ['Empty', 0]]);
    const row = body.domains[1]!.rows[0]!;
    expect(row).toMatchObject({ templateId: v2.id, version: 2, templateStatus: 'DRAFT', status: 'DRAFT', tptMinutes: 45, tptLabel: '12 Wks', modes: ['HERMETIC_MCP'], validSections: 6, hasBlueprint: true, definedByAnvil: false, projectCount: 1 });
    // The studio runs v1; the row shows v2 (a draft), so the badge is Draft, but the live studio is still listed (S1-10, S3-09).
    expect(row.deployments).toEqual([{ id: expect.any(String), projectId: project.id, projectName: 'PRJ-MKTG-101', status: 'ACTIVE', smeEmail: 'sme.one@example.test', studioUrl: 'https://experts.example.test/studio/mktg-launch-abc123' }]);
    const k = body.domains[0]!.rows[0]!;
    expect(k).toMatchObject({ templateId: kyb.id, hasBlueprint: false, definedByAnvil: false, validSections: 0, tptLabel: '', modes: [], deployments: [] });
    expect(body.summary).toEqual({ totalTemplates: 2, activeStudios: 1, attachedProjects: 1, attachedSmes: 1, authoredTasks: 0 });

    const withRetired = TemplateDirectoryResponse.parse((await http.get(admin, '/templates/directory?includeRetired=true')).json());
    expect(withRetired.domains[0]!.rows.map((r) => r.workflowName)).toEqual(['KYB and beneficial ownership', 'Retired workflow']);
  });

  it('status is Active when the shown version has an active studio (S1-07)', async () => {
    const mktg = await db.domain.create({ data: { clientId, name: 'Digital Marketing' } });
    const t = await seedTemplate(clientId, { domainId: mktg.id, status: 'PUBLISHED' });
    const project = await seedProject(clientId, adminId, t);
    const sme = await createCandidate(clientId);
    const run = await db.compilerGenerationRun.create({ data: { clientId, templateId: t.id, templateVersion: 1, provider: 'mock', model: 'mock', promptHash: 'h', requestedById: adminId, status: 'SUCCEEDED' } });
    const ver = await db.compilerVerificationRun.create({ data: { clientId, generationRunId: run.id, requestedById: adminId, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 1 } });
    let row = TemplateDirectoryResponse.parse((await http.get(admin, '/templates/directory')).json()).domains[0]!.rows[0]!;
    expect(row.status).toBe('VERIFIED');
    await db.studioDeployment.create({ data: { clientId, templateId: t.id, templateLineageId: t.lineageId, templateVersion: 1, projectId: project.id, candidateId: sme.id, verificationRunId: ver.id, studioKey: `k-${randomUUID()}`, deployedById: adminId } });
    row = TemplateDirectoryResponse.parse((await http.get(admin, '/templates/directory')).json()).domains[0]!.rows[0]!;
    expect(row.status).toBe('ACTIVE');
  });

  it('PM view: newest published version only, no drafts, no SME emails or studio URLs, empty domains hidden (S1-15)', async () => {
    const { v1 } = await catalog();
    const res = await http.get(pm, '/templates/directory?includeRetired=true');
    expect(res.statusCode).toBe(200);
    const body = TemplateDirectoryResponse.parse(res.json());
    expect(body.view).toBe('PM');
    expect(body.domains.map((d) => d.domainName)).toEqual(['Digital Marketing']);
    const row = body.domains[0]!.rows[0]!;
    expect(row).toMatchObject({ templateId: v1.id, version: 1, status: 'ACTIVE' });
    expect(row.deployments[0]).toMatchObject({ smeEmail: null, studioUrl: null });
    expect(res.body).not.toContain('sme.one@example.test');
    expect(res.body).not.toContain('/studio/');
  });

  it('access: Admin and PM only; signed-out callers get 401; other clients see nothing of ours', async () => {
    await catalog();
    expect((await http.get(reviewer, '/templates/directory')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/templates/directory' })).statusCode).toBe(401);
    const other = await createClient();
    const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
    const body = TemplateDirectoryResponse.parse((await http.get(otherAdmin, '/templates/directory')).json());
    expect(body.domains).toEqual([]);
    expect(body.summary.totalTemplates).toBe(0);
  });

  it('500 workflows load in under 2 s (NFR-12)', async () => {
    const d = await db.domain.create({ data: { clientId, name: 'Bulk' } });
    const bp = (await seedTemplate(clientId, { domainId: d.id, name: 'seed' })).blueprint as object;
    await db.template.createMany({ data: Array.from({ length: 499 }, (_, i) => ({ clientId, domainId: d.id, lineageId: randomUUID(), workflowName: `Workflow ${i}`, blueprint: bp })) });
    const start = Date.now();
    const res = await http.get(admin, '/templates/directory');
    expect(res.statusCode).toBe(200);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(res.json().summary.totalTemplates).toBe(500);
  });

  it('S1-08: the API sends only the horizon, such as "12 Wks"; the console adds the minutes (DEF-1)', () => {
    const bp = exampleBlueprint();
    expect(tptLabel(bp, null)).toEqual({ minutes: 45, label: '12 Wks' });
    expect(tptLabel({ ...bp, template_meta: { ...bp.template_meta, tpt_label: '15 Steps' } }, null).label).toBe('15 Steps');
    expect(tptLabel({ ...bp, template_meta: { ...bp.template_meta, tpt_label: '' } }, null).label).toBe('12 Wks');
    expect(tptLabel(null, 30)).toEqual({ minutes: 30, label: '' });
  });
});
