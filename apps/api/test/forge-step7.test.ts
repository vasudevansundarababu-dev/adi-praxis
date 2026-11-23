import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleProfileOutput, TASK_HELP_REFUSAL, WAVE1_PROFILES } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemorySignedStorage, MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { MockSupportAssistant, SupportUnavailableError } from '../src/support/assistant';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
type Route = 'SME_PM' | 'SME_EXPERT_PM';
type Sme = { smeUserId: string; cookie: string };
const VIDEO = 'https://videos.example.test/kyb-tutorial.mp4';

/** Every string the author wrote that is long enough to be content (not a pick-list value). */
function authoredStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string' && v.length >= 25) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => authoredStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => authoredStrings(x, out));
  return out;
}

describe('MVP1 step 7: Tutorial and Help scoped to the task', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const bot = new MockSupportAssistant();
  let clientId: string;
  let admin: string;
  let pm: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), tutorialStorage: new MemorySignedStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider(), support: bot });
  });
  beforeEach(async () => {
    await resetDb();
    bot.calls.length = 0;
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

  async function template() {
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
    return tpl.id as string;
  }

  async function project(templateId: string, route: Route = 'SME_PM') {
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: route, templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    return p.id as string;
  }

  const fixedTask = async (projectId: string) => (await db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } })).find((t) => !t.slot?.isOpen && t.status === 'CREATED')!;
  const meTask = async (a: Sme, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();

  /** An assigned author (and on the Reviewer route, an assigned Reviewer), optionally with the task submitted. */
  async function setup(o: { route?: Route; submit?: boolean } = {}) {
    const templateId = await template();
    const pid = await project(templateId, o.route ?? 'SME_EXPERT_PM');
    const authorMail = `author-${randomUUID().slice(0, 6)}@gmail.test`;
    const author = await signIn(authorMail, `mock-${authorMail}`, 'Ada Author');
    const s = await source(pid, 'SME', { email: authorMail, first: 'Ada', last: 'Author' });
    const t = await fixedTask(pid);
    expect((await assign(pid, s.id, t.id)).statusCode).toBe(200);
    let reviewer: Sme | null = null;
    if ((o.route ?? 'SME_EXPERT_PM') === 'SME_EXPERT_PM') {
      const rMail = `rev-${randomUUID().slice(0, 6)}@gmail.test`;
      reviewer = await signIn(rMail, `mock-${rMail}`, 'Rita Reviewer');
      const r = await source(pid, 'REVIEWER', { email: rMail, first: 'Rita', last: 'Reviewer' });
      expect((await assign(pid, r.id, t.id)).statusCode).toBe(200);
    }
    const output = sampleProfileOutput(PROFILE);
    const saved = await put(author.cookie, `/me/tasks/${t.id}`, { output, activeSecondsDelta: 10, expectedRevision: (await meTask(author, t.id)).revision });
    expect(saved.statusCode, saved.body).toBe(200);
    if (o.submit !== false) {
      const sub = await post(author.cookie, `/me/tasks/${t.id}/submit`, { expectedRevision: (await meTask(author, t.id)).revision, syntheticDeclaration: true, flagExplanations: {} });
      expect(sub.statusCode, sub.body).toBe(200);
    }
    return { templateId, pid, id: t.id, author, reviewer: reviewer!, output, brief: (t.input as { slot?: { brief?: string } }).slot?.brief ?? '' };
  }

  // ── Tutorial ──

  describe('PUT /templates/:id/tutorial', () => {
    it('sets and clears the tutorial for every version, audited, without a new template version', async () => {
      const id = await template();
      const v2 = await post(admin, `/templates/${id}/versions`);
      expect(v2.statusCode, v2.body).toBe(201);
      const set = await put(admin, `/templates/${id}/tutorial`, { videoUrl: VIDEO, chapters: [{ title: 'Submitting', at: 400 }, { title: 'S1 Brief', at: 0 }] });
      expect(set.statusCode, set.body).toBe(200);
      expect(set.json()).toMatchObject({ id, version: 1, tutorial: { videoUrl: VIDEO, chapters: [{ title: 'S1 Brief', at: 0 }, { title: 'Submitting', at: 400 }] } });
      // The detail GET shows it on both versions; no version was added.
      expect((await get(pm, `/templates/${id}`)).json().tutorial).toEqual({ videoUrl: VIDEO, chapters: [{ title: 'S1 Brief', at: 0 }, { title: 'Submitting', at: 400 }] });
      expect((await get(admin, `/templates/${v2.json().id}`)).json().tutorial.videoUrl).toBe(VIDEO);
      expect((await get(admin, `/templates/${id}/versions`)).json().items).toHaveLength(2);
      const [audit] = await db.auditEvent.findMany({ where: { clientId, action: 'template.tutorial_set' } });
      expect(audit).toMatchObject({ entityId: id, actorType: 'USER', before: { tutorial: null }, after: { tutorial: { videoUrl: VIDEO }, versions: 2 } });

      const cleared = await put(admin, `/templates/${id}/tutorial`, { videoUrl: null });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(cleared.json().tutorial).toBeNull();
      expect((await db.template.findUniqueOrThrow({ where: { id } })).tutorialChapters).toBeNull();
      expect(await db.auditEvent.count({ where: { clientId, action: 'template.tutorial_set' } })).toBe(2);
    });

    it('a new version keeps the tutorial; a link (not a video file) is accepted', async () => {
      const id = await template();
      expect((await put(admin, `/templates/${id}/tutorial`, { videoUrl: 'https://www.youtube.com/watch?v=abc' })).statusCode).toBe(200);
      const v2 = await post(admin, `/templates/${id}/versions`);
      expect(v2.json().tutorial).toEqual({ videoUrl: 'https://www.youtube.com/watch?v=abc', chapters: [] });
    });

    it('is Admin only and validates the body', async () => {
      const id = await template();
      expect((await put(pm, `/templates/${id}/tutorial`, { videoUrl: VIDEO })).statusCode).toBe(403);
      const bad = [
        { videoUrl: 'http://videos.example.test/a.mp4' },
        { videoUrl: 'not a url' },
        { videoUrl: `https://videos.example.test/${'a'.repeat(500)}.mp4` },
        { videoUrl: VIDEO, chapters: Array.from({ length: 21 }, (_, i) => ({ title: `C${i}`, at: i })) },
        { videoUrl: VIDEO, chapters: [{ title: 'x'.repeat(101), at: 0 }] },
        { videoUrl: VIDEO, chapters: [{ title: 'Start', at: -1 }] },
        { videoUrl: VIDEO, chapters: [{ title: '', at: 0 }] },
        {},
      ];
      for (const body of bad) expect((await put(admin, `/templates/${id}/tutorial`, body)).statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect((await put(admin, `/templates/${randomUUID()}/tutorial`, { videoUrl: VIDEO })).statusCode).toBe(404);
      expect(await db.auditEvent.count({ where: { clientId, action: 'template.tutorial_set' } })).toBe(0);
    });

    it('the candidate task and review payloads carry the tutorial (null when none)', async () => {
      const s = await setup();
      expect((await meTask(s.author, s.id)).tutorial).toBeNull();
      expect((await get(s.reviewer.cookie, `/me/reviews/${s.id}`)).json().tutorial).toBeNull();
      expect((await put(admin, `/templates/${s.templateId}/tutorial`, { videoUrl: VIDEO, chapters: [{ title: 'S1 Brief', at: 30 }] })).statusCode).toBe(200);
      const want = { videoUrl: VIDEO, chapters: [{ title: 'S1 Brief', at: 30 }] };
      expect((await meTask(s.author, s.id)).tutorial).toEqual(want);
      const r = await get(s.reviewer.cookie, `/me/reviews/${s.id}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().tutorial).toEqual(want);
    });

    it('D2: an approved generated video reaches the author and the Reviewer as a short-lived signed address with captions', async () => {
      const s = await setup();
      // What approval writes (tested end to end in tutorial-video.test.ts): a private storage address and chapters.
      const key = `tutorials/${randomUUID()}/${randomUUID()}/tutorial.mp4`;
      const t = await db.template.findUniqueOrThrow({ where: { id: s.templateId } });
      await db.template.updateMany({ where: { lineageId: t.lineageId }, data: { tutorialVideoUrl: `storage:${key}`, tutorialChapters: [{ title: 'Overview', at: 0 }, { title: 'S1 Brief', at: 21 }] } });
      const want = { videoUrl: `https://storage.test/${key}?action=read&expires=43200`, captionsUrl: `https://storage.test/${key.replace('tutorial.mp4', 'captions.vtt')}?action=read&expires=43200`, chapters: [{ title: 'Overview', at: 0 }, { title: 'S1 Brief', at: 21 }] };
      expect((await meTask(s.author, s.id)).tutorial).toEqual(want);
      expect((await get(s.reviewer.cookie, `/me/reviews/${s.id}`)).json().tutorial).toEqual(want);
    });
  });

  // ── Help ──

  describe('POST /me/tasks/:id/help and /me/reviews/:taskId/help', () => {
    it('the author asks about their own task: scoped prompt with the refusal and never-write rules, minimal context', async () => {
      const s = await setup({ submit: false });
      const res = await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?', history: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi' }] });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ answer: expect.any(String), scoped: true });
      const c = bot.calls.at(-1)!;
      expect(c.ctx.scope).toBe('TASK_AUTHOR');
      expect(c.history).toHaveLength(2);
      expect(c.system).toContain(TASK_HELP_REFUSAL);
      expect(c.system).toContain('Never write task content for the author');
      expect(c.system).toContain("Never write the author's content");
      expect(c.system).toMatch(/Never use the names Praxis, Anvil or ADI-Labs/);
      // Task context as data: the template, the slot brief, the section titles with what is filled.
      expect(c.context).toContain('<record source="this task">');
      expect(c.context).toContain(PROFILE.catalogWorkflowName);
      if (s.brief) expect(c.context).toContain(s.brief.slice(0, 60));
      for (const sec of PROFILE.sections) expect(c.context).toContain(sec.title);
      expect(c.context).toContain('"filled":true');
      expect(c.ctx.templates?.[0]).toContain(`TEMPLATE GUIDE: ${PROFILE.catalogWorkflowName}`);
      // The author's answers are not sent.
      const authored = authoredStrings(s.output).filter((x) => !PROFILE.sections.some((sec) => sec.title === x) && !(s.brief && s.brief.includes(x)));
      expect(authored.length).toBeGreaterThan(3);
      for (const x of authored) expect(`${c.system}\n${c.context}`).not.toContain(x);
    });

    it('anything outside the task gets the refusal sentence (local assistant)', async () => {
      const s = await setup({ submit: false });
      const res = await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: "What's the weather in Chicago?" });
      expect(res.statusCode).toBe(200);
      expect(res.json().answer).toBe(TASK_HELP_REFUSAL);
    });

    it('D-020: an expired Google sign-in gives a plain message (never the raw provider text); Benchmark questions are answered from the help pack', async () => {
      const s = await setup({ submit: false });
      const original = bot.answer.bind(bot);
      bot.answer = async () => {
        throw new SupportUnavailableError('{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)","error_subtype":"invalid_rapt"}');
      };
      try {
        const res = await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?' });
        expect(res.statusCode).toBe(503);
        expect(res.json().message).toBe('Help can’t reach the AI service: the Google sign-in for AI on this computer has expired. Ask an admin to sign in again. You can keep writing the task; the form’s own guidance still applies.');
        expect(res.body).not.toContain('invalid_rapt');
      } finally {
        bot.answer = original;
      }
      const ok = await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What is Focus on edge case and Save benchmark fields?' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().answer).toMatch(/FOCUS ON EDGE CASE|SAVE BENCHMARK FIELDS/);
      expect(bot.calls.at(-1)!.system).toContain('Benchmark panel');
    });

    it("someone else's task is not found; a missing or long question is refused", async () => {
      const s = await setup({ submit: false });
      const otherMail = `other-${randomUUID().slice(0, 6)}@gmail.test`;
      const other = await signIn(otherMail, `mock-${otherMail}`, 'Olly Other');
      expect((await post(other.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?' })).statusCode).toBe(404);
      expect((await post(other.cookie, `/me/reviews/${s.id}/help`, { question: 'What goes in S1?' })).statusCode).toBe(404);
      expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: '' })).statusCode).toBe(400);
      expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'x'.repeat(1001) })).statusCode).toBe(400);
      expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'Hi', history: Array.from({ length: 11 }, () => ({ role: 'user', text: 'a' })) })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.id}/help`, payload: { question: 'Hi' } })).statusCode).toBe(401);
      expect((await post(pm, `/me/tasks/${s.id}/help`, { question: 'Hi' })).statusCode).toBe(401);
      expect(bot.calls).toHaveLength(0);
    });

    it('the assigned Reviewer asks with the review framing and sees their own comments; the author then sees them too', async () => {
      const s = await setup();
      const res = await post(s.reviewer.cookie, `/me/reviews/${s.id}/help`, { question: 'What should I check in S1?' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().scoped).toBe(true);
      const c = bot.calls.at(-1)!;
      expect(c.ctx.scope).toBe('TASK_REVIEWER');
      expect(c.system).toContain(TASK_HELP_REFUSAL);
      expect(c.system).toContain('Never decide for the reviewer');
      for (const sec of PROFILE.sections) expect(c.context).toContain(sec.title);
      for (const x of authoredStrings(s.output).filter((x) => !(s.brief && s.brief.includes(x)))) expect(c.context).not.toContain(x);

      // Send back with a comment: it is in the Reviewer's and then the author's Help context.
      const v = (await get(s.reviewer.cookie, `/me/reviews/${s.id}`)).json();
      const rw = await post(s.reviewer.cookie, `/me/reviews/${s.id}/decision`, { decision: 'REWORK', expectedVersion: v.expectedVersion, expectedRevision: v.expectedRevision, comments: [{ section: 'S5', text: 'Add the ownership verification step before the decision.' }] });
      expect(rw.statusCode, rw.body).toBe(200);
      await post(s.reviewer.cookie, `/me/reviews/${s.id}/help`, { question: 'What did I ask for?' });
      expect(bot.calls.at(-1)!.context).toContain('Add the ownership verification step');
      await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What does the comment on S5 ask?' });
      expect(bot.calls.at(-1)!.ctx.scope).toBe('TASK_AUTHOR');
      expect(bot.calls.at(-1)!.context).toContain('Add the ownership verification step');
    });

    it('a Reviewer not assigned to the task cannot ask; the author cannot use the review route for their own task', async () => {
      const s = await setup();
      const s2 = await setup();
      expect((await post(s2.reviewer.cookie, `/me/reviews/${s.id}/help`, { question: 'What should I check?' })).statusCode).toBe(404);
      expect((await post(s.reviewer.cookie, `/me/tasks/${s.id}/help`, { question: 'What should I check?' })).statusCode).toBe(404);
      expect((await post(s.author.cookie, `/me/reviews/${s.id}/help`, { question: 'What should I check?' })).statusCode).toBe(404);
      expect(bot.calls).toHaveLength(0);
    });

    it('with the new flow off: the author keeps Help on their own task; the review route follows GET /me/reviews (409)', async () => {
      const s = await setup();
      await setFlow(false);
      expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?' })).statusCode).toBe(200);
      const r = await post(s.reviewer.cookie, `/me/reviews/${s.id}/help`, { question: 'What goes in S1?' });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('NEW_FLOW_OFF');
    });

    it('is rate limited per session like the Support Bot (20 a minute)', async () => {
      const s = await setup({ submit: false });
      for (let i = 0; i < 20; i++) expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: `What goes in S${(i % 8) + 1}?` })).statusCode).toBe(200);
      expect((await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?' })).statusCode).toBe(429);
    });

    it('the assistant being down answers 503 SUPPORT_UNAVAILABLE', async () => {
      const s = await setup({ submit: false });
      const { SupportUnavailableError } = await import('../src/support/assistant');
      const orig = bot.answer.bind(bot);
      bot.answer = async () => {
        throw new SupportUnavailableError('down');
      };
      try {
        const r = await post(s.author.cookie, `/me/tasks/${s.id}/help`, { question: 'What goes in S1?' });
        expect(r.statusCode).toBe(503);
        expect(r.json().error).toBe('SUPPORT_UNAVAILABLE');
      } finally {
        bot.answer = orig;
      }
    });
  });
});
