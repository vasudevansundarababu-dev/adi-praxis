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
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Policy retrieval for authoring (docs/authoring/handover-v2/07-POLICY-INGESTION-RAG.md): the SME, the chatbot model and
 * the agent preview get only published, agent-visible rules in force today. Evaluator-only rules never leave the server.
 */
const SECRET = 'test-mock-secret';
type Who = { cookie: string; smeUserId: string; candidateId: string };

const POLICY = [
  'Synthetic Bank KYC Refresh Standard v3',
  'Analysts must refresh high-risk customer files every 12 months.',
  'Analysts shall record the source of every document they rely on.',
  'Expired identity documents are not permitted as primary evidence.',
].join('\n');


describe('policy retrieval for authoring', () => {
  let app: FastifyInstance;
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
    app = await buildApp({ logger: process.env.TEST_LOG ? { level: 'error' } : false, config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider() });
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

  it('returns only agent-visible rules in force: never an evaluator-only or expired rule', async () => {
    const p = await project();
    const doc = await post(pm, `/projects/${p.projectId}/policy/documents/text`, { title: 'KYC Refresh Standard', text: POLICY, format: 'txt', granularity: 'line' });
    expect(doc.statusCode, doc.body).toBe(201);
    const versionId = doc.json().version.id;
    const rule = (key: string, title: string, quote: string, visibility: string, effective: { from: string | null; to: string | null }) =>
      post(pm, `/projects/${p.projectId}/policy/rules`, {
        documentVersionId: versionId,
        ruleKey: key,
        body: { title, requirement: quote, requirementType: 'obligation', visibility, applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { ...effective, conditionText: effective.from || effective.to ? null : 'always' }, evidenceNeeds: [], verificationHint: null, uncertainty: [] },
        citations: [{ fieldPath: 'requirement', role: 'supports', quote }],
      });
    expect((await rule('REFRESH', 'Refresh period', 'Analysts must refresh high-risk customer files every 12 months.', 'agent_visible', { from: '2026-01-01', to: null })).statusCode).toBe(201);
    expect((await rule('SOURCES', 'Record sources', 'Analysts shall record the source of every document they rely on.', 'evaluator_only', { from: null, to: null })).statusCode).toBe(201);
    expect((await rule('EXPIRED', 'Old evidence rule', 'Expired identity documents are not permitted as primary evidence.', 'agent_visible', { from: '2019-01-01', to: '2020-12-31' })).statusCode).toBe(201);
    for (const r of (await get(pm, `/projects/${p.projectId}/policy/rules`)).json().items) {
      const rv = await post(pm, `/projects/${p.projectId}/policy/rule-versions/${r.versionId}/review`, { expectedContentHash: r.contentHash });
      expect(rv.statusCode, rv.body).toBe(200);
    }
    expect((await post(pm, `/projects/${p.projectId}/policy/rule-set`, { expectedLatestVersion: null })).statusCode).toBe(201);

    const smeRules = (await get(p.a.cookie, `/me/tasks/${p.taskA}/policy`)).json();
    expect(smeRules.rules.map((r: { rule_key: string }) => r.rule_key)).toEqual(['R-REFRESH']);
    const conversation = (await get(p.a.cookie, `/me/tasks/${p.taskA}/conversation`)).json();
    expect(conversation.policy.rules.map((r: { rule_key: string }) => r.rule_key)).toEqual(['R-REFRESH']);
    expect(JSON.stringify(conversation)).not.toContain('record the source of every document');
    const preview = (await get(p.a.cookie, `/me/tasks/${p.taskA}/agent-preview`)).json();
    expect(preview.policy.map((r: { rule_key: string }) => r.rule_key)).toEqual(['R-REFRESH']);
    // The PM still sees every published rule.
    expect((await get(pm, `/tasks/${p.taskA}/policy`)).json().rules.map((r: { rule_key: string }) => r.rule_key).sort()).toEqual(['R-EXPIRED', 'R-REFRESH', 'R-SOURCES']);
  });
});
