import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CandidateRule, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { POLICY_AI_ACTIONS } from '../src/policy/ai-cap';
import { loadVersionText } from '../src/policy/documents';
import { checkedEnrichment, ENRICHMENT_ACTIONS, enrichProject, normaliseJurisdiction, type RuleEnricher } from '../src/policy/enrich';
import { createRuleFromCandidate } from '../src/policy/rules';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A2 (owner, 25 Nov 2026: AI Extract is supervised; the PM reviews and corrects every rule): an
 * enrichment pass over the project's existing drafts suggests C1's library parts (kind, issuer, ISO jurisdiction,
 * subject, scope) and a condition over the catalog. It never re-extracts and never touches an approved rule. A draft no
 * person has edited is pre-filled; a person's draft is only offered the suggestion. The model is mocked.
 */
const C2 = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8')) as FactCatalog;
const POLICY = ['Synthetic bank policy', 'Each applicant must give a taxpayer ID.', 'California applicants must show a California-compliant ID.', 'Report cash deposits over 10,000 dollars.'].join('\n');
const line = (n: number) => POLICY.split('\n')[n]!;
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: false, actors: ['The bank'], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };

let app: FastifyInstance;
let storage: MemoryStorage;
let clientId: string;
let pmId: string;
let pmCookie: string;
let projectId: string;
let documentId: string;
let docVersionId: string;
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

/** A scripted model: per rule key, exactly what it answers. */
const scripted = (answers: Record<string, Record<string, unknown>>): RuleEnricher & { calls: number } => {
  const e = { modelVersion: 'scripted-enricher', calls: 0, enrich: async ({ rules }: { rules: { ruleKey: string }[] }) => { e.calls++; return rules.flatMap((r) => (answers[r.ruleKey] ? [{ ruleKey: r.ruleKey, ...answers[r.ruleKey] }] : [])); } };
  return e;
};
const GOOD = {
  'R-TIN': { library: { kind: 'policy', issuer: 'bank', subject: 'party', scope: { process: 'account_opening', customer_types: ['individual'] } }, jurisdictions: ['US-Federal'], condition: { fact: 'process', op: 'eq', value: 'account_opening' } },
  'R-CA-ID': { library: { kind: 'regulation', issuer: 'state', subject: 'party', scope: { process: 'account_opening' } }, jurisdictions: ['CA'], condition: { all: [{ fact: 'process', op: 'eq', value: 'account_opening' }, { fact: 'governing_state', op: 'eq', value: 'CA' }] } },
  'R-CTR': { library: { kind: 'regulation', issuer: 'federal', subject: 'case', scope: { process: 'currency_transaction_reporting' } }, jurisdictions: ['US'], condition: { fact: 'process', op: 'eq', value: 'currency_transaction_reporting' } },
};

beforeAll(async () => {
  storage = new MemoryStorage();
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  pmId = pm.id;
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC judgment' } });
  projectId = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC judgment' } })).id;
  pmCookie = await login(app, pm.email);
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic bank policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  docVersionId = d.json().version.id;
  documentId = (await db.policyDocument.findFirstOrThrow({ where: { projectId } })).id;
  expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2)).statusCode).toBe(201);
});

/** A draft as extraction leaves it: no person has edited it. */
async function extracted(key: string, n: number, extra: Record<string, unknown> = {}) {
  const dv = await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: docVersionId } });
  const doc = await loadVersionText(storage, dv);
  const candidate = CandidateRule.parse({ ...BASE, title: key, requirement: line(n), ...extra, ruleKey: key, citations: [{ fieldPath: 'requirement', role: 'supports', quote: line(n) }] });
  const r = await db.$transaction((tx) => createRuleFromCandidate(tx, { clientId, projectId, documentVersion: dv, doc: { ...doc, format: dv.format }, candidate, origin: 'extraction:llamaextract', editedById: 'extraction:job-1' }));
  return { ruleId: r.rule.id, contentHash: r.version.contentHash };
}
async function byPerson(key: string, n: number) {
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: docVersionId, ruleKey: key, body: { ...BASE, title: key, requirement: line(n) }, citations: [{ fieldPath: 'requirement', role: 'supports', quote: line(n) }] });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; contentHash: string };
}
const run = (enricher: RuleEnricher, over: { dailyCap?: number; documentId?: string; runId?: string } = {}) =>
  enrichProject(db, { storage, enricher, dailyCap: over.dailyCap ?? 100, capActions: POLICY_AI_ACTIONS }, { clientId, projectId, runId: over.runId ?? randomUUID(), requestedById: pmId, requestedRoles: ['PM'], ...(over.documentId ? { documentId: over.documentId } : {}) });
const latest = async (ruleId: string) => db.policyRuleVersion.findFirstOrThrow({ where: { ruleId }, orderBy: { version: 'desc' } });

describe('A2: jurisdiction codes (ISO, deterministic)', () => {
  it('maps every value in today’s extraction, and never guesses', () => {
    expect(['US-Federal', 'Federal', 'US', 'United States', 'CA', 'US-CA', 'California', 'NY', 'TX', 'FL', 'IL'].map(normaliseJurisdiction)).toEqual(['US', 'US', 'US', 'US', 'US-CA', 'US-CA', 'US-CA', 'US-NY', 'US-TX', 'US-FL', 'US-IL']);
    expect([null, '', 'Canada', 'EU', 'XX'].map((j) => normaliseJurisdiction(j as string))).toEqual([null, null, null, null, null]);
  });
});

describe('A2: server checks on the model’s answer', () => {
  it('keeps only valid parts: vocabulary, ISO jurisdiction (deterministic first), a condition that passes the catalog; the rest becomes a question', () => {
    const rules = [{ ruleKey: 'R-A', title: 't', requirement: 'r', quotes: ['q'], conditionText: null, jurisdictions: ['CA'] }];
    const ok = checkedEnrichment([{ ruleKey: 'R-A', library: { kind: 'regulation', issuer: 'state', subject: 'party', scope: { process: 'account_opening' } }, jurisdictions: ['CA'], condition: { fact: 'governing_state', op: 'eq', value: 'CA' } }], rules, C2);
    expect(ok).toEqual([{ ruleKey: 'R-A', content: { library: { kind: 'regulation', issuer: 'state', subject: 'party', scope: { process: 'account_opening' }, jurisdiction: 'US-CA' }, condition: { fact: 'governing_state', op: 'eq', value: 'CA' } }, problems: [] }]);
    const bad = checkedEnrichment([{ ruleKey: 'R-A', library: { kind: 'statute', subject: 'party', scope: { process: 'lending' } }, jurisdictions: ['Mars'], condition: { fact: 'charter', op: 'eq', value: 'x' } }, { ruleKey: 'R-UNKNOWN' }], rules, C2);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.content).toEqual({ library: { subject: 'party', jurisdiction: 'US-CA' }, question: expect.stringContaining('When does this rule apply') });
    expect(bad[0]!.problems.join(' ')).toMatch(/kind.*scope.*"charter" is not a fact/s);
  });
});

describe('A2: the enrichment pass over existing drafts', () => {
  it('pre-fills a draft no person has edited; only offers a person’s draft; never touches an approved rule or the rule set', async () => {
    const tin = await extracted('TIN', 1);
    const ca = await byPerson('CA-ID', 2);
    const ctr = await extracted('CTR', 3);
    // An approved rule (like the 11 of rule set v2), published in a rule set.
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${ctr.ruleId}/applied`, { applied: true, expectedContentHash: ctr.contentHash })).statusCode).toBe(200);
    const set = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(set.statusCode, set.body).toBe(201);

    const e = scripted(GOOD);
    expect(await run(e)).toMatchObject({ status: 'done', prefilled: 1, offered: 1, skippedApproved: 1 });
    // Pre-filled: library parts and the condition, on the same draft (no new version), marked as the pass's own edit.
    const t = await latest(tin.ruleId);
    expect([t.version, t.state, t.editedById.startsWith('enrichment:')]).toEqual([1, 'DRAFT', true]);
    expect(PolicyRuleBody.parse(t.body)).toMatchObject({ library: { kind: 'policy', issuer: 'bank', subject: 'party', jurisdiction: 'US', scope: { process: 'account_opening', customer_types: ['individual'] } }, condition: { fact: 'process', op: 'eq', value: 'account_opening' } });
    // A person's draft: unchanged, the suggestion waits for the PM.
    expect((await latest(ca.ruleId)).contentHash).toBe(ca.contentHash);
    expect(await db.policyRuleSuggestion.count({ where: { ruleId: ca.ruleId, source: 'enrichment' } })).toBe(1);
    // The approved rule: no suggestion, no new version, same hash; the rule set is unchanged.
    expect((await db.policyRuleVersion.findMany({ where: { ruleId: ctr.ruleId } })).map((v) => [v.state, v.contentHash])).toEqual([['REVIEWED', ctr.contentHash]]);
    expect(await db.policyRuleSuggestion.count({ where: { ruleId: ctr.ruleId } })).toBe(0);
    expect((await db.projectRuleSet.findMany({ where: { projectId } })).map((s) => s.digest)).toEqual([set.json().digest]);
    expect(await db.auditEvent.count({ where: { action: ENRICHMENT_ACTIONS.suggested } })).toBe(1);

    // A second pass with the same answers changes nothing.
    const before = await latest(tin.ruleId);
    await run(e);
    expect((await latest(tin.ruleId)).contentHash).toBe(before.contentHash);
    expect(await db.policyRuleVersion.count({ where: { ruleId: tin.ruleId } })).toBe(1);
  });

  it('a condition that fails the catalog is stored as a question with its problems and never pre-filled', async () => {
    const tin = await extracted('TIN', 1);
    await run(scripted({ 'R-TIN': { library: { subject: 'party', scope: { process: 'account_opening' } }, condition: { fact: 'charter', op: 'eq', value: 'national' } } }));
    const body = PolicyRuleBody.parse((await latest(tin.ruleId)).body);
    expect(body.condition).toBeUndefined();
    expect(body.library).toMatchObject({ subject: 'party', scope: { process: 'account_opening' } });
    const s = await db.policyRuleSuggestion.findFirstOrThrow({ where: { ruleId: tin.ruleId } });
    expect(s.problems).toEqual([expect.stringContaining('"charter" is not a fact')]);
    expect(s.content).toMatchObject({ question: expect.stringContaining('When does this rule apply') });
  });

  it('one document only when asked; the same run is not done twice; the daily AI cap is respected; a model failure is recorded', async () => {
    await extracted('TIN', 1);
    const other = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Other', text: 'Other policy\nKeep records for five years.', format: 'txt', granularity: 'line' });
    expect(other.statusCode).toBe(201);
    const e = scripted(GOOD);
    const runId = randomUUID();
    expect(await run(e, { documentId, runId })).toMatchObject({ status: 'done', prefilled: 1 });
    expect(await run(e, { documentId, runId })).toMatchObject({ status: 'done', prefilled: 0 });
    expect(e.calls).toBe(1);
    expect(await run(e, { dailyCap: 0 })).toMatchObject({ status: 'skipped' });
    expect(await db.auditEvent.count({ where: { action: ENRICHMENT_ACTIONS.skipped } })).toBe(1);
    const failing: RuleEnricher = { modelVersion: 'down', enrich: async () => { throw new Error('model unavailable'); } };
    expect(await run(failing)).toMatchObject({ status: 'failed' });
    expect(await db.auditEvent.count({ where: { action: ENRICHMENT_ACTIONS.failed } })).toBe(1);
  });

  it('the PM starts a pass from the console (a worker job), and sees its state', async () => {
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/enrichment`, { documentId });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json()).toMatchObject({ status: 'running', runId: expect.any(String) });
    expect(await db.outboxEvent.count({ where: { name: 'policy.enrichment_requested', aggregateId: res.json().runId } })).toBe(1);
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/enrichment`)).json()).toMatchObject({ status: 'running', runId: res.json().runId });
  });
});
