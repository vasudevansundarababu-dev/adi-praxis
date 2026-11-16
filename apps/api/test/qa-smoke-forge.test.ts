import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateRule } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MockSuitabilityEvaluator } from '../src/candidate/suitability';
import { FORGE_NEEDS, FORGE_SMOKE_PREFIX, FORGE_STEPS, optionsFromEnv, qaSmoke, STEPS, type QaSmokeOptions, type QaSmokeReport } from '../src/jobs/qa-smoke';
import type { Http } from '../src/jobs/qa-users';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { policyExtractionHandler, type Adapters } from '../src/policy/extraction/service';
import type { ExtractionAdapter, ProviderResult } from '../src/policy/extraction/types';
import { MockConversationAssistant } from '../src/tasks/conversation/assistant';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * The QA smoke job's MVP1 new-flow pass (MVP1 step 9) against the real API in-process, every provider mocked
 * (CLAUDE.md rule 5): mock Google sign-in (Offline mode), mock identity, models, extraction and hashing embeddings, and
 * the default export validator (the local pre-check: no RL Gym). The pass reads export eligibility only; nothing is
 * ever exported. The worker's outbox handlers are delivered whenever the job waits.
 */
const SECRET = 'test-mock-secret';
const PW = { admin: 'demo-admin-password-1', pm: 'demo-pm-password-123', reviewer: 'qa-seed-reviewer-pass-9' };

/** Behaves like LlamaExtract for the earlier journey's policy step. */
class ScriptedExtraction implements ExtractionAdapter {
  constructor(readonly provider: 'llamaextract' | 'google') {}
  availability() {
    return [];
  }
  async submit() {
    return { operationId: 'op-1' };
  }
  async getStatus() {
    return { status: 'succeeded' as const };
  }
  async getResult(): Promise<ProviderResult> {
    const rule = (ruleKey: string, quote: string): CandidateRule => ({
      ruleKey,
      title: ruleKey,
      requirement: quote,
      requirementType: 'obligation',
      visibility: 'agent_visible',
      applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
      prerequisites: [],
      precedence: [],
      exceptions: { kind: 'none', items: [] },
      effective: { from: null, to: null, conditionText: 'always' },
      evidenceNeeds: [],
      verificationHint: null,
      uncertainty: [],
      citations: [{ fieldPath: 'requirement', role: 'supports', quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: 0.9 }],
    });
    return { raw: { ok: true }, candidates: [rule('NW-4.1', 'The analyst must screen every owner against the sanctions list before the account is opened.')], partial: false, usage: { pages: 1, credits: 10, inputTokens: null, outputTokens: null, actualUsd: 0.01 } };
  }
  async cleanup() {
    return 'deleted' as const;
  }
}

describe('qa-smoke new-flow pass against the real API in-process (all providers mocked)', () => {
  let app: FastifyInstance;
  let clientId: string;
  let admin: string;
  const config = testConfig({ FIELD_SUGGESTIONS_ENABLED: 'true', POLICY_BUDGET_LLAMA_USD: '20', POLICY_BUDGET_GOOGLE_USD: '20', ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() });
  const storage = new MemoryStorage();
  const email = new MemoryEmailSender();
  const evaluator = new MockSuitabilityEvaluator();
  const adapters = { llamaextract: new ScriptedExtraction('llamaextract'), google: new ScriptedExtraction('google') } as unknown as Adapters;
  const worker = defaultHandlers({ evaluator, email, config, conversationAssistant: new MockConversationAssistant() }).register(policyExtractionHandler({ storage, adapters, sleep: async () => undefined }));
  const deliver = async () => {
    for (const ev of await db.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, worker, ev.id);
  };
  /** Every request the job sends, to prove what it never calls. */
  const sent: { method: string; path: string }[] = [];

  const http: Http = async ({ method, path, body, cookie, root, form }) => {
    sent.push({ method, path });
    let payload: string | Buffer | undefined = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { cookie: cookie ?? '', ...idem() };
    if (form) {
      const boundary = '----qasmoke';
      const parts = Object.entries(form.fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.file.name}"\r\nContent-Type: ${form.file.type}\r\n\r\n${form.file.content}\r\n--${boundary}--\r\n`);
      payload = Buffer.from(parts.join(''), 'utf8');
      headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    } else if (payload !== undefined) headers['content-type'] = 'application/json';
    const r = await app.inject({ method: method as 'GET', url: `${root ? '' : '/api/v1'}${path}`, headers, payload });
    let parsed: unknown = null;
    try {
      parsed = r.body ? JSON.parse(r.body) : null;
    } catch {
      parsed = r.body;
    }
    return { status: r.statusCode, body: parsed, cookies: r.cookies.map((c) => `${c.name}=${c.value}`), retryAfterSeconds: null };
  };
  const adminPut = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/admin/forge-settings', headers: { cookie: admin, ...idem() }, payload });

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google: new MockGoogleVerifier(SECRET), identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, evaluator, email, embeddings: new HashingEmbeddingProvider(), policyAdapters: adapters });
  });
  beforeEach(async () => {
    await resetDb();
    sent.length = 0;
    // As QA stands: the demo Admin and PM, a seeded Reviewer, KYC v2 (account-opening form), the new flow on, Offline.
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: PW.admin, TASKFLOW_PATH: '/none' });
    clientId = client.id;
    await db.user.create({ data: { clientId, email: 'pm@praxis.demo', name: 'Pat Morgan', roles: ['PM'], passwordHash: await hashPassword(PW.pm) } });
    await db.user.create({ data: { clientId, email: 'reviewer01@praxis.test', name: 'SYNTHETIC QA Reviewer 01', roles: ['REVIEWER'], passwordHash: await hashPassword(PW.reviewer) } });
    admin = await login(app, 'admin@praxis.demo', PW.admin);
    const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: admin, ...idem() }, payload });
    const domainId = (await post('/domains', { name: 'Banking' })).json().id;
    const v1 = (await post('/templates', { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'Assemble identity evidence and recommend a disposition.', verificationCriteria: 'Policy adherence.', humanGate: 'A person approves.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'], coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['teen_joint_checking'] }], cells: [{ tags: { product: 'teen_joint_checking' }, quota: 1, required: true }] }, edgeCaseCatalog: [] })).json();
    expect((await post(`/templates/${v1.id}/publish`)).statusCode).toBe(200);
    const v2 = (await post(`/templates/${v1.id}/versions`)).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/templates/${v2.id}`, headers: { cookie: admin, ...idem() }, payload: { profileId: 'kyc-account-opening' } })).statusCode).toBe(200);
    expect((await post(`/templates/${v2.id}/publish`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/policy/extraction-profiles/llama-agentic-v1', headers: { cookie: admin, ...idem() }, payload: { enabled: true } })).statusCode).toBe(200);
    expect((await adminPut({ newFlow: true, candidateSignIn: 'OFFLINE' })).statusCode).toBe(200);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const env = { DEMO_ADMIN_PASSWORD: PW.admin, DEMO_PM_PASSWORD: PW.pm, QA_SEED_REVIEWER_PASSWORD: PW.reviewer };
  const run = (at = new Date('2026-11-15T10:00:00Z'), extraEnv: Record<string, string> = {}, over: Partial<QaSmokeOptions> = {}) =>
    qaSmoke({ ...optionsFromEnv({ ...env, ...extraEnv }, 'demo', http, at), now: () => at, pollMs: 1, sleep: deliver, ...over }, () => undefined);
  const forge = (r: QaSmokeReport) => Object.fromEntries(r.forge.steps.map((s) => [s.name, s]));
  const statuses = (r: QaSmokeReport) => Object.fromEntries(r.forge.steps.map((s) => [s.name, s.status]));
  const allPass = Object.fromEntries(FORGE_STEPS.map((n) => [n, 'PASS']));

  /** QA's newest KYC version: the corrected Keystone proposal, one task per state (five). */
  async function addReusableKyc() {
    const key = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } })).json().key;
    const packet = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8'));
    const proposed = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${key}`, ...idem() }, payload: packet });
    expect(proposed.statusCode, proposed.body).toBe(201);
    const templateId = proposed.json().data.template_version_id as string;
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${templateId}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    return templateId;
  }

  it('the new-flow steps depend only on earlier ones and come after the earlier journey', () => {
    for (const [i, n] of FORGE_STEPS.entries()) for (const d of FORGE_NEEDS[n]) expect(FORGE_STEPS.indexOf(d)).toBeLessThan(i);
    expect(FORGE_NEEDS['forge-cleanup']).toEqual([]);
    expect(() => optionsFromEnv({ QA_SMOKE_NEW_FLOW: 'sometimes' }, 'demo', http)).toThrow(/QA_SMOKE_NEW_FLOW must be one of auto, on, off/);
    expect(() => optionsFromEnv({ QA_SMOKE_FORGE_ROUTE: 'PM' }, 'demo', http)).toThrow(/QA_SMOKE_FORGE_ROUTE/);
    const o = optionsFromEnv({}, 'demo', http, new Date('2026-11-15T10:00:05Z'));
    expect(o).toMatchObject({ newFlow: 'auto', forgeRoute: 'SME_EXPERT_PM', forgeSmeEmail: 'smoke-forge-sme-20261115100005@praxis.test', forgeReviewerEmail: 'smoke-forge-rev-20261115100005@praxis.test' });
  });

  it('Reviewer route: project → one row per slot → Sourcing → assign → Offline sign-in → terms → Home → author → Reviewer → PM → export open', async () => {
    const r = await run();
    const failed = [...r.steps, ...r.forge.steps].filter((s) => s.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    // The earlier journey is untouched and still passes with the new flow on.
    expect(r.steps.map((s) => s.name)).toEqual([...STEPS]);
    expect(r.forge).toMatchObject({ mode: 'auto', ran: true, route: 'SME_EXPERT_PM' });
    expect(statuses(r)).toEqual(allPass);

    // Its own synthetic project, separate from the earlier journey's.
    const p = await db.project.findUniqueOrThrow({ where: { id: r.forge.ids.projectId } });
    expect(p.name).toBe(`${FORGE_SMOKE_PREFIX}2026-11-15 10:00:00`);
    expect(p.id).not.toBe(r.ids.projectId);
    expect(p.reviewRoute).toBe('SME_EXPERT_PM');
    // One task row per slot.
    const slots = await db.coverageSlot.findMany({ where: { projectId: p.id } });
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id } });
    expect(tasks).toHaveLength(slots.length);
    expect(new Set(tasks.map((t) => t.slotId)).size).toBe(slots.length);
    expect(forge(r)['forge-tasks']!.details).toMatchObject({ tasks: slots.length, export: 'Export opens when the task is approved (0 of 1 now).' });
    // Sourced, tagged synthetic people; the SME authored, the Reviewer passed, the PM approved.
    const people = await db.sourcedPerson.findMany({ where: { projectId: p.id }, orderBy: { role: 'asc' } });
    expect(people.map((x) => [x.role, x.firstName, x.agency, x.emailNorm]).sort()).toEqual([
      ['REVIEWER', 'SYNTHETIC', 'SYNTHETIC QA smoke', 'smoke-forge-rev-20261115100000@praxis.test'],
      ['SME', 'SYNTHETIC', 'SYNTHETIC QA smoke', 'smoke-forge-sme-20261115100000@praxis.test'],
    ].sort());
    const pm = await db.user.findUniqueOrThrow({ where: { email: 'pm@praxis.demo' } });
    const reviewer = people.find((x) => x.role === 'REVIEWER')!;
    for (const t of tasks) {
      expect(t.status).toBe('ACCEPTED');
      expect(t.reviewerSmeUserId).toBe(reviewer.smeUserId);
      const reviews = await db.taskReview.findMany({ where: { taskInstanceId: t.id }, orderBy: { createdAt: 'asc' } });
      expect(reviews.map((x) => [x.stage, x.decision, x.reviewerId])).toEqual([
        ['EXPERT_REVIEW', 'PASS', reviewer.smeUserId],
        ['PM_APPROVAL', 'ACCEPT', pm.id],
      ]);
    }
    const records = await db.approvedTaskRecord.findMany({ where: { projectId: p.id } });
    expect(records.map((x) => x.taskInstanceId).sort()).toEqual(tasks.map((t) => t.id).sort());
    // Terms were accepted through Before you start, and audited.
    expect(await db.auditEvent.count({ where: { clientId, action: 'candidate.terms_accepted' } })).toBe(2);
    // Export eligibility only: open at the end, never exported, never validated by RL Gym.
    expect(forge(r)['forge-export']).toMatchObject({ status: 'PASS', details: { canExport: true, exported: false, validator: 'praxis-precheck' } });
    expect(await db.projectValidationRun.count({ where: { projectId: p.id } })).toBe(0);
    expect(sent.some((x) => x.method === 'POST' && /\/exports$/.test(x.path))).toBe(false);
    // The smoke test never changes the client's settings, and signs its candidates out at the end.
    expect(sent.filter((x) => x.path === '/admin/forge-settings').map((x) => x.method)).toEqual(['GET']);
    const smeUserIds = people.map((x) => x.smeUserId!);
    expect(await db.session.count({ where: { smeUserId: { in: smeUserIds }, revokedAt: null } })).toBe(0);
    expect(forge(r)['forge-cleanup']).toMatchObject({ status: 'PASS', details: { signedOut: 2 } });
    const final = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(['COMPLETED', 'CANCELLED']).toContain(final.status);
    for (const pw of Object.values(PW)) expect(JSON.stringify(r)).not.toContain(pw);
  }, 120_000);

  it('per-state template, Author → PM/Admin: five tasks; export opens only when all five are approved', async () => {
    const templateId = await addReusableKyc();
    const r = await run(new Date('2026-11-15T11:00:00Z'), { QA_SMOKE_FORGE_ROUTE: 'SME_PM' });
    const failed = r.forge.steps.filter((s) => s.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.forge).toMatchObject({ ran: true, route: 'SME_PM' });
    expect(r.forge.ids.templateId).toBe(templateId);
    // The template makes one task per state: a one-task probe found five and was cancelled; the real project holds five.
    const probe = await db.project.findUniqueOrThrow({ where: { id: r.forge.ids.probeProjectId } });
    expect(probe.status).toBe('CANCELLED');
    const p = await db.project.findUniqueOrThrow({ where: { id: r.forge.ids.projectId } });
    expect(p).toMatchObject({ reviewRoute: 'SME_PM', maxPerExpert: 5 });
    const tasks = await db.taskInstance.findMany({ where: { projectId: p.id }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
    expect(tasks).toHaveLength(5);
    expect(tasks.every((t) => t.status === 'ACCEPTED' && t.reviewerSmeUserId === null)).toBe(true);
    // The Tasks list carried each task's selector from its slot.
    const selectors = forge(r)['forge-tasks']!.details!.selectors as string[];
    tasks.forEach((t, i) => expect(selectors[i]).toContain((t.input as { slot: { case: { value: string } } }).slot.case.value));
    expect(forge(r)['forge-review']!.details).toMatchObject({ approved: 5, reviewerPassed: 0, records: 5 });
    // The PM's approvals: each one checked that export was still closed ("n of 5 now") before it, and open after the last.
    const exportReads = sent.filter((x) => x.method === 'GET' && x.path === `/projects/${p.id}/export`);
    expect(exportReads.length).toBe(1 + 5 + 1);
    expect(forge(r)['forge-export']).toMatchObject({ status: 'PASS', details: { canExport: true, tasks: 5 } });
    expect(await db.sourcedPerson.count({ where: { projectId: p.id, role: 'REVIEWER' } })).toBe(0);
  }, 180_000);

  it('is safe to re-run: a second run makes its own project and people and leaves the first run’s alone', async () => {
    const first = await run(new Date('2026-11-15T12:00:00Z'), {}, { newFlow: 'on' });
    expect(first.ok).toBe(true);
    const before = await db.project.findUniqueOrThrow({ where: { id: first.forge.ids.projectId } });
    const firstPeople = await db.sourcedPerson.findMany({ where: { projectId: before.id } });
    const second = await run(new Date('2026-11-15T12:05:30Z'), {}, { newFlow: 'on' });
    const failed = second.forge.steps.filter((s) => s.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(second.forge.ids.projectId).not.toBe(first.forge.ids.projectId);
    expect(await db.project.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ status: before.status, name: before.name });
    expect(await db.sourcedPerson.findMany({ where: { projectId: before.id } })).toEqual(firstPeople);
    const forgeProjects = await db.project.findMany({ where: { name: { startsWith: FORGE_SMOKE_PREFIX } } });
    expect(forgeProjects).toHaveLength(2);
    expect(new Set((await db.sourcedPerson.findMany({ where: { projectId: { in: forgeProjects.map((x) => x.id) } } })).map((x) => x.emailNorm)).size).toBe(4);
  }, 180_000);

  it('auto with the new flow off: the pass is SKIPPED with the reason and creates nothing; on: it FAILS', async () => {
    expect((await adminPut({ newFlow: false })).statusCode).toBe(200);
    const auto = await run(new Date('2026-11-15T13:00:00Z'));
    expect(auto.ok).toBe(true);
    expect(auto.steps.every((s) => s.status === 'PASS')).toBe(true);
    expect(auto.forge.ran).toBe(false);
    expect(forge(auto)['forge-settings']).toMatchObject({ status: 'SKIPPED', reason: 'The new flow is off for this client' });
    expect(forge(auto)['forge-project']).toMatchObject({ status: 'SKIPPED', reason: 'needs forge-settings' });
    expect(forge(auto)['forge-cleanup']).toMatchObject({ status: 'SKIPPED', reason: 'no new-flow project was created' });
    expect(await db.project.count({ where: { name: { startsWith: FORGE_SMOKE_PREFIX } } })).toBe(0);

    const on = await run(new Date('2026-11-15T13:10:00Z'), { QA_SMOKE_NEW_FLOW: 'on' });
    expect(on.ok).toBe(false);
    expect(forge(on)['forge-settings']).toMatchObject({ status: 'FAIL', error: expect.stringContaining('QA_SMOKE_NEW_FLOW=on needs it on') });
    // Nothing of the new flow was attempted. (This second run's earlier-journey task repeats the first run's golden
    // case, so its review is flagged as a likely duplicate: earlier-journey behaviour, unchanged by this pass.)
    expect(statuses(on)).toMatchObject({ 'forge-project': 'SKIPPED', 'forge-cleanup': 'SKIPPED' });

    const off = await run(new Date('2026-11-15T13:20:00Z'), { QA_SMOKE_NEW_FLOW: 'off' });
    expect(forge(off)['forge-settings']).toMatchObject({ status: 'SKIPPED', reason: 'QA_SMOKE_NEW_FLOW=off' });
    expect(sent.filter((x) => x.path === '/admin/forge-settings')).toHaveLength(2);
  }, 180_000);

  it('Online sign-in mode fails the pass up front with the reason (QA must use Offline); nothing is created', async () => {
    expect((await adminPut({ candidateSignIn: 'ONLINE' })).statusCode).toBe(200);
    const r = await run(new Date('2026-11-15T14:00:00Z'), { QA_SMOKE_NEW_FLOW: 'on' }, {});
    expect(forge(r)['forge-settings']).toMatchObject({ status: 'FAIL', error: expect.stringContaining('QA must use Offline') });
    expect(statuses(r)).toMatchObject({ 'forge-project': 'SKIPPED', 'forge-cleanup': 'SKIPPED' });
    expect(await db.project.count({ where: { name: { startsWith: FORGE_SMOKE_PREFIX } } })).toBe(0);
  }, 180_000);

  it('unpublished terms fail sign-in with "publish Terms first"; cleanup still cancels the project', async () => {
    await db.termsDocument.deleteMany({ where: { clientId, key: 'data_use' } });
    const r = await run(new Date('2026-11-15T15:00:00Z'), {}, { newFlow: 'on' });
    expect(forge(r)['forge-sign-in']).toMatchObject({ status: 'FAIL', error: expect.stringContaining('must be published before anyone signs in (Admin → Terms)') });
    expect(statuses(r)).toMatchObject({ 'forge-authoring': 'SKIPPED', 'forge-review': 'SKIPPED', 'forge-export': 'SKIPPED', 'forge-cleanup': 'PASS' });
    expect(await db.project.findUniqueOrThrow({ where: { id: r.forge.ids.projectId } })).toMatchObject({ status: 'CANCELLED' });
    expect(r.ok).toBe(false);
  }, 180_000);
});
