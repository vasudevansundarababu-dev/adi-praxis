import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProfileOutput, setFieldValue, WAVE1_PROFILES, type SectionKey } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { verifyApprovedChain } from '../src/dataset/verify';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
type Route = 'SME_PM' | 'SME_EXPERT_PM';
type Sme = { smeUserId: string; cookie: string };

describe('MVP1 step 2: task review on the Tasks tab and by the external Reviewer', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;
  let pmUserId: string;
  let otherPm: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const u = await createUser(clientId, ['PM']);
    pmUserId = u.id;
    pm = await login(app, u.email);
    otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    await setFlow(true);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** A KYB authoring project on the given route, owned by the PM, submitted with the new flow on (one task row per slot). */
  async function project(route: Route) {
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
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: route, templateId: tpl.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    return p.id as string;
  }

  const tasksOf = (projectId: string) => db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
  /** A task on a fixed (not open) slot, so no coverage confirmation is needed. */
  const fixedTask = async (projectId: string) => (await tasksOf(projectId)).find((t) => !t.slot?.isOpen && t.status === 'CREATED')!;

  const meTask = async (a: Sme, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();
  async function saveAndSubmit(a: Sme, id: string, output: object) {
    const v = await meTask(a, id);
    const s = await put(a.cookie, `/me/tasks/${id}`, { output, activeSecondsDelta: 10, expectedRevision: v.revision });
    expect(s.statusCode, s.body).toBe(200);
    const sub = await post(a.cookie, `/me/tasks/${id}/submit`, { expectedRevision: (await meTask(a, id)).revision, syntheticDeclaration: true, flagExplanations: {} });
    expect(sub.statusCode, sub.body).toBe(200);
  }

  /** A submitted task authored by a directly assigned SME; on the Reviewer route, with an external Reviewer assigned. */
  async function submitted(route: Route) {
    const pid = await project(route);
    const authorMail = `author-${randomUUID().slice(0, 6)}@gmail.test`;
    const author = await signIn(authorMail, `mock-${authorMail}`, 'Ada Author');
    const s = await source(pid, 'SME', { email: authorMail, first: 'Ada', last: 'Author' });
    const t = await fixedTask(pid);
    expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
    let reviewer: Sme | null = null;
    if (route === 'SME_EXPERT_PM') {
      const rMail = `rev-${randomUUID().slice(0, 6)}@gmail.test`;
      reviewer = await signIn(rMail, `mock-${rMail}`, 'Rita Reviewer');
      const r = await source(pid, 'REVIEWER', { email: rMail, first: 'Rita', last: 'Reviewer' });
      const ra = await assign(pid, r.id, t.id);
      expect(ra.statusCode, ra.body).toBe(200);
    }
    await saveAndSubmit(author, t.id, sampleProfileOutput(PROFILE));
    return { pid, id: t.id, author, reviewer };
  }

  const page = async (cookie: string, pid: string, id: string) => (await get(cookie, `/projects/${pid}/forge-tasks/${id}`)).json();
  async function decide(cookie: string, pid: string, id: string, body: object, seen?: { expectedVersion: number; expectedRevision: number }) {
    const v = seen ?? (await page(pm, pid, id));
    return post(cookie, `/projects/${pid}/tasks/${id}/decision`, { expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, ...body });
  }
  async function review(r: Sme, id: string, body: object) {
    const v = (await get(r.cookie, `/me/reviews/${id}`)).json();
    return post(r.cookie, `/me/reviews/${id}/decision`, { expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, ...body });
  }
  const audits = (id: string, action: string) => db.auditEvent.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });

  // ── Author -> PM/Admin ──

  describe('Author -> PM/Admin route', () => {
    it('the owner PM approves: one ApprovedTaskRecord, chain valid, audited via the Tasks tab', async () => {
      const s = await submitted('SME_PM');
      const v = await page(pm, s.pid, s.id);
      expect(v).toMatchObject({ status: 'SUBMITTED', smeStatus: 'In review', canDecide: true, waitingFor: null, expectedVersion: 1, checklistRequired: true, author: { name: 'Ada Author' }, reviewer: null });
      expect(v.output).toBeTruthy();
      expect(v.template.profileId).toBe(PROFILE.profileId);
      // Approve needs every checklist item.
      const partial = await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: { ...allTrue, correct: false } }, v);
      expect(partial.statusCode).toBe(400);
      expect(partial.json().error).toBe('CHECKLIST_INCOMPLETE');
      const ok = await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue, notes: 'Good case.' }, v);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toMatchObject({ status: 'ACCEPTED' });
      const rec = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.id } });
      expect(rec.reviewerId).toBe(pmUserId);
      expect(await verifyApprovedChain(db)).toMatchObject({ checked: 1, breaks: [] });
      const [rv] = await db.taskReview.findMany({ where: { taskInstanceId: s.id } });
      expect(rv).toMatchObject({ decision: 'ACCEPT', stage: null, reviewerId: pmUserId, submissionVersion: 1 });
      expect(rv!.contentHash).toBeTruthy();
      expect((await audits(s.id, 'task.accepted'))[0]!.after).toMatchObject({ via: 'tasks_tab', version: 1 });
      expect(await db.outboxEvent.count({ where: { name: 'task.accepted', aggregateId: s.id } })).toBe(1);
      // Decided: no more buttons; a second decision is refused.
      expect(await page(pm, s.pid, s.id)).toMatchObject({ status: 'ACCEPTED', canDecide: false, waitingFor: null, smeStatus: 'Accepted' });
      expect((await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue }, v)).statusCode).toBe(409);
    });

    it('rework stores comments per section; the SME sees them, resubmits, and the Admin rejects with a reason', async () => {
      const s = await submitted('SME_PM');
      const v = await page(pm, s.pid, s.id);
      // Rework and Reject need a comment for the author; Reject needs a reason.
      expect((await decide(pm, s.pid, s.id, { decision: 'REWORK' }, v)).statusCode).toBe(400);
      expect((await decide(pm, s.pid, s.id, { decision: 'REJECT', rejectReason: 'INCORRECT' }, v)).statusCode).toBe(400);
      expect((await decide(pm, s.pid, s.id, { decision: 'REJECT', comments: [{ section: 'S1', text: 'x' }] }, v)).statusCode).toBe(400);
      expect((await decide(pm, s.pid, s.id, { decision: 'REWORK', comments: [{ section: 'S 1!', text: 'x' }] }, v)).statusCode).toBe(400);

      const comments = [{ section: 'S1', text: 'Name the business trigger.' }, { section: 'S3-S4', text: 'Add the second owner.' }];
      const rw = await decide(pm, s.pid, s.id, { decision: 'REWORK', comments }, v);
      expect(rw.statusCode, rw.body).toBe(200);
      expect(rw.json()).toMatchObject({ status: 'REWORK' });
      const task = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } });
      expect(task).toMatchObject({ status: 'REWORK', reworkCount: 1, reviewStage: null });
      expect((await audits(s.id, 'task.rework_requested'))[0]!.after).toMatchObject({ via: 'tasks_tab', comments: 2 });
      const mine = await meTask(s.author, s.id);
      expect(mine.status).toBe('REWORK');
      expect(mine.review).toMatchObject({ decision: 'REWORK', comments });

      const fixed = setFieldValue(PROFILE, mine.output, 'S1' as SectionKey, 'businessContext', 'A synthetic onboarding triggered by a new holding company.');
      await saveAndSubmit(s.author, s.id, fixed);
      const v2 = await page(admin, s.pid, s.id);
      expect(v2).toMatchObject({ status: 'SUBMITTED', expectedVersion: 2, canDecide: true });
      expect(v2.reviews).toEqual([expect.objectContaining({ decision: 'REWORK', comments, version: 1 })]);
      // A decision on the old version is stale.
      const stale = await decide(admin, s.pid, s.id, { decision: 'REJECT', rejectReason: 'INCORRECT', notes: 'Still wrong.' }, v);
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('STALE_STAGE_DECISION');
      const staleRev = await decide(admin, s.pid, s.id, { decision: 'REJECT', rejectReason: 'INCORRECT', notes: 'Still wrong.' }, { expectedVersion: 2, expectedRevision: v2.expectedRevision - 1 });
      expect(staleRev.json().error).toBe('STALE_REVISION');
      const rj = await decide(admin, s.pid, s.id, { decision: 'REJECT', rejectReason: 'INCORRECT', notes: 'Still wrong.' }, v2);
      expect(rj.statusCode, rj.body).toBe(200);
      expect(rj.json()).toMatchObject({ status: 'REJECTED' });
      expect((await audits(s.id, 'task.rejected'))[0]!.after).toMatchObject({ via: 'tasks_tab', reason: 'INCORRECT', version: 2 });
      expect(await db.approvedTaskRecord.count()).toBe(0);
      expect((await meTask(s.author, s.id)).review).toMatchObject({ decision: 'REJECT', notes: 'Still wrong.' });
    });

    it('refuses a PM who does not own the project, and the author deciding on their own task', async () => {
      const s = await submitted('SME_PM');
      const v = await page(pm, s.pid, s.id);
      expect((await decide(otherPm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue }, v)).statusCode).toBe(404);
      expect((await get(otherPm, `/projects/${s.pid}/forge-tasks`)).statusCode).toBe(404);
      expect((await get(otherPm, `/projects/${s.pid}/forge-tasks/${s.id}`)).statusCode).toBe(404);
      // The project's PM is also the author (same email): never decides, Admin or not.
      const author = await db.taskInstance.findUniqueOrThrow({ where: { id: s.id }, include: { assignedTo: { include: { smeUser: true } } } });
      const pmUser = await db.user.findUniqueOrThrow({ where: { id: pmUserId } });
      await db.smeUser.update({ where: { id: author.assignedTo!.smeUserId }, data: { contactEmail: pmUser.email.toUpperCase() } });
      const own = await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue }, v);
      expect(own.statusCode).toBe(403);
      expect(await page(pm, s.pid, s.id)).toMatchObject({ canDecide: false, waitingFor: 'PM' });
      expect(await db.taskReview.count()).toBe(0);
    });
  });

  // ── Author -> Reviewer -> PM/Admin ──

  describe('Author -> Reviewer -> PM/Admin route', () => {
    it('the PM waits for the Reviewer; the Reviewer passes; the PM approves the exact version', async () => {
      const s = await submitted('SME_EXPERT_PM');
      const r = s.reviewer!;
      const v = await page(pm, s.pid, s.id);
      expect(v).toMatchObject({ reviewStage: 'EXPERT_REVIEW', canDecide: false, waitingFor: 'REVIEWER', reviewer: { name: 'Rita Reviewer' }, checklistRequired: false });
      const early = await decide(pm, s.pid, s.id, { decision: 'APPROVE' }, v);
      expect(early.statusCode).toBe(409);
      expect(early.json().error).toBe('WAITING_FOR_REVIEWER');

      // The Reviewer's Home and Review page.
      expect((await get(r.cookie, '/me/reviews')).json().items).toEqual([expect.objectContaining({ taskId: s.id, status: 'To review', author: 'Ada Author', projectId: s.pid })]);
      const rv = (await get(r.cookie, `/me/reviews/${s.id}`)).json();
      expect(rv).toMatchObject({ canDecide: true, status: 'To review', version: 1, expectedVersion: 1, myDecisions: [], template: { profileId: PROFILE.profileId } });
      expect(rv.output).toBeTruthy();
      expect(rv).not.toHaveProperty('similar');
      // The Reviewer never rejects.
      expect((await post(r.cookie, `/me/reviews/${s.id}/decision`, { decision: 'REJECT', expectedVersion: 1, expectedRevision: rv.expectedRevision })).statusCode).toBe(400);
      const stale = await post(r.cookie, `/me/reviews/${s.id}/decision`, { decision: 'PASS', expectedVersion: 1, expectedRevision: rv.expectedRevision + 5 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe('STALE_REVISION');
      const passed = await review(r, s.id, { decision: 'PASS' });
      expect(passed.statusCode, passed.body).toBe(200);
      expect(passed.json()).toMatchObject({ stage: 'PM_APPROVAL', version: 1 });
      const pass = await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: s.id, decision: 'PASS' } });
      expect(pass).toMatchObject({ reviewerId: r.smeUserId, stage: 'EXPERT_REVIEW', submissionVersion: 1 });
      const [pa] = await audits(s.id, 'task.expert_passed');
      expect(pa).toMatchObject({ actorType: 'CANDIDATE', after: { reviewer: 'external', smeUserId: r.smeUserId, stage: 'PM_APPROVAL' } });
      expect((await get(r.cookie, '/me/reviews')).json().items[0].status).toBe('Approved');
      expect((await get(r.cookie, `/me/reviews/${s.id}`)).json()).toMatchObject({ canDecide: false, status: 'Approved' });
      // Deciding again on a passed version is refused.
      expect((await review(r, s.id, { decision: 'PASS' })).statusCode).toBe(409);

      const atPm = await page(pm, s.pid, s.id);
      expect(atPm).toMatchObject({ reviewStage: 'PM_APPROVAL', canDecide: true, waitingFor: null, expertPass: { version: 1 } });
      expect(atPm.reviews).toEqual([expect.objectContaining({ decision: 'PASS', by: 'Rita Reviewer', stage: 'EXPERT_REVIEW' })]);
      const ok = await decide(pm, s.pid, s.id, { decision: 'APPROVE' }, atPm);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toMatchObject({ status: 'ACCEPTED', version: 1 });
      expect((await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.id } })).reviewerId).toBe(pmUserId);
      expect((await audits(s.id, 'task.accepted'))[0]!.after).toMatchObject({ via: 'tasks_tab', expertId: r.smeUserId, samePersonAsExpert: false, responsibility: 'PM' });
      expect(await verifyApprovedChain(db)).toMatchObject({ checked: 1, breaks: [] });
      expect((await get(r.cookie, '/me/reviews')).json().items[0].status).toBe('Approved');
    });

    it('Reviewer rework: the SME sees the comments, resubmits, and it returns to the same Reviewer', async () => {
      const s = await submitted('SME_EXPERT_PM');
      const r = s.reviewer!;
      expect((await review(r, s.id, { decision: 'REWORK' })).statusCode).toBe(400);
      const comments = [{ section: 'S1', text: 'The trigger is missing.' }, { section: 'S6-S8', text: 'Explain the outcome.' }];
      const back = await review(r, s.id, { decision: 'REWORK', comments });
      expect(back.statusCode, back.body).toBe(200);
      expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: 'REWORK', reviewStage: null, reworkCount: 1, reviewerSmeUserId: r.smeUserId });
      expect((await audits(s.id, 'task.rework_requested'))[0]!.after).toMatchObject({ reviewer: 'external', stage: 'EXPERT_REVIEW', comments: 2 });
      expect((await get(r.cookie, '/me/reviews')).json().items[0].status).toBe('Sent back');
      expect(await page(pm, s.pid, s.id)).toMatchObject({ status: 'REWORK', smeStatus: 'Rework', canDecide: false, waitingFor: null });

      const mine = await meTask(s.author, s.id);
      expect(mine.review).toMatchObject({ decision: 'REWORK', stage: 'EXPERT_REVIEW', comments });
      await saveAndSubmit(s.author, s.id, setFieldValue(PROFILE, mine.output, 'S1' as SectionKey, 'businessContext', 'A synthetic onboarding triggered by a new holding company.'));
      expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: 'SUBMITTED', reviewStage: 'EXPERT_REVIEW', reviewerSmeUserId: r.smeUserId });
      expect((await get(r.cookie, '/me/reviews')).json().items[0].status).toBe('To review');
      const rv = (await get(r.cookie, `/me/reviews/${s.id}`)).json();
      expect(rv).toMatchObject({ canDecide: true, version: 2, myDecisions: [expect.objectContaining({ decision: 'REWORK', version: 1 })] });
      expect((await review(r, s.id, { decision: 'PASS' })).json()).toMatchObject({ stage: 'PM_APPROVAL', version: 2 });
      // The PM may also send it back at PM approval.
      const pmBack = await decide(pm, s.pid, s.id, { decision: 'REWORK', comments: [{ section: 'S5', text: 'Tighten the expected work.' }] });
      expect(pmBack.statusCode, pmBack.body).toBe(200);
      expect((await audits(s.id, 'task.rework_requested')).at(-1)!.after).toMatchObject({ via: 'tasks_tab', stage: 'PM_APPROVAL' });
    });

    it('a Reviewer not assigned to the task, or reviewing their own task, is refused', async () => {
      const s = await submitted('SME_EXPERT_PM');
      const stranger = await signIn('stranger@gmail.test');
      expect((await get(stranger.cookie, `/me/reviews/${s.id}`)).statusCode).toBe(404);
      expect((await post(stranger.cookie, `/me/reviews/${s.id}/decision`, { decision: 'PASS', expectedVersion: 1, expectedRevision: 1 })).statusCode).toBe(404);
      expect((await get(stranger.cookie, '/me/reviews')).json().items).toEqual([]);
      // The author is never their own Reviewer, even if the data said so.
      await db.taskInstance.update({ where: { id: s.id }, data: { reviewerSmeUserId: s.author.smeUserId } });
      expect((await get(s.author.cookie, `/me/reviews/${s.id}`)).statusCode).toBe(403);
      const own = await post(s.author.cookie, `/me/reviews/${s.id}/decision`, { decision: 'PASS', expectedVersion: 1, expectedRevision: 1 });
      expect(own.statusCode).toBe(403);
      expect(own.json().error).toBe('OWN_TASK');
      expect(await db.taskReview.count()).toBe(0);
    });
  });

  // ── Tasks tab list and the switch ──

  describe('Tasks tab list and the new-flow switch', () => {
    it('lists one row per slot with statuses, people, turn and date', async () => {
      const s = await submitted('SME_EXPERT_PM');
      const slots = await db.coverageSlot.count({ where: { projectId: s.pid } });
      const res = await get(pm, `/projects/${s.pid}/forge-tasks`);
      expect(res.statusCode, res.body).toBe(200);
      const { items, reviewRoute } = res.json();
      expect(reviewRoute).toBe('SME_EXPERT_PM');
      expect(items).toHaveLength(slots);
      expect(items.map((x: { slotLabel: string }) => x.slotLabel)).toEqual(Array.from({ length: slots }, (_, i) => `Task ${i + 1}`));
      const mine = items.find((x: { taskId: string }) => x.taskId === s.id);
      expect(mine).toMatchObject({ status: 'SUBMITTED', smeStatus: 'In review', author: { name: 'Ada Author' }, reviewer: { name: 'Rita Reviewer' }, reviewStage: 'EXPERT_REVIEW', canDecide: false, waitingFor: 'REVIEWER' });
      expect(Date.parse(mine.date)).toBeGreaterThan(0);
      for (const o of items.filter((x: { taskId: string }) => x.taskId !== s.id)) expect(o).toMatchObject({ status: 'CREATED', smeStatus: 'New', author: null, reviewer: null, canDecide: false, waitingFor: null });
      // An open task's page has no output yet.
      const other = items.find((x: { taskId: string }) => x.taskId !== s.id);
      expect((await page(admin, s.pid, other.taskId)).output).toBeNull();

      await review(s.reviewer!, s.id, { decision: 'PASS' });
      const after = (await get(pm, `/projects/${s.pid}/forge-tasks`)).json().items.find((x: { taskId: string }) => x.taskId === s.id);
      expect(after).toMatchObject({ reviewStage: 'PM_APPROVAL', canDecide: true, waitingFor: null });
    });

    it('with the new flow off the new routes answer NEW_FLOW_OFF and the earlier review routes work as before', async () => {
      const s = await submitted('SME_PM');
      const v = await page(pm, s.pid, s.id);
      await setFlow(false);
      for (const res of [
        await get(pm, `/projects/${s.pid}/forge-tasks`),
        await get(pm, `/projects/${s.pid}/forge-tasks/${s.id}`),
        await decide(pm, s.pid, s.id, { decision: 'APPROVE', checklist: allTrue }, v),
        await get(s.author.cookie, '/me/reviews'),
        await get(s.author.cookie, `/me/reviews/${s.id}`),
        await post(s.author.cookie, `/me/reviews/${s.id}/decision`, { decision: 'PASS', expectedVersion: 1, expectedRevision: 1 }),
      ]) {
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error).toBe('NEW_FLOW_OFF');
      }
      // The earlier Reviews screen: an assigned Validator accepts with the one-step decision, unchanged.
      const validator = await createUser(clientId, ['REVIEWER']);
      expect((await post(pm, `/projects/${s.pid}/reviewers`, { userId: validator.id })).statusCode).toBe(200);
      const vc = await login(app, validator.email);
      const r = (await get(vc, `/review/tasks/${s.id}`)).json();
      const ok = await post(vc, `/review/tasks/${s.id}/decision`, { decision: 'ACCEPT', expectedRevision: r.revision, checklist: allTrue });
      expect(ok.statusCode, ok.body).toBe(200);
      const [rv] = await db.taskReview.findMany({ where: { taskInstanceId: s.id } });
      expect(rv).toMatchObject({ decision: 'ACCEPT', reviewerId: validator.id, contentHash: null, stage: null });
      expect((await audits(s.id, 'task.accepted'))[0]!.after).not.toHaveProperty('via');
    });
  });
});
