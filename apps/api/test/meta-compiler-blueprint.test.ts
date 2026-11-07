import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlueprintResponse, HarborBlueprint } from '@praxis/shared';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';
import { api, exampleBlueprint, jsonBody, seedTemplate } from './meta-compiler-fixtures';

describe('A2 blueprint read and save, Save Variant, UISpec export (S2-01, S2-11, S2-12, S2-15, S2-16, D-02)', () => {
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let admin: string;
  let admin2: string;
  let pm: string;
  let reviewer: string;

  beforeAll(async () => {
    app = await buildTestApp();
    http = api(app);
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    admin = await login(app, (await createUser(clientId, ['ADMIN'])).email);
    admin2 = await login(app, (await createUser(clientId, ['ADMIN'])).email);
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const save = (cookie: string, id: string, bp: HarborBlueprint, expectedRevision: number) => http.put(cookie, `/templates/${id}/blueprint`, { blueprint: jsonBody(bp), expectedRevision });

  it('reads the stored blueprint with revision and server-side section problems (S2-01, D-03)', async () => {
    const t = await seedTemplate(clientId);
    const res = await http.get(admin, `/templates/${t.id}/blueprint`);
    expect(res.statusCode, res.body).toBe(200);
    const body = BlueprintResponse.parse(res.json());
    expect(body).toMatchObject({ templateId: t.id, version: 1, templateStatus: 'DRAFT', editable: true, blueprintRevision: 0, validSections: 6 });
    expect(body.blueprint.studio_id).toBe((t.blueprint as { studio_id: string }).studio_id);
  });

  it('a template without a blueprint opens with panel 0 pre-filled from its catalog fields (D11b)', async () => {
    const t = await seedTemplate(clientId, { blueprint: null });
    const body = BlueprintResponse.parse((await http.get(admin, `/templates/${t.id}/blueprint`)).json());
    expect(body.blueprint.catalog).toMatchObject({ primary_work: 'Plan a launch budget.', skills: ['Marketing'], task_modes: ['AUTHORING'] });
    expect(body.blueprint.template_meta).toMatchObject({ label: t.workflowName, tpt_minutes: 45 });
    expect(body.validSections).toBe(1);
  });

  it('saving needs the expected revision; a stale save gets 409 BLUEPRINT_CONFLICT and never overwrites (S2-16)', async () => {
    const t = await seedTemplate(clientId);
    const bp = exampleBlueprint((t.blueprint as { studio_id: string }).studio_id);
    bp.domain_meta.persona_label = 'Admin one';
    const first = await save(admin, t.id, bp, 0);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ blueprintRevision: 1, validSections: 6 });
    bp.domain_meta.persona_label = 'Admin two';
    const second = await save(admin2, t.id, bp, 0);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'BLUEPRINT_CONFLICT', details: { revision: 1 } });
    const stored = await db.template.findUniqueOrThrow({ where: { id: t.id } });
    expect((stored.blueprint as HarborBlueprint).domain_meta.persona_label).toBe('Admin one');
    const audit = await db.auditEvent.findMany({ where: { entityId: t.id, action: 'template.blueprint_saved' } });
    expect(audit).toHaveLength(1);
  });

  it('the server re-runs the validators: problems come back, the draft still saves, and catalog columns follow panel 0', async () => {
    const t = await seedTemplate(clientId);
    const bp = exampleBlueprint((t.blueprint as { studio_id: string }).studio_id);
    bp.step_5_default_rubric.milestones[0]!.weight = 10;
    bp.catalog.primary_work = 'Changed primary work';
    const res = await save(admin, t.id, bp, 0);
    expect(res.statusCode).toBe(200);
    const body = BlueprintResponse.parse(res.json());
    expect(body.validSections).toBe(5);
    expect(body.problems.stage_5).toEqual(['Milestone weights must add up to 100 (now 50)']);
    expect((await db.template.findUniqueOrThrow({ where: { id: t.id } })).primaryWork).toBe('Changed primary work');
  });

  it('the Studio Blueprint ID must be unique per client (S2-02)', async () => {
    const a = await seedTemplate(clientId, { name: 'A' });
    const b = await seedTemplate(clientId, { name: 'B', domainId: a.domainId });
    const taken = (a.blueprint as { studio_id: string }).studio_id;
    const res = await save(admin, b.id, exampleBlueprint(taken), 0);
    expect(res.statusCode).toBe(200);
    expect(res.json().problems.stage_1).toEqual([`Studio Blueprint ID "${taken}" is already used by another workflow`]);
  });

  it('only drafts are editable (TEMPLATE_NOT_EDITABLE); a new version copies the blueprint and allows edits; one draft per workflow (S2-15, D-02)', async () => {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED' });
    const bp = exampleBlueprint((t.blueprint as { studio_id: string }).studio_id);
    const res = await save(admin, t.id, bp, 0);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('TEMPLATE_NOT_EDITABLE');
    const v2 = await http.post(admin, `/templates/${t.id}/versions`);
    expect(v2.statusCode, v2.body).toBe(201);
    const copy = await db.template.findUniqueOrThrow({ where: { id: v2.json().id } });
    expect(copy.blueprint).toEqual(t.blueprint);
    expect(copy.executionMode).toBe('HERMETIC_MCP');
    const again = await http.post(admin, `/templates/${t.id}/versions`);
    expect(again.json().error).toBe('DRAFT_EXISTS');
    const saved = await save(admin, copy.id, bp, copy.blueprintRevision);
    expect(saved.statusCode, saved.body).toBe(200);
    // The published version is untouched (projects keep their pinned blueprint).
    expect((await db.template.findUniqueOrThrow({ where: { id: t.id } })).blueprint).toEqual(t.blueprint);
  });

  it('a template without a blueprint can still get a new version (old catalog keeps working)', async () => {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED', blueprint: null });
    const v2 = await http.post(admin, `/templates/${t.id}/versions`);
    expect(v2.statusCode, v2.body).toBe(201);
    expect((await db.template.findUniqueOrThrow({ where: { id: v2.json().id } })).blueprint).toBeNull();
  });

  it('Save Variant creates a new DRAFT v1 lineage linked to its source; label unique in the domain; source unchanged (S2-12)', async () => {
    const t = await seedTemplate(clientId, { status: 'PUBLISHED' });
    const res = await http.post(admin, `/templates/${t.id}/variant`, { label: 'Launch of Smart Watch' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, variantOfId: t.id });
    expect(res.json().lineageId).not.toBe(t.lineageId);
    const v = await db.template.findUniqueOrThrow({ where: { id: res.json().templateId } });
    expect(v).toMatchObject({ status: 'DRAFT', version: 1, workflowName: 'Launch of Smart Watch', domainId: t.domainId, variantOfId: t.id, blueprintRevision: 0 });
    const vbp = v.blueprint as HarborBlueprint;
    expect(vbp.template_meta.label).toBe('Launch of Smart Watch');
    expect(vbp.studio_id).toBe('launch-of-smart-watch');
    expect(vbp.step_5_default_rubric).toEqual((t.blueprint as HarborBlueprint).step_5_default_rubric);
    expect(BlueprintResponse.parse((await http.get(admin, `/templates/${v.id}/blueprint`)).json()).validSections).toBe(6);
    expect((await db.template.findUniqueOrThrow({ where: { id: t.id } })).updatedAt).toEqual(t.updatedAt);

    const dup = await http.post(admin, `/templates/${t.id}/variant`, { label: 'launch of smart watch' });
    expect(dup.statusCode).toBe(409);
    expect((await http.post(admin, `/templates/${t.id}/variant`, { label: t.workflowName })).statusCode).toBe(409);
    expect(await db.auditEvent.count({ where: { action: 'template.variant_created' } })).toBe(1);
  });

  it('Save Variant is idempotent per Idempotency-Key', async () => {
    const t = await seedTemplate(clientId);
    const key = idem();
    const a = await http.post(admin, `/templates/${t.id}/variant`, { label: 'Retry me' }, key);
    const b = await http.post(admin, `/templates/${t.id}/variant`, { label: 'Retry me' }, key);
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual(a.json());
    expect(b.headers['idempotent-replayed']).toBe('true');
  });

  it('UISpec export downloads the blueprint JSON and is audited (S2-11)', async () => {
    const t = await seedTemplate(clientId);
    const res = await http.get(admin, `/templates/${t.id}/uispec`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+-v1\.UISpec\.json"/);
    expect(HarborBlueprint.parse(res.json())).toEqual(HarborBlueprint.parse(t.blueprint));
    expect(await db.auditEvent.count({ where: { entityId: t.id, action: 'template.uispec_exported' } })).toBe(1);
  });

  it('access: PM reads published blueprints only; only Admins save, vary or export; other clients get 404', async () => {
    const draft = await seedTemplate(clientId);
    const pub = await seedTemplate(clientId, { status: 'PUBLISHED', name: 'Published one', domainId: draft.domainId });
    expect((await http.get(pm, `/templates/${draft.id}/blueprint`)).statusCode).toBe(404);
    const pmView = await http.get(pm, `/templates/${pub.id}/blueprint`);
    expect(pmView.statusCode).toBe(200);
    expect(pmView.json().editable).toBe(false);
    expect((await http.get(reviewer, `/templates/${pub.id}/blueprint`)).statusCode).toBe(403);
    const bp = exampleBlueprint();
    expect((await save(pm, draft.id, bp, 0)).statusCode).toBe(403);
    expect((await http.post(pm, `/templates/${draft.id}/variant`, { label: 'x' })).statusCode).toBe(403);
    expect((await http.get(pm, `/templates/${draft.id}/uispec`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/templates/${draft.id}/blueprint` })).statusCode).toBe(401);
    const other = await createClient();
    const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
    expect((await http.get(otherAdmin, `/templates/${draft.id}/blueprint`)).statusCode).toBe(404);
    expect((await save(otherAdmin, draft.id, bp, 0)).statusCode).toBe(404);
    expect((await http.post(otherAdmin, `/templates/${draft.id}/variant`, { label: 'x' })).statusCode).toBe(404);
    expect((await http.get(otherAdmin, `/templates/${draft.id}/uispec`)).statusCode).toBe(404);
  });

  it('rejects a blueprint that breaks the schema (network_internal can never be false)', async () => {
    const t = await seedTemplate(clientId);
    const body = jsonBody(exampleBlueprint());
    (body.harbor_contract as Record<string, unknown>).network_internal = false;
    const res = await http.put(admin, `/templates/${t.id}/blueprint`, { blueprint: body, expectedRevision: 0 });
    expect(res.statusCode).toBe(400);
  });
});

describe('agentFacingBlueprint (D-21)', () => {
  it('removes judge checklists, which hold the answer key, along with verifier bodies', async () => {
    const { agentFacingBlueprint } = await import('../src/meta-compiler/blueprint');
    const bp = exampleBlueprint();
    const m = bp.step_5_default_rubric.milestones[0]!;
    bp.step_5_default_rubric.milestones[0] = {
      ...m,
      verifier_template: 'llm_judge_checklist',
      judge: { deliverable_path: '/workspace/outputs/report.md', system_prompt: 'Grade strictly.', criteria: [{ num: 1, category: '', text: 'SECRET-ANSWER 7.6%', points: 1 }] },
    };
    const view = agentFacingBlueprint(bp);
    expect(view.step_5_default_rubric.milestones.every((x) => x.judge === null && x.verifier_body === '')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('SECRET-ANSWER');
    expect(bp.step_5_default_rubric.milestones[0]!.judge).not.toBeNull();
  });
});
