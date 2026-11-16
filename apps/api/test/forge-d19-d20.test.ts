import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

describe('D19 + D20: SME places and the platform pool on the Assign screen', () => {
  let app: FastifyInstance; // the real selection gate (identity, selection, onboarding)
  let stubApp: FastifyInstance; // the staffing test double, for the earlier flow
  let prodApp: FastifyInstance; // production environment (offline sign-in refused)
  const storage = new MemoryStorage();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;
  let pmUserId: string;
  let otherPm: string;

  const deps = () => ({
    db,
    pingRedis: async () => true,
    google,
    identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
    resolveClientId: async () => clientId,
    storage,
    email: new MemoryEmailSender(),
    embeddings: new HashingEmbeddingProvider(),
  });
  const { setFlow, source, signIn, assign: assignAs } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ ...deps(), config });
    stubApp = await buildApp({ ...deps(), config, selectionGate: stubSelectionGate });
    prodApp = await buildApp({ ...deps(), config: { ...config, appEnv: 'production' } });
  });

  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const pmUser = await createUser(clientId, ['PM']);
    pmUserId = pmUser.id;
    pm = await login(app, pmUser.email);
    otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
  });

  afterAll(async () => {
    await app.close();
    await stubApp.close();
    await prodApp.close();
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
        coverageDimensions: {
          dimensions: [
            { key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate', 'trust'] },
            { key: 'risk_level', label: 'Risk level', values: ['low', 'high'] },
          ],
          cells: [{ tags: { customer_type: 'corporate', risk_level: 'high' }, quota: 1, required: true }],
        },
        edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  /** A submitted authoring project (READY_FOR_STAFFING), owned by the PM, with 12 distinct tasks (or `target`), GB only. */
  async function project(opts: { route?: 'SME_PM' | 'SME_EXPERT_PM'; submit?: boolean; target?: number } = {}) {
    const templateId = await template();
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC', 'Sanctions screening'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: `Forge ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: opts.target ?? 12, maxPerExpert: Math.min(4, opts.target ?? 12), tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] })).json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    if (opts.submit !== false) {
      const s = await post(pm, `/projects/${p.id}/submit`);
      expect(s.statusCode, s.body).toBe(200);
    }
    if (opts.route) await db.project.update({ where: { id: p.id }, data: { reviewRoute: opts.route } });
    return p.id as string;
  }


  const tasksOf = (projectId: string) => db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
  const openTask = async (projectId: string) => (await tasksOf(projectId)).find((t) => t.status === 'CREATED' && !t.assignedToId)!;
  const assign = assignAs;
  const audits = (action: string) => db.auditEvent.findMany({ where: { action } });

  const ids = (v: { people: { sourcedPersonId: string | null; candidateId: string | null }[] }) => v.people.map((x) => x.sourcedPersonId ?? `pool:${x.candidateId}`);
  const view = async (pid: string) => (await get(pm, `/projects/${pid}/assignable`)).json();

  /** A person in the platform pool: an account and a candidate record, as onboarding or an earlier assignment makes. */
  async function poolPerson(o: { name: string; email?: string; country?: string | null; skills?: string[]; years?: number | null; limit?: number }) {
    const email = o.email ?? `${o.name.toLowerCase().replace(/\s+/g, '.')}@gmail.test`;
    const u = await db.smeUser.create({ data: { clientId, displayName: o.name, contactEmail: email } });
    const c = await db.candidate.create({
      data: { clientId, smeUserId: u.id, poolStatus: 'IN_POOL', country: o.country ?? null, skills: o.skills ?? [], specialties: [], jurisdictions: [], domainExperienceYears: o.years ?? null, ...(o.limit ? { concurrentProjectLimit: o.limit } : {}) },
    });
    return { candidateId: c.id, smeUserId: u.id, email };
  }
  const assignPool = (pid: string, candidateId: string, role: 'SME' | 'REVIEWER', taskId: string, cookie = pm) =>
    call(app, 'POST', cookie, `/projects/${pid}/assignments/direct`, { candidateId, role, taskId });

  describe('D19: SME places are never fewer than the tasks', () => {
    it('raises Required workers to the task count on submit (audited)', async () => {
      await setFlow(true);
      const pid = await project();
      const p = await db.project.findUniqueOrThrow({ where: { id: pid } });
      expect(p.requiredWorkers).toBe(12);
      const raised = await audits('project.required_workers_raised');
      expect(raised).toHaveLength(1);
      expect(raised[0]!.after).toMatchObject({ requiredWorkers: 12, reason: 'task_count' });
      expect(await view(pid)).toMatchObject({ requiredWorkers: 12, taskCount: 12, minRequiredWorkers: 12, smePlacesFull: false });
    });

    it('fixes an existing project whose Required workers is below its tasks: four SMEs on four tasks (QA project f7f3cfae)', async () => {
      await setFlow(true);
      const pid = await project();
      await db.project.update({ where: { id: pid }, data: { requiredWorkers: 1 } });
      const people = [await source(pid, 'SME'), await source(pid, 'SME'), await source(pid, 'SME'), await source(pid, 'SME')];
      expect((await assign(pid, people[0]!.id, (await openTask(pid)).id)).statusCode).toBe(200);
      const v = await view(pid);
      expect(v).toMatchObject({ requiredWorkers: 12, smePlacesUsed: 1, smePlacesFull: false });
      for (const s of people.slice(1)) {
        const r = await assign(pid, s.id, (await openTask(pid)).id);
        expect(r.statusCode, r.body).toBe(200);
      }
      expect((await db.project.findUniqueOrThrow({ where: { id: pid } })).requiredWorkers).toBe(12);
      // Raised once (here, on the first assign; submit had raised it before the test lowered it), then left alone.
      const raised = await audits('project.required_workers_raised');
      expect(raised.filter((a) => (a.before as { requiredWorkers: number }).requiredWorkers === 1)).toHaveLength(1);
      await view(pid);
      expect(await audits('project.required_workers_raised')).toHaveLength(raised.length);
    });

    it('lets the PM or Admin change Required workers: never below the floor, idempotent, audited, own projects only', async () => {
      await setFlow(true);
      const pid = await project({ target: 3 });
      const v0 = await view(pid);
      expect(v0.taskCount).toBe(3);
      const a = await source(pid, 'SME');
      const b = await source(pid, 'SME');
      const c = await source(pid, 'SME');
      for (const s of [a, b, c]) expect((await assign(pid, s.id, (await openTask(pid)).id)).statusCode).toBe(200);
      expect(await view(pid)).toMatchObject({ requiredWorkers: 3, smePlacesUsed: 3, smePlacesFull: true, minRequiredWorkers: 3 });

      const low = await post(pm, `/projects/${pid}/required-workers`, { requiredWorkers: 2 });
      expect(low.statusCode).toBe(422);
      expect(low.json()).toMatchObject({ error: 'REQUIRED_WORKERS_TOO_LOW', details: { minimum: 3 } });
      expect((await post(otherPm, `/projects/${pid}/required-workers`, { requiredWorkers: 5 })).statusCode).toBe(404);
      expect((await post(pm, `/projects/${pid}/required-workers`, { requiredWorkers: 0 })).statusCode).toBe(400);

      const key = idem();
      const once = await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/required-workers`, headers: { cookie: pm, ...key }, payload: { requiredWorkers: 5 } });
      expect(once.statusCode, once.body).toBe(200);
      expect(once.json()).toMatchObject({ requiredWorkers: 5, changed: true });
      const replay = await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/required-workers`, headers: { cookie: pm, ...key }, payload: { requiredWorkers: 5 } });
      expect(replay.json()).toEqual(once.json());
      const same = await post(admin, `/projects/${pid}/required-workers`, { requiredWorkers: 5 });
      expect(same.json()).toMatchObject({ requiredWorkers: 5, changed: false });
      expect(await audits('project.required_workers_unchanged')).toHaveLength(1);
      const changed = await audits('project.required_workers_changed');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({ before: { requiredWorkers: 3 }, after: { requiredWorkers: 5, tasks: 3, smesAssigned: 3 } });
      expect(await view(pid)).toMatchObject({ requiredWorkers: 5, smePlacesFull: false });
    });

    it('refuses a change on a draft, completed or cancelled project', async () => {
      await setFlow(true);
      const pid = await project();
      await db.project.update({ where: { id: pid }, data: { status: 'COMPLETED' } });
      expect((await post(pm, `/projects/${pid}/required-workers`, { requiredWorkers: 20 })).json().error).toBe('PROJECT_NOT_OPEN');
    });
  });

  describe('D20: the platform pool on the Assign screen', () => {
    it('lists available pool people who meet the criteria, with the match; leaves out the unavailable and the mismatched', async () => {
      await setFlow(true);
      const pid = await project(); // GB required; skills KYC, Sanctions screening
      const fit = await poolPerson({ name: 'Ada Fit', country: 'GB', skills: ['KYC'], years: 6 });
      const unknown = await poolPerson({ name: 'Una Known' });
      await poolPerson({ name: 'Usa Person', country: 'US', skills: ['KYC'] });
      await poolPerson({ name: 'Baker Wrong', country: 'GB', skills: ['Baking'] });
      const busy = await poolPerson({ name: 'Bea Busy', country: 'GB', skills: ['KYC'], limit: 1 });
      const sourcedHere = await poolPerson({ name: 'Sam Here', country: 'GB', skills: ['KYC'] });
      const here = await source(pid, 'SME', { first: 'Sam', last: 'Here', email: sourcedHere.email });

      // Bea is on another open project, at her limit of one.
      const other = await project();
      const bea = await source(other, 'SME', { first: 'Bea', last: 'Busy', email: busy.email });
      expect((await assign(other, bea.id, (await openTask(other)).id)).statusCode).toBe(200);

      const v = await view(pid);
      expect(v.criteria).toEqual({ countries: ['GB'], countryRequired: true, minYears: null, yearsRequired: false });
      expect(ids(v).sort()).toEqual([here.id, `pool:${fit.candidateId}`, `pool:${unknown.candidateId}`].sort());
      const ada = v.people.find((x: { candidateId: string }) => x.candidateId === fit.candidateId);
      expect(ada).toMatchObject({
        source: 'POOL',
        sourcedPersonId: null,
        role: null,
        firstName: 'Ada',
        lastName: 'Fit',
        email: fit.email,
        assessed: true,
        location: { value: 'GB', matched: true },
        experience: null,
        activeProjects: 0,
        projectLimit: 2,
      });
      expect(ada.matchingSkills).toEqual([{ skill: 'KYC', matched: true }, { skill: 'Sanctions screening', matched: false }]);
      expect(ada).not.toHaveProperty('smeUserId');
      expect(v.people.find((x: { candidateId: string }) => x.candidateId === unknown.candidateId)).toMatchObject({ assessed: false, location: { value: null, matched: null } });
      // The better match first.
      expect(v.people.filter((x: { source: string }) => x.source === 'POOL')[0].candidateId).toBe(fit.candidateId);
      // This project's Sourcing profile is listed once, as before.
      expect(v.people.find((x: { sourcedPersonId: string }) => x.sourcedPersonId === here.id)).toMatchObject({ source: 'SOURCING', role: 'SME' });
    });

    it('assigns a pool person to a task: makes their record on the project, reuses their account, audited and idempotent', async () => {
      await setFlow(true);
      const pid = await project();
      const fit = await poolPerson({ name: 'Ada Fit', country: 'GB', skills: ['KYC'] });
      const t = await openTask(pid);
      const key = idem();
      const send = () => app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/assignments/direct`, headers: { cookie: pm, ...key }, payload: { candidateId: fit.candidateId, role: 'SME', taskId: t.id } });
      const res = await send();
      expect(res.statusCode, res.body).toBe(200);
      const replay = await send();
      expect(replay.json()).toEqual(res.json());

      const rows = await db.sourcedPerson.findMany({ where: { projectId: pid } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: res.json().sourcedPersonId, role: 'SME', firstName: 'Ada', lastName: 'Fit', emailNorm: fit.email, smeUserId: fit.smeUserId, submittedById: pmUserId });
      expect(rows[0]!.assignedAt).not.toBeNull();
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
      expect(task).toMatchObject({ status: 'ASSIGNED', assignedToId: fit.candidateId });
      expect(await db.smeUser.count({ where: { contactEmail: fit.email } })).toBe(1);
      const added = await audits('sourcing.person_added');
      expect(added).toHaveLength(1);
      expect(added[0]!.after).toMatchObject({ projectId: pid, role: 'SME', fromPool: true, candidateId: fit.candidateId });
      expect(JSON.stringify(added[0])).not.toContain(fit.email);
      // Now on the project: in Resource assignments, no longer in the pool list.
      expect((await get(pm, `/projects/${pid}/people`)).json().items.map((x: { email: string }) => x.email)).toEqual([fit.email]);
      expect(ids(await view(pid))).not.toContain(`pool:${fit.candidateId}`);
    });

    it('keeps one role per project, and refuses someone no longer available or a malformed request', async () => {
      await setFlow(true);
      const pid = await project({ route: 'SME_EXPERT_PM' });
      const author = await source(pid, 'SME', { email: 'author@gmail.test' });
      const t = await openTask(pid);
      expect((await assign(pid, author.id, t.id)).statusCode).toBe(200);
      const rev = await poolPerson({ name: 'Rita Review', country: 'GB', skills: ['KYC'] });
      const listed = (await view(pid)).people.find((x: { candidateId: string }) => x.candidateId === rev.candidateId);
      expect(listed.reviewableTaskIds).toEqual([t.id]);

      const ok = await assignPool(pid, rev.candidateId, 'REVIEWER', t.id);
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } })).reviewerSmeUserId).toBe(rev.smeUserId);
      // Now a Reviewer here: never also an SME on this project.
      expect((await assignPool(pid, rev.candidateId, 'SME', (await openTask(pid)).id)).json().error).toBe('BOTH_ROLES');

      const busy = await poolPerson({ name: 'Bea Busy', country: 'GB', skills: ['KYC'], limit: 1 });
      const other = await project();
      expect((await assignPool(other, busy.candidateId, 'SME', (await openTask(other)).id)).statusCode).toBe(200);
      const refused = await assignPool(pid, busy.candidateId, 'SME', (await openTask(pid)).id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toBe('NOT_AVAILABLE');
      const us = await poolPerson({ name: 'Usa Person', country: 'US' });
      expect((await assignPool(pid, us.candidateId, 'SME', (await openTask(pid)).id)).json().error).toBe('NOT_AVAILABLE');

      const both = await call(app, 'POST', pm, `/projects/${pid}/assignments/direct`, { sourcedPersonId: author.id, candidateId: rev.candidateId, role: 'SME', taskId: t.id });
      expect(both.statusCode).toBe(400);
      const noRole = await call(app, 'POST', pm, `/projects/${pid}/assignments/direct`, { candidateId: rev.candidateId, taskId: t.id });
      expect(noRole.statusCode).toBe(400);
      // Another PM cannot reach this project at all.
      expect((await assignPool(pid, us.candidateId, 'SME', (await openTask(pid)).id, otherPm)).statusCode).toBe(404);
    });
  });
});
