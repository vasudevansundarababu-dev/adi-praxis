import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Corrected (reusable, five-state) KYC template: Anvil's corrective proposal becomes the next DRAFT version of the
 * existing KYC lineage with target 5 and no quotas, whatever the previous version had (KYC five-state contract K1-K6;
 * requirement 49172 sections 5.1-5.3). Mocks only: no network, no model, no paid calls.
 */
const PACKET = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const WORKFLOW = 'KYC onboarding and refresh';
const clone = () => structuredClone(PACKET);

describe('corrected KYC template (reusable five-state proposal)', () => {
  let app: FastifyInstance;
  let admin: string;
  let anvilKey: string;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
  });
  beforeEach(async () => {
    await resetDb();
    await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    anvilKey = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const propose = (body: object) => app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });
  const validate = (body: object) => app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/validate', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });

  /** A published KYC version carrying the old per-application cardinality (target 200, coverage cells, edge quotas). */
  async function oldPublishedVersion() {
    const domainId = (await app.inject({ method: 'POST', url: '/api/v1/domains', headers: { cookie: admin, ...idem() }, payload: { name: 'Banking' } })).json().id;
    const t = (await app.inject({ method: 'POST', url: '/api/v1/templates', headers: { cookie: admin, ...idem() }, payload: { domainId, workflowName: WORKFLOW, primaryWork: 'Old per-application KYC.', verificationCriteria: 'Old.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] } })).json();
    await db.template.update({
      where: { id: t.id },
      data: {
        defaultDistinctTarget: 200,
        coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['checking', 'savings'] }], cells: [{ tags: { product: 'checking' }, quota: 10, required: true }, { tags: { product: 'savings' }, quota: 10, required: true }] },
        edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }],
      },
    });
    const pub = await app.inject({ method: 'POST', url: `/api/v1/templates/${t.id}/publish`, headers: { cookie: admin, ...idem() } });
    expect(pub.statusCode, pub.body).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id: t.id } });
  }

  it('the corrected packet is authorable', async () => {
    await oldPublishedVersion();
    const v = await validate(clone());
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().data).toMatchObject({ valid: true, errors: [] });
  });

  it('becomes the next DRAFT of the same lineage with target 5 and no quotas; the published version is untouched; parts stored verbatim', async () => {
    const old = await oldPublishedVersion();
    const body = clone();
    const res = await propose(body);
    expect(res.statusCode, res.body).toBe(201);
    const d = res.json().data;
    expect(d).toMatchObject({ status: 'draft_created', template_id: old.lineageId, version: old.version + 1, profile_id: 'golden-kyc-reusable-v1' });

    const draft = await db.template.findUniqueOrThrow({ where: { id: d.template_version_id } });
    expect(draft).toMatchObject({ lineageId: old.lineageId, status: 'DRAFT', profileId: 'golden-kyc-reusable-v1', defaultDistinctTarget: 5 });
    expect(draft.coverageDimensions).toEqual({ dimensions: [], cells: [] });
    expect(draft.edgeCaseCatalog).toEqual([]);
    const spec = draft.anvilSpec as Record<string, any>;
    expect(spec.authoring.template.caseSelector).toEqual({ field: 'governing_state', source: 'S1.governingState', values: ['CA', 'NY', 'TX', 'FL', 'IL'] });
    expect(spec.execution).toEqual(body.execution);
    expect(spec.execution.schema_version).toBe('anvil.template-execution.v2');

    const after = await db.template.findUniqueOrThrow({ where: { id: old.id } });
    expect(after).toMatchObject({ status: 'PUBLISHED', defaultDistinctTarget: 200 });
    expect((after.edgeCaseCatalog as unknown[]).length).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: draft.id, action: 'template.version_created' } })).toBe(1);
  });

  it("Keystone's unedited packet is refused with each reason named", async () => {
    await oldPublishedVersion();
    const raw = clone();
    raw.authoring.profile.coverageDimensions = [];
    raw.authoring.profile.edgeCases = [];
    const r1 = await validate(raw);
    expect(r1.statusCode).toBe(422);
    expect(JSON.stringify(r1.json().data.errors)).toMatch(/coverageDimensions|edgeCases/);

    const noOutputs = clone();
    delete noOutputs.authoring.profile.contract.outputsFrom;
    const r2 = (await validate(noOutputs)).json().data;
    expect(JSON.stringify(r2.errors)).toMatch(/no output fields/);
  });

  it('a reused form ID is refused (v4/v5 keep their form)', async () => {
    await oldPublishedVersion();
    expect((await propose(clone())).statusCode).toBe(201);
    const again = await validate(clone());
    expect(again.statusCode).toBe(422);
    expect(again.json().data.errors.map((e: { code: string }) => e.code)).toContain('TP_FORM_ID_TAKEN');
  });

  it('the case selector must match the pick list exactly, and may not come with task-multiplying quotas or another target', async () => {
    await oldPublishedVersion();
    const cases: [string, (b: Record<string, any>) => void, RegExp][] = [
      ['missing value', (b) => (b.authoring.template.caseSelector.values = ['CA', 'NY', 'TX', 'FL']), /must equal the options/],
      ['unknown field', (b) => (b.authoring.template.caseSelector.source = 'S1.residenceState'), /not a field of the form/],
      ['not a pick list', (b) => (b.authoring.template.caseSelector.source = 'S1.title'), /must be a pick_list/],
      ['target', (b) => (b.authoring.template.defaultDistinctTarget = 200), /must be 5/],
      ['edge quota', (b) => (b.authoring.template.edgeCaseCatalog = [{ name: 'PEP link', quota: 1, required: true }]), /no edge-case quotas/],
      ['coverage', (b) => (b.authoring.template.coverageDimensions = { dimensions: [{ key: 'product', label: 'Product', values: ['a'] }], cells: [] }), /no coverage quotas/],
    ];
    for (const [name, edit, msg] of cases) {
      const b = clone();
      edit(b);
      const r = await validate(b);
      expect(r.statusCode, name).toBe(422);
      expect(JSON.stringify(r.json().data.errors), name).toMatch(msg);
    }
  });

  it('execution v2 needs exact federal policy references', async () => {
    await oldPublishedVersion();
    for (const fp of [undefined, [], [{ id: 'federal-cip', version: '1', content_sha256: 'not-a-hash', publication_ref: 'x' }]]) {
      const b = clone();
      if (fp === undefined) delete b.execution.federalPolicies;
      else b.execution.federalPolicies = fp;
      const r = await validate(b);
      expect(r.statusCode).toBe(422);
      expect(JSON.stringify(r.json().data.errors)).toMatch(/federalPolicies/);
    }
    // An invalid proposal is refused with 422 (not a server error) and creates nothing.
    const bad = clone();
    delete bad.execution.federalPolicies;
    const before = await db.template.count();
    const refused = await propose(bad);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().data).toMatchObject({ valid: false, status: 'template_invalid' });
    expect(await db.template.count()).toBe(before);
    const unknown = clone();
    unknown.execution.schema_version = 'anvil.template-execution.v3';
    expect((await validate(unknown)).statusCode).toBe(422);
  });
});
