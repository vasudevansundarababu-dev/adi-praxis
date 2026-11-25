import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { FixedCoverageClient } from '../src/anvil/coverage-client';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A3 (owner, 25 Nov 2026): the PM's review queue. Every draft shows its text and condition beside the
 * source quote, with flags from the readiness checks, the condition and library checks, Studio's coverage answer (stored
 * per version) and the AI's open questions. Unflagged rules can be confirmed in one batch: the PM confirms, never the AI,
 * and a batch with one flagged or stale rule changes nothing. Synthetic policy text only.
 */
const C2 = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8')) as FactCatalog;
const POLICY = ['Synthetic bank policy', 'Each applicant must give a taxpayer ID.', 'When an account is opened.', 'California applicants must show a California-compliant ID.', 'Keep records for five years.'].join('\n');
const line = (n: number) => POLICY.split('\n')[n]!;
const LIB = { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } };
const OPENING = { fact: 'process', op: 'eq', value: 'account_opening' };
const COMPLETE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: false, actors: ['The bank'], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: line(2) }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: '2026-01-01', to: null, conditionText: null }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [], condition: OPENING, library: LIB };
const coverage = { schema_version: 'adi.utility.coverage-check.v1', environment_version_id: 'kyc-judgment-openenv@1', checked_at: '2026-11-25T14:00:00Z', edge_cases: [], clauses: [{ clause_id: 'R-COMPLETE', version: 1, status: 'supported', gaps: [] }, { clause_id: 'R-GAP', version: 1, status: 'needs_environment_change', gaps: [{ kind: 'fact', ref: 'process', message: 'The environment has no process fact yet.' }] }] };

let app: FastifyInstance;
let clientId: string;
let pmCookie: string;
let projectId: string;
let docVersionId: string;
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown, key: Record<string, string> = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...key }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage(), coverageClient: new FixedCoverageClient(coverage) });
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
  expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2)).statusCode).toBe(201);
});

async function rule(key: string, over: Record<string, unknown> = {}, quoteCondition = true) {
  const citations = [{ fieldPath: 'requirement', role: 'supports', quote: line(1) }, ...(quoteCondition ? [{ fieldPath: 'applicability.conditionText', role: 'qualifies', quote: line(2) }] : [])];
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: docVersionId, ruleKey: key, body: { ...COMPLETE, title: key, requirement: line(1), ...over }, citations });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; contentHash: string };
}
const queue = async () => (await api(pmCookie).get(`/projects/${projectId}/policy/review-queue`)).json() as { items: Array<{ ruleKey: string; ruleId: string; contentHash: string; flags: { code: string; message: string }[]; quotes: { quote: string }[]; conditionText: string; coverage: unknown; requirement: string }> };
const codes = async () => Object.fromEntries((await queue()).items.map((i) => [i.ruleKey, i.flags.map((f) => f.code)]));

describe('A3: the review queue', () => {
  it('lists drafts with the source quote beside the text and condition; flags what needs a careful read; flagged first', async () => {
    await rule('COMPLETE');
    const { condition: _c, ...noCondition } = COMPLETE;
    await rule('NO-CONDITION', { condition: undefined, ...noCondition, title: 'NO-CONDITION' });
    await rule('UNQUOTED', {}, false);
    await rule('NO-LIBRARY', { library: { kind: 'policy' } });
    await rule('NO-DATE', { effective: { from: null, to: null, conditionText: 'always' } });
    const q = await queue();
    expect(q.items.map((i) => i.ruleKey).at(-1)).toBe('R-COMPLETE');
    const c = await codes();
    expect(c['R-COMPLETE']).toEqual([]);
    expect(c['R-NO-CONDITION']).toEqual(['condition_not_set']);
    expect(c['R-UNQUOTED']).toEqual(expect.arrayContaining(['condition_not_quoted', 'not_ready']));
    expect(c['R-NO-LIBRARY']).toEqual(['library_incomplete']);
    expect(c['R-NO-DATE']).toEqual(['no_effective_date']);
    const complete = q.items.find((i) => i.ruleKey === 'R-COMPLETE')!;
    expect(complete).toMatchObject({ requirement: line(1), conditionText: expect.stringContaining('account_opening'), quotes: expect.arrayContaining([expect.objectContaining({ quote: line(1) }), expect.objectContaining({ quote: line(2) })]) });
    expect(q.items.find((i) => i.ruleKey === 'R-NO-LIBRARY')!.flags[0]!.message).toMatch(/issuer.*jurisdiction.*subject.*scope/);
  });

  it('an approved or excluded rule is not in the queue; the AI’s open question or a needs-review disposition is a flag', async () => {
    const done = await rule('DONE');
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${done.ruleId}/applied`, { applied: true, expectedContentHash: done.contentHash })).statusCode).toBe(200);
    const asked = await rule('ASKED');
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: asked.ruleId } });
    await db.policyRuleSuggestion.create({ data: { clientId, projectId, ruleId: asked.ruleId, ruleVersionId: v.id, contentHash: v.contentHash, source: 'enrichment', model: 'm', promptVersion: 'enrichment/1', content: { question: 'Does this apply to minors?' }, problems: [], createdById: 'x' } });
    await db.policyRuleSuggestion.create({ data: { clientId, projectId, ruleId: asked.ruleId, ruleVersionId: v.id, contentHash: v.contentHash, source: 'disposition', model: 'm', promptVersion: 'dispositions/1', content: { disposition: 'needs_review', question: 'In scope?' }, problems: [], createdById: 'x' } });
    const c = await codes();
    expect(Object.keys(c)).toEqual(['R-ASKED']);
    expect(c['R-ASKED']).toEqual(expect.arrayContaining(['open_question', 'needs_review']));
  });

  it('a new version of an approved rule must say how it changes the version before it (C1 change)', async () => {
    const r = await rule('CHANGED');
    const applied = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/applied`, { applied: true, expectedContentHash: r.contentHash });
    const v2 = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}`, { expectedContentHash: applied.json().contentHash, body: { ...COMPLETE, title: 'CHANGED', requirement: line(1), verificationHint: 'Ask each applicant.' } });
    expect(v2.statusCode, v2.body).toBe(200);
    expect((await codes())['R-CHANGED']).toEqual(['change_missing']);
    const v3 = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}`, { expectedContentHash: v2.json().contentHash, body: { ...COMPLETE, title: 'CHANGED', requirement: line(1), verificationHint: 'Ask each applicant.', library: { ...LIB, change: { kind: 'clarifies', summary: 'Says to ask each applicant.' } } } });
    expect(v3.statusCode, v3.body).toBe(200);
    expect((await codes())['R-CHANGED']).toEqual([]);
  });
});

describe('A3: Studio’s coverage on draft conditions, stored per version', () => {
  it('sends every draft’s condition with its version; stores each answer for that version and hash; a new version needs a new check', async () => {
    const ok = await rule('COMPLETE');
    const gap = await rule('GAP');
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/review-queue/coverage`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ connected: true, checked: 2, stored: 2 });
    expect(await db.policyCoverageResult.count({ where: { projectId } })).toBe(2);
    const c = await codes();
    expect(c['R-COMPLETE']).toEqual([]);
    expect(c['R-GAP']).toEqual(['coverage_needs_environment_change']);
    expect((await queue()).items.find((i) => i.ruleKey === 'R-GAP')!.flags[0]!.message).toContain('The environment has no process fact yet.');
    await expect(db.$executeRaw`DELETE FROM "PolicyCoverageResult"`).rejects.toThrow();
    // An edit makes a new content hash: the stored answer no longer describes it.
    const edited = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${gap.ruleId}`, { expectedContentHash: gap.contentHash, body: { ...COMPLETE, title: 'GAP', requirement: line(1), verificationHint: 'x' } });
    expect(edited.statusCode).toBe(200);
    expect((await codes())['R-GAP']).toEqual([]);
    expect((await queue()).items.find((i) => i.ruleKey === 'R-GAP')!.coverage).toBeNull();
    void ok;
  });
});

describe('A3: bulk confirm (the PM’s approval, never the AI’s)', () => {
  it('applies every unflagged rule in one command, audited per rule; a repeat replays; the queue empties', async () => {
    const a = await rule('A');
    const b = await rule('B');
    const key = idem();
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items: [{ ruleId: a.ruleId, expectedContentHash: a.contentHash }, { ruleId: b.ruleId, expectedContentHash: b.contentHash }] }, key);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ applied: 2 });
    expect((await db.policyRuleVersion.findMany({ where: { ruleId: { in: [a.ruleId, b.ruleId] } } })).map((v) => v.state)).toEqual(['REVIEWED', 'REVIEWED']);
    expect(await db.auditEvent.count({ where: { action: 'policy.rule_applied' } })).toBe(2);
    expect(await db.auditEvent.count({ where: { action: 'policy.rules_applied_batch' } })).toBe(1);
    const again = await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items: [{ ruleId: a.ruleId, expectedContentHash: a.contentHash }, { ruleId: b.ruleId, expectedContentHash: b.contentHash }] }, key);
    expect(again.json()).toEqual(res.json());
    expect(await db.auditEvent.count({ where: { action: 'policy.rule_applied' } })).toBe(2);
    expect((await queue()).items).toEqual([]);
  });

  it('one flagged, stale or unknown rule refuses the whole batch, with the list; nothing changes', async () => {
    const a = await rule('A');
    const flagged = await rule('UNQUOTED', {}, false);
    const batches = [
      [{ ruleId: a.ruleId, expectedContentHash: a.contentHash }, { ruleId: flagged.ruleId, expectedContentHash: flagged.contentHash }],
      [{ ruleId: a.ruleId, expectedContentHash: 'f'.repeat(64) }],
      [{ ruleId: a.ruleId, expectedContentHash: a.contentHash }, { ruleId: randomUUID(), expectedContentHash: a.contentHash }],
    ];
    for (const items of batches) {
      const res = await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('BATCH_REFUSED');
      expect(res.json().details.refused.length).toBeGreaterThan(0);
    }
    expect(await db.policyRuleVersion.count({ where: { state: 'REVIEWED' } })).toBe(0);
  });
});
