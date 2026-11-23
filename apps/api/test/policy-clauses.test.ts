import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conditionFacts, conditionLabel, conditionProblems, CoverageCheck, FactCatalog, type ClauseCondition } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { citedRules, clausesFor } from '../src/anvil/clause-export';
import { FixedCoverageClient } from '../src/anvil/coverage-client';
import { templateBoundFacts } from '../src/policy/fact-catalog';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * E-002 §4.1 (owner decisions 23 Nov 2026), against Studio's draft contracts (d27063d): clause conditions as structured
 * predicates over the project's logical facts, shown in plain language; the approved clause list with "setup needed";
 * the clause identity in the export; Validate calling Studio's coverage check.
 */
const CATALOG = (projectId: string, facts = FACTS): FactCatalog => ({ schema_version: 'adi.utility.fact-catalog.v1', catalog_id: 'kyc.project.facts', version: 1, owner: { kind: 'project_scope', id: projectId }, facts });
const FACTS: FactCatalog['facts'] = [
  { id: 'product', label: 'Product', type: 'enum', allowed_values: ['individual', 'adult_joint', 'teen_joint', 'custodial'], availability: 'case_data' },
  { id: 'governing_state', label: 'Governing state', type: 'string', availability: 'case_data' },
  { id: 'submitted_at', label: 'Submitted', type: 'date', availability: 'case_data' },
];
const CA_JOINT: ClauseCondition = { all: [{ fact: 'governing_state', op: 'eq', value: 'CA' }, { fact: 'product', op: 'in', value: ['adult_joint', 'teen_joint'] }] };

describe('clause conditions (shared)', () => {
  it('checks facts, operators and values against the fact catalog', () => {
    expect(conditionProblems(CA_JOINT, { facts: FACTS })).toEqual([]);
    expect(conditionProblems(null, null)).toEqual([]);
    expect(conditionProblems({ fact: 'charter', op: 'eq', value: 'national' }, { facts: FACTS })[0]).toContain('"charter" is not a fact');
    expect(conditionProblems({ fact: 'product', op: 'gt', value: 'individual' }, { facts: FACTS })[0]).toContain('does not allow the operator "gt"');
    expect(conditionProblems({ fact: 'product', op: 'eq', value: 'business' }, { facts: FACTS })[0]).toContain('"business" is not a valid value for Product');
    expect(conditionProblems({ fact: 'submitted_at', op: 'between', value: ['2026-01-01'] }, { facts: FACTS })[0]).toContain('needs [low, high]');
    expect(conditionProblems({ fact: 'product', op: 'eq', value: 'individual' }, null)[0]).toContain('setup needed');
  });

  it('shows a condition in plain language and lists its facts', () => {
    expect(conditionLabel(CA_JOINT, { facts: FACTS })).toBe('Governing state is CA, and Product is one of adult_joint, teen_joint');
    expect(conditionLabel({ not: { fact: 'governing_state', op: 'present' } }, { facts: FACTS })).toBe('not (Governing state is known)');
    expect(conditionLabel({ fact: 'x', op: 'eq', value: 1, label: 'Written by the PM' })).toBe('Written by the PM');
    expect(conditionLabel(null)).toBe('Applies wherever the project’s approved scope applies.');
    expect(conditionFacts(CA_JOINT)).toEqual(['governing_state', 'product']);
  });

  it('reads Studio’s coverage-check.v1 fixture and a template’s policy bindings', () => {
    const fixture = { schema_version: 'adi.utility.coverage-check.v1', environment_version_id: 'golden-kyc-openenv@8', template: { template_id: 'tpl_x5rwt6d5eu', version: 7 }, checked_at: '2026-11-23T20:00:00Z', edge_cases: [{ tag: 'expired_document', status: 'supported', have: { individual: 10 }, minimum_per_product: 10, gaps: [] }], clauses: [{ clause_id: 'pol-ca-demo', version: 1, status: 'needs_environment_change', gaps: [{ kind: 'fact', ref: 'charter', message: 'No charter fact.' }] }] };
    expect(CoverageCheck.safeParse(fixture).success).toBe(true);
    expect(templateBoundFacts({ execution: { policy_bindings: { fact_catalog: 'golden-kyc-openenv.facts@1', facts: [{ fact: 'product', environment_fact: 'product' }] } } })).toEqual({ factCatalog: 'golden-kyc-openenv.facts@1', facts: ['product'] });
    expect(templateBoundFacts({ execution: {} })).toBeNull();
  });
});

const POLICY = ['Synthetic KYC policy', 'For California joint accounts, each joint holder must provide a California-compliant ID.', 'The bank must verify the residential address.'].join('\n');
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };

let app: FastifyInstance;
let clientId: string;
let pmCookie: string;
let projectId: string;
let templateId: string;
const coverageAnswer = { schema_version: 'adi.utility.coverage-check.v1', environment_version_id: 'golden-kyc-openenv@8', checked_at: '2026-11-23T20:00:00Z', edge_cases: [], clauses: [{ clause_id: 'R-CA-JOINT', version: 1, status: 'needs_environment_change', gaps: [{ kind: 'fact', ref: 'governing_state', message: 'The environment has no governing_state fact.' }] }] };
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage(), coverageClient: new FixedCoverageClient(coverageAnswer) });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC onboarding and refresh' } });
  templateId = template.id;
  projectId = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC clauses' } })).id;
  pmCookie = await login(app, pm.email);
});

async function caRule() {
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic KYC policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  const quote = POLICY.split('\n')[1]!;
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: d.json().version.id, ruleKey: 'CA-JOINT', body: { ...BASE, title: 'CA joint ID', requirement: quote }, citations: [{ fieldPath: 'requirement', role: 'supports', quote }] });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; contentHash: string };
}

describe('project fact catalog, conditions on rules, approved clauses', () => {
  it('the PM saves a versioned fact catalog; a condition is checked against it and kept when an edit omits it', async () => {
    const r = await caRule();
    const edit = (body: object, hash: string) => api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}`, { expectedContentHash: hash, body: { ...BASE, title: 'CA joint ID', requirement: POLICY.split('\n')[1], ...body } });
    // No catalog yet: a condition cannot be checked ("setup needed").
    const early = await edit({ condition: CA_JOINT }, r.contentHash);
    expect(early.statusCode).toBe(422);
    expect(early.json().message).toContain('setup needed');
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, { ...CATALOG(randomUUID()) })).statusCode).toBe(422);
    const saved = await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, CATALOG(projectId));
    expect(saved.statusCode, saved.body).toBe(201);
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, CATALOG(projectId))).json()).toMatchObject({ version: 1, unchanged: true });
    expect((await edit({ condition: { fact: 'charter', op: 'eq', value: 'x' } }, r.contentHash)).statusCode).toBe(422);
    const ok = await edit({ condition: CA_JOINT }, r.contentHash);
    expect(ok.statusCode, ok.body).toBe(200);
    // An edit from an older client (no condition) keeps it.
    const again = await edit({ verificationHint: 'Check each holder.' }, ok.json().contentHash);
    expect(again.statusCode, again.body).toBe(200);
    const body = (await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.ruleId }, orderBy: { version: 'desc' } })).body as { condition?: unknown };
    expect(body.condition).toEqual(CA_JOINT);
    await expect(db.$executeRaw`DELETE FROM "ProjectFactCatalog"`).rejects.toThrow();
  });

  it('approved clauses show the condition in plain language and "setup needed" when the template binds none of its facts; the export carries the clause identity; Validate shows Studio’s answer', async () => {
    const r = await caRule();
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, CATALOG(projectId));
    const ok = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}`, { expectedContentHash: r.contentHash, body: { ...BASE, title: 'CA joint ID', requirement: POLICY.split('\n')[1], condition: CA_JOINT } });
    expect(ok.statusCode, ok.body).toBe(200);
    const applied = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/applied`, { applied: true, expectedContentHash: ok.json().contentHash });
    expect(applied.statusCode, applied.body).toBe(200);
    const list = (await api(pmCookie).get(`/projects/${projectId}/policy/clauses`)).json();
    expect(list.templateBinds).toBeNull();
    expect(list.items[0]).toMatchObject({ clauseId: 'R-CA-JOINT', conditionText: 'Governing state is CA, and Product is one of adult_joint, teen_joint', status: 'setup_needed', missingFacts: ['governing_state', 'product'], source: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }, approval: { approvalId: expect.any(String) } });
    // The template binds both facts: available.
    await db.template.update({ where: { id: templateId }, data: { anvilSpec: { execution: { policy_bindings: { fact_catalog: 'golden-kyc-openenv.facts@1', facts: [{ fact: 'governing_state', environment_fact: 'governing_state' }, { fact: 'product', environment_fact: 'product' }] } } } } });
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/clauses`)).json().items[0]).toMatchObject({ status: 'available', missingFacts: [], bindingRevision: 'golden-kyc-openenv.facts@1' });

    // Export: a task citing the approved version carries clause ID, version, source hash, condition, exceptions, approval and binding revision.
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.ruleId, state: 'REVIEWED' }, orderBy: { version: 'desc' } });
    const output = { sections: { S4: { statePolicies: [{ ruleId: r.ruleId, ruleVersion: 'rs1', contentSha256: v.contentHash, locator: 'x' }] } } };
    expect(citedRules(output)).toEqual([{ ruleId: r.ruleId, contentSha256: v.contentHash }]);
    const template = await db.template.findUniqueOrThrow({ where: { id: templateId } });
    const clauses = await clausesFor(db, { clientId, projectId, output }, template.anvilSpec);
    expect(clauses).toEqual([{ clause_id: 'R-CA-JOINT', version: v.version, source: { document_id: expect.any(String), document_version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), locator: expect.any(Object) }, condition: CA_JOINT, exceptions: { kind: 'none', items: [] }, approval: { approval_id: v.id, project_id: projectId, approved_by: expect.any(String), approved_at: expect.any(String) }, binding_revision: 'golden-kyc-openenv.facts@1' }]);
    // A rule without a structured condition adds nothing (packages keep their bytes).
    expect(await clausesFor(db, { clientId, projectId, output: { sections: { S4: { statePolicies: [{ ruleId: randomUUID(), contentSha256: 'a'.repeat(64) }] } } } }, template.anvilSpec)).toEqual([]);

    // Validate: Studio's coverage answer for the project's clauses.
    const check = await api(pmCookie).post(`/projects/${projectId}/coverage-check`, {});
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toMatchObject({ connected: true, request: { clauses: 1 }, result: { clauses: [{ clause_id: 'R-CA-JOINT', status: 'needs_environment_change' }] } });
  });
});
