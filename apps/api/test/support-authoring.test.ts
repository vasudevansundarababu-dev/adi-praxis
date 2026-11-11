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
import { TEMPLATE_PROFILES } from '@praxis/shared';
import { AUTHORING_GUIDE, templateGuide, templatesFor } from '../src/support/authoring-help';
import { GeminiSupportAssistant, MockSupportAssistant, rankParagraphs, SUPPORT_SYSTEM, supportModel, SupportUnavailableError, type SupportContext } from '../src/support/assistant';
import { SME_HELP, STAFF_HELP } from '../src/support/help-pack';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Help bot for authoring v2.1 (owner, 12 Nov 2026): authors, Experts, PMs and Admins get the same explanations of how
 * authoring, review, approval and policy work and why; each template's guide is generated from its profile.
 */
const SECRET = 'test-mock-secret';
type Who = { cookie: string; smeUserId: string; candidateId: string };



describe('help bot: authoring v2.1 knowledge for authors, reviewers and approvers', () => {
  let app: FastifyInstance;
  const bot = new MockSupportAssistant();
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;

  const post = (cookie: string, url: string, payload: object = {}, headers: Record<string, string> = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...headers }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  async function deliver(name: string) {
    const handlers = defaultHandlers({ email, config, storage });
    for (const ev of await db.outboxEvent.findMany({ where: { name }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, handlers, ev.id).catch(() => undefined);
  }

  beforeAll(async () => {
    app = await buildApp({ logger: process.env.TEST_LOG ? { level: 'error' } : false, config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider(), support: bot });
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

  async function sme(): Promise<Who> {
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED', contactEmail: mail } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    return { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id };
  }

  /** A project with an assigned SME (two of them), an assigned Validator (Expert) and an unassigned one. */
  async function project() {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName: 'KYC onboarding and refresh',
        primaryWork: 'Assemble identity evidence and recommend a disposition.',
        verificationCriteria: 'Document checks, completeness, policy adherence.',
        humanGate: 'Approval, rejection and high-risk classification remain human decisions.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId: t.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: false }] })).json();
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const r = await createUser(clientId, ['REVIEWER']);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: r.id })).statusCode).toBe(200);
    const outsider = await createUser(clientId, ['REVIEWER']);
    const a = await sme();
    const b = await sme();
    expect((await post(pm, `/projects/${p.id}/assignments`, { candidateIds: [a.candidateId, b.candidateId] })).statusCode).toBe(200);
    await deliver('candidate.assigned');
    const taskOf = async (w: Who) => (await db.taskInstance.findFirstOrThrow({ where: { projectId: p.id, assignedToId: w.candidateId } })).id;
    return { projectId: p.id as string, a, b, taskA: await taskOf(a), taskB: await taskOf(b), expert: await login(app, r.email), outsider: await login(app, outsider.email) };
  }

  const ask = (cookie: string, url: string, question: string, path: string) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload: { question, screen: { path, title: 'Task', headings: [], messages: [], fields: [] } } });

  it('the authoring guide explains every owner decision; staff and SMEs both get it', () => {
    for (const phrase of [
      'the PM may reject too',
      'The same person may be both Expert and PM',
      'Any change to the rubric or to the reference answer',
      'is always material',
      'Failing a critical criterion fails the whole task',
      'Evaluator-only rules (used to grade)',
      'PROPOSING A POLICY DOCUMENT',
      'cannot be accepted: it is returned for a readable, synthetic copy',
      'POLICY SOURCES ON THE REVIEW PAGE',
      'Clustering F1 (Praxis)',
      'It never writes case facts, answers, rationales or rubric conditions',
    ])
      expect(AUTHORING_GUIDE, phrase).toContain(phrase);
    expect(STAFF_HELP).toContain(AUTHORING_GUIDE);
    expect(SME_HELP).toContain(AUTHORING_GUIDE);
    expect(SME_HELP).toContain('You earn once per accepted task');
  });

  it('every template has a generated guide with its fields, graded outputs, workflow and owner decisions', () => {
    for (const p of TEMPLATE_PROFILES) {
      const g = templateGuide(p);
      expect(g, p.profileId).toContain(`TEMPLATE GUIDE: ${p.catalogWorkflowName}`);
      expect(g).toContain('S1 ');
    }
    const by = (id: string) => templateGuide(TEMPLATE_PROFILES.find((p) => p.profileId === id)!);
    expect(by('q4-global-paid-search-query-clustering')).toContain('q01_intent');
    expect(by('q4-global-paid-search-query-clustering')).toContain('at most 20');
    expect(by('customer-risk-rating')).toContain('"Senior compliance approver decides" (Senior compliance approver)');
    expect(by('customer-risk-rating')).toMatch(/Factor rating \(required\) \[private\]? ?— values: low, medium, high|Factor rating \(required\) — values: low, medium, high/);
    expect(by('adverse-media-review')).toContain('Compliance reviewer decides');
    expect(by('enhanced-due-diligence')).toContain('risk_rating = low / medium / high / very_high');
    expect(by('fraud-risk-and-compliance-handoffs')).toContain('authorised_push_payment_scam');
    expect(by('fraud-risk-and-compliance-handoffs')).not.toContain('Business hand-off');
    expect(by('compliance-monitoring')).toContain('Give each exception its own severity');
  });

  it('finds the template from the question or the record on screen', () => {
    expect(templatesFor('What does EDD need in S6?', null).map((p) => p.profileId)).toEqual(['enhanced-due-diligence']);
    expect(templatesFor('Why is my Q4 task limited to 20 queries?', null).map((p) => p.profileId)).toEqual(['q4-global-paid-search-query-clustering']);
    expect(templatesFor('What should I write here?', { template: { workflow: 'Customer risk rating' } }).map((p) => p.profileId)).toEqual(['customer-risk-rating']);
    expect(templatesFor('Fraud–risk/compliance handoffs rules?', null).map((p) => p.profileId)).toContain('fraud-risk-and-compliance-handoffs');
    expect(templatesFor('How do I reset my password?', null)).toEqual([]);
  });

  it('the SME bot never writes task content; the offline bot ranks the right explanation first', () => {
    expect(SUPPORT_SYSTEM('SME')).toContain('Never write task content for the author');
    expect(SUPPORT_SYSTEM('STAFF')).not.toContain('Never write task content for the author');
    const top = (help: string, q: string) => rankParagraphs(help, q, 3).map((p) => p.split(/[.(]/)[0]!.trim());
    expect(top(SME_HELP, 'Why did my task come back after the Expert changed the rubric?')).toContain('EXPERT EDITS AND "MATERIAL" CHANGES');
    expect(top(STAFF_HELP, 'Can the PM reject a task?')).toContain('REVIEW ROUTES');
    expect(top(SME_HELP, 'How do I propose a policy document?')[0]).toBe('PROPOSING A POLICY DOCUMENT');
  });

  it('runs on Gemini when QA does, and fails closed on a bad answer', async () => {
    expect(supportModel({ SUPPORT_MODEL: '', AUTHORING_MODEL: 'gemini:gemini-3.8-flash' })).toMatchObject({ vendor: 'gemini', model: 'gemini-3.8-flash' });
    expect(supportModel({ SUPPORT_MODEL: '', AUTHORING_MODEL: 'claude-sonnet-5-5' })).toMatchObject({ vendor: 'claude', model: 'claude-sonnet-5' });
    expect(supportModel({ SUPPORT_MODEL: 'claude-haiku-5-5', AUTHORING_MODEL: 'gemini:x' })).toMatchObject({ vendor: 'claude', model: 'claude-haiku-5-5' });
    const prompts: { system: string; user: string }[] = [];
    let reply = JSON.stringify({ answer: 'Rubric changes are always material.' });
    const drafter = { complete: async (p: { system: string; user: string }) => (prompts.push(p), { text: reply, inputTokens: 10, outputTokens: 5 }) };
    const g = new GeminiSupportAssistant('gemini-3.8-flash', { projectId: 'p', location: 'global' }, drafter as never);
    const ctx: SupportContext = { audience: 'SME', roles: ['SME'], screen: { path: '/tasks/x', title: 'Task', headings: [], fields: [], messages: [] }, record: null, help: SME_HELP, templates: ['TEMPLATE GUIDE: Customer risk rating'] };
    expect((await g.answer(ctx, [], 'Why?')).answer).toBe('Rubric changes are always material.');
    expect(prompts[0]!.system).toContain('Never write task content for the author');
    expect(prompts[0]!.system).toContain('EXPERT EDITS AND');
    expect(prompts[0]!.user).toContain('<template>');
    reply = 'not json';
    await expect(g.answer(ctx, [], 'Why?')).rejects.toBeInstanceOf(SupportUnavailableError);
  });

  it('an SME asks about their own task: the bot gets the task and its template guide, never someone else\'s', async () => {
    const p = await project();
    bot.calls.length = 0;
    const res = await ask(p.a.cookie, '/me/support/ask', 'What happens when the Expert changes my rubric?', `/tasks/${p.taskA}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ usedRecord: 'your task', usedTemplates: ['KYC onboarding and refresh'] });
    expect(res.json().helpVersion).toMatch(/^help\/2/);
    expect(res.json().answer).toContain('always material');
    expect(bot.calls[0]!.ctx).toMatchObject({ audience: 'SME', roles: ['SME'] });
    expect(bot.calls[0]!.ctx.templates![0]).toContain('TEMPLATE GUIDE: KYC onboarding and refresh');
    // Another SME's task is not given to the bot.
    const other = await ask(p.a.cookie, '/me/support/ask', 'What is this?', `/tasks/${p.taskB}`);
    expect(other.json().usedRecord).toBeNull();
    // Staff use their own route; the SME route needs a candidate session.
    expect((await ask(pm, '/me/support/ask', 'What is this?', '/home')).statusCode).toBe(401);
    expect((await ask(p.expert, '/support/ask', 'Can the PM reject a task?', '/review/tasks')).json().answer).toContain('the PM may reject too');
  });
});
