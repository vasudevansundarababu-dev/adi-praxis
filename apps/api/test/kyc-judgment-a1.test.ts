import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FactCatalog, PolicyRuleBody } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { MockDispositionSuggester } from '../src/policy/dispositions';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A1 (owner, 25 Nov 2026: "Accept recommendations"; contracts C1 and C2 at Studio 1ba841d): the
 * project holds the environment's fact catalog (C2) as it is; a rule can define a derived fact (C1 derived_facts, such
 * as us_person) that other rules' conditions may name; suggested conditions are stored against the exact rule version
 * and are adopted only by a PM, never by the AI. Synthetic policy text only.
 */
const C2 = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8')) as FactCatalog;
const POLICY = ['Synthetic bank policy', 'A U.S. person is a U.S. citizen.', 'For a minor who is a U.S. person without a taxpayer ID, request it.', 'California applicants must show a California-compliant ID.'].join('\n');
const line = (n: number) => POLICY.split('\n')[n]!;
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };
const US_PERSON = { id: 'us_person', type: 'boolean', definition: { fact: 'citizenship', op: 'in', value: ['US'] } } as const;

let app: FastifyInstance;
let clientId: string;
let pmCookie: string;
let projectId: string;
let docVersionId: string;
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown, key = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...key }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage(), dispositionSuggester: new MockDispositionSuggester() });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC judgment' } });
  projectId = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC judgment' } })).id;
  pmCookie = await login(app, pm.email);
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic bank policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  docVersionId = d.json().version.id;
});

async function rule(key: string, n: number, extra: Record<string, unknown> = {}) {
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: docVersionId, ruleKey: key, body: { ...BASE, title: key, requirement: line(n), ...extra }, citations: [{ fieldPath: 'requirement', role: 'supports', quote: line(n) }] });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; contentHash: string };
}
const edit = (ruleId: string, hash: string, n: number, extra: Record<string, unknown>) => api(pmCookie).put(`/projects/${projectId}/policy/rules/${ruleId}`, { expectedContentHash: hash, body: { ...BASE, title: 'x', requirement: line(n), ...extra } });

describe('A1: the environment’s fact catalog (C2) in the project', () => {
  it('loads as it is: environment owner, multi-valued and computed facts, descriptions; an identical save changes nothing', async () => {
    expect(FactCatalog.safeParse(C2).success).toBe(true);
    const saved = await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    expect(saved.statusCode, saved.body).toBe(201);
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2)).json()).toMatchObject({ version: 1, unchanged: true });
    const got = (await api(pmCookie).get(`/projects/${projectId}/policy/fact-catalog`)).json();
    expect(got.catalog).toMatchObject({ catalog_id: 'kyc-judgment-openenv.facts', owner: { kind: 'environment_version', id: 'kyc-judgment-openenv@1' } });
    expect(got.catalog.facts.find((f: { id: string }) => f.id === 'citizenship')).toMatchObject({ cardinality: 'many' });
    // Still refused: a catalog owned by another project.
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, { ...C2, owner: { kind: 'project_scope', id: randomUUID() } })).statusCode).toBe(422);
  });
});

describe('A1: derived facts (C1 derived_facts)', () => {
  it('a rule defines us_person over catalog facts; other rules’ conditions may then name it', async () => {
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    const def = await rule('US-PERSON-DEFINITION', 1, { library: { defines: US_PERSON } });
    expect((await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: def.ruleId } })).body).toMatchObject({ library: { defines: US_PERSON } });
    const minor = await rule('GB-03', 2);
    const cond = { all: [{ fact: 'party_role', op: 'eq', value: 'minor' }, { fact: 'us_person', op: 'eq', value: true }] };
    const ok = await edit(minor.ruleId, minor.contentHash, 2, { condition: cond });
    expect(ok.statusCode, ok.body).toBe(200);
    // A derived fact that nothing defines is unknown.
    const bad = await edit(minor.ruleId, ok.json().contentHash, 2, { condition: { fact: 'us_resident', op: 'eq', value: true } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().message).toContain('"us_resident" is not a fact');
  });

  it('a definition may name only catalog facts, never another derived fact or an unknown one', async () => {
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    await rule('US-PERSON-DEFINITION', 1, { library: { defines: US_PERSON } });
    const r = await rule('OTHER', 2);
    const chained = await edit(r.ruleId, r.contentHash, 2, { library: { defines: { id: 'minor_us_person', type: 'boolean', definition: { fact: 'us_person', op: 'eq', value: true } } } });
    expect(chained.statusCode).toBe(422);
    expect(chained.json().message).toContain('"us_person" is not a fact');
    const twice = await edit(r.ruleId, r.contentHash, 2, { library: { defines: US_PERSON } });
    expect(twice.statusCode).toBe(422);
    expect(twice.json().message).toContain('us_person is already defined');
  });

  it('library metadata is optional and never defaulted: a rule without it keeps its body and content hash', async () => {
    const r = await rule('PLAIN', 3);
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.ruleId } });
    expect(v.contentHash).toBe(r.contentHash);
    expect(PolicyRuleBody.parse(v.body)).not.toHaveProperty('library');
  });
});

describe('A1: stored suggestions; only a PM adopts them', () => {
  it('dispositions are stored once per rule version, hash, source and prompt, with their checks; nothing changes the rule', async () => {
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    const ca = await rule('CA-ID', 3, { applicability: { ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California applicants' } });
    const first = await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {});
    expect(first.statusCode, first.body).toBe(200);
    const item = first.json().items.find((i: { ruleKey: string }) => i.ruleKey === 'R-CA-ID');
    expect(item).toMatchObject({ disposition: 'recommended', mode: 'conditional', condition: { fact: 'governing_state', op: 'eq', value: 'CA' }, suggestionId: expect.any(String) });
    expect(await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {})).toMatchObject({ statusCode: 200 });
    const rows = await db.policyRuleSuggestion.findMany({ where: { ruleId: ca.ruleId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'disposition', model: 'mock-dispositions-1', contentHash: ca.contentHash, problems: [] });
    expect((await db.policyRuleVersion.findMany({ where: { ruleId: ca.ruleId } })).map((v) => v.contentHash)).toEqual([ca.contentHash]);
    // Append-only.
    await expect(db.$executeRaw`DELETE FROM "PolicyRuleSuggestion"`).rejects.toThrow();
    const list = (await api(pmCookie).get(`/projects/${projectId}/policy/rules/${ca.ruleId}/suggestions`)).json();
    expect(list.items).toEqual([expect.objectContaining({ id: rows[0]!.id, source: 'disposition', current: true })]);
  });

  it('the PM adopts a suggested condition on a draft; a stale or failing suggestion is refused; audited', async () => {
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    const ca = await rule('CA-ID', 3, { applicability: { ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California applicants' } });
    const item = (await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {})).json().items[0];
    const adopted = await api(pmCookie).post(`/projects/${projectId}/policy/suggestions/${item.suggestionId}/adopt`, { expectedContentHash: ca.contentHash });
    expect(adopted.statusCode, adopted.body).toBe(200);
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: ca.ruleId }, orderBy: { version: 'desc' } });
    expect(v.state).toBe('DRAFT');
    expect((v.body as { condition?: unknown }).condition).toEqual({ fact: 'governing_state', op: 'eq', value: 'CA' });
    expect(await db.auditEvent.count({ where: { action: 'policy.rule_suggestion_adopted', entityId: v.id } })).toBe(1);
    // The suggestion was for the earlier content: adopting it again is stale.
    const again = await api(pmCookie).post(`/projects/${projectId}/policy/suggestions/${item.suggestionId}/adopt`, { expectedContentHash: v.contentHash });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('STALE_SUGGESTION');
    // A suggestion whose checks failed is never adopted.
    const bad = await db.policyRuleSuggestion.create({ data: { clientId, projectId, ruleId: ca.ruleId, ruleVersionId: v.id, contentHash: v.contentHash, source: 'enrichment', model: 'm', promptVersion: 'p', content: { condition: { fact: 'charter', op: 'eq', value: 'x' } }, problems: ['condition: "charter" is not a fact in the project\'s fact catalog.'], createdById: 'system' } });
    const refused = await api(pmCookie).post(`/projects/${projectId}/policy/suggestions/${bad.id}/adopt`, { expectedContentHash: v.contentHash });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toBe('SUGGESTION_HAS_PROBLEMS');
  });

  it('adopting on an approved rule makes a new draft; the approved version and the rule set stay as they are', async () => {
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2);
    const ca = await rule('CA-ID', 3, { applicability: { ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California applicants' } });
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${ca.ruleId}/applied`, { applied: true, expectedContentHash: ca.contentHash, acceptUnverifiedEvidence: true })).statusCode).toBe(200);
    const set = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
    expect(set.statusCode, set.body).toBe(201);
    const item = (await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {})).json().items[0];
    const adopted = await api(pmCookie).post(`/projects/${projectId}/policy/suggestions/${item.suggestionId}/adopt`, { expectedContentHash: ca.contentHash });
    expect(adopted.statusCode, adopted.body).toBe(200);
    const versions = await db.policyRuleVersion.findMany({ where: { ruleId: ca.ruleId }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => [v.version, v.state, v.contentHash === ca.contentHash])).toEqual([[1, 'REVIEWED', true], [2, 'DRAFT', false]]);
    expect((await db.projectRuleSet.findMany({ where: { projectId } })).map((s) => s.digest)).toEqual([set.json().digest]);
  });
});
