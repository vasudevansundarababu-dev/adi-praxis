import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClauseCondition, FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { citedRuleIdentities, citedRules, citedRuleVersions, policyClausesFor } from '../src/anvil/clause-export';
import { mapRecordPolicies } from '../src/anvil/policy-id-map';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { policyLibrary } from '../src/tasks/rubric/service';
import { referenceProblems } from '../src/tasks/task-integrity';
import { textSha256 } from '../src/policy/text-hash';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A5 with C1's rule identity (contracts at Studio 1ba841d): a form that declares `textSha256` (C4's
 * private expectedRules) cites a rule as (rule key, Authoring's integer version, text SHA-256), the same identity as the
 * policy library export (A4). Such a citation exports as a policy clause with its text_sha256, and is checked against
 * the project's library by that identity. Synthetic policy text only.
 */
const POLICY = ['Synthetic KYC policy', 'For California joint accounts, each joint holder must provide a California-compliant ID.', 'The bank must verify the residential address.'].join('\n');
const QUOTE = POLICY.split('\n')[1]!;
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };
const FACTS: FactCatalog['facts'] = [{ id: 'governing_state', label: 'Governing state', type: 'string', availability: 'case_data' }];
const CA: ClauseCondition = { fact: 'governing_state', op: 'eq', value: 'CA' };

let app: FastifyInstance;
let clientId: string;
let pmCookie: string;
let projectId: string;
const api = (cookie: string) => ({
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage() });
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
});

/** One rule with a condition, applied and published in rule set v1; returns the published version. */
async function publishedRule() {
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic KYC policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, { schema_version: 'adi.utility.fact-catalog.v1', catalog_id: 'kyc.project.facts', version: 1, owner: { kind: 'project_scope', id: projectId }, facts: FACTS })).statusCode).toBe(201);
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: d.json().version.id, ruleKey: 'CA-JOINT', body: { ...BASE, title: 'CA joint ID', requirement: QUOTE, condition: CA }, citations: [{ fieldPath: 'requirement', role: 'supports', quote: QUOTE }] });
  expect(r.statusCode, r.body).toBe(201);
  const applied = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.json().ruleId}/applied`, { applied: true, expectedContentHash: r.json().contentHash });
  expect(applied.statusCode, applied.body).toBe(200);
  const set = await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null });
  expect(set.statusCode, set.body).toBe(201);
  return db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.json().ruleId, state: 'REVIEWED' }, include: { rule: true } });
}

const pickerOutput = (item: Record<string, unknown>) => ({ sections: { S4: { expectedRules: [{ locator: 'Synthetic KYC policy · line 2', quote: QUOTE, appliesTo: '', rationale: 'CA case', exception: '', ...item }] } } });

const c1Output = (item: Record<string, unknown>) => ({ sections: { S4: { policies: [{ appliesTo: 'x', rationale: 'CA case', ...item }] } } });

describe('A5 with C1 identity: (rule key, integer version, text SHA-256)', () => {
  it('the picker’s library gives each published version its number and text SHA-256', async () => {
    const v = await publishedRule();
    const lib = await policyLibrary(db, clientId, projectId);
    expect(lib.documents[0]!.rules[0]).toMatchObject({ ruleKey: 'R-CA-JOINT', version: v.version, textSha256: textSha256(QUOTE) });
  });

  it('a C1-identity citation exports the same clause as the other citation kinds, with its text_sha256', async () => {
    const v = await publishedRule();
    const output = c1Output({ ruleId: 'R-CA-JOINT', ruleVersion: v.version, textSha256: textSha256(QUOTE) });
    expect(citedRuleIdentities(output)).toEqual([{ ruleKey: 'R-CA-JOINT', version: v.version, textSha256: textSha256(QUOTE) }]);
    expect(citedRules(output)).toEqual([]);
    expect(citedRuleVersions(output)).toEqual([]);
    const byIdentity = (await policyClausesFor(db, { clientId, projectId, output })).map((c) => c.entry);
    const byId = (await policyClausesFor(db, { clientId, projectId, output: { sections: { S4: { statePolicies: [{ ruleId: v.ruleId, contentSha256: v.contentHash }] } } } })).map((c) => c.entry);
    expect(byIdentity).toEqual(byId);
    expect(byIdentity[0]).toMatchObject({ clause_id: 'R-CA-JOINT', version: v.version, text_sha256: textSha256(QUOTE) });
    expect(await referenceProblems(db, { clientId, projectId, output })).toEqual([]);
  });

  it('never guesses: another text hash, an unknown version or a rule of another project is flagged and not exported', async () => {
    const v = await publishedRule();
    for (const output of [c1Output({ ruleId: 'R-CA-JOINT', ruleVersion: v.version, textSha256: 'f'.repeat(64) }), c1Output({ ruleId: 'R-CA-JOINT', ruleVersion: v.version + 5, textSha256: textSha256(QUOTE) }), c1Output({ ruleId: 'R-NOPE', ruleVersion: v.version, textSha256: textSha256(QUOTE) })]) {
      expect(await policyClausesFor(db, { clientId, projectId, output })).toEqual([]);
      expect(await referenceProblems(db, { clientId, projectId, output })).toEqual([expect.objectContaining({ code: 'UNRESOLVED_CLAUSE', owner: 'author' })]);
    }
    // Without a project, an identity citation can't be resolved: it is flagged, never skipped silently.
    expect(await referenceProblems(db, { clientId, output: c1Output({ ruleId: 'R-CA-JOINT', ruleVersion: v.version, textSha256: textSha256(QUOTE) }) })).toEqual([expect.objectContaining({ code: 'UNRESOLVED_CLAUSE' })]);
  });

  it('every policy_clauses entry carries text_sha256 (approved-task-export.v1, additive)', async () => {
    const v = await publishedRule();
    const [c] = await policyClausesFor(db, { clientId, projectId, output: pickerOutput({ ruleId: 'R-CA-JOINT', ruleVersion: v.id, contentSha256: v.contentHash }) });
    expect(c!.entry.text_sha256).toBe(textSha256(QUOTE));
  });
});
