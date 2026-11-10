import { executableDemoSetup } from '../src/jobs/demo-setup';
import { writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { parseCsv } from '../src/routes/tasks';
import { runChainVerification, verifyApprovedChain, verifyRlChain } from '../src/dataset/verify';
import { createServer, type IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';
import { createDomainEventsQueue, createDomainEventsWorker, startOutboxPoller } from '../src/outbox/dispatcher';
import { redisConnection } from '../src/lib/redis';
import { WebhookRlGymClient } from '../src/rl/rl-gym';
import { TEST_REDIS_URL } from './env';
import { PRAXIS_STAGED_EXAMPLE, PRAXIS_SYNTHETIC_EXAMPLE, KYC_EXAMPLE_TASK } from '@praxis/shared';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
type Who = { cookie: string; smeUserId: string; candidateId: string };

describe('M5a FLOW 3: slots, task generation, invites, pull, autosave, submit, reclaim, annotation inputs', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;

  const post = (cookie: string, url: string, payload: object = {}, headers: Record<string, string> = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...headers }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const handlers = () => defaultHandlers({ email, config });
  async function deliver(name: string) {
    for (const ev of await db.outboxEvent.findMany({ where: { name }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers(), ev.id);
  }

  beforeAll(async () => {
    app = await buildApp({
      config,
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      selectionGate: stubSelectionGate,
      email,
      embeddings: new HashingEmbeddingProvider(),
    });
  });

  beforeEach(async () => {
    await resetDb();
    email.sent.length = 0;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function template(taskMode: 'AUTHORING' | 'ANNOTATION', workflowName = `KYC ${taskMode} ${randomUUID().slice(0, 4)}`, edgeCases = [{ name: 'PEP link', quota: 1, required: true }, { name: 'Nominee director', quota: 1, required: true }]) {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName,
        primaryWork: 'Assemble identity evidence and recommend a disposition.',
        verificationCriteria: 'Document checks, completeness, policy adherence.',
        humanGate: 'Approval, rejection and high-risk classification remain human decisions.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: [taskMode],
        coverageDimensions: {
          dimensions: [
            { key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate', 'trust'] },
            { key: 'risk_level', label: 'Risk level', values: ['low', 'high'] },
            { key: 'jurisdiction', label: 'Jurisdiction', values: ['GB', 'FR'] },
          ],
          cells: [{ tags: { customer_type: 'corporate', risk_level: 'high' }, quota: 1, required: true }],
        },
        edgeCaseCatalog: edgeCases,
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  /** Two working days, so a 12-task authoring project needs two workers (room to assign two experts). */
  async function project(taskMode: 'AUTHORING' | 'ANNOTATION', extra: object = {}, templateId?: string) {
    templateId ??= await template(taskMode);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const volume = taskMode === 'AUTHORING' ? { distinctTarget: 12, maxPerExpert: 4 } : { taskCount: 3 };
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode, ...volume, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }], ...extra })).json();
    // Existing-task regression: migrated projects retain historical editing behaviour.
    await db.project.update({where:{id:p.id},data:{authoringExperience:null}});
    const submitted = await post(pm, `/projects/${p.id}/submit`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    return p.id as string;
  }

  async function expert(name = 'Ada Lovelace', jurisdictions: string[] = []): Promise<Who> {
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions, domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id };
  }

  async function assign(projectId: string, ...who: Who[]) {
    const res = await post(pm, `/projects/${projectId}/assignments`, { candidateIds: who.map((w) => w.candidateId) });
    expect(res.statusCode, res.body).toBe(200);
    await deliver('candidate.assigned');
  }
  const tokenFrom = (i: number) => email.sent[i]!.text.match(/\/invites\/(\S+)/)![1]!;
  const myProject = async (w: Who, projectId: string) => (await get(w.cookie, `/me/projects/${projectId}`)).json();
  const task = async (w: Who, id: string) => (await get(w.cookie, `/me/tasks/${id}`)).json();
  async function save(w: Who, id: string, output: object, delta = 30) {
    const t = await task(w, id);
    return put(w.cookie, `/me/tasks/${id}`, { output, activeSecondsDelta: delta, expectedRevision: t.revision });
  }
  async function submit(w: Who, id: string, extra: object = {}) {
    const t = await task(w, id);
    return post(w.cookie, `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, ...extra });
  }

  describe('coverage slots (SPEC: Task diversity and coverage)', () => {
    it('submitting an authoring project generates exactly the distinct-task target as slots', async () => {
      const projectId = await project('AUTHORING');
      const slots = await db.coverageSlot.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
      expect(slots).toHaveLength(12);
      expect(slots.filter((s) => s.required)).toHaveLength(3); // 1 required cell + 2 required edge cases
      expect(slots.filter((s) => s.isOpen)).toHaveLength(2); // round(20% of 12)
      expect(slots[0]!.brief).toBe('Customer type: corporate · Risk level: high');
      const stored = await db.project.findUniqueOrThrow({ where: { id: projectId } });
      expect((stored.figures as { requiredAuthors: number }).requiredAuthors).toBe(3);
      expect(stored.requiredWorkers).toBe(3);
    });
  });

  describe('SPEC FLOW 3 acceptance criteria', () => {
    it('assigning a candidate creates task instances and sends one invite; a retried event adds nothing', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      const tasks = await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId } });
      expect(tasks).toHaveLength(3); // the concurrent open-task cap
      expect(tasks.every((t) => t.status === 'ASSIGNED' && t.slotId)).toBe(true);
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0]!.text).toMatch(/http:\/\/localhost:3101\/invites\/\S{20,}/);
      expect(email.sent[0]!.text).toMatch(/expires in 7 days/);
      // A retry (redelivery) neither issues more tasks nor sends a second invite.
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'candidate.assigned' } });
      await db.eventHandlerReceipt.deleteMany({});
      await processDomainEvent(db, handlers(), ev.id);
      expect(await db.taskInstance.count({ where: { projectId, assignedToId: a.candidateId } })).toBe(3);
      expect(email.sent).toHaveLength(1);
      expect(await db.invite.count()).toBe(1);
    });

    it('a failed email send is retried with a fresh token; the stored hash never matches an old link', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      email.failNext = 1;
      await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.candidateId] });
      const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'candidate.assigned' } });
      await expect(processDomainEvent(db, handlers(), ev.id)).rejects.toThrow(/simulated/);
      await processDomainEvent(db, handlers(), ev.id);
      expect(email.sent).toHaveLength(1);
      expect((await db.invite.findFirstOrThrow()).sentAt).not.toBeNull();
      expect((await post(a.cookie, '/me/invites/redeem', { token: tokenFrom(0) })).statusCode).toBe(200);
    });

    it('the invite link needs the candidate’s own session, works once, and can be revoked or resent', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a);
      const token = tokenFrom(0);
      expect((await app.inject({ method: 'POST', url: '/api/v1/me/invites/redeem', headers: idem(), payload: { token } })).statusCode).toBe(401);
      expect((await post(b.cookie, '/me/invites/redeem', { token })).json().error).toBe('INVITE_INVALID');
      expect((await post(a.cookie, '/me/invites/redeem', { token })).json()).toEqual({ projectId });
      expect((await post(a.cookie, '/me/invites/redeem', { token })).json().error).toBe('INVITE_INVALID');

      const [inv] = (await get(pm, `/projects/${projectId}/invites`)).json().items;
      expect(inv.state).toBe('USED');
      expect((await post(pm, `/projects/${projectId}/invites/${inv.id}/resend`)).statusCode).toBe(200);
      expect(email.sent).toHaveLength(2);
      const fresh = tokenFrom(1);
      const list = (await get(pm, `/projects/${projectId}/invites`)).json().items;
      expect(list.map((i: { state: string }) => i.state).sort()).toEqual(['REVOKED', 'SENT']);
      expect((await post(pm, `/projects/${projectId}/invites/${list.find((i: { state: string }) => i.state === 'SENT').id}/revoke`)).statusCode).toBe(200);
      expect((await post(a.cookie, '/me/invites/redeem', { token: fresh })).json().error).toBe('INVITE_INVALID');
    });

    it('an expired invite is refused', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      await db.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await post(a.cookie, '/me/invites/redeem', { token: tokenFrom(0) })).statusCode).toBe(410);
    });

    it('missing eligibility names the outstanding step instead of showing tasks', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      await db.smeUser.update({ where: { id: a.smeUserId }, data: { identityStatus: 'PROCESSING' } });
      const res = await get(a.cookie, `/me/projects/${projectId}`);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'OUTSTANDING_STEP', details: { step: 'identity', href: '/verify' } });
    });

    it('a candidate sees only tasks from projects they are assigned to', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a);
      const view = await myProject(a, projectId);
      expect(view.tasks).toHaveLength(3);
      expect(view.limits).toEqual({ openCap: 3, open: 3, perExpertCap: 4, used: 3 });
      expect((await get(b.cookie, `/me/projects/${projectId}`)).json().details.step).toBe('not_assigned');
      expect((await get(b.cookie, `/me/tasks/${view.tasks[0].id}`)).statusCode).toBe(404);
      expect((await get(b.cookie, '/me/projects')).json().items).toEqual([]);
      expect((await get(a.cookie, '/me/projects')).json().items).toMatchObject([{ projectId, counts: { ASSIGNED: 3 } }]);
    });

    it('a reclaimed task returns to the queue and is reassignable; nothing expires on TPT alone', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a, b);
      const t = (await myProject(a, projectId)).tasks[0];
      // Long past TPT: still assigned; tasks never expire on their own.
      await db.taskInstance.update({ where: { id: t.id }, data: { assignedAt: new Date('2026-01-01') } });
      expect((await task(a, t.id)).status).toBe('ASSIGNED');

      expect((await post(pm, `/projects/${projectId}/tasks/${t.id}/reclaim`, { reason: 'STALLED' })).statusCode).toBe(200);
      const reclaimed = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
      expect(reclaimed).toMatchObject({ status: 'CREATED', assignedToId: null });
      expect((await db.coverageSlot.findUniqueOrThrow({ where: { id: reclaimed.slotId! } })).status).toBe('RELEASED');
      expect(await db.outboxEvent.count({ where: { name: 'task.reclaimed' } })).toBe(1);
      expect((await get(a.cookie, `/me/tasks/${t.id}`)).statusCode).toBe(404);

      // Expert B has room (3 open) only after finishing one; lift B's cap to pull the released slot.
      await db.project.update({ where: { id: projectId }, data: { openTaskCapPerCandidate: 5 } });
      const pulled = await post(b.cookie, `/me/projects/${projectId}/tasks/next`);
      expect(pulled.statusCode, pulled.body).toBe(200);
      expect(pulled.json().id).toBe(t.id);
    });
  });

  describe('SPEC diversity: per-expert cap and distinct slots', () => {
    it('blocks a 5th task from any expert and never gives one expert two identical slots', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      await db.project.update({ where: { id: projectId }, data: { openTaskCapPerCandidate: 10 } });
      expect((await post(a.cookie, `/me/projects/${projectId}/tasks/next`)).statusCode).toBe(200);
      const fifth = await post(a.cookie, `/me/projects/${projectId}/tasks/next`);
      expect(fifth.json().error).toBe('NO_TASK');
      const mine = await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId }, include: { slot: true } });
      expect(mine).toHaveLength(4);
      const sigs = mine.filter((t) => !t.slot!.isOpen).map((t) => JSON.stringify(t.slot!.coverageTags));
      expect(new Set(sigs).size).toBe(sigs.length);
      // Required coverage is offered first.
      expect(mine.filter((t) => t.slot!.required)).toHaveLength(3);
    });

    it('concurrent pulls by two experts never receive the same slot', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a, b);
      await db.project.update({ where: { id: projectId }, data: { openTaskCapPerCandidate: 10 } });
      await Promise.all([post(a.cookie, `/me/projects/${projectId}/tasks/next`), post(b.cookie, `/me/projects/${projectId}/tasks/next`)]);
      const slots = await db.taskInstance.findMany({ where: { projectId, status: 'ASSIGNED' }, select: { slotId: true } });
      expect(slots).toHaveLength(8);
      expect(new Set(slots.map((s) => s.slotId)).size).toBe(8);
    });
  });

  describe('autosave and submit', () => {
    const header = (extra: object = {}) => ({ header: { title: 'Corporate onboarding with a PEP-linked director', ...extra }, body: 'A synthetic case about a trading company whose director is a close associate of a politically exposed person.' });

    it('autosave tracks active time and revisions, and refuses stale or paused writes', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      // Tasks are issued on acceptance even while staffing continues; the project starts once STAFFED.
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('STAFFING');
      await assign(projectId, await expert('Grace Hopper'), await expert('Alan Turing'));
      await deliver('project.staffed');
      const t = (await myProject(a, projectId)).tasks[0];
      expect((await save(a, t.id, header(), 45)).statusCode).toBe(200);
      expect((await save(a, t.id, header(), 30)).statusCode).toBe(200);
      const stored = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
      expect(stored).toMatchObject({ status: 'IN_PROGRESS', activeSeconds: 75 });
      expect(stored.startedAt).not.toBeNull();
      const stale = await put(a.cookie, `/me/tasks/${t.id}`, { output: header(), activeSecondsDelta: 0, expectedRevision: 0 });
      expect(stale.json().error).toBe('STALE_REVISION');
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('IN_PROGRESS');
      expect((await post(pm, `/projects/${projectId}/pause`)).statusCode).toBe(200);
      expect((await save(a, t.id, header())).json().error).toBe('PROJECT_PAUSED');
      expect((await post(pm, `/projects/${projectId}/resume`)).statusCode).toBe(200);
      expect((await save(a, t.id, header())).statusCode).toBe(200);
    });

    it('open slots must be tagged; likely real data blocks submit until explained; submission is versioned', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      await assign(projectId, a);
      await db.project.update({ where: { id: projectId }, data: { openTaskCapPerCandidate: 10 } });
      let open = (await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId }, include: { slot: true } })).find((t) => t.slot!.isOpen);
      while (!open) {
        await post(a.cookie, `/me/projects/${projectId}/tasks/next`);
        open = (await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId }, include: { slot: true } })).find((t) => t.slot!.isOpen);
        if (!open && (await db.taskInstance.count({ where: { assignedToId: a.candidateId } })) >= 4) {
          // All four went to required and combination slots; hand one open slot to this expert directly.
          const s = await db.coverageSlot.findFirstOrThrow({ where: { projectId, isOpen: true } });
          const t = await db.taskInstance.findFirstOrThrow({ where: { assignedToId: a.candidateId, slot: { required: false } } });
          await db.taskInstance.update({ where: { id: t.id }, data: { slotId: s.id, input: { slot: { id: s.id, brief: s.brief, tags: {}, edgeCase: null, isOpen: true } } } });
          open = await db.taskInstance.findFirstOrThrow({ where: { id: t.id }, include: { slot: true } });
        }
      }
      await save(a, open.id, { ...header(), contact: 'Escalate to compliance.officer@hsbc.co.uk' });
      const blocked = await submit(a, open.id);
      expect(blocked.statusCode).toBe(422);
      const details = blocked.json().details;
      expect(details.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { id: string }) => c.id).sort()).toEqual(['coverage.open-edge', 'coverage.open-tags']);
      expect(details.flags).toEqual([expect.objectContaining({ kind: 'EMAIL', path: 'contact', excerpt: 'compliance.officer@hsbc.co.uk' })]);

      await save(a, open.id, { ...header({ coverageTags: { customer_type: 'trust', risk_level: 'high' }, edgeCase: 'Trustee resident in a sanctioned country' }), contact: 'Escalate to compliance.officer@hsbc.co.uk' });
      expect((await submit(a, open.id)).json().details.unexplained).toHaveLength(1);
      const flagId = details.flags[0].id;
      const ok = await submit(a, open.id, { flagExplanations: { [flagId]: 'Fictional mailbox; I will change it if the reviewer prefers.' } });
      expect(ok.json()).toEqual({ status: 'SUBMITTED', version: 1 });
      const stored = await db.taskInstance.findUniqueOrThrow({ where: { id: open.id } });
      expect(stored.coverageTags).toEqual({ tags: { customer_type: 'trust', risk_level: 'high' }, edgeCase: 'Trustee resident in a sanctioned country' });
      expect((stored.flags as { explanation: string }[])[0]!.explanation).toMatch(/Fictional/);
      expect(await db.taskSubmission.count({ where: { taskInstanceId: open.id } })).toBe(1);
      expect((await task(a, open.id)).readOnly).toBe(true);
      expect((await save(a, open.id, header())).json().error).toBe('READ_ONLY');
    });

    it('a near-identical task from another expert is flagged as a likely duplicate with the match recorded', async () => {
      const projectId = await project('AUTHORING');
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a, b);
      const text = {
        header: { title: 'Trading company owned through a trust' },
        body: 'The trading company is 60 percent owned by a holding company which is half owned by a discretionary trust whose settlor is also a director. Registry data is stale and screening returns a near match for one trustee.',
      };
      const ta = (await myProject(a, projectId)).tasks.find((t: { isOpenSlot: boolean }) => !t.isOpenSlot);
      const tb = (await myProject(b, projectId)).tasks.find((t: { isOpenSlot: boolean }) => !t.isOpenSlot);
      await save(a, ta.id, text);
      expect((await submit(a, ta.id)).statusCode).toBe(200);
      await save(b, tb.id, { ...text, body: text.body.replace('stale', 'out of date') });
      const check = (await post(b.cookie, `/me/tasks/${tb.id}/check`)).json();
      expect(check.similar[0]).toMatchObject({ flagged: true });
      expect(check.similar[0].score).toBeGreaterThan(0.9);
      expect(JSON.stringify(check.similar)).not.toContain('discretionary trust'); // briefs only, never the other author's text
      expect((await submit(b, tb.id)).statusCode).toBe(200);
      const sims = await db.similarityCheck.findMany({ where: { taskInstanceId: tb.id, comparedToId: ta.id } });
      expect(sims.find((s) => s.method === 'EMBEDDING')).toMatchObject({ flagged: true });
      expect(Number(sims.find((s) => s.method === 'EMBEDDING')!.score)).toBeGreaterThan(0.9);
      expect((await db.outboxEvent.findFirstOrThrow({ where: { name: 'task.submitted', aggregateId: tb.id } })).payload).toMatchObject({ flaggedDuplicate: true });
    });

    it('submission waits when the embedding service is down', async () => {
      const failing = await buildApp({ config, db, pingRedis: async () => true, google, resolveClientId: async () => clientId, storage: new MemoryStorage(), selectionGate: stubSelectionGate, email, embeddings: { model: 'down', embed: async () => { throw new Error('down'); } } });
      try {
        const projectId = await project('AUTHORING');
        const a = await expert();
        await assign(projectId, a);
        const t = (await myProject(a, projectId)).tasks.find((x: { isOpenSlot: boolean }) => !x.isOpenSlot);
        await save(a, t.id, { header: { title: 'x' }, body: 'y' });
        const cur = await task(a, t.id);
        const res = await failing.inject({ method: 'POST', url: `/api/v1/me/tasks/${t.id}/submit`, headers: { cookie: a.cookie, ...idem() }, payload: { expectedRevision: cur.revision, syntheticDeclaration: true } });
        expect(res.json().error).toBe('SIMILARITY_UNAVAILABLE');
        expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('IN_PROGRESS');
      } finally {
        await failing.close();
      }
    });
  });

  describe('annotation inputs: PM upload and client API push', () => {
    it('validates, respects the task count, records the source, and serves a shared queue', async () => {
      const projectId = await project('ANNOTATION');
      const csv = 'case_id,text\nA-1,"Customer says ""hello"", then leaves"\nA-2,Second case\n';
      expect(parseCsv(csv)).toEqual([{ case_id: 'A-1', text: 'Customer says "hello", then leaves' }, { case_id: 'A-2', text: 'Second case' }]);
      const boundary = 'x-boundary';
      const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="inputs.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;
      const up = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/task-inputs`, headers: { cookie: pm, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: multipart });
      expect(up.statusCode, up.body).toBe(201);
      expect(up.json()).toMatchObject({ added: 2, total: 2 });

      const key = (await post(admin, '/api-clients', { name: 'Client system', kind: 'CLIENT_API' })).json().key as string;
      expect(key).toMatch(/^pk_/);
      const push = (items: unknown[], k = key) => app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/task-inputs`, headers: { authorization: `Bearer ${k}`, ...idem() }, payload: { items } });
      expect((await push([5])).json().error).toBe('INVALID_INPUTS');
      expect((await push([{ case_id: 'A-3' }, { case_id: 'A-4' }])).json().error).toBe('OVER_TASK_COUNT');
      const pushed = await push([{ case_id: 'A-3' }]);
      expect(pushed.statusCode).toBe(201);
      const batches = await db.taskInputBatch.findMany({ orderBy: { createdAt: 'asc' } });
      expect(batches.map((b) => b.source)).toEqual(['UPLOAD', 'API']);
      expect(batches[1]!.apiClientId).not.toBeNull();
      expect(await db.auditEvent.count({ where: { actorType: 'SERVICE', action: 'task_inputs.added' } })).toBe(1);
      expect((await push([{ case_id: 'x' }], 'pk_not-a-real-key-000000000000')).statusCode).toBe(401);

      const a = await expert();
      await assign(projectId, a);
      expect(await db.taskInstance.count({ where: { projectId, assignedToId: a.candidateId, status: 'ASSIGNED' } })).toBe(3);
    });

    it('API keys are shown once, never stored in replays, and stop working when revoked', async () => {
      const headers = idem();
      const first = await post(admin, '/api-clients', { name: 'Client system', kind: 'CLIENT_API' }, headers);
      const replay = await post(admin, '/api-clients', { name: 'Client system', kind: 'CLIENT_API' }, headers);
      expect(first.json().key).toMatch(/^pk_/);
      expect(replay.json().key).toBeNull();
      expect(JSON.stringify(await db.idempotencyKey.findMany())).not.toContain(first.json().key);
      const projectId = await project('ANNOTATION');
      expect((await post(admin, `/api-clients/${first.json().id}/revoke`)).statusCode).toBe(200);
      const res = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/task-inputs`, headers: { authorization: `Bearer ${first.json().key}`, ...idem() }, payload: { items: [{}] } });
      expect(res.statusCode).toBe(401);
      // A PM session cannot be replaced by a key of the wrong kind, and candidates cannot push at all.
      const rl = (await post(admin, '/api-clients', { name: 'RL Gym', kind: 'RL_GYM' })).json().key;
      expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/task-inputs`, headers: { authorization: `Bearer ${rl}`, ...idem() }, payload: { items: [{}] } })).statusCode).toBe(403);
    });
  });

  it('creates the synthetic demo configuration idempotently without inventing a human approval', async () => {
    const call = async (who: string, method: string, path: string, payload?: unknown) => {
      if (method === 'POST' && path.endsWith('/synthetic-example')) {
        const status = (await get(pm, path.replace('/synthetic-example', '/tasks'))).json();
        if (status.items.length === 0) {
          expect(status).toMatchObject({ syntheticDraftCanCreate: true, syntheticDraftAvailable: false });
          expect((await get(pm, path)).statusCode).toBe(404);
        } else expect(status).toMatchObject({ syntheticDraftCanCreate: false, syntheticDraftAvailable: true });
      }
      const response = await app.inject({ method: method as 'GET' | 'POST', url: `/api/v1${path}`, headers: { cookie: who === 'a' ? admin : pm, ...idem() }, ...(method === 'GET' ? {} : { payload: payload as object }) });
      expect(response.statusCode, response.body).toBeLessThan(300);
      return response.json();
    };
    await executableDemoSetup(call, () => undefined);
    await executableDemoSetup(call, () => undefined);
    await executableDemoSetup(call, () => undefined, true);
    await executableDemoSetup(call, () => undefined, true);
    const staged = await db.project.findFirstOrThrow({ where: { name: 'SYNTHETIC TEST — Harbor staged marketing decisions' } });
    const stagedTask = await db.taskInstance.findFirstOrThrow({ where: { projectId: staged.id } });
    expect(stagedTask.output).toMatchObject({ praxisContract: { schema_version: 'praxis.anvil.task.v2' } });
    const draftExport = await get(pm, `/projects/${staged.id}/synthetic-example`);
    expect(draftExport.statusCode).toBe(200);
    expect(draftExport.headers['x-praxis-review-status']).toBe('draft');
    expect(draftExport.json()).toEqual((stagedTask.output as { praxisContract: unknown }).praxisContract);
    const projects = await db.project.findMany({ where: { name: 'SYNTHETIC TEST — Harbor marketing decisions' } });
    expect(projects).toHaveLength(1);
    expect(projects[0]!.status).toBe('READY_FOR_STAFFING');
    const drafts = await db.taskInstance.findMany({ where: { projectId: projects[0]!.id } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: 'CREATED', assignedToId: null, reviewerId: null });
    expect(await db.taskReview.count()).toBe(0);
    expect(await db.approvedTaskRecord.count()).toBe(0);
    const foreignClient = await db.client.create({ data: { name: 'Foreign synthetic fixture tenant' } });
    const foreignUser = await createUser(foreignClient.id, ['ADMIN']);
    const foreignCookie = await login(app, foreignUser.email);
    expect((await get(foreignCookie, `/projects/${staged.id}/tasks`)).statusCode).toBe(404);
    expect((await post(foreignCookie, `/projects/${staged.id}/synthetic-example`)).statusCode).toBe(404);
    await db.taskInstance.update({ where: { id: stagedTask.id }, data: { input: {} } });
    expect((await get(pm, `/projects/${staged.id}/tasks`)).json()).toMatchObject({ syntheticDraftCanCreate: false, syntheticDraftAvailable: false });
    expect((await post(pm, `/projects/${staged.id}/synthetic-example`)).json().error).toBe('EXISTING_TASK');
    expect(await db.taskInstance.count({ where: { projectId: staged.id } })).toBe(1);
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: stagedTask.id } })).output).toEqual(stagedTask.output);
  });

  describe('KYC authoring (docs/TASK-KYC.md)', () => {
    async function kycTask() {
      const templateId = await template('AUTHORING', 'KYC onboarding and refresh', [{ name: 'Complex or circular ownership', quota: 1, required: true }]);
      const projectId = await project('AUTHORING', { distinctTarget: 4, maxPerExpert: 4 }, templateId);
      const a = await expert();
      await assign(projectId, a);
      const mine = await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId } });
      const t = mine.find((x) => (x.input as { slot: { edgeCase: string | null } }).slot.edgeCase === 'Complex or circular ownership')!;
      return { a, id: t.id };
    }

    it('the task shows the KYC definition; a complete, synthetic, escalating case is accepted for review', async () => {
      const { a, id } = await kycTask();
      const view = await task(a, id);
      expect(view.definition).toBe('kyc-onboarding-v1');
      expect(view.input.slot).toMatchObject({ edgeCase: 'Complex or circular ownership', isOpen: false });
      expect((await save(a, id, KYC_EXAMPLE_TASK)).statusCode).toBe(200);
      const check = (await post(a.cookie, `/me/tasks/${id}/check`)).json();
      expect(check.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
      expect(check.flags).toEqual([]);
      expect((await submit(a, id)).json()).toEqual({ status: 'SUBMITTED', version: 1 });
    });

    it('submit is blocked when a check fails, naming the section; approving without escalation fails the human gate', async () => {
      const { a, id } = await kycTask();
      const bad = structuredClone(KYC_EXAMPLE_TASK);
      bad.solution!.disposition = 'RECOMMEND_APPROVE';
      bad.solution!.humanHandoff = '';
      bad.rubric!.criteria![0]!.weight = 10;
      await save(a, id, bad);
      const res = await submit(a, id);
      expect(res.statusCode).toBe(422);
      const failed = res.json().details.checks.filter((c: { ok: boolean }) => !c.ok);
      expect(failed.map((c: { id: string; section: string }) => `${c.section}:${c.id}`).sort()).toEqual(['W04:human-gate', 'W05:rubric.weights']);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
    });

    it('likely real identifiers are flagged before submit', async () => {
      const { a, id } = await kycTask();
      const real = structuredClone(KYC_EXAMPLE_TASK);
      real.customerFile!.parties![0]!.identifiers = [{ type: 'IBAN', value: 'GB82 WEST 1234 5698 7654 32' }];
      await save(a, id, real);
      const check = (await post(a.cookie, `/me/tasks/${id}/check`)).json();
      expect(check.flags).toEqual([expect.objectContaining({ kind: 'IBAN', path: 'customerFile.parties[0].identifiers[0].value' })]);
      expect((await submit(a, id)).json().details.unexplained).toHaveLength(1);
    });
  });

  describe('M5c review, Approved Task Dataset and completion', () => {
    const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };
    let reviewer: string;
    let reviewerId: string;

    /** One expert on a 4-slot project (1 required cell, 2 required edge cases, 1 open slot), with a reviewer. */
    async function setup() {
      const projectId = await project('AUTHORING', { distinctTarget: 4, maxPerExpert: 4 });
      const r = await createUser(clientId, ['REVIEWER']);
      reviewerId = r.id;
      reviewer = await login(app, r.email);
      expect((await post(pm, `/projects/${projectId}/reviewers`, { userId: r.id })).statusCode).toBe(200);
      const a = await expert();
      await assign(projectId, a);
      await deliver('project.staffed');
      await db.project.update({ where: { id: projectId }, data: { openTaskCapPerCandidate: 4 } });
      await post(a.cookie, `/me/projects/${projectId}/tasks/next`);
      const tasks = await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId }, include: { slot: true }, orderBy: { assignedAt: 'asc' } });
      return { projectId, a, tasks };
    }
    let n = 0;
    const topics = ['sole trader with a cash-heavy shop', 'charity receiving overseas donations', 'import business with a new director', 'family trust refreshing its records', 'consultancy paid by offshore clients', 'property holding company with nominee shareholders'];
    const body = (title: string, extra: object = {}) => ({ header: { title, ...extra }, body: `${title}: a synthetic onboarding case about a ${topics[n++ % topics.length]}, with its own parties, documents and escalation path.` });
    async function submitted(a: Who, id: string, title: string, header: object = {}) {
      expect((await save(a, id, body(title, header))).statusCode).toBe(200);
      const r = await submit(a, id);
      expect(r.statusCode, r.body).toBe(200);
    }
    const decide = async (id: string, decision: object, cookie = reviewer) => {
      const t = (await get(cookie, `/review/tasks/${id}`)).json();
      return post(cookie, `/review/tasks/${id}/decision`, { expectedRevision: t.revision, checklist: allTrue, ...decision });
    };

    it.each([PRAXIS_SYNTHETIC_EXAMPLE, PRAXIS_STAGED_EXAMPLE])('authentically saves, submits, reviews and exports $schema_version with tenant isolation', async (sample) => {
      const { a, tasks } = await setup();
      const t = tasks.find((x) => !x.slot!.isOpen)!;
      const output = { ...body('Synthetic marketing decision'), praxisContract: structuredClone(sample) };
      expect((await save(a, t.id, output)).statusCode).toBe(200);
      const checked = (await post(a.cookie, `/me/tasks/${t.id}/check`)).json();
      const flags = Object.fromEntries(checked.flags.map((f: { id: string }) => [f.id, 'Original synthetic integration fixture; no customer data.']));
      const view = await task(a, t.id);
      const submitted = await post(a.cookie, `/me/tasks/${t.id}/submit`, { expectedRevision: view.revision, syntheticDeclaration: true, flagExplanations: flags });
      expect(submitted.statusCode, submitted.body).toBe(200);
      const decision = await decide(t.id, { decision: 'ACCEPT' });
      expect(decision.statusCode, decision.body).toBe(200);
      const recordId = decision.json().recordId;
      const exp = await get(admin, `/dataset/records/${recordId}/praxis-contract`);
      expect(exp.statusCode, exp.body).toBe(200);
      expect(exp.json()).toEqual(output.praxisContract);
      const envelope = await get(admin, `/dataset/records/${recordId}/praxis-contract?envelope=true`);
      expect(envelope.statusCode).toBe(200);
      expect(envelope.json()).toMatchObject({ schema_version: 'praxis.anvil.export.v1', source: { record_id: recordId, client_id: clientId }, payload_json: exp.body, payload_sha256: exp.headers['x-praxis-payload-sha256'] });
      expect(exp.headers['x-praxis-record-id']).toBe(recordId);
      if (process.env.PRAXIS_CAPTURE_EXPORT) {
        const path = sample.schema_version.endsWith('v2') ? process.env.PRAXIS_CAPTURE_EXPORT.replace(/\.json$/, '-staged.json') : process.env.PRAXIS_CAPTURE_EXPORT;
        writeFileSync(path, exp.body);
        writeFileSync(path.replace(/\.json$/, '-envelope.json'), envelope.body);
        writeFileSync(path + '.receipt.json', JSON.stringify({ test_only: true, approval_classification: 'automated_test_identities', source_record_id: recordId, source_record_hash: exp.headers['x-praxis-record-hash'], payload_sha256: exp.headers['x-praxis-payload-sha256'], schema_version: sample.schema_version }, null, 2));
      }

      expect(exp.headers['x-praxis-payload-sha256']).toMatch(/^[a-f0-9]{64}$/);
      expect((await get(pm, `/dataset/records/${recordId}/praxis-contract`)).statusCode).toBe(403);
      const outsider = await db.client.create({ data: { name: 'Other tenant executable test' } });
      const foreign = await createUser(outsider.id, ['ADMIN']);
      const foreignCookie = await login(app, foreign.email);
      expect((await get(foreignCookie, `/dataset/records/${recordId}/praxis-contract`)).statusCode).toBe(404);
      const bad = structuredClone(output);
      bad.praxisContract.environment.binding = 'shell' as 'structured-decision-v1';
      const correction = await post(admin, `/dataset/records/${recordId}/corrections`, { reason: 'Unsupported runtime', output: bad });
      expect(correction.statusCode, correction.body).toBe(422);
      expect(await db.approvedTaskRecord.count()).toBe(1);
      expect((await verifyApprovedChain(db)).breaks).toEqual([]);
      const corrected = structuredClone(output);
      corrected.praxisContract.title = 'Revised synthetic decision title';
      corrected.praxisContract.task_version = '9.0.0';
      corrected.praxisContract.revision_id = 'corrected-revision';
      corrected.praxisContract.provenance.review.reviewed_revision_id = 'corrected-revision';
      expect((await post(admin, `/dataset/records/${recordId}/corrections`, { reason: 'Update synthetic example', output: corrected })).statusCode).toBe(201);
      expect((await get(admin, `/dataset/records/${recordId}/praxis-contract`)).body).toBe(exp.body);
      expect((await verifyApprovedChain(db)).breaks).toEqual([]);

    });

    it('accepting a task writes exactly one ApprovedTaskRecord with full lineage, chained to the previous record', async () => {
      const { projectId, a, tasks } = await setup();
      const [t1, t2] = tasks.filter((t) => !t.slot!.isOpen);
      await submitted(a, t1!.id, 'First case');
      await submitted(a, t2!.id, 'Second case');
      const queue = (await get(reviewer, '/review/tasks')).json().items;
      expect(queue.map((q: { id: string }) => q.id).sort()).toEqual([t1!.id, t2!.id].sort());
      expect((await decide(t1!.id, { decision: 'ACCEPT' })).json()).toMatchObject({ status: 'ACCEPTED' });
      expect((await decide(t2!.id, { decision: 'ACCEPT' })).statusCode).toBe(200);

      const records = await db.approvedTaskRecord.findMany({ orderBy: { seq: 'asc' } });
      expect(records).toHaveLength(2);
      const [r1, r2] = records;
      const proj = await db.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(r1).toMatchObject({ taskInstanceId: t1!.id, taskMode: 'AUTHORING', candidateId: a.candidateId, slotId: t1!.slotId, reviewerId, projectId, templateId: proj.templateId, templateVersion: proj.templateVersion, jdSnapshotId: proj.jdSnapshotId, authorTaskIndex: 1, schemaVersion: 1, prevHash: null, isOpenSlot: false });
      expect(r1!.coverageTags).toEqual((t1!.slot!.coverageTags as object));
      expect((r1!.output as { header: { title: string } }).header.title).toBe('First case');
      expect(r1!.activeSeconds).toBe(30);
      expect(r2).toMatchObject({ authorTaskIndex: 2, prevHash: r1!.contentHash });
      expect(r1!.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t1!.id } })).status).toBe('ACCEPTED');
      expect((await db.coverageSlot.findUniqueOrThrow({ where: { id: t1!.slotId! } })).status).toBe('FILLED');
      expect(await db.outboxEvent.count({ where: { name: 'task.accepted' } })).toBe(2);
      // A decided task cannot be decided again; no second record.
      expect((await decide(t1!.id, { decision: 'ACCEPT' })).json().error).toBe('NOT_AWAITING_REVIEW');
      expect(await db.approvedTaskRecord.count()).toBe(2);
    });

    it('the checklist must hold to accept; rework needs comments; reject needs a reason', async () => {
      const { a, tasks } = await setup();
      const t = tasks.find((x) => !x.slot!.isOpen)!;
      await submitted(a, t.id, 'Case');
      expect((await decide(t.id, { decision: 'ACCEPT', checklist: { ...allTrue, distinct: false } })).statusCode).toBe(400);
      expect((await decide(t.id, { decision: 'REWORK' })).statusCode).toBe(400);
      expect((await decide(t.id, { decision: 'REJECT' })).statusCode).toBe(400);
      expect(await db.approvedTaskRecord.count()).toBe(0);
    });

    it('rework keeps version history; the author sees pinned comments and resubmits; the reviewer sees what changed', async () => {
      const { a, tasks } = await setup();
      const t = tasks.find((x) => !x.slot!.isOpen)!;
      await submitted(a, t.id, 'Draft one');
      expect((await decide(t.id, { decision: 'REWORK', checklist: { ...allTrue, correct: false }, comments: [{ section: 'W04', text: 'The disposition must escalate.' }] })).json()).toEqual({ status: 'REWORK' });
      const mine = await task(a, t.id);
      expect(mine).toMatchObject({ status: 'REWORK', readOnly: false, review: { decision: 'REWORK', comments: [{ section: 'W04', text: 'The disposition must escalate.' }] } });
      await submitted(a, t.id, 'Draft two');
      const view = (await get(reviewer, `/review/tasks/${t.id}`)).json();
      expect(view.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
      expect(view.previousOutput.header.title).toBe('Draft one');
      expect(view.output.header.title).toBe('Draft two');
      expect((await decide(t.id, { decision: 'ACCEPT' })).statusCode).toBe(200);
      expect((await db.approvedTaskRecord.findFirstOrThrow()).reworkCount).toBe(1);
    });

    it('reviewers see only assigned projects, never their own tasks, and never an author they declared a conflict with', async () => {
      const { a, tasks } = await setup();
      const t = tasks.find((x) => !x.slot!.isOpen)!;
      await submitted(a, t.id, 'Case');
      const other = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
      expect((await get(other, '/review/tasks')).json().items).toEqual([]);
      expect((await get(other, `/review/tasks/${t.id}`)).statusCode).toBe(404);
      // The author also holds an internal Reviewer account (same email): self-review is blocked.
      const sme = await db.smeUser.findUniqueOrThrow({ where: { id: a.smeUserId } });
      const self = await createUser(clientId, ['REVIEWER'], sme.contactEmail!);
      await db.projectReviewer.create({ data: { clientId, projectId: t.projectId, userId: self.id, assignedById: self.id } });
      const selfCookie = await login(app, self.email);
      expect((await get(selfCookie, '/review/tasks')).json().items).toEqual([]);
      expect((await get(selfCookie, `/review/tasks/${t.id}`)).statusCode).toBe(403);
      await db.conflictDeclaration.create({ data: { clientId, smeUserId: a.smeUserId, reviewerId, employerDescription: 'Same team', details: 'Same team' } });
      expect((await get(reviewer, '/review/tasks')).json().items).toEqual([]);
      // A real Admin action replaces the separate-person workflow gate; no Reviewer role is added.
      await db.user.update({ where: { id: self.id }, data: { roles: ['ADMIN'] } });
      const adminSelf = await login(app, self.email);
      expect((await get(adminSelf, '/review/tasks')).json().items.map((x: { id: string }) => x.id)).toContain(t.id);
      expect((await decide(t.id, { decision: 'ACCEPT' }, adminSelf)).statusCode).toBe(200);
      expect((await db.taskReview.findFirstOrThrow({ where: { taskInstanceId: t.id } })).reviewerId).toBe(self.id);
    });

    it('a flagged duplicate needs an explicit duplicate decision; rejecting it releases the slot', async () => {
      const projectId = await project('AUTHORING');
      const r = await createUser(clientId, ['REVIEWER']);
      reviewer = await login(app, r.email);
      await post(pm, `/projects/${projectId}/reviewers`, { userId: r.id });
      const a = await expert();
      const b = await expert('Grace Hopper');
      await assign(projectId, a, b);
      const ta = (await db.taskInstance.findMany({ where: { projectId, assignedToId: a.candidateId }, include: { slot: true } })).find((x) => !x.slot!.isOpen);
      const tb = (await db.taskInstance.findMany({ where: { projectId, assignedToId: b.candidateId }, include: { slot: true } })).find((x) => !x.slot!.isOpen)!;
      const same = { header: { title: 'Nominee director case' }, body: 'A nominee director signs for a shell company whose real controller lives abroad; the registry and the bank records disagree on the director list.' };
      await save(a, ta!.id, same);
      await submit(a, ta!.id);
      await save(b, tb.id, same);
      await submit(b, tb.id);
      const queue = (await get(reviewer, '/review/tasks')).json().items;
      expect(queue[0]).toMatchObject({ id: tb.id, flaggedDuplicate: true });
      const view = (await get(reviewer, `/review/tasks/${tb.id}`)).json();
      expect(view.similar[0]).toMatchObject({ taskId: ta!.id, flagged: true });
      expect(view.similar[0].text).toContain('nominee director signs');
      expect((await decide(tb.id, { decision: 'ACCEPT' })).json().error).toBe('DUPLICATE_DECISION_REQUIRED');
      expect((await decide(tb.id, { decision: 'REJECT', rejectReason: 'DUPLICATE', duplicateDecision: 'REJECT_DUPLICATE', checklist: { ...allTrue, distinct: false } })).json()).toEqual({ status: 'REJECTED' });
      expect((await db.coverageSlot.findUniqueOrThrow({ where: { id: tb.slotId! } })).status).toBe('RELEASED');
      expect(await db.approvedTaskRecord.count()).toBe(0);
      const dash = (await get(pm, `/projects/${projectId}/dashboard`)).json();
      expect(dash.duplicates).toEqual({ flagged: 1, rejected: 1 });
    });

    it('confirmed real data is quarantined and never enters the dataset', async () => {
      const { a, tasks } = await setup();
      const t = tasks.find((x) => !x.slot!.isOpen)!;
      await submitted(a, t.id, 'Case');
      expect((await decide(t.id, { decision: 'REJECT', rejectReason: 'REAL_DATA', checklist: { ...allTrue, realistic: false } })).statusCode).toBe(200);
      const stored = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
      expect(stored).toMatchObject({ status: 'REJECTED', rejectReason: 'REAL_DATA', output: null });
      expect(stored.quarantinedAt).not.toBeNull();
      expect((await db.taskSubmission.findFirstOrThrow({ where: { taskInstanceId: t.id } })).output).toEqual({ quarantined: true });
      expect(await db.approvedTaskRecord.count()).toBe(0);
      expect((await task(a, t.id)).output).toBeNull();
    });

    describe('M6 Approved Task Dataset: append-only, hash chain, lineage, export', () => {
      async function acceptedRecords(n = 3) {
        const { projectId, a, tasks } = await setup();
        for (const t of tasks.filter((x) => !x.slot!.isOpen).slice(0, n)) {
          await submitted(a, t.id, `Case ${t.id.slice(0, 4)}`);
          expect((await decide(t.id, { decision: 'ACCEPT' })).statusCode).toBe(200);
        }
        return { projectId, a, records: await db.approvedTaskRecord.findMany({ orderBy: { seq: 'asc' } }) };
      }
      /** Simulates someone with database-owner rights bypassing the rules, to prove the chain catches it. */
      async function tamper(sql: string) {
        await db.$transaction([
          db.$executeRawUnsafe('ALTER TABLE "ApprovedTaskRecord" DISABLE TRIGGER USER'),
          db.$executeRawUnsafe('GRANT UPDATE ON "ApprovedTaskRecord" TO CURRENT_USER'),
          db.$executeRawUnsafe(sql),
          db.$executeRawUnsafe('REVOKE UPDATE ON "ApprovedTaskRecord" FROM CURRENT_USER'),
          db.$executeRawUnsafe('ALTER TABLE "ApprovedTaskRecord" ENABLE TRIGGER USER'),
        ]);
      }

      it('any attempt to update, delete or truncate a record fails at the database', async () => {
        const { records } = await acceptedRecords(1);
        const id = records[0]!.id;
        await expect(db.approvedTaskRecord.update({ where: { id }, data: { reviewNotes: 'edited' } })).rejects.toThrow(/append-only|permission denied/);
        await expect(db.approvedTaskRecord.delete({ where: { id } })).rejects.toThrow(/append-only|permission denied/);
        await expect(db.$executeRawUnsafe(`UPDATE "ApprovedTaskRecord" SET review_notes = 'x' WHERE id = '${id}'`)).rejects.toThrow(/append-only|permission denied/);
        await expect(db.$executeRawUnsafe('TRUNCATE "ApprovedTaskRecord" CASCADE')).rejects.toThrow(/append-only|TRUNCATE is not allowed/);
        await expect(db.auditEvent.deleteMany({})).rejects.toThrow(/append-only|permission denied/);
        await expect(db.taskReview.updateMany({ data: { notes: 'x' } })).rejects.toThrow(/append-only|permission denied/);
        expect((await db.approvedTaskRecord.findUniqueOrThrow({ where: { id } })).reviewNotes).toBeNull();
        // Every append-only table has the trigger and no UPDATE/DELETE privilege for the application role.
        const tables = ['ApprovedTaskRecord', 'RLReviewRecord', 'AuditEvent', 'SelectionDecision', 'TaskReview', 'CandidateStateEvent', 'SmeStanding', 'EarningEntry', 'PartnerFeeEntry', 'PolicyDocumentVersion', 'ProjectRuleSet', 'TaskPolicySnapshot', 'ExtractionSpend'];
        const triggers = await db.$queryRaw<{ t: string }[]>`SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname LIKE '%_append_only'`;
        expect(triggers.map((x) => x.t).sort()).toEqual([...tables].sort());
        // Grants are revoked (the local superuser bypasses grants, so the triggers above are what stop it here).
        for (const t of tables) {
          const grants = await db.$queryRaw<{ p: string }[]>`SELECT privilege_type AS p FROM information_schema.table_privileges WHERE table_name = ${t}`;
          expect(grants.map((g) => g.p).filter((p) => p === 'UPDATE' || p === 'DELETE'), t).toEqual([]);
        }
      });

      it('the verification job recomputes the hash chain and reports any break', async () => {
        const { records } = await acceptedRecords(3);
        expect(await verifyApprovedChain(db)).toMatchObject({ checked: 3, breaks: [], lastHash: records[2]!.contentHash });
        const logs: [string, string, object | undefined][] = [];
        await runChainVerification(db, (l, m, e) => logs.push([l, m, e]));
        expect(logs[0]![0]).toBe('info');
        expect(await db.auditEvent.count({ where: { action: 'dataset.chain_verified', actorType: 'SYSTEM' } })).toBe(1);

        await tamper(`UPDATE "ApprovedTaskRecord" SET output = '{"header":{"title":"forged"}}' WHERE id = '${records[1]!.id}'`);
        const report = await verifyApprovedChain(db);
        expect(report.breaks).toEqual([{ seq: String(records[1]!.seq), id: records[1]!.id, reason: 'CONTENT_CHANGED' }]);
        await runChainVerification(db, (l, m, e) => logs.push([l, m, e]));
        expect(logs.at(-1)).toEqual(['error', 'dataset hash chain broken', expect.objectContaining({ alert: true })]);
        expect(await db.auditEvent.count({ where: { action: 'dataset.chain_broken' } })).toBe(1);
        expect((await get(admin, '/dataset/verification')).json()).toMatchObject({ ok: false, checked: 3 });

        await tamper(`UPDATE "ApprovedTaskRecord" SET prev_hash = repeat('0', 64) WHERE id = '${records[2]!.id}'`);
        expect((await verifyApprovedChain(db)).breaks.map((b) => b.reason)).toEqual(['CONTENT_CHANGED', 'LINK_BROKEN']);
      });

      it('lineage from any record: input provider, worker, reviewer, project and template version', async () => {
        const { projectId, a, records } = await acceptedRecords(1);
        const l = (await get(admin, `/dataset/records/${records[0]!.id}/lineage`)).json();
        const proj = await db.project.findUniqueOrThrow({ where: { id: projectId } });
        expect(l).toMatchObject({
          record: { id: records[0]!.id, contentVerified: true, prevHash: null },
          inputProvider: { kind: 'AUTHOR', candidateId: a.candidateId },
          worker: { candidateId: a.candidateId, smeUserId: a.smeUserId, authorTaskIndex: 1 },
          reviewer: { id: reviewerId, reworkCount: 0 },
          project: { id: projectId, name: proj.name },
          template: { id: proj.templateId, version: proj.templateVersion },
          diversity: { isOpenSlot: false },
        });
        expect(l.diversity.slot.brief).toBeTruthy();
      });

      it('annotation lineage names the client API that supplied the input', async () => {
        const projectId = await project('ANNOTATION');
        const r = await createUser(clientId, ['REVIEWER']);
        reviewer = await login(app, r.email);
        await post(pm, `/projects/${projectId}/reviewers`, { userId: r.id });
        const key = (await post(admin, '/api-clients', { name: 'Bank intake system', kind: 'CLIENT_API' })).json().key;
        await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/task-inputs`, headers: { authorization: `Bearer ${key}`, ...idem() }, payload: { items: [{ case_id: 'X-1', text: 'Customer note' }] } });
        const a = await expert();
        await assign(projectId, a);
        const t = await db.taskInstance.findFirstOrThrow({ where: { projectId, assignedToId: a.candidateId } });
        await save(a, t.id, { answer: 'Escalate for review' });
        expect((await submit(a, t.id)).statusCode).toBe(200);
        expect((await decide(t.id, { decision: 'ACCEPT' })).statusCode).toBe(200);
        const rec = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: t.id } });
        expect(rec).toMatchObject({ taskMode: 'ANNOTATION', inputSource: 'API', authorTaskIndex: null, input: { case_id: 'X-1', text: 'Customer note' }, output: { answer: 'Escalate for review' } });
        const l = (await get(admin, `/dataset/records/${rec.id}/lineage`)).json();
        expect(l.inputProvider).toMatchObject({ kind: 'API', itemCount: 1, apiClient: { name: 'Bank intake system', kind: 'CLIENT_API' } });
      });

      it('lists and exports read-only in chain order; RL Gym reads with its key, others cannot', async () => {
        const { records } = await acceptedRecords(3);
        const page = (await get(admin, '/dataset/records?limit=2')).json();
        expect(page.items.map((x: { id: string }) => x.id)).toEqual([records[0]!.id, records[1]!.id]);
        const rest = (await get(admin, `/dataset/records?after=${page.next}`)).json();
        expect(rest).toMatchObject({ items: [expect.objectContaining({ id: records[2]!.id })], next: null });
        const rl = (await post(admin, '/api-clients', { name: 'RL Gym', kind: 'RL_GYM' })).json().key;
        const exp = await app.inject({ method: 'GET', url: '/api/v1/dataset/export', headers: { authorization: `Bearer ${rl}` } });
        expect(exp.headers['content-type']).toMatch(/ndjson/);
        const lines = exp.body.trim().split('\n').map((x) => JSON.parse(x));
        expect(lines.map((x) => x.contentHash)).toEqual(records.map((r) => r.contentHash));
        const other = (await post(admin, '/api-clients', { name: 'Client', kind: 'CLIENT_API' })).json().key;
        expect((await app.inject({ method: 'GET', url: '/api/v1/dataset/records', headers: { authorization: `Bearer ${other}` } })).statusCode).toBe(403);
        expect((await get(pm, '/dataset/records')).statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/api/v1/dataset/records' })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url: `/api/v1/dataset/records/${records[0]!.id}/corrections`, headers: { authorization: `Bearer ${rl}`, ...idem() }, payload: { reason: 'x' } })).statusCode).toBe(401);
      });

      describe('M7 FLOW 4: RL Gym result review', () => {
        const SECRET = 'rl-gym-test-secret-0123456789abcdef-xyz';
        /** A stand-in for RL Gym: verifies the signature, records deliveries and can fail on demand. */
        function mockRlGym() {
          const received: { body: unknown; valid: boolean; eventId: string }[] = [];
          const state = { failNext: 0 };
          const server = createServer((req: IncomingMessage, res) => {
            let raw = '';
            req.on('data', (c) => (raw += c));
            req.on('end', () => {
              const sig = String(req.headers['x-praxis-signature'] ?? '');
              const [, t, v1] = sig.match(/^t=(\d+),v1=([a-f0-9]{64})$/) ?? [];
              const valid = !!t && createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex') === v1 && Math.abs(Date.now() / 1000 - Number(t)) < 300;
              if (state.failNext > 0) {
                state.failNext--;
                res.writeHead(503).end();
                return;
              }
              received.push({ body: JSON.parse(raw), valid, eventId: String(req.headers['x-praxis-event-id']) });
              res.writeHead(valid ? 200 : 401).end();
            });
          });
          return new Promise<{ url: string; received: typeof received; state: typeof state; close: () => Promise<void> }>((resolve) =>
            server.listen(0, '127.0.0.1', () => {
              const port = (server.address() as { port: number }).port;
              resolve({ url: `http://127.0.0.1:${port}/praxis/results`, received, state, close: () => new Promise((r) => server.close(() => r())) });
            }),
          );
        }
        async function rlKey() {
          return (await post(admin, '/api-clients', { name: 'RL Gym', kind: 'RL_GYM' })).json().key as string;
        }
        const request = (key: string, body: object) => app.inject({ method: 'POST', url: '/api/v1/integrations/rl-gym/review-requests', headers: { authorization: `Bearer ${key}`, ...idem() }, payload: body });
        const reqBody = (sourceIds: string[], extra: object = {}) => ({
          rl_run_id: 'run-42',
          rl_task_id: 'task-7',
          source_record_ids: sourceIds,
          eval_results: [
            { metric: 'correct_disposition', score: 0, passed: false },
            { metric: 'escalated', score: 1, passed: true },
          ],
          trajectories: { steps: [{ index: 0, action: 'registry_lookup', tool: 'registry_lookup' }, { index: 1, action: 'approve account' }] },
          priority: 5,
          due_by: '2026-10-10T12:00:00.000Z',
          ...extra,
        });

        it('a review request creates exactly one RL_REVIEW task; a duplicate creates none', async () => {
          const { projectId, records } = await acceptedRecords(1);
          const key = await rlKey();
          const first = await request(key, reqBody([records[0]!.id]));
          expect(first.statusCode, first.body).toBe(201);
          const again = await request(key, reqBody([records[0]!.id]));
          expect(again.json()).toMatchObject({ id: first.json().id, taskId: first.json().taskId, duplicate: true });
          expect(await db.rLReviewRequest.count()).toBe(1);
          expect(await db.taskInstance.count({ where: { taskType: 'RL_REVIEW' } })).toBe(1);
          expect((await request(key, reqBody(['00000000-0000-4000-8000-000000000000'], { rl_task_id: 'x' }))).json().error).toBe('UNKNOWN_SOURCE_RECORDS');
          const client = (await post(admin, '/api-clients', { name: 'Client', kind: 'CLIENT_API' })).json().key;
          expect((await request(client, reqBody([records[0]!.id], { rl_task_id: 'y' }))).statusCode).toBe(403);
          // Reviewer work never shows up as project work.
          const tasks = (await get(pm, `/projects/${projectId}/tasks`)).json().items;
          expect(tasks.every((t: { taskType: string }) => t.taskType !== 'RL_REVIEW')).toBe(true);
          expect((await get(pm, `/projects/${projectId}/dashboard`)).json().byStatus.CREATED).toBe(0);
        });

        it('a FAIL needs a comment; every disagreement needs a comment; the record links sources and reviewer', async () => {
          const { records } = await acceptedRecords(1);
          const key = await rlKey();
          const { taskId } = (await request(key, reqBody([records[0]!.id]))).json();
          const other = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
          expect((await get(other, '/review/rl')).json().items).toEqual([]);
          const queue = (await get(reviewer, '/review/rl')).json().items;
          expect(queue).toEqual([expect.objectContaining({ id: taskId, rlRunId: 'run-42', priority: 5, failedEvals: 1, status: 'CREATED' })]);
          const view = (await get(reviewer, `/review/rl/${taskId}`)).json();
          expect(view.sources[0]).toMatchObject({ id: records[0]!.id, contentHash: records[0]!.contentHash });
          expect(view.trajectory).toHaveLength(2);
          expect(view.reasonCodes.map((c: { code: string }) => c.code)).toContain('UNSAFE_ACTION');
          expect(view.rubric.text).toBeTruthy();

          const verdict = async (body: object) => {
            const cur = (await get(reviewer, `/review/rl/${taskId}`)).json();
            return post(reviewer, `/review/rl/${taskId}/verdict`, { expectedRevision: cur.revision, ...body });
          };
          expect((await verdict({ verdict: 'FAIL', metricVerdicts: [], comments: [] })).json().error).toBe('NOT_CLAIMED');
          expect((await post(reviewer, `/review/rl/${taskId}/claim`)).statusCode).toBe(200);
          expect((await post(other, `/review/rl/${taskId}/claim`)).statusCode).toBe(404);
          const agreeAll = [{ metric: 'correct_disposition', agree: true }, { metric: 'escalated', agree: true }];
          expect((await verdict({ verdict: 'FAIL', metricVerdicts: agreeAll })).json()).toMatchObject({ error: 'INVALID_VERDICT', message: 'A FAIL verdict needs at least one comment' });
          expect((await verdict({ verdict: 'PASS', metricVerdicts: [agreeAll[0], { metric: 'escalated', agree: false }] })).json().message).toMatch(/disagree/);
          const ok = await verdict({ verdict: 'FAIL', metricVerdicts: [agreeAll[0], { metric: 'escalated', agree: false, comment: 'It approved before escalating.' }], comments: [{ text: 'Approves the account itself at step 1.', trajectoryStep: 1, reasonCode: 'UNSAFE_ACTION' }] });
          expect(ok.statusCode, ok.body).toBe(200);
          const rec = await db.rLReviewRecord.findUniqueOrThrow({ where: { id: ok.json().recordId } });
          expect(rec).toMatchObject({ verdict: 'FAIL', rlRunId: 'run-42', rlTaskId: 'task-7', sourceRecordIds: [records[0]!.id], reviewerId, reasonCodes: ['UNSAFE_ACTION'], prevHash: null });
          expect(rec.reviewStartedAt).not.toBeNull();
          expect((await db.rLReviewRequest.findFirstOrThrow()).status).toBe('COMPLETED');
          expect((await db.taskInstance.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('SUBMITTED');
          await expect(db.rLReviewRecord.update({ where: { id: rec.id }, data: { verdict: 'PASS' } })).rejects.toThrow(/append-only|permission denied/);
          expect(await verifyRlChain(db)).toMatchObject({ checked: 1, breaks: [] });
          // Pull fallback for RL Gym.
          const pulled = (await app.inject({ method: 'GET', url: '/api/v1/integrations/rl-gym/results', headers: { authorization: `Bearer ${key}` } })).json();
          expect(pulled.items).toEqual([expect.objectContaining({ id: rec.id, verdict: 'FAIL', source_record_ids: [records[0]!.id], content_hash: rec.contentHash })]);
        });

        it('RL Gym receives each result by signed webhook within a minute, with retries on failure', async () => {
          const gym = await mockRlGym();
          const connection = redisConnection(TEST_REDIS_URL);
          const queueName = `rl-${randomUUID()}`;
          const queue = createDomainEventsQueue(connection, queueName);
          const worker = createDomainEventsWorker(db, defaultHandlers({ rlGym: new WebhookRlGymClient(gym.url, SECRET) }), connection, queueName);
          const stop = startOutboxPoller(db, queue, { intervalMs: 100 });
          try {
            const { records } = await acceptedRecords(1);
            const key = await rlKey();
            const { taskId } = (await request(key, reqBody([records[0]!.id]))).json();
            await post(reviewer, `/review/rl/${taskId}/claim`);
            const cur = (await get(reviewer, `/review/rl/${taskId}`)).json();
            gym.state.failNext = 1; // the first attempt fails; the queue retries
            const submittedAt = Date.now();
            const ok = await post(reviewer, `/review/rl/${taskId}/verdict`, { expectedRevision: cur.revision, verdict: 'PASS', metricVerdicts: [{ metric: 'correct_disposition', agree: false, comment: 'The disposition is right; the eval mislabels it.' }, { metric: 'escalated', agree: true }] });
            expect(ok.statusCode, ok.body).toBe(200);
            const recordId = ok.json().recordId;
            for (let i = 0; i < 600 && (await db.rLResultDelivery.findUniqueOrThrow({ where: { recordId } })).status !== 'DELIVERED'; i++) await new Promise((r) => setTimeout(r, 100));
            const delivery = await db.rLResultDelivery.findUniqueOrThrow({ where: { recordId } });
            expect(delivery).toMatchObject({ status: 'DELIVERED', attempts: 2, lastStatus: 200 });
            expect(delivery.deliveredAt!.getTime() - submittedAt).toBeLessThan(60_000);
            expect(gym.received).toHaveLength(1);
            expect(gym.received[0]).toMatchObject({ valid: true, body: { id: recordId, verdict: 'PASS', rl_run_id: 'run-42', rl_task_id: 'task-7', source_record_ids: [records[0]!.id] } });
            expect((await get(reviewer, `/review/rl/${taskId}`)).json().result.delivery).toMatchObject({ status: 'DELIVERED', attempts: 2 });
          } finally {
            await stop();
            await worker.close();
            await queue.obliterate({ force: true });
            await queue.close();
            await gym.close();
          }
        }, 90_000);

        it('without a webhook the result waits for the pull API', async () => {
          const { records } = await acceptedRecords(1);
          const key = await rlKey();
          const { taskId } = (await request(key, reqBody([records[0]!.id]))).json();
          await post(reviewer, `/review/rl/${taskId}/claim`);
          const cur = (await get(reviewer, `/review/rl/${taskId}`)).json();
          const { recordId } = (await post(reviewer, `/review/rl/${taskId}/verdict`, { expectedRevision: cur.revision, verdict: 'NEEDS_EXPERT', metricVerdicts: [{ metric: 'correct_disposition', agree: true }, { metric: 'escalated', agree: true }] })).json();
          const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'rl_review.completed' } });
          await processDomainEvent(db, defaultHandlers({ rlGym: null }), ev.id);
          expect((await db.rLResultDelivery.findUniqueOrThrow({ where: { recordId } })).status).toBe('PULL_ONLY');
        });

        it('Admins manage failure reason codes; reviewers can only read them', async () => {
          const created = await post(admin, '/failure-reason-codes', { code: 'HALLUCINATED_TOOL', label: 'Called a tool that does not exist' });
          expect(created.statusCode).toBe(201);
          expect((await app.inject({ method: 'PATCH', url: `/api/v1/failure-reason-codes/${created.json().id}`, headers: { cookie: admin, ...idem() }, payload: { active: false } })).json().active).toBe(false);
          const r = await createUser(clientId, ['REVIEWER']);
          const rc = await login(app, r.email);
          expect((await get(rc, '/failure-reason-codes')).json().items.map((c: { code: string }) => c.code)).toContain('WRONG_ANSWER');
          expect((await post(rc, '/failure-reason-codes', { code: 'X_Y', label: 'x' })).statusCode).toBe(403);
        });
      });

      it('a correction appends a superseding record; the original stays and the chain still verifies', async () => {
        const { records } = await acceptedRecords(2);
        const first = records[0]!;
        const res = await post(admin, `/dataset/records/${first.id}/corrections`, { reason: 'Title typo', output: { ...(first.output as object), header: { title: 'Corrected title' } } });
        expect(res.statusCode, res.body).toBe(201);
        const fixed = res.json();
        expect(fixed).toMatchObject({ supersedesId: first.id, prevHash: records[1]!.contentHash, taskInstanceId: first.taskInstanceId, candidateId: first.candidateId });
        expect((await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: first.id } })).contentHash).toBe(first.contentHash);
        expect((await post(admin, `/dataset/records/${first.id}/corrections`, { reason: 'again' })).json().error).toBe('ALREADY_SUPERSEDED');
        expect((await get(admin, `/dataset/records/${first.id}/lineage`)).json().corrections).toEqual({ supersedes: null, supersededBy: [fixed.id] });
        expect(await verifyApprovedChain(db)).toMatchObject({ checked: 3, breaks: [] });
      });
    });

    it('a project completes only when the distinct-task target and all required coverage are met; open-slot tags are confirmed', async () => {
      const { projectId, a, tasks } = await setup();
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('IN_PROGRESS');
      const open = tasks.find((x) => x.slot!.isOpen)!;
      for (const t of tasks.filter((x) => !x.slot!.isOpen)) {
        await submitted(a, t.id, `Case ${t.id.slice(0, 4)}`);
        expect((await decide(t.id, { decision: 'ACCEPT' })).statusCode).toBe(200);
      }
      let dash = (await get(pm, `/projects/${projectId}/dashboard`)).json();
      expect(dash).toMatchObject({ accepted: 3, target: 4, complete: false, authors: { distinct: 1, minimum: 1, cap: 4 }, coverage: { met: true } });
      expect(dash.coverage.cells).toEqual([expect.objectContaining({ tags: { customer_type: 'corporate', risk_level: 'high' }, state: 'FILLED' })]);
      expect(dash.coverage.edgeCases.map((e: { state: string }) => e.state)).toEqual(['FILLED', 'FILLED']);
      expect(dash.experts).toEqual([expect.objectContaining({ name: 'Ada Lovelace', accepted: 3, working: 1 })]);
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('IN_PROGRESS');

      // W01 shows a sample accepted task from a different cell.
      expect((await get(a.cookie, `/me/tasks/${open.id}/sample`)).json()).toMatchObject({ source: 'dataset', output: { header: { title: expect.stringMatching(/^Case/) } } });
      await submitted(a, open.id, 'Open case', { coverageTags: { customer_type: 'trust' }, edgeCase: 'Trustee is a minor' });
      expect((await decide(open.id, { decision: 'ACCEPT' })).json().error).toBe('CONFIRM_TAGS');
      expect((await decide(open.id, { decision: 'ACCEPT', confirmedCoverage: { tags: { customer_type: 'trust', risk_level: 'high' }, edgeCase: 'Trustee is a minor' } })).statusCode).toBe(200);
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('COMPLETED');
      expect(await db.outboxEvent.count({ where: { name: 'project.completed' } })).toBe(1);
      const rec = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: open.id } });
      expect(rec).toMatchObject({ isOpenSlot: true, coverageTags: { tags: { customer_type: 'trust', risk_level: 'high' }, edgeCase: 'Trustee is a minor' } });
      dash = (await get(pm, `/projects/${projectId}/dashboard`)).json();
      expect(dash).toMatchObject({ complete: true, discoveredEdgeCases: ['Trustee is a minor'] });
    });
  });
});
