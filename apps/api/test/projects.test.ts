import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { redisConnection } from '../src/lib/redis';
import { createDomainEventsQueue, createDomainEventsWorker, dispatchOutboxBatch } from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { seed } from '../prisma/seed';
import { TEST_REDIS_URL } from './env';
import { buildTestApp, createUser, db, idem, login, resetDb } from './helpers';

const TEMPLATE = {
  primaryWork: 'Assemble identity evidence.',
  verificationCriteria: 'Document checks.',
  humanGate: 'Approval remains with a human.',
  defaultTptMinutes: 90,
  skills: ['KYC'],
  taskModes: ['AUTHORING', 'ANNOTATION'],
  edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }],
};
const JD = {
  title: 'KYC Analyst (task author)',
  responsibilities: 'Write synthetic KYC onboarding cases.',
  skills: ['KYC', 'EDD'],
  wagePerTask: 40,
  wageCurrency: 'gbp',
  locationType: 'REMOTE',
};
const FILTERS = [
  { attributeKey: 'country', operator: 'IN', values: ['GB', 'IE'], required: true },
  { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'C1' }], required: true },
  { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 3 }, required: false },
];

describe('M2 FLOW 1: project creation', () => {
  let app: FastifyInstance;
  let admin: string;
  let pm: string;
  let otherPm: string;
  let reviewer: string;
  let pmId: string;
  let templateId: string;
  let jdId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    // The real seed: client, admin, taxonomy and (unused here) the Taskflow catalog.
    const { client } = await seed(db, { SEED_CLIENT_NAME: 'ADI-Labs', SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const pmUser = await createUser(client.id, ['PM']);
    pmId = pmUser.id;
    pm = await login(app, pmUser.email);
    otherPm = await login(app, (await createUser(client.id, ['PM'])).email);
    reviewer = await login(app, (await createUser(client.id, ['REVIEWER'])).email);

    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    templateId = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding and refresh', ...TEMPLATE })).json().id;
    expect((await post(admin, `/templates/${templateId}/publish`)).statusCode).toBe(200);
    jdId = (await post(pm, '/job-descriptions', JD)).json().id;
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
  const complete = {
    description: 'Q4 KYC authoring',
    startDate: '2026-10-05',
    endDate: '2026-12-18',
    distinctTarget: 50,
    maxPerExpert: 4,
    tptMinutes: 90,
    demographicFilters: FILTERS,
  };
  async function draft(extra: object = {}, cookie = pm) {
    const res = await post(cookie, '/projects', { templateId, name: `KYC Q4 ${randomUUID().slice(0, 6)}`, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  describe('AC1: a PM can create, save as draft, edit and submit a project from any published template', () => {
    it('creates a DRAFT pre-filled from the template', async () => {
      const p = await draft();
      expect(p).toMatchObject({
        status: 'DRAFT',
        templateId,
        templateVersion: 1,
        workflowName: 'KYC onboarding and refresh',
        domainName: 'Banking',
        taskMode: 'AUTHORING',
        distinctTarget: 50,
        maxPerExpert: 4,
        tptMinutes: 90,
        hoursPerWorkerDay: 4,
        ownerId: pmId,
      });
      expect(await db.auditEvent.count({ where: { entityId: p.id, action: 'project.created' } })).toBe(1);
    });

    it('saves partial edits to a draft, step by step', async () => {
      const p = await draft();
      const r1 = await patch(pm, `/projects/${p.id}`, { startDate: '2026-10-05', endDate: '2026-12-18' });
      expect(r1.statusCode, r1.body).toBe(200);
      expect((await patch(pm, `/projects/${p.id}`, { demographicFilters: FILTERS })).statusCode).toBe(200);
      const res = await patch(pm, `/projects/${p.id}`, { jobDescriptionId: jdId, tptMinutes: 60 });
      expect(res.json()).toMatchObject({ startDate: '2026-10-05', tptMinutes: 60, jobDescriptionId: jdId, status: 'DRAFT' });
      expect(res.json().demographicFilters).toEqual(FILTERS);
    });

    it('submits a complete draft to READY_FOR_STAFFING', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'READY_FOR_STAFFING', requiredWorkers: 13 });
      expect(res.json().submittedAt).not.toBeNull();
    });

    it('works from every published template and task mode (authoring and annotation)', async () => {
      const domainId = (await get(admin, '/domains')).json().items[0].id;
      const t2 = (await post(admin, '/templates', { domainId, workflowName: 'Sanctions screening', ...TEMPLATE, taskModes: ['ANNOTATION'] })).json();
      await post(admin, `/templates/${t2.id}/publish`);
      const p = await draft({ templateId: t2.id, taskCount: 500, tptMinutes: 10, startDate: '2026-10-05', endDate: '2026-10-30', demographicFilters: FILTERS, jobDescriptionId: jdId });
      expect(p.taskMode).toBe('ANNOTATION');
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode, res.body).toBe(200);
      // 500 x 10 / 60 = 83.3 h over 4 h x 20 days -> 2 workers
      expect(res.json().requiredWorkers).toBe(2);
    });

    it('only the latest published version of a workflow can be used', async () => {
      const draftT = (await post(admin, `/templates/${templateId}/versions`)).json();
      expect((await post(pm, '/projects', { templateId: draftT.id, name: 'From draft' })).statusCode).toBe(400);
      await post(admin, `/templates/${draftT.id}/publish`);
      expect((await post(pm, '/projects', { templateId, name: 'From old v1' })).statusCode).toBe(400);
      expect((await post(pm, '/projects', { templateId: draftT.id, name: 'From v2' })).statusCode).toBe(201);
    });

    it('project names are unique per client', async () => {
      await draft({}, pm).then((p) => patch(pm, `/projects/${p.id}`, { name: 'Unique name' }));
      expect((await post(otherPm, '/projects', { templateId, name: 'unique NAME' })).statusCode).toBe(409);
    });

    it('a submitted project can no longer be edited', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      await post(pm, `/projects/${p.id}/submit`);
      const res = await patch(pm, `/projects/${p.id}`, { tptMinutes: 5 });
      expect(res.statusCode).toBe(409);
      expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(409);
    });
  });

  describe('validation (SPEC FLOW 1)', () => {
    it('refuses to submit an incomplete project and lists every problem', async () => {
      const p = await draft({ tptMinutes: null });
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('PROJECT_INCOMPLETE');
      const problems: string[] = res.json().details.problems;
      for (const m of [/TPT/, /Start date and target end date/, /demographic filter/, /job description/]) {
        expect(problems.some((x) => m.test(x)), String(m)).toBe(true);
      }
      expect((await get(pm, `/projects/${p.id}`)).json().status).toBe('DRAFT');
      expect(await db.outboxEvent.count()).toBe(0);
    });

    it('rejects out-of-range values at save time', async () => {
      const p = await draft();
      for (const body of [{ tptMinutes: 0 }, { tptMinutes: 481 }, { startDate: '05/10/2026' }, { hoursPerWorkerDay: 25 }, { taskCount: 0 }]) {
        expect((await patch(pm, `/projects/${p.id}`, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it('checks filters against the taxonomy on submit', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['ZZ'], required: true }] });
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode).toBe(422);
      expect(res.json().details.problems.join()).toMatch(/Country \/ region: unknown value/);
    });

    it('the target must cover required edge cases and the cap must not exceed it', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId, distinctTarget: 1, maxPerExpert: 2, coverageQuotas: { cells: [], edgeCases: [{ name: 'PEP link', quota: 2 }] } });
      const problems: string[] = (await post(pm, `/projects/${p.id}/submit`)).json().details.problems;
      expect(problems.join()).toMatch(/at least 2/);
      expect(problems.join()).toMatch(/between 1 and the target/);
    });

    it('more than 500 required workers is a warning, not a block', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId, taskMode: 'ANNOTATION', taskCount: 100000, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-09' });
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().requiredWorkers).toBe(5000);
    });

    it('a template retired before submit blocks the submit', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      await post(admin, `/templates/${templateId}/retire`);
      const res = await post(pm, `/projects/${p.id}/submit`);
      expect(res.statusCode).toBe(422);
      expect(res.json().details.problems.join()).toMatch(/no longer available/);
    });
  });

  describe('AC2: submitted projects store the template version and snapshots of the JD and demographics', () => {
    it('freezes the JD, demographics and computed figures', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      const submitted = (await post(pm, `/projects/${p.id}/submit`)).json();
      const row = await db.project.findUniqueOrThrow({ where: { id: p.id } });

      expect(row.templateVersion).toBe(1);
      const snap = await db.jobDescriptionSnapshot.findUniqueOrThrow({ where: { id: submitted.jdSnapshotId } });
      expect(snap.data).toMatchObject({ title: JD.title, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' });
      expect(row.demographicsSnapshot).toMatchObject({
        filters: FILTERS,
        attributes: expect.arrayContaining([expect.objectContaining({ key: 'country', label: 'Country / region' })]),
      });
      // 50 tasks x 90 min = 75 h; 55 working days; authors 13 dominates. Budget 50 x 40.
      expect(row.figures).toMatchObject({ tasks: 50, requiredAuthors: 13, totalEffortHours: 75, workingDays: 55, requiredWorkers: 13, labourBudget: 2000 });
    });

    it('later changes to the JD or template do not touch a submitted project', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      const submitted = (await post(pm, `/projects/${p.id}/submit`)).json();

      await patch(pm, `/job-descriptions/${jdId}`, { wagePerTask: 55, title: 'Renamed' });
      const v2 = (await post(admin, `/templates/${templateId}/versions`)).json();
      await patch(admin, `/templates/${v2.id}`, { defaultTptMinutes: 30 });
      await post(admin, `/templates/${v2.id}/publish`);

      const snap = await db.jobDescriptionSnapshot.findUniqueOrThrow({ where: { id: submitted.jdSnapshotId } });
      expect(snap.data).toMatchObject({ title: JD.title, wagePerTask: 40 });
      expect((await get(pm, `/projects/${p.id}`)).json().jdSnapshot).toMatchObject({ title: JD.title, wagePerTask: 40 });
      const after = (await get(pm, `/projects/${p.id}`)).json();
      expect([after.templateId, after.templateVersion, after.tptMinutes]).toEqual([templateId, 1, 90]);
    });

    it('the submit is audited with the status change', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      await post(pm, `/projects/${p.id}/submit`);
      const ev = await db.auditEvent.findFirstOrThrow({ where: { entityId: p.id, action: 'project.submitted' } });
      expect(ev).toMatchObject({ actorId: pmId, before: { status: 'DRAFT' } });
      expect(ev.after).toMatchObject({ status: 'READY_FOR_STAFFING', templateVersion: 1 });
    });
  });

  describe('AC3: submitting emits project.ready_for_staffing for FLOW 2', () => {
    it('writes the event with the submit and delivers it to a subscribed handler', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      await post(pm, `/projects/${p.id}/submit`);
      const events = await db.outboxEvent.findMany({ where: { name: 'project.ready_for_staffing' } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ aggregateType: 'Project', aggregateId: p.id });
      expect(events[0]!.payload).toMatchObject({ projectId: p.id, templateId, templateVersion: 1, requiredWorkers: 13 });

      // A stand-in FLOW 2 consumer receives it through the real outbox pipeline.
      const received: unknown[] = [];
      const registry = new HandlerRegistry().register({
        name: 'test.flow2',
        event: 'project.ready_for_staffing',
        handle: async (e) => {
          received.push(e.payload);
        },
      });
      const connection = redisConnection(TEST_REDIS_URL);
      const name = `test-events-${randomUUID()}`;
      const queue = createDomainEventsQueue(connection, name);
      const worker = createDomainEventsWorker(db, registry, connection, name);
      try {
        await dispatchOutboxBatch(db, queue);
        const start = Date.now();
        while (received.length === 0 && Date.now() - start < 10_000) await new Promise((r) => setTimeout(r, 50));
        expect(received).toEqual([expect.objectContaining({ projectId: p.id })]);
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    });

    it('a repeated submit (same Idempotency-Key) emits the event once', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      const key = idem();
      const send = () => app.inject({ method: 'POST', url: `/api/v1/projects/${p.id}/submit`, headers: { cookie: pm, ...key }, payload: {} });
      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(200);
      expect(await db.outboxEvent.count({ where: { name: 'project.ready_for_staffing' } })).toBe(1);
    });
  });

  describe('AC4: only the owning PM and Admins can view or edit a project', () => {
    it('another PM cannot see, edit, submit or cancel it, and it is not in their list', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      expect((await get(otherPm, `/projects/${p.id}`)).statusCode).toBe(404);
      expect((await patch(otherPm, `/projects/${p.id}`, { tptMinutes: 5 })).statusCode).toBe(404);
      expect((await post(otherPm, `/projects/${p.id}/submit`)).statusCode).toBe(404);
      expect((await post(otherPm, `/projects/${p.id}/cancel`)).statusCode).toBe(404);
      expect((await get(otherPm, '/projects')).json().items).toEqual([]);
      expect((await get(pm, '/projects')).json().items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    });

    it('Admins can view, edit and cancel any project', async () => {
      const p = await draft({ ...complete, jobDescriptionId: jdId });
      expect((await get(admin, `/projects/${p.id}`)).statusCode).toBe(200);
      expect((await get(admin, '/projects')).json().items).toHaveLength(1);
      expect((await patch(admin, `/projects/${p.id}`, { tptMinutes: 45 })).json().tptMinutes).toBe(45);
      expect((await post(admin, `/projects/${p.id}/cancel`)).json().status).toBe('CANCELLED');
    });

    it('Reviewers have no access to projects; only PMs create them', async () => {
      const p = await draft();
      expect((await get(reviewer, '/projects')).statusCode).toBe(403);
      expect((await get(reviewer, `/projects/${p.id}`)).statusCode).toBe(403);
      expect((await post(reviewer, '/projects', { templateId, name: 'X' })).statusCode).toBe(403);
      expect((await post(admin, '/projects', { templateId, name: 'X' })).statusCode).toBe(403);
    });
  });

  describe('cancel and pause', () => {
    it('cancels from DRAFT and READY_FOR_STAFFING; a cancelled project is terminal', async () => {
      const d = await draft();
      expect((await post(pm, `/projects/${d.id}/cancel`)).json().status).toBe('CANCELLED');
      const s = await draft({ ...complete, jobDescriptionId: jdId });
      await post(pm, `/projects/${s.id}/submit`);
      expect((await post(pm, `/projects/${s.id}/cancel`)).json().status).toBe('CANCELLED');
      expect((await post(pm, `/projects/${s.id}/cancel`)).statusCode).toBe(409);
      expect(await db.auditEvent.count({ where: { action: 'project.cancelled' } })).toBe(2);
    });

    it('pause is only allowed from IN_PROGRESS', async () => {
      const d = await draft();
      expect((await post(pm, `/projects/${d.id}/pause`)).json().error).toBe('INVALID_TRANSITION');
      await db.project.update({ where: { id: d.id }, data: { status: 'IN_PROGRESS' } });
      expect((await post(pm, `/projects/${d.id}/pause`)).json().status).toBe('PAUSED');
      expect((await post(pm, `/projects/${d.id}/cancel`)).json().status).toBe('CANCELLED');
    });
  });

  describe('job descriptions', () => {
    it('validates wage, currency and location', async () => {
      expect((await post(pm, '/job-descriptions', { ...JD, wagePerTask: 0 })).statusCode).toBe(400);
      expect((await post(pm, '/job-descriptions', { ...JD, wageCurrency: 'POUNDS' })).statusCode).toBe(400);
      expect((await post(pm, '/job-descriptions', { ...JD, locationType: 'ONSITE' })).statusCode).toBe(400);
      const onsite = await post(pm, '/job-descriptions', { ...JD, locationType: 'HYBRID', location: 'London, UK' });
      expect(onsite.statusCode).toBe(201);
      expect(onsite.json()).toMatchObject({ wageCurrency: 'GBP', location: 'London, UK' });
      expect((await patch(pm, `/job-descriptions/${onsite.json().id}`, { location: '' })).statusCode).toBe(400);
    });

    it('stores a normalised title for FLOW 2 lookup and audits changes', async () => {
      const jd = await db.jobDescription.findUniqueOrThrow({ where: { id: jdId } });
      expect(jd.normalizedTitle).toBe('kyc analyst (task author)');
      await patch(pm, `/job-descriptions/${jdId}`, { title: '  KYC   Analyst ' });
      expect((await db.jobDescription.findUniqueOrThrow({ where: { id: jdId } })).normalizedTitle).toBe('kyc analyst');
      expect(await db.auditEvent.count({ where: { entityId: jdId } })).toBe(2);
    });

    it('Reviewers cannot use job descriptions', async () => {
      expect((await get(reviewer, '/job-descriptions')).statusCode).toBe(403);
    });
  });

  describe('demographic taxonomy', () => {
    it('is seeded with the SPEC attributes (no age band) and readable by PMs', async () => {
      const items = (await get(pm, '/demographic-attributes')).json().items;
      expect(items.map((a: { key: string }) => a.key)).toEqual([
        'country', 'city_radius', 'languages', 'education_level', 'domain_experience_years', 'availability_hours_week', 'time_zone',
      ]);
    });

    it('only Admins add attributes, with values validated for the type', async () => {
      const attr = { key: 'certification', label: 'Certification', type: 'MULTI_SELECT', allowedValues: [{ value: 'CAMS', label: 'CAMS' }] };
      expect((await post(pm, '/demographic-attributes', attr)).statusCode).toBe(403);
      expect((await post(admin, '/demographic-attributes', { ...attr, allowedValues: { min: 1 } })).statusCode).toBe(400);
      expect((await post(admin, '/demographic-attributes', attr)).statusCode).toBe(201);
      expect((await post(admin, '/demographic-attributes', attr)).statusCode).toBe(409);
    });

    it('re-running the seed does not overwrite an Admin’s edits', async () => {
      await db.demographicAttribute.updateMany({ where: { key: 'time_zone' }, data: { label: 'Working time zone' } });
      await seed(db, { SEED_CLIENT_NAME: 'ADI-Labs', SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
      expect((await db.demographicAttribute.findFirstOrThrow({ where: { key: 'time_zone' } })).label).toBe('Working time zone');
    });
  });
});
