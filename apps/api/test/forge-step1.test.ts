import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { offlineSignInAllowed } from '../src/forge/settings';
import { MemoryEmailSender } from '../src/lib/email';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { allocateTasks, ensureSlotTasks } from '../src/tasks/task-service';
import { writeAudit } from '../src/platform/audit';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';

describe('MVP1 step 1: settings, Sourcing, task rows, direct assignment, candidate gate', () => {
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

  /** A submitted authoring project (READY_FOR_STAFFING), owned by the PM, with 12 distinct tasks. */
  async function project(opts: { route?: 'SME_PM' | 'SME_EXPERT_PM'; submit?: boolean } = {}) {
    const templateId = await template();
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC', 'Sanctions screening'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: `Forge ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 12, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] })).json();
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

  // ── 1. Settings ──

  describe('settings', () => {
    it('defaults to the earlier flow and offline sign-in; PMs read, only Admins write; the change is audited', async () => {
      const r = await get(pm, '/admin/forge-settings');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ newFlow: false, candidateSignIn: 'OFFLINE', offlineAllowed: true });
      expect((await put(pm, '/admin/forge-settings', { newFlow: true })).statusCode).toBe(403);

      await db.client.update({ where: { id: clientId }, data: { settings: { maxTaskCount: 50 } } });
      const u = await put(admin, '/admin/forge-settings', { newFlow: true });
      expect(u.statusCode, u.body).toBe(200);
      expect(u.json()).toMatchObject({ newFlow: true, candidateSignIn: 'OFFLINE' });
      const c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
      expect(c.settings).toEqual({ maxTaskCount: 50, forge: { newFlow: true, candidateSignIn: 'OFFLINE' } });
      const [a] = await audits('forge.settings_updated');
      expect(a).toMatchObject({ before: { newFlow: false, candidateSignIn: 'OFFLINE' }, after: { newFlow: true, candidateSignIn: 'OFFLINE' } });

      expect((await put(admin, '/admin/forge-settings', { candidateSignIn: 'ONLINE' })).json()).toMatchObject({ newFlow: true, candidateSignIn: 'ONLINE' });
      expect((await put(admin, '/admin/forge-settings', { other: 1 })).statusCode).toBe(400);
      expect((await put(admin, '/admin/forge-settings', { candidateSignIn: 'MAYBE' })).statusCode).toBe(400);
    });

    it('refuses offline sign-in in production, whatever the switch says', async () => {
      const prodAdmin = await login(prodApp, 'admin@test.local', 'admin-password-123');
      const r = await call(prodApp, 'PUT', prodAdmin, '/admin/forge-settings', { candidateSignIn: 'OFFLINE' });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('OFFLINE_NOT_ALLOWED');
      expect((await call(prodApp, 'GET', prodAdmin, '/admin/forge-settings')).json().offlineAllowed).toBe(false);
      expect((await call(prodApp, 'PUT', prodAdmin, '/admin/forge-settings', { candidateSignIn: 'ONLINE' })).statusCode).toBe(200);
      expect(offlineSignInAllowed({ NODE_ENV: 'production', appEnv: 'production' })).toBe(false);
      expect(offlineSignInAllowed({ NODE_ENV: 'production', appEnv: 'local' })).toBe(false);
      expect(offlineSignInAllowed({ NODE_ENV: 'production', appEnv: 'demo' })).toBe(true);
      expect(offlineSignInAllowed({ NODE_ENV: 'production', appEnv: 'staging' })).toBe(true);
      expect(offlineSignInAllowed({ NODE_ENV: 'development', appEnv: 'local' })).toBe(true);
    });
  });

  // ── 2. Sourcing ──

  describe('sourcing', () => {
    it('adds a person to an open project, flags a duplicate, and keeps names and emails out of the audit log', async () => {
      const pid = await project();
      const res = await post(pm, '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'Ada', lastName: 'Lovelace', email: '  Ada.L@Gmail.test ', linkedinUrl: 'https://linkedin.example/in/ada', agency: 'Talent Co' });
      expect(res.statusCode, res.body).toBe(201);
      const dto = res.json();
      expect(dto).toMatchObject({ projectId: pid, role: 'SME', firstName: 'Ada', email: 'ada.l@gmail.test', hasCv: false, hasAssessment: false, agency: 'Talent Co', assigned: false });
      expect(dto.projectSkills).toEqual(expect.arrayContaining(['KYC', 'Sanctions screening']));
      const dup = await post(pm, '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'Ada', lastName: 'L', email: 'ada.l@gmail.test' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error).toBe('DUPLICATE_PERSON');
      const [a] = await audits('sourcing.person_added');
      expect(a!.after).toEqual({ projectId: pid, role: 'SME' });
      expect(JSON.stringify(a)).not.toMatch(/ada|lovelace/i);
    });

    it('allows Reviewers only on the Reviewer route, and only new or active projects', async () => {
      const smePm = await project();
      const r = await post(pm, '/sourcing/people', { projectId: smePm, role: 'REVIEWER', firstName: 'R', lastName: 'One', email: 'r1@gmail.test' });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('NO_REVIEWER_STEP');
      const routed = await project({ route: 'SME_EXPERT_PM' });
      expect((await post(pm, '/sourcing/people', { projectId: routed, role: 'REVIEWER', firstName: 'R', lastName: 'One', email: 'r1@gmail.test' })).statusCode).toBe(201);

      const draft = await project({ submit: false });
      expect((await post(pm, '/sourcing/people', { projectId: draft, role: 'SME', firstName: 'A', lastName: 'B', email: 'ab@gmail.test' })).json().error).toBe('PROJECT_NOT_OPEN');
      for (const status of ['COMPLETED', 'CANCELLED'] as const) {
        const closed = await project();
        await db.project.update({ where: { id: closed }, data: { status } });
        expect((await post(pm, '/sourcing/people', { projectId: closed, role: 'SME', firstName: 'A', lastName: 'B', email: 'ab@gmail.test' })).json().error).toBe('PROJECT_NOT_OPEN');
      }
      const paused = await project();
      await db.project.update({ where: { id: paused }, data: { status: 'PAUSED' } });
      expect((await post(pm, '/sourcing/people', { projectId: paused, role: 'SME', firstName: 'A', lastName: 'B', email: 'ab@gmail.test' })).statusCode).toBe(201);
    });

    it('limits a PM to their own projects; an Admin sees every project', async () => {
      const pid = await project();
      await source(pid, 'SME', { first: 'Owned', last: 'Person' });
      const other = await post(otherPm, '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'X', lastName: 'Y', email: 'xy@gmail.test' });
      expect(other.statusCode).toBe(404);
      expect((await get(otherPm, '/sourcing/people?role=SME')).json().items).toEqual([]);
      expect((await get(otherPm, `/projects/${pid}/people`)).statusCode).toBe(404);
      expect((await get(otherPm, `/projects/${pid}/assignable`)).statusCode).toBe(404);
      expect((await get(admin, '/sourcing/people?role=SME')).json().items).toHaveLength(1);
      expect((await post(admin, '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'By', lastName: 'Admin', email: 'admin-added@gmail.test' })).statusCode).toBe(201);
    });

    it('lists by role and searches name, email, role, project and skills across both roles', async () => {
      const pid = await project({ route: 'SME_EXPERT_PM' });
      await source(pid, 'SME', { first: 'Alan', last: 'Turing', email: 'alan@gmail.test' });
      await source(pid, 'REVIEWER', { first: 'Barbara', last: 'Liskov', email: 'barbara@gmail.test' });
      const name = (await db.project.findUniqueOrThrow({ where: { id: pid } })).name;
      const names = async (url: string) => ((await get(pm, url)).json().items as { firstName: string }[]).map((x) => x.firstName).sort();
      expect(await names('/sourcing/people?role=SME')).toEqual(['Alan']);
      expect(await names('/sourcing/people?role=REVIEWER')).toEqual(['Barbara']);
      expect(await names('/sourcing/people?role=SME&q=liskov')).toEqual(['Barbara']);
      expect(await names('/sourcing/people?q=ALAN@gmail')).toEqual(['Alan']);
      expect(await names('/sourcing/people?q=reviewer')).toEqual(['Barbara']);
      expect(await names(`/sourcing/people?q=${encodeURIComponent(name.toLowerCase())}`)).toEqual(['Alan', 'Barbara']);
      expect(await names('/sourcing/people?q=sanctions')).toEqual(['Alan', 'Barbara']);
      expect(await names('/sourcing/people?q=nothing-like-this')).toEqual([]);
      const [row] = (await get(pm, '/sourcing/people?role=SME')).json().items;
      expect(row.submittedBy).toBeTruthy();
    });

    it('stores a CV (PDF only) and an answers file (Excel or PDF), up to 10 MB, and audits it', async () => {
      const pid = await project();
      const s = await source(pid, 'SME');
      const upload = (kind: string | null, body: Buffer, cookie = pm) => {
        const boundary = `----forge${randomUUID()}`;
        const parts = [
          ...(kind ? [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`)] : []),
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
          body,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ];
        return app.inject({ method: 'POST', url: `/api/v1/sourcing/people/${s.id}/files`, headers: { cookie, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
      };
      const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100)]);
      const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml'), Buffer.alloc(50)]);
      const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml')]);

      expect((await upload(null, pdf)).statusCode).toBe(400);
      expect((await upload('photo', pdf)).statusCode).toBe(400);
      expect((await upload('cv', xlsx)).statusCode).toBe(415);
      expect((await upload('assessment', docx)).statusCode).toBe(415);
      expect((await upload('cv', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)]))).statusCode).toBe(413);
      expect((await upload('cv', pdf, otherPm)).statusCode).toBe(404);

      const cv = await upload('cv', pdf);
      expect(cv.statusCode, cv.body).toBe(200);
      expect(cv.json()).toMatchObject({ kind: 'cv', mimeType: 'application/pdf', hasCv: true, hasAssessment: false });
      const ax = await upload('assessment', xlsx);
      expect(ax.json()).toMatchObject({ kind: 'assessment', hasCv: true, hasAssessment: true });
      expect((await upload('assessment', pdf)).statusCode).toBe(200);
      const row = await db.sourcedPerson.findUniqueOrThrow({ where: { id: s.id } });
      expect(storage.objects.get(row.cvStorageKey!)?.contentType).toBe('application/pdf');
      expect(storage.objects.has(row.assessmentStorageKey!)).toBe(true);
      expect(await audits('sourcing.file_uploaded')).toHaveLength(3);
    });
  });

  // ── 3. Task rows ──

  describe('task rows', () => {
    it('creates one CREATED task per slot on submit when the new flow is on, exactly once, and lists them', async () => {
      await setFlow(true);
      const pid = await project();
      const slots = await db.coverageSlot.count({ where: { projectId: pid } });
      expect(slots).toBeGreaterThan(0);
      const tasks = await tasksOf(pid);
      expect(tasks).toHaveLength(slots);
      expect(new Set(tasks.map((t) => t.slotId)).size).toBe(slots);
      for (const t of tasks) {
        expect(t).toMatchObject({ status: 'CREATED', taskType: 'AUTHORING', assignedToId: null });
        expect((t.input as { slot: { id: string; brief: string } }).slot).toMatchObject({ id: t.slotId, brief: t.slot!.brief, isOpen: t.slot!.isOpen });
      }
      // Lazy calls create nothing more.
      await get(pm, `/projects/${pid}/people`);
      await get(pm, `/projects/${pid}/assignable`);
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(slots);
      expect((await get(pm, `/projects/${pid}/tasks`)).json().items).toHaveLength(slots);
      const a = (await get(pm, `/projects/${pid}/assignable`)).json();
      expect(a.openTasks).toHaveLength(slots);
    });

    it('creates no rows with the new flow off; turning it on creates them lazily (audited), once', async () => {
      const pid = await project();
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(0);
      expect((await get(pm, `/projects/${pid}/people`)).statusCode).toBe(200);
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(0);
      await setFlow(true);
      const r = await get(pm, `/projects/${pid}/people`);
      expect(r.json()).toMatchObject({ items: [], reviewRoute: 'SME_PM', requiredWorkers: (await db.project.findUniqueOrThrow({ where: { id: pid } })).requiredWorkers });
      const slots = await db.coverageSlot.count({ where: { projectId: pid } });
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(slots);
      expect(await audits('project.task_rows_created')).toHaveLength(1);
      await db.$transaction((tx) => ensureSlotTasks(tx, pid));
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(slots);
    });

    it('allocateTasks still works and reuses a CREATED row on the slot', async () => {
      await setFlow(true);
      const pid = await project();
      const before = await db.taskInstance.count({ where: { projectId: pid } });
      await db.project.update({ where: { id: pid }, data: { status: 'STAFFING' } });
      const sme = await db.smeUser.create({ data: { clientId, displayName: 'Old Flow', identityStatus: 'VERIFIED' } });
      const c = await db.candidate.create({ data: { clientId, smeUserId: sme.id, specialties: [], jurisdictions: [], skills: [] } });
      await db.projectAssignment.create({ data: { clientId, projectId: pid, candidateId: c.id } });
      const issued = await db.$transaction((tx) => allocateTasks(tx, { projectId: pid, candidateId: c.id, want: 2 }, (i) => writeAudit(tx, { clientId, actorType: 'SYSTEM', actorId: null }, i)));
      expect(issued).toHaveLength(2);
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(before);
      expect(issued.every((t) => t.status === 'ASSIGNED' && t.assignedToId === c.id)).toBe(true);
    });
  });

  // ── 4. Direct assignment ──

  describe('direct assignment', () => {
    it('is refused with the new flow off, and the earlier flow (match, assign, pull) is untouched', async () => {
      const pid = await project();
      const s = await source(pid, 'SME');
      const fake = randomUUID();
      const r = await assign(pid, s.id, fake);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('NEW_FLOW_OFF');
      expect((await post(pm, `/projects/${pid}/tasks/${fake}/author`, { sourcedPersonId: s.id })).json().error).toBe('NEW_FLOW_OFF');

      // Earlier flow with the staffing test double: match, assign, pull one task.
      const pmStub = await login(stubApp, (await db.user.findUniqueOrThrow({ where: { id: pmUserId } })).email);
      expect((await call(stubApp, 'POST', pmStub, `/projects/${pid}/match`)).statusCode).toBe(200);
      const mail = `${randomUUID().slice(0, 8)}@example.test`;
      const res = await stubApp.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Old Flow' }), adultAttested: true } });
      const smeUserId = res.json().id as string;
      const cookie = `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`;
      await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
      const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
      const asg = await call(stubApp, 'POST', pmStub, `/projects/${pid}/assignments`, { candidateIds: [c.id] });
      expect(asg.statusCode, asg.body).toBe(200);
      expect((await call(stubApp, 'GET', cookie, `/me/projects/${pid}`)).json().canPull).toBe(true);
      const pull = await call(stubApp, 'POST', cookie, `/me/projects/${pid}/tasks/next`);
      expect(pull.statusCode, pull.body).toBe(200);
      expect(await db.taskInstance.count({ where: { projectId: pid } })).toBe(1);
    });

    it('assigns an SME: creates the account, matching record and project place; the task is ASSIGNED and its slot OFFERED; audited', async () => {
      await setFlow(true);
      const pid = await project();
      const s = await source(pid, 'SME', { first: 'Mary', last: 'Jackson', email: 'Mary.J@gmail.test' });
      const t = await openTask(pid);
      const r = await assign(pid, s.id, t.id);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ taskId: t.id, status: 'ASSIGNED' });

      const person = await db.sourcedPerson.findUniqueOrThrow({ where: { id: s.id } });
      expect(person).toMatchObject({ assignedById: pmUserId, releasedAt: null });
      expect(person.assignedAt).not.toBeNull();
      const u = await db.smeUser.findUniqueOrThrow({ where: { id: person.smeUserId! }, include: { providerIdentities: true, candidate: true } });
      expect(u).toMatchObject({ displayName: 'Mary Jackson', contactEmail: 'mary.j@gmail.test', identityStatus: 'NOT_STARTED' });
      expect(u.providerIdentities).toHaveLength(0);
      expect(u.candidate).toMatchObject({ poolStatus: 'ASSIGNED_DIRECT' });
      const pa = await db.projectAssignment.findUniqueOrThrow({ where: { projectId_candidateId: { projectId: pid, candidateId: u.candidate!.id } } });
      expect(pa).toMatchObject({ smeAssignmentId: null, releasedAt: null });
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id }, include: { slot: true } });
      expect(task).toMatchObject({ status: 'ASSIGNED', assignedToId: u.candidate!.id, projectAssignmentId: pa.id });
      expect(task.assignedAt).not.toBeNull();
      expect(task.slot).toMatchObject({ status: 'OFFERED', assignedToId: u.candidate!.id });
      expect((await db.project.findUniqueOrThrow({ where: { id: pid } })).status).toBe('IN_PROGRESS');

      const [issued] = await audits('task.issued');
      expect(issued!.after).toMatchObject({ direct: true, by: pmUserId, candidateId: u.candidate!.id });
      expect(await audits('sourcing.person_assigned')).toHaveLength(1);
      expect(await audits('sourcing.account_created')).toHaveLength(1);

      const people = (await get(pm, `/projects/${pid}/people`)).json().items;
      expect(people).toEqual([expect.objectContaining({ sourcedPersonId: s.id, role: 'SME', status: 'ASSIGNED', email: 'mary.j@gmail.test', tasks: [expect.objectContaining({ taskId: t.id, status: 'ASSIGNED' })] })]);
      expect((await get(pm, '/sourcing/people?role=SME')).json().items[0].assigned).toBe(true);

      // A second task for the same person reuses the account and place; a taken task is refused.
      const t2 = await openTask(pid);
      expect((await assign(pid, s.id, t2.id)).statusCode).toBe(200);
      expect(await db.smeUser.count({ where: { contactEmail: 'mary.j@gmail.test' } })).toBe(1);
      expect(await db.projectAssignment.count({ where: { projectId: pid } })).toBe(1);
      const s2 = await source(pid, 'SME');
      expect((await assign(pid, s2.id, t.id)).json().error).toBe('TASK_NOT_OPEN');
    });

    it('is idempotent: a replay with the same key changes nothing more', async () => {
      await setFlow(true);
      const pid = await project();
      const s = await source(pid, 'SME');
      const t = await openTask(pid);
      const headers = { cookie: pm, ...idem() };
      const first = await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/assignments/direct`, headers, payload: { sourcedPersonId: s.id, taskId: t.id } });
      const again = await app.inject({ method: 'POST', url: `/api/v1/projects/${pid}/assignments/direct`, headers, payload: { sourcedPersonId: s.id, taskId: t.id } });
      expect(first.statusCode).toBe(200);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      expect(await audits('task.issued')).toHaveLength(1);
    });

    it('reuses an SmeUser already signed in with the mock subject, or with the contact email', async () => {
      await setFlow(true);
      const pid = await project();
      const bySubject = await signIn('sub.match@gmail.test');
      const s1 = await source(pid, 'SME', { email: 'Sub.Match@gmail.test' });
      expect((await assign(pid, s1.id, (await openTask(pid)).id)).statusCode).toBe(200);
      expect((await db.sourcedPerson.findUniqueOrThrow({ where: { id: s1.id } })).smeUserId).toBe(bySubject.smeUserId);

      const byEmail = await signIn('mail.match@gmail.test', `google-${randomUUID()}`);
      const s2 = await source(pid, 'SME', { email: 'MAIL.match@gmail.test' });
      expect((await assign(pid, s2.id, (await openTask(pid)).id)).statusCode).toBe(200);
      expect((await db.sourcedPerson.findUniqueOrThrow({ where: { id: s2.id } })).smeUserId).toBe(byEmail.smeUserId);
      expect(await audits('sourcing.account_created')).toHaveLength(0);
    });

    it('stops at Required workers (unless the person already has a place) and at the per-expert cap', async () => {
      await setFlow(true);
      const pid = await project();
      await db.project.update({ where: { id: pid }, data: { requiredWorkers: 2 } });
      const a = await source(pid, 'SME');
      const b = await source(pid, 'SME');
      const c = await source(pid, 'SME');
      expect((await assign(pid, a.id, (await openTask(pid)).id)).statusCode).toBe(200);
      expect((await get(pm, `/projects/${pid}/assignable`)).json().smePlacesFull).toBe(false);
      expect((await assign(pid, b.id, (await openTask(pid)).id)).statusCode).toBe(200);
      const view = (await get(pm, `/projects/${pid}/assignable`)).json();
      expect(view).toMatchObject({ smePlacesFull: true, smePlacesUsed: 2, requiredWorkers: 2 });
      expect(view.people.map((x: { sourcedPersonId: string }) => x.sourcedPersonId)).toEqual([c.id]);
      const full = await assign(pid, c.id, (await openTask(pid)).id);
      expect(full.statusCode).toBe(409);
      expect(full.json().error).toBe('SME_PLACES_FULL');
      // Already placed: more tasks, up to the per-expert cap.
      await db.project.update({ where: { id: pid }, data: { maxPerExpert: 2 } });
      expect((await assign(pid, a.id, (await openTask(pid)).id)).statusCode).toBe(200);
      const capped = await assign(pid, a.id, (await openTask(pid)).id);
      expect(capped.statusCode).toBe(409);
      expect(capped.json().error).toBe('MAX_PER_EXPERT');
    });

    it('lists the Assign screen: matching skills from the assessment, open tasks, and not-yet-assigned people', async () => {
      await setFlow(true);
      const pid = await project();
      const s = await source(pid, 'SME', { assessment: { 'Requirement 1': 'Met: five years of KYC reviews', Why: 'Strong onboarding background' } });
      const plain = await source(pid, 'SME');
      const v = (await get(pm, `/projects/${pid}/assignable`)).json();
      const one = v.people.find((x: { sourcedPersonId: string }) => x.sourcedPersonId === s.id);
      expect(one.assessed).toBe(true);
      expect(one.matchingSkills).toEqual(expect.arrayContaining([{ skill: 'KYC', matched: true }, { skill: 'Sanctions screening', matched: false }]));
      const two = v.people.find((x: { sourcedPersonId: string }) => x.sourcedPersonId === plain.id);
      expect(two.assessed).toBe(false);
      expect(two.matchingSkills.every((m: { matched: null }) => m.matched === null)).toBe(true);
      expect(v.reviewableTasks).toEqual([]);
    });
  });

  describe('reviewer assignment', () => {
    it('needs the Reviewer route, a task with an author, never the author, and one role per person', async () => {
      await setFlow(true);
      const pid = await project({ route: 'SME_EXPERT_PM' });
      const author = await source(pid, 'SME', { email: 'author@gmail.test' });
      const reviewer = await source(pid, 'REVIEWER', { email: 'reviewer@gmail.test' });
      const t = await openTask(pid);
      const early = await assign(pid, reviewer.id, t.id);
      expect(early.json().error).toBe('TASK_NOT_REVIEWABLE');
      expect((await assign(pid, author.id, t.id)).statusCode).toBe(200);

      // The author sourced again as Reviewer: one role per project, and never on their own task.
      const twin = await source(pid, 'REVIEWER', { email: 'author@gmail.test' });
      expect((await get(pm, `/projects/${pid}/assignable`)).json().people.map((x: { sourcedPersonId: string }) => x.sourcedPersonId)).not.toContain(twin.id);
      expect((await assign(pid, twin.id, t.id)).json().error).toBe('BOTH_ROLES');

      const v = (await get(pm, `/projects/${pid}/assignable`)).json();
      expect(v.reviewableTasks.map((x: { taskId: string }) => x.taskId)).toEqual([t.id]);
      expect(v.people.find((x: { sourcedPersonId: string }) => x.sourcedPersonId === reviewer.id).reviewableTaskIds).toEqual([t.id]);

      const ok = await assign(pid, reviewer.id, t.id);
      expect(ok.statusCode, ok.body).toBe(200);
      const person = await db.sourcedPerson.findUniqueOrThrow({ where: { id: reviewer.id } });
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
      expect(task.reviewerSmeUserId).toBe(person.smeUserId);
      expect(await db.candidate.count({ where: { smeUserId: person.smeUserId! } })).toBe(0);
      expect(await audits('task.reviewer_assigned')).toHaveLength(1);
      const people = (await get(pm, `/projects/${pid}/people`)).json().items;
      expect(people.find((x: { role: string }) => x.role === 'REVIEWER').tasks).toEqual([expect.objectContaining({ taskId: t.id })]);

      const second = await source(pid, 'REVIEWER');
      expect((await assign(pid, second.id, t.id)).json().error).toBe('HAS_REVIEWER');
      // A Reviewer cannot be put on an open task's author slot either (no such route for Reviewers).
      expect((await assign(pid, second.id, (await openTask(pid)).id)).json().error).toBe('TASK_NOT_REVIEWABLE');
    });

    it('refuses a Reviewer on a project whose route has no Reviewer step', async () => {
      await setFlow(true);
      const pid = await project({ route: 'SME_EXPERT_PM' });
      const author = await source(pid, 'SME');
      const reviewer = await source(pid, 'REVIEWER');
      const t = await openTask(pid);
      expect((await assign(pid, author.id, t.id)).statusCode).toBe(200);
      await db.project.update({ where: { id: pid }, data: { reviewRoute: 'SME_PM' } });
      expect((await assign(pid, reviewer.id, t.id)).json().error).toBe('NO_REVIEWER_STEP');
    });
  });

  describe('change author', () => {
    it('changes the author before they start, releasing the old one; refuses once started', async () => {
      await setFlow(true);
      const pid = await project();
      const first = await source(pid, 'SME');
      const second = await source(pid, 'SME');
      const t = await openTask(pid);
      expect((await assign(pid, first.id, t.id)).statusCode).toBe(200);
      const r = await post(pm, `/projects/${pid}/tasks/${t.id}/author`, { sourcedPersonId: second.id });
      expect(r.statusCode, r.body).toBe(200);
      const p2 = await db.sourcedPerson.findUniqueOrThrow({ where: { id: second.id }, include: { smeUser: { include: { candidate: true } } } });
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id }, include: { slot: true } });
      expect(task).toMatchObject({ status: 'ASSIGNED', assignedToId: p2.smeUser!.candidate!.id });
      expect(task.slot!.assignedToId).toBe(p2.smeUser!.candidate!.id);
      expect((await db.sourcedPerson.findUniqueOrThrow({ where: { id: first.id } })).releasedAt).not.toBeNull();
      expect(await audits('task.author_changed')).toHaveLength(1);
      expect((await get(pm, `/projects/${pid}/people`)).json().items.map((x: { sourcedPersonId: string }) => x.sourcedPersonId)).toEqual([second.id]);

      expect((await post(pm, `/projects/${pid}/tasks/${t.id}/author`, { sourcedPersonId: second.id })).json().error).toBe('SAME_AUTHOR');
      await db.taskInstance.update({ where: { id: t.id }, data: { startedAt: new Date() } });
      const late = await post(pm, `/projects/${pid}/tasks/${t.id}/author`, { sourcedPersonId: first.id });
      expect(late.statusCode).toBe(409);
      expect(late.json().error).toBe('AUTHOR_STARTED');
      await db.taskInstance.update({ where: { id: t.id }, data: { startedAt: null, status: 'IN_PROGRESS' } });
      expect((await post(pm, `/projects/${pid}/tasks/${t.id}/author`, { sourcedPersonId: first.id })).json().error).toBe('AUTHOR_STARTED');
    });
  });

  // ── 5. Candidate gate ──

  describe('candidate gate in the new flow', () => {
    it('lets an assigned SME with no identity check and no selection open and save the task, but not pull tasks', async () => {
      await setFlow(true);
      const pid = await project();
      const me = await signIn('assigned@gmail.test');
      const s = await source(pid, 'SME', { email: 'assigned@gmail.test' });
      const t = await openTask(pid);
      expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
      expect((await db.smeUser.findUniqueOrThrow({ where: { id: me.smeUserId } })).identityStatus).toBe('NOT_STARTED');

      const proj = await call(app, 'GET', me.cookie, `/me/projects/${pid}`);
      expect(proj.statusCode, proj.body).toBe(200);
      expect(proj.json().canPull).toBe(false);
      expect(proj.json().tasks.map((x: { id: string }) => x.id)).toEqual([t.id]);
      const view = await call(app, 'GET', me.cookie, `/me/tasks/${t.id}`);
      expect(view.statusCode, view.body).toBe(200);
      const save = await call(app, 'PUT', me.cookie, `/me/tasks/${t.id}`, { output: { header: { title: 'Draft' } }, activeSecondsDelta: 30, expectedRevision: view.json().revision });
      expect(save.statusCode, save.body).toBe(200);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('IN_PROGRESS');

      const pull = await call(app, 'POST', me.cookie, `/me/projects/${pid}/tasks/next`);
      expect(pull.statusCode).toBe(409);
      expect(pull.json().error).toBe('PM_ASSIGNS_TASKS');
      expect((await call(app, 'GET', me.cookie, '/me/projects')).json().items.map((x: { projectId: string }) => x.projectId)).toEqual([pid]);
    });

    it('still blocks an SME who is not assigned, and the old gate applies with the new flow off', async () => {
      await setFlow(true);
      const pid = await project();
      const other = await signIn('not.assigned@gmail.test');
      const r = await call(app, 'GET', other.cookie, `/me/projects/${pid}`);
      expect(r.statusCode).toBe(409);
      expect(r.json().details.step).toBe('identity');

      // Assigned, then the flow switched off: the earlier checks (identity, selection) apply again.
      const me = await signIn('assigned2@gmail.test');
      const s = await source(pid, 'SME', { email: 'assigned2@gmail.test' });
      const t = await openTask(pid);
      expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
      expect((await call(app, 'GET', me.cookie, `/me/projects/${pid}`)).statusCode).toBe(200);
      await setFlow(false);
      const off = await call(app, 'GET', me.cookie, `/me/projects/${pid}`);
      expect(off.statusCode).toBe(409);
      expect(off.json().details.step).toBe('identity');
      await db.smeUser.update({ where: { id: me.smeUserId }, data: { identityStatus: 'VERIFIED' } });
      const gated = await call(app, 'GET', me.cookie, `/me/projects/${pid}`);
      expect(gated.statusCode).toBe(409);
      expect(gated.json().details.step).toBe('eligibility');
    });

    it('a released author loses access to the project', async () => {
      await setFlow(true);
      const pid = await project();
      const me = await signIn('released@gmail.test');
      const s = await source(pid, 'SME', { email: 'released@gmail.test' });
      const next = await source(pid, 'SME');
      const t = await openTask(pid);
      expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
      expect((await post(pm, `/projects/${pid}/tasks/${t.id}/author`, { sourcedPersonId: next.id })).statusCode).toBe(200);
      expect((await call(app, 'GET', me.cookie, `/me/tasks/${t.id}`)).statusCode).toBe(404);
      expect((await call(app, 'GET', me.cookie, `/me/projects/${pid}`)).statusCode).toBe(409);
    });
  });
});
