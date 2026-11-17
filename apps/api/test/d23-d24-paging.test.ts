import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { pageAssignable } from '../src/forge/sourcing';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

describe('D23 + D24: search and server-side paging', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;

  const { setFlow, source } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({
      db,
      config: testConfig(),
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
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function template() {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName: `KYC ${randomUUID().slice(0, 6)}`,
        primaryWork: 'Assemble identity evidence and recommend a disposition.',
        verificationCriteria: 'Document checks, completeness, policy adherence.',
        humanGate: 'Approval, rejection and high-risk classification remain human decisions.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  async function project(templateId: string, name: string, submit = false) {
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const res = await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().id as string;
    if (submit) {
      await db.project.update({ where: { id }, data: { authoringExperience: null } });
      const s = await post(pm, `/projects/${id}/submit`);
      expect(s.statusCode, s.body).toBe(200);
    }
    return id;
  }

  describe('GET /projects', () => {
    it('pages 10 at a time with the total, keeps returning every project without ?page=, and searches across all pages', async () => {
      const t = await template();
      for (let i = 1; i <= 12; i++) await project(t, `Launch pilot ${String(i).padStart(2, '0')}`);
      await project(t, 'Zanzibar onboarding review');

      const all = (await get(pm, '/projects')).json();
      expect(all.items).toHaveLength(13);
      expect(all.total).toBeUndefined();

      const p1 = (await get(pm, '/projects?page=1')).json();
      expect(p1).toMatchObject({ page: 1, pageSize: 10, total: 13, pageCount: 2 });
      expect(p1.items).toHaveLength(10);
      const p2 = (await get(pm, '/projects?page=2')).json();
      expect(p2.items).toHaveLength(3);
      const ids = new Set([...p1.items, ...p2.items].map((p: { id: string }) => p.id));
      expect(ids.size).toBe(13);
      // A page past the end shows the last page.
      expect((await get(pm, '/projects?page=9')).json()).toMatchObject({ page: 2, total: 13 });
      expect((await get(pm, '/projects?page=1&pageSize=5')).json()).toMatchObject({ pageSize: 5, pageCount: 3 });
      expect((await get(pm, '/projects?page=0')).statusCode).toBe(400);

      // The search counts the filtered total, whichever page the match was on.
      const found = (await get(pm, `/projects?page=1&q=${encodeURIComponent('Zanzibar')}`)).json();
      expect(found).toMatchObject({ total: 1, page: 1 });
      expect(found.items.map((p: { name: string }) => p.name)).toEqual(['Zanzibar onboarding review']);
      expect((await get(pm, '/projects?page=1&q=qqqqxxxx')).json()).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('GET /users', () => {
    it('pages users for the Admin, with the total and a search; without ?page= every user, as before', async () => {
      for (let i = 0; i < 11; i++) await createUser(clientId, ['REVIEWER'], `reviewer${i}@test.local`);
      await createUser(clientId, ['FINANCE'], 'quentin.money@test.local');
      const all = (await get(admin, '/users')).json();
      const n = all.items.length;
      expect(n).toBeGreaterThanOrEqual(14);
      const p1 = (await get(admin, '/users?page=1')).json();
      expect(p1).toMatchObject({ page: 1, pageSize: 10, total: n, pageCount: Math.ceil(n / 10) });
      expect(p1.items).toHaveLength(10);
      expect(p1.items.map((u: { email: string }) => u.email)).toEqual(all.items.slice(0, 10).map((u: { email: string }) => u.email));
      const found = (await get(admin, '/users?page=1&q=quentin')).json();
      expect(found.total).toBe(1);
      expect(found.items[0].email).toBe('quentin.money@test.local');
      expect((await get(pm, '/users?page=1')).statusCode).toBe(403);
    });
  });

  describe('GET /projects/:id/assignable', () => {
    it('searches by first name, last name, email and skill, and pages; without q or page the list is unchanged', async () => {
      await setFlow(true);
      const pid = await project(await template(), 'Assign search', true);
      for (let i = 0; i < 12; i++) await source(pid, 'SME', { first: `Person${i}`, last: 'Smith', email: `person${i}@gmail.test` });
      await source(pid, 'SME', { first: 'Ada', last: 'Lovelace', email: 'countess@analytical.test', assessment: { skills: 'KYC' } });

      const all = (await get(pm, `/projects/${pid}/assignable`)).json();
      expect(all.people).toHaveLength(13);
      expect(all.total).toBeUndefined();

      const p1 = (await get(pm, `/projects/${pid}/assignable?page=1`)).json();
      expect(p1).toMatchObject({ page: 1, pageSize: 10, total: 13, pageCount: 2, peopleAvailable: 13 });
      expect(p1.people).toHaveLength(10);
      // Everything else on the screen is unchanged by paging.
      expect(p1).toMatchObject({ requiredWorkers: all.requiredWorkers, smePlacesUsed: all.smePlacesUsed, openTasks: all.openTasks });
      expect((await get(pm, `/projects/${pid}/assignable?page=2`)).json().people).toHaveLength(3);

      const names = async (q: string) => (await get(pm, `/projects/${pid}/assignable?page=1&q=${encodeURIComponent(q)}`)).json();
      expect((await names('ada')).people.map((p: { lastName: string }) => p.lastName)).toEqual(['Lovelace']);
      expect((await names('LOVELACE')).total).toBe(1);
      expect((await names('analytical.test')).total).toBe(1);
      expect((await names('kyc')).people.map((p: { firstName: string }) => p.firstName)).toEqual(['Ada']);
      expect((await names('smith')).total).toBe(12);
      const none = await names('nobody-here');
      expect(none).toMatchObject({ total: 0, people: [], peopleAvailable: 13 });
    });

    it('pageAssignable filters pool people and Sourcing profiles alike', () => {
      const person = (first: string, source: 'SOURCING' | 'POOL', skills: string[] = []) => ({
        firstName: first,
        lastName: 'X',
        email: `${first.toLowerCase()}@gmail.test`,
        source,
        matchingSkills: skills.map((skill) => ({ skill, matched: true })).concat([{ skill: 'Unmatched skill', matched: false }]),
      });
      const data = { people: [person('Pat', 'SOURCING'), person('Pool', 'POOL', ['Sanctions screening']), ...Array.from({ length: 11 }, (_, i) => person(`P${i}`, 'POOL'))] };
      expect(pageAssignable(data, {})).toBe(data);
      expect(pageAssignable(data, { q: 'sanctions' })).toMatchObject({ total: 1, peopleAvailable: 13 });
      // Only matched skills (the ones shown) are searched.
      expect(pageAssignable(data, { q: 'unmatched' })).toMatchObject({ total: 0 });
      expect(pageAssignable(data, { page: 2 }).people).toHaveLength(3);
      expect(pageAssignable(data, { q: 'gmail', page: 1 })).toMatchObject({ total: 13, pageCount: 2 });
    });
  });
});
