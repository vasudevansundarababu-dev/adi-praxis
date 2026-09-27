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

  async function template(taskMode: 'AUTHORING' | 'ANNOTATION') {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName: `KYC ${taskMode} ${randomUUID().slice(0, 4)}`,
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
        edgeCaseCatalog: [
          { name: 'PEP link', quota: 1, required: true },
          { name: 'Nominee director', quota: 1, required: true },
        ],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  /** Two working days, so a 12-task authoring project needs two workers (room to assign two experts). */
  async function project(taskMode: 'AUTHORING' | 'ANNOTATION', extra: object = {}) {
    const templateId = await template(taskMode);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const volume = taskMode === 'AUTHORING' ? { distinctTarget: 12, maxPerExpert: 4 } : { taskCount: 3 };
    const p = (await post(pm, '/projects', { templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode, ...volume, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }], ...extra })).json();
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
});
