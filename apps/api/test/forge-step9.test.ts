import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgeSlotSelector, WAVE1_PROFILES } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * MVP1 step 9: the Tasks list carries each task's coverage selector (from its slot, not its brief), and changing the
 * candidate sign-in mode signs everyone out of the candidate app. Mocks only.
 */
const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;

describe('MVP1 step 9: task selectors and sign-out on mode change', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  const { setFlow, signIn } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
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

  /** A dimension-matrix project (Risk level: high required, plus one more slot), submitted with the new flow on. */
  async function project() {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const tpl = (
      await post(admin, '/templates', {
        domainId,
        workflowName: PROFILE.catalogWorkflowName,
        primaryWork: 'Author a realistic synthetic case with its reference solution and rubric.',
        verificationCriteria: 'Evidence, reference and rubric are consistent.',
        humanGate: 'A reviewer approves every task; the agent only recommends.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${tpl.id}/publish`)).statusCode).toBe(200);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: tpl.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    expect((await post(pm, `/projects/${created.json().id}/submit`)).statusCode).toBe(200);
    return created.json().id as string;
  }

  describe('selector on the Tasks list', () => {
    it('each row carries {field, value, label} read from its slot, in slot order, labelled from the template', async () => {
      await setFlow(true);
      const pid = await project();
      const res = await get(pm, `/projects/${pid}/forge-tasks`);
      expect(res.statusCode, res.body).toBe(200);
      const items = res.json().items as { label: string; selector: unknown }[];
      expect(items.length).toBe(2);
      const slots = await db.coverageSlot.findMany({ where: { projectId: pid }, orderBy: { position: 'asc' } });
      items.forEach((row, i) => {
        const slot = slots[i]!;
        const tags = (slot.coverageTags as { tags: Record<string, string> }).tags;
        if (slot.isOpen) expect(row.selector).toEqual({ field: '', value: '', label: 'Open slot' });
        else expect(row.selector).toEqual({ field: 'Risk level', value: tags.risk_level, label: tags.risk_level });
      });
      // The required cell is first: Risk level high.
      expect(items[0]!.selector).toEqual({ field: 'Risk level', value: 'high', label: 'high' });
    });

    it('a case-selector slot gives the form field label and the option label (as the brief); edge-case and empty slots', () => {
      const labels = {
        fieldLabel: (source: string) => (source === 'S1.governingState' ? 'Governing state' : undefined),
        optionLabel: (_source: string, value: string) => ({ CA: 'California' })[value],
      };
      expect(forgeSlotSelector({ tags: { governing_state: 'CA' }, case: { field: 'governing_state', source: 'S1.governingState', value: 'CA' } }, labels)).toEqual({ field: 'Governing state', value: 'CA', label: 'California (CA)' });
      // No form label known: the selector's own field name and the bare value.
      expect(forgeSlotSelector({ tags: {}, case: { field: 'application_type', source: 'S1.applicationType', value: 'JOINT' } })).toEqual({ field: 'application_type', value: 'JOINT', label: 'JOINT' });
      // Dimension order, not key order.
      expect(forgeSlotSelector({ tags: { b: '2', a: '1' } }, { dimensions: [{ key: 'b', label: 'B' }, { key: 'a', label: 'A' }] })).toEqual({ field: 'B', value: '2', label: '2' });
      expect(forgeSlotSelector({ tags: {}, edgeCase: 'expired ID' })).toEqual({ field: 'Edge case', value: 'expired ID', label: 'expired ID' });
      expect(forgeSlotSelector({ tags: {}, isOpen: true })).toEqual({ field: '', value: '', label: 'Open slot' });
      expect(forgeSlotSelector({ tags: {} })).toBeNull();
      expect(forgeSlotSelector(null)).toBeNull();
    });
  });

  describe('sign-out on sign-in mode change', () => {
    /** Two candidate sessions in this client and one in another client; an internal session too. */
    async function sessions() {
      await setFlow(true);
      const a = await signIn('ada@gmail.test', 'mock-ada@gmail.test', 'Ada', { terms: false });
      const b = await signIn('bob@gmail.test', 'mock-bob@gmail.test', 'Bob', { terms: false });
      const other = await db.client.create({ data: { name: `Other client ${randomUUID().slice(0, 6)}` } });
      const stranger = await db.smeUser.create({ data: { clientId: other.id, displayName: 'Stranger' } });
      const foreign = await db.session.create({ data: { clientId: other.id, audience: 'CANDIDATE', smeUserId: stranger.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
      return { a, b, foreign };
    }
    const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });

    it('changing the mode ends every candidate session of the client, audited with counts only; console sessions stay', async () => {
      const { a, b, foreign } = await sessions();
      expect((await me(a.cookie)).statusCode).toBe(200);
      const res = await call(app, 'PUT', admin, '/admin/forge-settings', { candidateSignIn: 'ONLINE' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ candidateSignIn: 'ONLINE', candidateSessionsEnded: 2 });
      expect((await me(a.cookie)).statusCode).toBe(401);
      expect((await me(b.cookie)).statusCode).toBe(401);
      // Another client's candidates and the Admin's own console session are untouched.
      expect((await db.session.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt).toBeNull();
      expect((await get(admin, '/admin/forge-settings')).statusCode).toBe(200);
      const audit = await db.auditEvent.findMany({ where: { clientId, action: 'candidate.sessions_ended' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'Client', entityId: clientId, actorType: 'USER' });
      expect(audit[0]!.after).toEqual({ reason: 'sign_in_mode_changed', count: 2 });
      expect(JSON.stringify(audit[0])).not.toMatch(/ada@|bob@/);
    });

    it('saving without a mode change (the flow switch, or the same mode) signs nobody out; a replay is idempotent', async () => {
      const { a } = await sessions();
      const flow = await call(app, 'PUT', admin, '/admin/forge-settings', { newFlow: true });
      expect(flow.json()).toMatchObject({ candidateSessionsEnded: 0 });
      const same = await call(app, 'PUT', admin, '/admin/forge-settings', { candidateSignIn: 'OFFLINE' });
      expect(same.json()).toMatchObject({ candidateSignIn: 'OFFLINE', candidateSessionsEnded: 0 });
      expect((await me(a.cookie)).statusCode).toBe(200);
      expect(await db.auditEvent.count({ where: { clientId, action: 'candidate.sessions_ended' } })).toBe(0);

      // The same request sent twice (one Idempotency-Key) changes and signs out once.
      const key = idem();
      const send = () => app.inject({ method: 'PUT', url: '/api/v1/admin/forge-settings', headers: { cookie: admin, ...key }, payload: { candidateSignIn: 'ONLINE' } });
      const first = await send();
      const again = await send();
      expect(first.json()).toMatchObject({ candidateSessionsEnded: 2 });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      expect(await db.auditEvent.count({ where: { clientId, action: 'candidate.sessions_ended' } })).toBe(1);
      // Switching back is a change too: nobody is signed in now, so it ends none (and says so).
      const back = await call(app, 'PUT', admin, '/admin/forge-settings', { candidateSignIn: 'OFFLINE' });
      expect(back.json()).toMatchObject({ candidateSessionsEnded: 0 });
      expect(await db.auditEvent.count({ where: { clientId, action: 'candidate.sessions_ended' } })).toBe(2);
    });

    it('a PM cannot change the mode, so cannot sign anyone out', async () => {
      const { a } = await sessions();
      expect((await call(app, 'PUT', pm, '/admin/forge-settings', { candidateSignIn: 'ONLINE' })).statusCode).toBe(403);
      expect((await me(a.cookie)).statusCode).toBe(200);
    });
  });
});
