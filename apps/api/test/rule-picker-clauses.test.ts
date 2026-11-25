import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClauseCondition, FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { citedRules, citedRuleVersions, policyClausesFor } from '../src/anvil/clause-export';
import { mapRecordPolicies } from '../src/anvil/policy-id-map';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { policyLibrary } from '../src/tasks/rubric/service';
import { referenceProblems } from '../src/tasks/task-integrity';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A5 (owner, 25 Nov 2026: "Accept recommendations"): the S4 rule picker (`policy_citation`) stores
 * the cited rule version's content hash, and a picker citation exports as a policy clause (text, version, source,
 * approval, condition) exactly like a clause cited by rule id. Picker items keep their shape: ruleId = the rule key,
 * ruleVersion = the published version's id. Synthetic policy text only.
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

describe('A5: the S4 rule picker stores the content hash, and its citations export as clauses', () => {
  it('the library the picker reads gives each published rule version its content hash', async () => {
    const v = await publishedRule();
    const lib = await policyLibrary(db, clientId, projectId);
    expect(lib.documents[0]!.rules[0]).toMatchObject({ ruleKey: 'R-CA-JOINT', ruleVersionId: v.id, contentHash: v.contentHash });
  });

  it('a picker citation (rule key, version id, content hash) exports the same clause entry as a citation by rule id', async () => {
    const v = await publishedRule();
    const output = pickerOutput({ ruleId: 'R-CA-JOINT', ruleVersion: v.id, contentSha256: v.contentHash });
    expect(citedRuleVersions(output)).toEqual([{ ruleKey: 'R-CA-JOINT', ruleVersionId: v.id, contentSha256: v.contentHash }]);
    // The picker citation is not a rule-id citation, so the D-056 id map neither reads nor flags it.
    expect(citedRules(output)).toEqual([]);
    expect(mapRecordPolicies({ output } as never, null)).toEqual({ mapped: [], unmapped: [] });

    const byPicker = (await policyClausesFor(db, { clientId, projectId, output })).map((c) => c.entry);
    const byId = (await policyClausesFor(db, { clientId, projectId, output: { sections: { S4: { statePolicies: [{ ruleId: v.ruleId, contentSha256: v.contentHash }] } } } })).map((c) => c.entry);
    expect(byPicker).toEqual(byId);
    expect(byPicker).toEqual([
      {
        clause_id: 'R-CA-JOINT',
        version: v.version,
        title: 'CA joint ID',
        obligation: QUOTE,
        source: { document_id: expect.any(String), document_version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), quote: QUOTE },
        approval: { approval_id: v.id, project_id: projectId, approved_by: expect.any(String), approved_at: expect.any(String) },
        condition: CA,
      },
    ]);
    // Pinned per revision, as for rule-id citations.
    expect(await policyClausesFor(db, { clientId, projectId, output, createdAt: new Date(v.reviewedAt!.getTime() - 1000) })).toEqual([]);
    expect(await referenceProblems(db, { clientId, output })).toEqual([]);
  });

  it('never guesses: a hash that is not the version’s, another rule’s key or an unknown version is not exported and is flagged', async () => {
    const v = await publishedRule();
    const bad = [
      pickerOutput({ ruleId: 'R-CA-JOINT', ruleVersion: v.id, contentSha256: 'f'.repeat(64) }),
      pickerOutput({ ruleId: 'R-OTHER', ruleVersion: v.id, contentSha256: v.contentHash }),
      pickerOutput({ ruleId: 'R-CA-JOINT', ruleVersion: randomUUID(), contentSha256: v.contentHash }),
    ];
    for (const output of bad) {
      expect(await policyClausesFor(db, { clientId, projectId, output })).toEqual([]);
      const p = await referenceProblems(db, { clientId, output });
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ code: 'UNRESOLVED_CLAUSE', section: 'S4', severity: 'blocking', owner: 'author' });
    }
  });

  it('a citation picked before the hash was stored still resolves by its exact version id; a version approved after the task is flagged for the PM', async () => {
    const v = await publishedRule();
    const legacy = pickerOutput({ ruleId: 'R-CA-JOINT', ruleVersion: v.id });
    expect(citedRuleVersions(legacy)).toEqual([{ ruleKey: 'R-CA-JOINT', ruleVersionId: v.id, contentSha256: null }]);
    expect((await policyClausesFor(db, { clientId, projectId, output: legacy })).map((c) => c.entry.version)).toEqual([v.version]);
    const early = await referenceProblems(db, { clientId, output: legacy, record: { templateId: 'x', templateVersion: 1, createdAt: new Date(v.reviewedAt!.getTime() - 1000) } });
    expect(early).toEqual([expect.objectContaining({ code: 'UNRESOLVED_CLAUSE', owner: 'pm' })]);
    expect(early[0]!.message).toContain('was not approved when the task was approved');
  });

  it('document citations and rule-id citations keep their behaviour (a typed key with a non-UUID version is ignored as before)', async () => {
    const typed = pickerOutput({ ruleId: 'PR1', ruleVersion: 'v1', contentSha256: 'a'.repeat(64) });
    expect(citedRuleVersions(typed)).toEqual([]);
    expect(citedRules(typed)).toEqual([{ ruleId: 'PR1', contentSha256: 'a'.repeat(64) }]);
    expect(await policyClausesFor(db, { clientId, projectId, output: typed })).toEqual([]);
    expect(await referenceProblems(db, { clientId, output: typed })).toEqual([]);
  });
});
