import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';

/**
 * Fixture for the rule page's "To fix" navigation (owner, 27 Nov 2026), e2e database only. In its own client: a
 * policy-library project (its template binds the environment's facts, as KYC Judgment does) with a synthetic policy,
 * the fact catalog, one rule with several problems (no condition, missing library details, no in-force date) and one
 * complete rule. Built through the real API in-process. Prints { projectId, flaggedRuleId, readyRuleId, pm }.
 */
const url = process.env.E2E_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_e2e';
if (!/e2e/.test(new URL(url).pathname)) throw new Error('e2e-policy-library only runs against an e2e database');
const db = createDb(url);
const PASSWORD = 'e2e-policy-library-password';
const tag = randomUUID().slice(0, 8);
const { client } = await seed(db, { SEED_CLIENT_NAME: `E2E policy library ${tag}`, SEED_ADMIN_EMAIL: `admin.policy-library.${tag}@e2e.local`, SEED_ADMIN_PASSWORD: PASSWORD, TASKFLOW_PATH: '/none' });
const pmEmail = `pm.policy-library.${tag}@e2e.local`;
const pm = await db.user.create({ data: { clientId: client.id, email: pmEmail, name: 'Priya Menon', roles: ['PM'], passwordHash: await hashPassword(PASSWORD) } });

// The same object store as the e2e API (playwright.config.ts), so the rule's source text is there when an edit is saved.
const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url, REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6389/7', LOGIN_RATE_LIMIT_PER_MINUTE: '1000', VERTEX_PROJECT_ID: '', EVIDENCE_BUCKET: 'praxis-evidence', GCS_EMULATOR_HOST: 'http://localhost:4443', GCS_PROJECT_ID: 'praxis-local' });
const app = await buildApp({ config, db, pingRedis: async () => true, resolveClientId: async () => client.id, email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: pmEmail, password: PASSWORD } });
if (login.statusCode !== 200) throw new Error(`login → ${login.statusCode}: ${login.body}`);
const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
async function call(method: 'POST' | 'PUT', path: string, payload: object) {
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { cookie, 'idempotency-key': randomUUID() }, payload });
  if (![200, 201].includes(res.statusCode)) throw new Error(`${method} ${path} → ${res.statusCode}: ${res.body}`);
  return res.json();
}

const BINDS = { execution: { policy_bindings: { fact_catalog: 'kyc-judgment-openenv.facts@1', facts: [{ fact: 'process', type: 'enum', allowed_values: ['account_opening'] }] } } };
const domain = await db.domain.create({ data: { clientId: client.id, name: `Banking ${tag}` } });
const template = await db.template.create({ data: { clientId: client.id, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC judgment (e2e)', anvilSpec: BINDS } });
const projectId = (await db.project.create({ data: { clientId: client.id, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC judgment rules (e2e)' } })).id;

const POLICY = ['Synthetic bank policy', 'Each applicant must give a taxpayer ID.', 'When an account is opened.', 'Keep records for five years.'].join('\n');
const line = (n: number) => POLICY.split('\n')[n]!;
const doc = await call('POST', `/projects/${projectId}/policy/documents/text`, { title: 'Synthetic bank policy (e2e)', text: POLICY, format: 'txt', granularity: 'line' });
const documentVersionId = doc.version.id as string;
const catalog = JSON.parse(readFileSync(new URL('../test/fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8'));
await call('PUT', `/projects/${projectId}/policy/fact-catalog`, catalog);

const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: false, actors: ['The bank'], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: line(2) }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };
const flagged = await call('POST', `/projects/${projectId}/policy/rules`, {
  documentVersionId,
  ruleKey: 'R-E2E-TAXPAYER-ID',
  body: { ...BASE, title: 'Taxpayer ID at account opening', requirement: line(1), effective: { from: null, to: null, conditionText: null }, library: { kind: 'policy', subject: 'party' } },
  citations: [{ fieldPath: 'requirement', role: 'supports', quote: line(1) }],
});
const ready = await call('POST', `/projects/${projectId}/policy/rules`, {
  documentVersionId,
  ruleKey: 'R-E2E-RECORDS',
  body: { ...BASE, title: 'Keep records', requirement: line(3), effective: { from: '2026-01-01', to: null, conditionText: null }, condition: { fact: 'process', op: 'eq', value: 'account_opening' }, library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'case', scope: { process: 'account_opening' } } },
  citations: [
    { fieldPath: 'requirement', role: 'supports', quote: line(3) },
    { fieldPath: 'applicability.conditionText', role: 'qualifies', quote: line(2) },
  ],
});
// An open question from the AI suggestions on the flagged rule (the answer box journey).
const fv = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: flagged.ruleId }, orderBy: { version: 'desc' } });
await db.policyRuleSuggestion.create({ data: { clientId: client.id, projectId, ruleId: flagged.ruleId, ruleVersionId: fv.id, contentHash: fv.contentHash, source: 'enrichment', model: 'e2e', promptVersion: 'enrichment/1', content: { question: 'Should the rule cover remote openings?' }, problems: [], createdById: pm.id } });
await app.close();
await db.$disconnect();
console.log(JSON.stringify({ projectId, flaggedRuleId: flagged.ruleId, readyRuleId: ready.ruleId, pm: { email: pmEmail, password: PASSWORD } }));
