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
import { optionsFromEnv, qaSmoke, STEPS } from '../src/jobs/qa-smoke';
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
 * The QA smoke job against the real API in-process: real routes, states, checks, append-only dataset and audit, with
 * every provider mocked (CLAUDE.md rule 5): mock Google sign-in and identity, mock suitability and authoring models,
 * a scripted extraction provider and hashing embeddings. The worker's outbox handlers are delivered whenever the job
 * waits. This proves the job's requests match the routes as they are on main.
 */
const SECRET = 'test-mock-secret';
const PW = { admin: 'demo-admin-password-1', pm: 'demo-pm-password-123', reviewer: 'qa-seed-reviewer-pass-9' };

/** Behaves like LlamaExtract: accepts the job, succeeds, returns rules quoting the uploaded synthetic policy. */
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
  async getResult(_op: string, input: { text: string }): Promise<ProviderResult> {
    const rule = (ruleKey: string, title: string, quote: string): CandidateRule => ({
      ruleKey,
      title,
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
    expect(input.text).toContain('Northwind Example Bank');
    return {
      raw: { ok: true },
      candidates: [
        rule('NW-2.1', 'Verify every owner', 'The analyst must verify the identity of every account owner before the account is opened.'),
        rule('NW-4.1', 'Screen every owner', 'The analyst must screen every owner against the sanctions list before the account is opened.'),
      ],
      partial: false,
      usage: { pages: 1, credits: 10, inputTokens: null, outputTokens: null, actualUsd: 0.01 },
    };
  }
  async cleanup() {
    return 'deleted' as const;
  }
}

describe('qa-smoke against the real API in-process (all providers mocked)', () => {
  let app: FastifyInstance;
  let clientId: string;
  const config = testConfig({ FIELD_SUGGESTIONS_ENABLED: 'true', POLICY_BUDGET_LLAMA_USD: '20', POLICY_BUDGET_GOOGLE_USD: '20', ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() });
  const storage = new MemoryStorage();
  const email = new MemoryEmailSender();
  const evaluator = new MockSuitabilityEvaluator();
  const adapters = { llamaextract: new ScriptedExtraction('llamaextract'), google: new ScriptedExtraction('google') } as unknown as Adapters;
  const worker = defaultHandlers({ evaluator, email, config, conversationAssistant: new MockConversationAssistant() }).register(policyExtractionHandler({ storage, adapters, sleep: async () => undefined }));

  /** The deployed worker's part: deliver every outbox event (handlers are idempotent per event). */
  const deliver = async () => {
    for (const ev of await db.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, worker, ev.id);
  };

  const http: Http = async ({ method, path, body, cookie, root, form }) => {
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

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google: new MockGoogleVerifier(SECRET), identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, evaluator, email, embeddings: new HashingEmbeddingProvider(), policyAdapters: adapters });
  });
  beforeEach(async () => {
    await resetDb();
    // As QA stands after demo-setup and qa-users: the demo Admin and PM, a seeded Reviewer, KYC v2 (account-opening form).
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: PW.admin, TASKFLOW_PATH: '/none' });
    clientId = client.id;
    await db.user.create({ data: { clientId, email: 'pm@praxis.demo', name: 'Pat Morgan', roles: ['PM'], passwordHash: await hashPassword(PW.pm) } });
    await db.user.create({ data: { clientId, email: 'reviewer01@praxis.test', name: 'SYNTHETIC QA Reviewer 01', roles: ['REVIEWER'], passwordHash: await hashPassword(PW.reviewer) } });
    const admin = await login(app, 'admin@praxis.demo', PW.admin);
    const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: admin, ...idem() }, payload });
    const domainId = (await post('/domains', { name: 'Banking' })).json().id;
    const v1 = (await post('/templates', { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'Assemble identity evidence and recommend a disposition.', verificationCriteria: 'Policy adherence.', humanGate: 'A person approves.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'], coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['teen_joint_checking'] }], cells: [{ tags: { product: 'teen_joint_checking' }, quota: 1, required: true }] }, edgeCaseCatalog: [] })).json();
    expect((await post(`/templates/${v1.id}/publish`)).statusCode).toBe(200);
    const v2 = (await post(`/templates/${v1.id}/versions`)).json();
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/templates/${v2.id}`, headers: { cookie: admin, ...idem() }, payload: { profileId: 'kyc-account-opening' } })).statusCode).toBe(200);
    expect((await post(`/templates/${v2.id}/publish`)).statusCode).toBe(200);
    // QA's Admin enabled the live LlamaExtract profile (profiles start disabled).
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/policy/extraction-profiles/llama-agentic-v1', headers: { cookie: admin, ...idem() }, payload: { enabled: true } })).statusCode).toBe(200);
  });
  const env = { DEMO_ADMIN_PASSWORD: PW.admin, DEMO_PM_PASSWORD: PW.pm, QA_SEED_REVIEWER_PASSWORD: PW.reviewer };
  const run = (at = new Date('2026-11-14T10:00:00Z')) => qaSmoke({ ...optionsFromEnv(env, 'demo', http, at), now: () => at, pollMs: 1, sleep: deliver }, () => undefined);

  /** QA's newest KYC version: the corrected Keystone proposal (test/fixtures/kyc-reusable), one task per state. */
  async function addReusableKyc() {
    const admin = await login(app, 'admin@praxis.demo', PW.admin);
    const key = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } })).json().key;
    const packet = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8'));
    const proposed = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${key}`, ...idem() }, payload: packet });
    expect(proposed.statusCode, proposed.body).toBe(201);
    const templateId = proposed.json().data.template_version_id as string;
    const pub = await app.inject({ method: 'POST', url: `/api/v1/templates/${templateId}/publish`, headers: { cookie: admin, ...idem() } });
    expect(pub.statusCode, pub.body).toBe(200);

    return templateId;
  }

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('walks the whole journey through the real routes: every step PASSES and the records are real', async () => {
    const logs: string[] = [];
    const at = new Date('2026-11-14T10:00:00Z');
    const r = await qaSmoke({ ...optionsFromEnv(env, 'demo', http, at), now: () => at, pollMs: 1, sleep: deliver }, (level, message, extra = {}) => logs.push(JSON.stringify({ level, message, ...extra })));
    const failed = r.steps.filter((s) => s.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual([...STEPS]);

    // Real state behind the report.
    const project = await db.project.findUniqueOrThrow({ where: { id: r.ids.projectId } });
    // The one required task is approved, so the project completed by itself (a COMPLETED project cannot be cancelled).
    expect(project).toMatchObject({ name: 'SYNTHETIC QA smoke — 2026-11-14 10:00', status: 'COMPLETED' });
    expect(r.steps.find((s) => s.name === 'cleanup')).toMatchObject({ status: 'PASS', details: { status: 'COMPLETED', cancelled: false } });
    const record = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: r.ids.recordId } });
    expect(record.taskInstanceId).toBe(r.ids.taskId);
    const reviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer01@praxis.test' } });
    expect(record.reviewerId).toBe(reviewer.id);
    const decision = await db.selectionDecision.findFirstOrThrow({ where: { enrollmentId: r.ids.enrollmentId } });
    expect(decision).toMatchObject({ outcome: 'SELECTED', reviewerId: reviewer.id });
    const output = record.output as { sections: { S4: { policies: { ruleVersion: string }[] } } };
    expect(output.sections.S4.policies.map((p) => p.ruleVersion)).toEqual([r.ids.ruleVersionId]);
    expect(await db.taskDraftRun.count({ where: { taskInstanceId: r.ids.taskId, section: 'CHAT', status: 'SUCCEEDED' } })).toBe(1);
    expect(r.steps.find((s) => s.name === 'export')).toMatchObject({ status: 'PASS', details: { validator: 'praxis-precheck' } });
    expect(r.totalPaidCalls).toBe(4);
    for (const pw of Object.values(PW)) expect(JSON.stringify(r) + logs.join('')).not.toContain(pw);
  }, 120_000);

  it('on the per-state reusable KYC template (Anvil proposal, case selector, no worked example): builds a valid case from the template and passes end to end', async () => {
    const templateId = await addReusableKyc();
    const r = await run();
    expect(r.ids.templateId).toBe(templateId);
    const steps = Object.fromEntries(r.steps.map((s) => [s.name, s]));
    expect(steps.project).toMatchObject({ status: 'PASS', details: { profileId: 'golden-kyc-reusable-v1' } });
    // The task is a state slot and the saved case names that state.
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: r.ids.taskId } });
    const slotCase = (task.input as { slot: { case: { field: string; source: string; value: string } } }).slot.case;
    expect(slotCase.field).toBe('governing_state');
    const [section, field] = slotCase.source.split('.') as [string, string];
    expect((task.output as { sections: Record<string, Record<string, unknown>> }).sections[section]![field]).toBe(slotCase.value);
    // The case is built from the template itself: allowed enum values, the template's own criterion IDs and
    // evaluators (learned from the workbench pre-check), and the slot's state. It passes every submit check, the named
    // Reviewer accepts it, and the dataset chain verifies.
    const failed = r.steps.filter((s) => s.status !== 'PASS');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(steps.authoring).toMatchObject({ details: { criteriaFrom: 'pre-check', criteria: 20 } });
    const out = task.output as { sections: { S3: { environment: string; tools: string[] }; S7: { criteria: { id: string; evaluatorKind: string; evaluatorVersion: string; weight: number; critical?: boolean }[] } } };
    expect(out.sections.S3.environment).toBe('golden_kyc_openenv');
    const packet = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8'));
    const evaluators = packet.execution.evaluators as { criterion_id: string; capability: { id: string; version: string } }[];
    expect(out.sections.S7.criteria.map((c) => [c.id, c.evaluatorKind, c.evaluatorVersion])).toEqual(evaluators.map((e) => [e.criterion_id, e.capability.id, e.capability.version]));
    expect(out.sections.S7.criteria.reduce((n, c) => n + Math.round(c.weight * 100), 0)).toBe(10_000);
    const record = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: r.ids.recordId } });
    expect(record.taskInstanceId).toBe(r.ids.taskId);
    expect(record.reviewerId).toBe((await db.user.findUniqueOrThrow({ where: { email: 'reviewer01@praxis.test' } })).id);
    expect(await db.taskDraftRun.count({ where: { taskInstanceId: r.ids.taskId, section: 'CHAT', status: 'SUCCEEDED' } })).toBe(1);
    expect(steps.cleanup).toMatchObject({ status: 'PASS' });
  }, 120_000);

  it('QA_SMOKE_TEMPLATE_ID cannot pin an older version: PMs are offered only the newest; the report says so', async () => {
    await addReusableKyc();
    const older = await db.template.findFirstOrThrow({ where: { profileId: 'kyc-account-opening' } });
    const at = new Date('2026-11-14T11:00:00Z');
    const r = await qaSmoke({ ...optionsFromEnv({ ...env, QA_SMOKE_TEMPLATE_ID: older.id }, 'demo', http, at), now: () => at, pollMs: 1, sleep: deliver }, () => undefined);
    expect(r.steps.find((s) => s.name === 'project')).toMatchObject({ status: 'FAIL', error: expect.stringContaining('PMs see only the newest published version') });
    expect(await db.project.count()).toBe(0);
  }, 120_000);
});
