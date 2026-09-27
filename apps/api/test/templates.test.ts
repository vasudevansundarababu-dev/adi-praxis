import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { passThroughValidator } from '../src/templates/task-definition';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';

const COMPLETE = {
  primaryWork: 'Assemble identity evidence, reconcile fields, detect gaps, recommend a disposition.',
  verificationCriteria: 'Document/data checks, completeness, policy adherence, reviewer agreement.',
  humanGate: 'Approval, rejection and high-risk classification remain authorized decisions.',
  defaultTptMinutes: 90,
  skills: ['KYC', 'EDD'],
  taskModes: ['AUTHORING'],
};

describe('M1 template catalog', () => {
  let app: FastifyInstance;
  let admin: string;
  let pm: string;
  let reviewer: string;
  let domainId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    const { id: clientId } = await createClient();
    admin = await login(app, (await createUser(clientId, ['ADMIN'])).email);
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  function post(cookie: string, url: string, payload: unknown = {}) {
    return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  }
  function patch(cookie: string, url: string, payload: unknown) {
    return app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  }
  function get(cookie: string, url: string) {
    return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  }
  async function createTemplate(extra: object = {}, name = 'KYC onboarding and refresh') {
    const res = await post(admin, '/templates', { domainId, workflowName: name, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; lineageId: string; version: number; status: string };
  }
  async function publishedTemplate(name?: string) {
    const t = await createTemplate(COMPLETE, name);
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t;
  }
  const pmList = async () => (await get(pm, '/templates')).json().items as { id: string; version: number }[];

  describe('domains', () => {
    it('an Admin creates domains; names are unique regardless of case', async () => {
      expect((await post(admin, '/domains', { name: 'Healthcare' })).statusCode).toBe(201);
      const dup = await post(admin, '/domains', { name: 'banking' });
      expect(dup.statusCode).toBe(409);
      const list = (await get(pm, '/domains')).json().items.map((d: { name: string }) => d.name);
      expect(list).toEqual(['Banking', 'Healthcare']);
    });

    it('PMs and Reviewers cannot create domains', async () => {
      expect((await post(pm, '/domains', { name: 'Marketing' })).statusCode).toBe(403);
      expect((await post(reviewer, '/domains', { name: 'Marketing' })).statusCode).toBe(403);
    });
  });

  describe('create and edit drafts', () => {
    it('a new template is DRAFT version 1 of a new workflow, and is audited', async () => {
      const t = await createTemplate();
      expect(t).toMatchObject({ version: 1, status: 'DRAFT' });
      const audit = await db.auditEvent.findMany({ where: { entityId: t.id } });
      expect(audit.map((a) => a.action)).toEqual(['template.created']);
    });

    it('applies the diversity defaults from SPEC', async () => {
      const t = (await get(admin, `/templates/${(await createTemplate()).id}`)).json();
      expect(t).toMatchObject({
        defaultDistinctTarget: 50,
        defaultMaxPerExpert: 4,
        openSlotShare: 0.2,
        similarityThreshold: 0.9,
        coverageDimensions: { dimensions: [], cells: [] },
        edgeCaseCatalog: [],
      });
    });

    it('workflow names are unique within a domain (any case) but may repeat across domains', async () => {
      await createTemplate();
      const dup = await post(admin, '/templates', { domainId, workflowName: 'kyc ONBOARDING and refresh' });
      expect(dup.statusCode).toBe(409);
      const other = (await post(admin, '/domains', { name: 'Research Assistant' })).json().id;
      expect((await post(admin, '/templates', { domainId: other, workflowName: 'KYC onboarding and refresh' })).statusCode).toBe(201);
    });

    it('a draft can be edited in place; the audit records only the changed fields', async () => {
      const t = await createTemplate();
      const res = await patch(admin, `/templates/${t.id}`, { defaultTptMinutes: 60, skills: ['KYC', 'KYC', 'AML'] });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ version: 1, defaultTptMinutes: 60, skills: ['KYC', 'AML'] });
      const ev = await db.auditEvent.findFirstOrThrow({ where: { entityId: t.id, action: 'template.updated' } });
      expect(ev.before).toEqual({ defaultTptMinutes: null, skills: [] });
      expect(ev.after).toEqual({ defaultTptMinutes: 60, skills: ['KYC', 'AML'] });
    });

    it('rejects an invalid coverage matrix, edge-case catalog or TPT', async () => {
      const t = await createTemplate();
      const bad = [
        { coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk', values: ['low'] }], cells: [{ tags: { channel: 'remote' } }] } },
        { coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk', values: ['low'] }], cells: [{ tags: { risk_level: 'extreme' } }] } },
        { coverageDimensions: { dimensions: [{ key: 'risk', label: 'A', values: [] }, { key: 'risk', label: 'B', values: [] }] } },
        { coverageDimensions: { dimensions: [{ key: 'Risk Level', label: 'Risk', values: [] }] } },
        { edgeCaseCatalog: [{ name: 'PEP link' }, { name: 'pep LINK' }] },
        { edgeCaseCatalog: [{ name: 'PEP link', quota: 0 }] },
        { defaultTptMinutes: 481 },
        { defaultTptMinutes: 0 },
        { taskModes: ['RL_REVIEW'] },
        { taskDefinitionSchema: ['not', 'an', 'object'] },
      ];
      for (const body of bad) {
        const res = await patch(admin, `/templates/${t.id}`, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('stores a valid matrix and catalog with defaults filled in', async () => {
      const t = await createTemplate();
      const res = await patch(admin, `/templates/${t.id}`, {
        coverageDimensions: {
          dimensions: [
            { key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate'] },
            { key: 'risk_level', label: 'Risk level', values: ['low', 'high'] },
          ],
          cells: [{ tags: { customer_type: 'corporate', risk_level: 'high' } }],
        },
        edgeCaseCatalog: [{ name: 'Circular ownership', required: false }],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().coverageDimensions.cells).toEqual([
        { tags: { customer_type: 'corporate', risk_level: 'high' }, quota: 1, required: true },
      ]);
      expect(res.json().edgeCaseCatalog).toEqual([{ name: 'Circular ownership', description: '', quota: 1, required: false }]);
    });
  });

  describe('publish', () => {
    it('refuses to publish until the core fields are filled, naming what is missing', async () => {
      const t = await createTemplate();
      const res = await post(admin, `/templates/${t.id}/publish`);
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('TEMPLATE_INCOMPLETE');
      for (const missing of ['Primary work', 'Verification criteria', 'Human gate', 'Default TPT', 'skill', 'task mode']) {
        expect(res.json().message).toContain(missing);
      }
      expect((await get(admin, `/templates/${t.id}`)).json().status).toBe('DRAFT');
    });

    it('publishes a complete draft; the coverage matrix and schemas are optional', async () => {
      const t = await createTemplate(COMPLETE);
      const res = await post(admin, `/templates/${t.id}/publish`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'PUBLISHED', version: 1 });
      expect(res.json().publishedAt).not.toBeNull();
      expect(await db.auditEvent.count({ where: { entityId: t.id, action: 'template.published' } })).toBe(1);
    });

    it('only drafts can be published', async () => {
      const t = await publishedTemplate();
      expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(409);
    });

    it('a template in a retired domain cannot be published', async () => {
      const t = await createTemplate(COMPLETE);
      await db.domain.update({ where: { id: domainId }, data: { status: 'RETIRED' } });
      expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(409);
    });

    it('PMs and Reviewers cannot create, edit, publish or retire templates', async () => {
      const t = await createTemplate(COMPLETE);
      for (const cookie of [pm, reviewer]) {
        expect((await post(cookie, '/templates', { domainId, workflowName: 'X' })).statusCode).toBe(403);
        expect((await patch(cookie, `/templates/${t.id}`, { skills: ['x'] })).statusCode).toBe(403);
        expect((await post(cookie, `/templates/${t.id}/publish`)).statusCode).toBe(403);
        expect((await post(cookie, `/templates/${t.id}/retire`)).statusCode).toBe(403);
        expect((await post(cookie, `/templates/${t.id}/versions`)).statusCode).toBe(403);
      }
    });
  });

  describe('only PUBLISHED templates are offered to PMs (FLOW 1)', () => {
    it('drafts are invisible to PMs in the list and by id', async () => {
      const draft = await createTemplate();
      const pub = await publishedTemplate('Sanctions screening');
      expect((await pmList()).map((t) => t.id)).toEqual([pub.id]);
      expect((await get(pm, `/templates/${draft.id}`)).statusCode).toBe(404);
      expect((await get(pm, `/templates/${pub.id}`)).statusCode).toBe(200);
    });

    it('PMs cannot widen their view with the view parameter', async () => {
      await createTemplate();
      expect((await get(pm, '/templates?view=all')).json().items).toEqual([]);
    });

    it('Reviewers cannot read the catalog', async () => {
      expect((await get(reviewer, '/templates')).statusCode).toBe(403);
    });
  });

  describe('versioning: editing a published template creates a new version', () => {
    it('a published version cannot be edited in place', async () => {
      const t = await publishedTemplate();
      const res = await patch(admin, `/templates/${t.id}`, { defaultTptMinutes: 5 });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('TEMPLATE_NOT_EDITABLE');
      expect((await get(admin, `/templates/${t.id}`)).json().defaultTptMinutes).toBe(90);
    });

    it('a new version is a DRAFT copy with version + 1 in the same workflow; v1 is untouched', async () => {
      const v1 = await publishedTemplate();
      const res = await post(admin, `/templates/${v1.id}/versions`);
      expect(res.statusCode).toBe(201);
      const v2 = res.json();
      expect(v2).toMatchObject({ lineageId: v1.lineageId, version: 2, status: 'DRAFT', ...COMPLETE });
      expect(v2.id).not.toBe(v1.id);
      expect(v2.publishedAt).toBeNull();
      expect((await get(admin, `/templates/${v1.id}`)).json()).toMatchObject({ version: 1, status: 'PUBLISHED' });
    });

    it('PMs keep seeing v1 until v2 is published, then only v2; v1 stays readable for running projects', async () => {
      const v1 = await publishedTemplate();
      const v2 = (await post(admin, `/templates/${v1.id}/versions`)).json();
      await patch(admin, `/templates/${v2.id}`, { defaultTptMinutes: 120 });
      expect((await pmList()).map((t) => t.version)).toEqual([1]);

      expect((await post(admin, `/templates/${v2.id}/publish`)).statusCode).toBe(200);
      expect((await pmList()).map((t) => [t.id, t.version])).toEqual([[v2.id, 2]]);
      const old = await get(pm, `/templates/${v1.id}`);
      expect(old.statusCode).toBe(200);
      expect(old.json()).toMatchObject({ status: 'PUBLISHED', defaultTptMinutes: 90 });
    });

    it('only one draft per workflow at a time, even under concurrent requests', async () => {
      const v1 = await publishedTemplate();
      const results = await Promise.all([1, 2, 3].map(() => post(admin, `/templates/${v1.id}/versions`)));
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error).toBe('DRAFT_EXISTS');
      expect(await db.template.count({ where: { lineageId: v1.lineageId, status: 'DRAFT' } })).toBe(1);
    });

    it('a draft cannot be versioned; edit it instead', async () => {
      const t = await createTemplate();
      expect((await post(admin, `/templates/${t.id}/versions`)).json().error).toBe('TEMPLATE_IS_DRAFT');
    });

    it('the version history lists every version, newest first', async () => {
      const v1 = await publishedTemplate();
      const v2 = (await post(admin, `/templates/${v1.id}/versions`)).json();
      const res = await get(admin, `/templates/${v1.id}/versions`);
      expect(res.json().items.map((t: { id: string; version: number }) => [t.id, t.version])).toEqual([
        [v2.id, 2],
        [v1.id, 1],
      ]);
      expect((await get(pm, `/templates/${v1.id}/versions`)).statusCode).toBe(403);
    });

    it('the Admin catalog shows one row per workflow (latest version) by default, or every version on request', async () => {
      const v1 = await publishedTemplate();
      await post(admin, `/templates/${v1.id}/versions`);
      await createTemplate({}, 'Sanctions screening');
      const latest = (await get(admin, '/templates')).json().items;
      expect(latest.map((t: { workflowName: string; version: number }) => [t.workflowName, t.version])).toEqual([
        ['KYC onboarding and refresh', 2],
        ['Sanctions screening', 1],
      ]);
      expect((await get(admin, '/templates?view=all')).json().items).toHaveLength(3);
    });
  });

  describe('retire', () => {
    it('hides the workflow from new projects but keeps every version readable', async () => {
      const v1 = await publishedTemplate();
      const v2 = (await post(admin, `/templates/${v1.id}/versions`)).json();
      await post(admin, `/templates/${v2.id}/publish`);

      const res = await post(admin, `/templates/${v2.id}/retire`);
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('RETIRED');
      // Both published versions retire, so v1 does not resurface in FLOW 1.
      expect(await pmList()).toEqual([]);
      for (const id of [v1.id, v2.id]) {
        const t = await get(pm, `/templates/${id}`);
        expect(t.statusCode).toBe(200);
        expect(t.json().status).toBe('RETIRED');
      }
      expect(await db.auditEvent.count({ where: { action: 'template.retired' } })).toBe(2);
    });

    it('only published templates can be retired', async () => {
      const t = await createTemplate();
      expect((await post(admin, `/templates/${t.id}/retire`)).json().error).toBe('NOT_PUBLISHED');
    });

    it('a retired workflow can be revived as a new version', async () => {
      const v1 = await publishedTemplate();
      await post(admin, `/templates/${v1.id}/retire`);
      const v2 = (await post(admin, `/templates/${v1.id}/versions`)).json();
      expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
      await post(admin, `/templates/${v2.id}/publish`);
      expect((await pmList()).map((t) => t.id)).toEqual([v2.id]);
    });
  });

  it('templates are scoped to the caller’s client', async () => {
    const t = await createTemplate();
    const other = await createClient();
    const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
    expect((await get(otherAdmin, `/templates/${t.id}`)).statusCode).toBe(404);
    expect((await get(otherAdmin, '/templates')).json().items).toEqual([]);
    expect((await patch(otherAdmin, `/templates/${t.id}`, { skills: ['x'] })).statusCode).toBe(404);
    expect((await post(otherAdmin, '/templates', { domainId, workflowName: 'Y' })).statusCode).toBe(404);
  });

  it('unknown template ids return 404', async () => {
    expect((await get(admin, `/templates/${randomUUID()}`)).statusCode).toBe(404);
  });
});

describe('task definition interface (separate spec, stubbed)', () => {
  const template = { workflowName: 'KYC onboarding and refresh', taskDefinitionSchema: {}, collectionSchema: {} };
  it('validateTaskInput and validateSubmission pass by default in v1', async () => {
    expect(await passThroughValidator.validateTaskInput(template, { anything: true })).toEqual({ ok: true });
    expect(await passThroughValidator.validateSubmission(template, null)).toEqual({ ok: true });
  });
});
