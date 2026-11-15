import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProfileOutput, WAVE1_PROFILES } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

/** MVP1 step 4 (owner, 15 Nov 2026): in the new flow, export opens only when every task of the project is approved. */
describe('MVP1 step 4: export eligibility', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
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
    await setFlow(true);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** A KYB project with two fixed slots (no open slot), submitted with the new flow on: two task rows. End date passed. */
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
        openSlotShare: 0,
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'low' }, quota: 1, required: true }, { tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${tpl.id}/publish`)).statusCode).toBe(200);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: tpl.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const pid = created.json().id as string;
    await db.project.update({ where: { id: pid }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${pid}/submit`)).statusCode).toBe(200);
    const tasks = await db.taskInstance.findMany({ where: { projectId: pid }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
    expect(tasks.map((t) => t.slot?.isOpen)).toEqual([false, false]);
    // One SME authors both tasks.
    const mail = `author-${randomUUID().slice(0, 6)}@gmail.test`;
    const author = await signIn(mail, `mock-${mail}`, 'Ada Author');
    const s = await source(pid, 'SME', { email: mail, first: 'Ada', last: 'Author' });
    for (const t of tasks) {
      const a = await assign(pid, s.id, t.id);
      expect(a.statusCode, a.body).toBe(200);
    }
    return { pid, ids: tasks.map((t) => t.id), author };
  }

  async function submit(author: { cookie: string }, id: string) {
    const v = (await get(author.cookie, `/me/tasks/${id}`)).json();
    expect((await put(author.cookie, `/me/tasks/${id}`, { output: sampleProfileOutput(PROFILE), activeSecondsDelta: 10, expectedRevision: v.revision })).statusCode).toBe(200);
    const sub = await post(author.cookie, `/me/tasks/${id}/submit`, { expectedRevision: (await get(author.cookie, `/me/tasks/${id}`)).json().revision, syntheticDeclaration: true, flagExplanations: {} });
    expect(sub.statusCode, sub.body).toBe(200);
  }
  async function decide(pid: string, id: string, body: object) {
    const v = (await get(pm, `/projects/${pid}/forge-tasks/${id}`)).json();
    const r = await post(pm, `/projects/${pid}/tasks/${id}/decision`, { expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, ...body });
    expect(r.statusCode, r.body).toBe(200);
  }
  // Both tasks carry the same sample content, so the second is flagged as a likely duplicate; the reviewer accepts it as distinct.
  const approve = (pid: string, id: string, dup = false) => decide(pid, id, { decision: 'APPROVE', checklist: allTrue, ...(dup ? { duplicateDecision: 'ACCEPT_AS_DISTINCT' } : {}) });
  const state = async (pid: string) => (await get(pm, `/projects/${pid}/export`)).json();

  it('new flow: export stays closed (409 NOT_EXPORTABLE) until every task is approved, whatever the end date or status; then opens', async () => {
    const { pid, ids, author } = await project();
    expect(await state(pid)).toMatchObject({ canValidate: false, canExport: false, reason: 'Export opens when all 2 tasks are approved (0 of 2 now).' });
    await submit(author, ids[0]!);
    await approve(pid, ids[0]!);
    // One of two approved; the end date (6 Oct) has passed and the project is marked complete: still closed.
    await db.project.update({ where: { id: pid }, data: { status: 'COMPLETED' } });
    const half = await state(pid);
    expect(half).toMatchObject({ canValidate: true, canExport: false, reason: 'Export opens when all 2 tasks are approved (1 of 2 now).' });
    const refused = await post(pm, `/projects/${pid}/exports`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'NOT_EXPORTABLE', message: 'Export opens when all 2 tasks are approved (1 of 2 now).' });
    // Validate one approved task still works at any time.
    expect((await post(pm, `/projects/${pid}/validate`, { recordIds: [half.tasks[0].recordId] })).statusCode).toBe(201);

    await submit(author, ids[1]!);
    await approve(pid, ids[1]!, true);
    expect(await state(pid)).toMatchObject({ canValidate: true, canExport: true, reason: null });
    const ex = await post(pm, `/projects/${pid}/exports`);
    expect(ex.statusCode, ex.body).toBe(201);
    expect(ex.json()).toMatchObject({ kind: 'EXPORT' });
    expect(ex.json().results).toHaveLength(2);
    expect(await db.auditEvent.count({ where: { entityId: pid, action: 'project.exported' } })).toBe(1);
  });

  it('new flow: a rejected task does not count; old flow (switch off) keeps the end-date and complete rules', async () => {
    const { pid, ids, author } = await project();
    await submit(author, ids[0]!);
    await approve(pid, ids[0]!);
    await submit(author, ids[1]!);
    await decide(pid, ids[1]!, { decision: 'REJECT', rejectReason: 'INCORRECT', notes: 'Wrong.', comments: [{ section: 'S1', text: 'Wrong case.' }] });
    expect(await db.taskInstance.count({ where: { projectId: pid, status: 'REJECTED' } })).toBe(1);
    expect(await state(pid)).toMatchObject({ canExport: false, reason: 'Export opens when all 2 tasks are approved (1 of 2 now).' });
    expect((await post(pm, `/projects/${pid}/exports`)).json().error).toBe('NOT_EXPORTABLE');

    // The earlier journey: the end date has come, so export opens with one approved task.
    await setFlow(false);
    expect(await state(pid)).toMatchObject({ canValidate: true, canExport: true, reason: null });
    const ex = await post(pm, `/projects/${pid}/exports`);
    expect(ex.statusCode, ex.body).toBe(201);
    expect(ex.json().results).toHaveLength(1);
  });

  it('old flow: before the end date and not complete, export waits with the earlier reason', async () => {
    const { pid, ids, author } = await project();
    await submit(author, ids[0]!);
    await approve(pid, ids[0]!);
    await db.project.update({ where: { id: pid }, data: { endDate: new Date('2099-01-01'), distinctTarget: 5 } });
    await setFlow(false);
    expect(await state(pid)).toMatchObject({ canValidate: true, canExport: false, reason: 'Export opens when the project is complete: 1 of 5 required tasks approved, or on 2099-01-01. You can validate one task now.' });
    expect((await post(pm, `/projects/${pid}/exports`)).statusCode).toBe(409);
    await db.project.update({ where: { id: pid }, data: { status: 'COMPLETED' } });
    expect((await state(pid)).canExport).toBe(true);
  });
});
