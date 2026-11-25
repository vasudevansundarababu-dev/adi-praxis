import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conditionFacts, conditionLabel, conditionProblems, CoverageCheck, FactCatalog, type ClauseCondition } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { citedRules, clausesFor, policyClausesFor } from '../src/anvil/clause-export';
import { FixedCoverageClient, HttpCoverageClient } from '../src/anvil/coverage-client';
import { checkedDispositions, DispositionUnavailableError, MockDispositionSuggester, type DispositionSuggester } from '../src/policy/dispositions';
import { templateBoundFacts } from '../src/policy/fact-catalog';
import { evaluateQuality } from '../src/policy/quality';
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
let suggester: DispositionSuggester = new MockDispositionSuggester();
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
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage(), coverageClient: new FixedCoverageClient(coverageAnswer), dispositionSuggester: { get modelVersion() { return suggester.modelVersion; }, suggest: (i) => suggester.suggest(i) } });
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

async function caRule(applicability: object = BASE.applicability) {
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic KYC policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  const quote = POLICY.split('\n')[1]!;
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: d.json().version.id, ruleKey: 'CA-JOINT', body: { ...BASE, applicability, title: 'CA joint ID', requirement: quote }, citations: [{ fieldPath: 'requirement', role: 'supports', quote }] });
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
    const entry = { clause_id: 'R-CA-JOINT', version: v.version, title: 'CA joint ID', obligation: POLICY.split('\n')[1], text_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), source: { document_id: expect.any(String), document_version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), quote: POLICY.split('\n')[1] }, approval: { approval_id: v.id, project_id: projectId, approved_by: expect.any(String), approved_at: expect.any(String) }, condition: CA_JOINT };
    expect(clauses).toEqual([{ ...entry, binding_revision: 'golden-kyc-openenv.facts@1' }]);
    // approved-task-export.v1 policy_clauses (Studio ef06119): every approved selected clause, condition null when none.
    expect((await policyClausesFor(db, { clientId, projectId, output })).map((c) => c.entry)).toEqual([entry]);
    // Pinned per revision: a revision approved before the clause's approval never gains it later (same revision, same clauses).
    expect(await policyClausesFor(db, { clientId, projectId, output, createdAt: new Date(v.reviewedAt!.getTime() - 1000) })).toEqual([]);
    expect((await policyClausesFor(db, { clientId, projectId, output, createdAt: new Date(v.reviewedAt!.getTime() + 1000) })).length).toBe(1);
    // A rule without a structured condition adds nothing (packages keep their bytes).
    expect(await clausesFor(db, { clientId, projectId, output: { sections: { S4: { statePolicies: [{ ruleId: randomUUID(), contentSha256: 'a'.repeat(64) }] } } } }, template.anvilSpec)).toEqual([]);

    // Validate: Studio's coverage answer for the project's clauses.
    const check = await api(pmCookie).post(`/projects/${projectId}/coverage-check`, {});
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toMatchObject({ connected: true, request: { clauses: 1 }, result: { clauses: [{ clause_id: 'R-CA-JOINT', status: 'needs_environment_change' }] } });
  });
});

describe('suggested dispositions (E-002 §1.3): never approvals; checked on the server; manual fallback', () => {
  const RULES = [{ ruleKey: 'R-1', title: 't', requirement: 'r', applicability: null, jurisdictions: [], quotes: ['Each joint holder must provide an ID.'] }];
  it('server-side checks: unknown keys dropped, an invalid condition or an unquoted mismatch becomes Needs review', () => {
    const catalog = { facts: FACTS } as never;
    expect(checkedDispositions([{ ruleKey: 'R-9', disposition: 'recommended', mode: 'always' }], RULES, catalog, null)).toEqual([]);
    expect(checkedDispositions([{ ruleKey: 'R-1', disposition: 'recommended', mode: 'conditional', condition: { fact: 'charter', op: 'eq', value: 'x' } }], RULES, catalog, null)[0]).toMatchObject({ disposition: 'needs_review', question: expect.stringContaining('"charter" is not a fact') });
    expect(checkedDispositions([{ ruleKey: 'R-1', disposition: 'outside_scope', mismatch: { quote: 'not in the rule', reason: 'x' } }], RULES, catalog, null)[0]!.disposition).toBe('needs_review');
    expect(checkedDispositions([{ ruleKey: 'R-1', disposition: 'outside_scope', mismatch: { quote: 'joint holder', reason: 'Project has no joint accounts.' } }], RULES, catalog, null)[0]).toMatchObject({ disposition: 'outside_scope', mismatch: { quote: 'joint holder' } });
    expect(checkedDispositions([{ ruleKey: 'R-1', disposition: 'recommended', mode: 'conditional', condition: { fact: 'governing_state', op: 'eq', value: 'CA' } }], RULES, catalog, ['product'])[0]).toMatchObject({ conditionText: 'Governing state is CA', bindingGaps: ['governing_state'] });
  });

  it('the PM gets a conditional suggestion with plain words, uses it, and the rule stores the condition; an AI failure says so plainly', async () => {
    const r = await caRule({ ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California joint accounts' });
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, CATALOG(projectId));
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {});
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json().items[0];
    expect(d).toMatchObject({ ruleKey: 'R-CA-JOINT', disposition: 'recommended', mode: 'conditional', conditionText: 'Governing state is CA', bindingGaps: ['governing_state'], ruleId: r.ruleId });
    // Nothing was approved or changed by the suggestion.
    expect((await db.policyRuleVersion.findMany({ where: { ruleId: r.ruleId } })).length).toBe(1);
    const used = await api(pmCookie).post(`/projects/${projectId}/policy/rules/${r.ruleId}/condition`, { expectedContentHash: d.contentHash, condition: d.condition });
    expect(used.statusCode, used.body).toBe(200);
    const body = (await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.ruleId }, orderBy: { version: 'desc' } })).body as { condition?: unknown };
    expect(body.condition).toEqual({ fact: 'governing_state', op: 'eq', value: 'CA' });
    suggester = { modelVersion: 'failing', suggest: async () => { throw new DispositionUnavailableError('{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}'); } };
    try {
      const fail = await api(pmCookie).post(`/projects/${projectId}/policy/dispositions`, {});
      expect(fail.statusCode).toBe(503);
      expect(fail.json().message).toBe('Suggestions can’t reach the AI service: the Google sign-in for AI on this computer has expired. Ask an admin to sign in again. You can review each rule by hand.');
    } finally {
      suggester = new MockDispositionSuggester();
    }
  });
});

describe('PM quality evaluation (E-002 §4.1.4)', () => {
  it('counts with raw numbers and lists each discrepancy by type', () => {
    const r = evaluateQuality(
      [
        { id: 'L1', quote: 'each joint holder must provide a California-compliant ID', disposition: 'recommended' },
        { id: 'L2', quote: 'The bank must verify the residential address.', disposition: 'needs_review' },
        { id: 'L3', quote: 'Staff must not open an account without a CIP record.' },
      ],
      [
        { ruleKey: 'R-CA', quotes: ['For California joint accounts, each joint holder must provide a California-compliant ID.'], disposition: 'recommended' },
        { ruleKey: 'R-ADDR', quotes: ['The bank must verify the residential address.'], disposition: 'recommended' },
        { ruleKey: 'R-EXTRA', quotes: ['Something the PM did not label.'], disposition: null },
      ],
    );
    expect(r.extraction.precision).toEqual({ value: 0.667, numerator: 2, denominator: 3 });
    expect(r.extraction.recall).toEqual({ value: 0.667, numerator: 2, denominator: 3 });
    expect(r.suggestions.agreement).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(r.counts).toEqual({ missed_obligation: 1, extra_rule: 1, merged_obligations: 0, disposition_mismatch: 1, no_suggestion: 0 });
    expect(r.discrepancies).toContainEqual({ type: 'disposition_mismatch', labelId: 'L2', ruleKey: 'R-ADDR', expected: 'needs_review', got: 'recommended' });
  });

  it('a run is stored with its reproducibility metadata; labels stay private to PM/Admin', async () => {
    await caRule({ ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California joint accounts' });
    await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, CATALOG(projectId));
    const dv = await db.policyDocumentVersion.findFirstOrThrow({ where: { projectId } });
    const set = await api(pmCookie).put(`/projects/${projectId}/policy/reference-sets`, { documentVersionId: dv.id, labels: [{ id: 'L1', quote: 'each joint holder must provide a California-compliant ID', disposition: 'recommended' }, { id: 'L2', quote: 'The bank must verify the residential address.' }] });
    expect(set.statusCode, set.body).toBe(201);
    const run = await api(pmCookie).post(`/projects/${projectId}/policy/quality-runs`, { referenceSetId: set.json().id });
    expect(run.statusCode, run.body).toBe(201);
    expect(run.json().result).toMatchObject({ extraction: { precision: { numerator: 1, denominator: 1 }, recall: { numerator: 1, denominator: 2 } }, suggestions: { agreement: { numerator: 1, denominator: 1 } }, counts: { missed_obligation: 1 } });
    expect(run.json().metadata).toMatchObject({ document: { sha256: dv.sha256, documentVersion: dv.version }, scope: { factCatalogVersion: 1 }, suggestions: { promptVersion: 'dispositions/1', model: 'mock-dispositions-1' }, referenceSet: { version: 1, labels: 2 } });
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/quality`)).json().runs).toHaveLength(1);
    const sme = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await api(sme).get(`/projects/${projectId}/policy/quality`)).statusCode).toBe(403);
    await expect(db.$executeRaw`DELETE FROM "PolicyQualityRun"`).rejects.toThrow();
  });
});

describe('Validate against Studio’s live coverage endpoint (client, with a recorded Studio)', () => {
  it('sends seed_family, the edge-case entries in use and the clauses; reads coverage-check.v1; plain messages on errors', async () => {
    const sent: Record<string, unknown>[] = [];
    const answer = { schema_version: 'adi.utility.coverage-check.v1', environment_version_id: 'golden-kyc-openenv@8', checked_at: '2026-11-23T20:00:00Z', edge_cases: [{ tag: 'expired_document', status: 'supported', gaps: [] }], clauses: [] };
    const ok = new HttpCoverageClient({ coverageCheck: async (b) => (sent.push(b), { ok: true as const, httpStatus: 200, data: answer }) }, 'synthetic-kyc-cases@1.1.0:20261119');
    const r = await ok.check({ template: { id: 't', version: 5 }, edge_case_tags: ['expired_document'], edge_cases: [{ tag: 'expired_document', context: 'c', twist: 't' }], clauses: [] });
    expect(r).toMatchObject({ ok: true, result: { environment_version_id: 'golden-kyc-openenv@8' } });
    expect(sent[0]).toEqual({ seed_family: 'synthetic-kyc-cases@1.1.0:20261119', clauses: [], edge_cases: [{ tag: 'expired_document', context: 'c', twist: 't' }] });
    const refused = new HttpCoverageClient({ coverageCheck: async () => ({ ok: false as const, kind: 'rejected' as const, httpStatus: 422, code: 'SCHEMA_INVALID', message: 'bad condition at /clauses/0/condition' }) }, 'f');
    expect(await refused.check({ template: { id: 't', version: 1 }, edge_case_tags: [], clauses: [] })).toEqual({ ok: false, message: 'Studio refused the coverage check: bad condition at /clauses/0/condition' });
  });
});

describe('fact catalog from the template (v8 with policy bindings)', () => {
  it('builds the first project catalog from the template’s bound facts; refuses when one exists or the template binds none', async () => {
    expect((await api(pmCookie).post(`/projects/${projectId}/policy/fact-catalog/from-template`, {})).statusCode).toBe(422);
    await db.template.update({ where: { id: templateId }, data: { anvilSpec: { execution: { policy_bindings: { fact_catalog: 'golden-kyc-openenv.facts@1', facts: [{ fact: 'governing_state', environment_fact: 'governing_state' }, { fact: 'product', environment_fact: 'product', type: 'enum', label: 'Product', allowed_values: ['individual', 'adult_joint', 'teen_joint', 'custodial'] }] } } } } });
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/fact-catalog/from-template`, {});
    expect(r.statusCode, r.body).toBe(201);
    const cat = (await api(pmCookie).get(`/projects/${projectId}/policy/fact-catalog`)).json();
    expect(cat.catalog.facts).toEqual([
      { id: 'governing_state', label: 'Governing state', type: 'string', availability: 'case_data' },
      { id: 'product', label: 'Product', type: 'enum', allowed_values: ['individual', 'adult_joint', 'teen_joint', 'custodial'], availability: 'case_data' },
    ]);
    expect((await api(pmCookie).post(`/projects/${projectId}/policy/fact-catalog/from-template`, {})).statusCode).toBe(409);
  });
});
