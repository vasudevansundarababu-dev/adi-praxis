import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1, A4 (owner, 25 Nov 2026; contract C1 policy-library.v1 at Studio 1ba841d): the policy library export.
 * Every approved rule of the project (distractors included, drafts never) with its whole chain of approved versions,
 * oldest first, each with its text, text SHA-256, condition, effective mode, source quote and approval. Checked against
 * Studio's C1 schema. The same library exports the same bytes; earlier versions never change. Synthetic text only.
 */
const read = (p: string) => JSON.parse(readFileSync(new URL(`./fixtures/kyc-judgment/${p}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const C2 = read('kyc-judgment-openenv.fact-catalog.json') as unknown as FactCatalog;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const s of ['common.v1', 'clause-condition.v1', 'fact-catalog.v1']) ajv.addSchema(read(`schemas/${s}.schema.json`));
const validateC1 = ajv.compile(read('schemas/policy-library.v1.schema.json'));
const sha = (t: string) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
/**
 * C1 at 1ba841d has no `requirement`, `source_text` or `source_text_sha256` yet (coordinator, 25 Nov: export both;
 * Studio adds them to the contract). Until then the schema check runs on the library without those three fields.
 */
const withoutNewFields = (lib: { rules: { versions: Record<string, unknown>[] }[] }) => ({ ...lib, rules: lib.rules.map((r) => ({ ...r, versions: r.versions.map(({ requirement: _r, source_text: _s, source_text_sha256: _h, ...v }) => v) })) });

const FEDERAL = ['Synthetic federal text', 'A U.S. person is a U.S. citizen.', 'Each U.S. person must give a taxpayer identification number.', 'Banks must report cash transactions over 10,000 dollars.', 'Keep a copy of each identity document.'].join('\n');
const BANK = ['Synthetic bank operating choices', 'If a minor party has no taxpayer ID on file, request it.', 'Rule GB-03 is withdrawn: a minor’s taxpayer ID is collected after the account opens.'].join('\n');
const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };
const LIB = { kind: 'regulation', issuer: 'federal', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening', customer_types: ['individual'], product_lines: ['deposit'] } };
const OPENING = { fact: 'process', op: 'eq', value: 'account_opening' };

let app: FastifyInstance;
let pmCookie: string;
let pmId: string;
let projectId: string;
const docs: Record<string, { documentId: string; versionId: string }> = {};
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage() });
});
afterAll(async () => {
  await app.close();
});

async function doc(key: string, title: string, text: string, jurisdiction: string, library: Record<string, unknown>) {
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title, text, format: 'txt', granularity: 'line', jurisdiction, effectiveFrom: '2026-01-01' });
  expect(d.statusCode, d.body).toBe(201);
  const documentId = (await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: d.json().version.id } })).documentId;
  const meta = await api(pmCookie).put(`/projects/${projectId}/policy/documents/${documentId}/library`, library);
  expect(meta.statusCode, meta.body).toBe(200);
  docs[key] = { documentId, versionId: d.json().version.id };
}
async function rule(key: string, d: string, quote: string, extra: Record<string, unknown>, apply = true) {
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId: docs[d]!.versionId, ruleKey: key, body: { ...BASE, title: key, requirement: quote, ...extra }, citations: [{ fieldPath: 'requirement', role: 'supports', quote }] });
  expect(r.statusCode, r.body).toBe(201);
  if (!apply) return r.json() as { ruleId: string; contentHash: string };
  const a = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.json().ruleId}/applied`, { applied: true, expectedContentHash: r.json().contentHash });
  expect(a.statusCode, a.body).toBe(200);
  return { ruleId: r.json().ruleId as string, contentHash: a.json().contentHash as string };
}
const line = (t: string, n: number) => t.split('\n')[n]!;

beforeEach(async () => {
  await resetDb();
  const clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  pmId = pm.id;
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC judgment' } });
  projectId = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC judgment' } })).id;
  pmCookie = await login(app, pm.email);
  expect((await api(pmCookie).put(`/projects/${projectId}/policy/fact-catalog`, C2)).statusCode).toBe(201);
  await doc('federal', 'Synthetic federal text', FEDERAL, 'US', { kind: 'official_text', captureSourceUrl: 'https://example.invalid/federal', captureDownloadedOn: '2026-11-20' });
  await doc('bank', 'Synthetic bank operating choices', BANK, 'US', { kind: 'bank_policy' });
});

/** The library used by most tests: a definition, a party rule naming the derived fact, a changed bank rule, a distractor. */
async function library() {
  await rule('US-PERSON-DEFINITION', 'federal', line(FEDERAL, 1), { condition: null, library: { ...LIB, subject: 'case', defines: { id: 'us_person', type: 'boolean', definition: { fact: 'citizenship', op: 'in', value: ['US'] } } } });
  await rule('TIN', 'federal', line(FEDERAL, 2), { condition: { all: [OPENING, { fact: 'us_person', op: 'eq', value: true }] }, library: LIB });
  const gb = await rule('GB-03', 'bank', line(BANK, 1), { condition: { all: [OPENING, { fact: 'party_role', op: 'eq', value: 'minor' }] }, library: { ...LIB, kind: 'business_rule', issuer: 'bank' } });
  // Version 2 withdraws it, published only by a scenario event.
  const v2 = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${gb.ruleId}`, { expectedContentHash: gb.contentHash, body: { ...BASE, title: 'GB-03', requirement: line(BANK, 2), condition: { all: [OPENING, { fact: 'party_role', op: 'eq', value: 'minor' }] }, library: { ...LIB, kind: 'business_rule', issuer: 'bank', effect: 'withdrawn', effectiveMode: 'scenario_only', change: { kind: 'withdraws', summary: 'The TIN request before opening is withdrawn.' } } }, citations: [{ documentVersionId: docs.bank!.versionId, fieldPath: 'requirement', role: 'supports', quote: line(BANK, 2) }] });
  expect(v2.statusCode, v2.body).toBe(200);
  expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${gb.ruleId}/applied`, { applied: true, expectedContentHash: v2.json().contentHash })).statusCode).toBe(200);
  await rule('CTR', 'federal', line(FEDERAL, 3), { condition: { fact: 'process', op: 'eq', value: 'currency_transaction_reporting' }, library: { ...LIB, subject: 'case', scope: { process: 'currency_transaction_reporting' } } });
  // Never exported: a draft, and an excluded rule.
  await rule('DRAFT-ONLY', 'federal', line(FEDERAL, 4), { condition: null, library: LIB }, false);
  const ex = await rule('EXCLUDED', 'federal', line(FEDERAL, 4), { condition: null, library: LIB }, false);
  const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: ex.ruleId } });
  expect((await api(pmCookie).post(`/projects/${projectId}/policy/rule-versions/${v.id}/exclude`, { expectedContentHash: v.contentHash, reason: 'Badly extracted.' })).statusCode).toBe(200);
  return gb;
}
const exportNow = () => api(pmCookie).post(`/projects/${projectId}/policy/library-exports`, {});

describe('A4: the policy library export (C1)', () => {
  it('exports every approved rule with its whole chain, valid against Studio’s C1 schema', async () => {
    await library();
    const res = await exportNow();
    expect(res.statusCode, res.body).toBe(201);
    const lib = res.json().library;
    expect(validateC1(withoutNewFields(lib)), JSON.stringify(validateC1.errors)).toBe(true);
    // Both texts travel: the PM-approved wording (also `text`, the identity) and the verbatim source passage.
    for (const r of lib.rules) for (const v of r.versions) expect([v.requirement === v.text, v.source_text_sha256 === sha(v.source_text)]).toEqual([true, true]);
    expect(lib).toMatchObject({ schema_version: 'adi.utility.policy-library.v1', library_id: `project-${projectId}.library`, fact_catalog: 'kyc-judgment-openenv.facts@1', export: { project_id: projectId, library_revision: 1, exported_by: pmId } });
    expect(lib.rules.map((r: { rule_id: string }) => r.rule_id)).toEqual(['R-CTR', 'R-GB-03', 'R-TIN', 'R-US-PERSON-DEFINITION']);
    const gb = lib.rules.find((r: { rule_id: string }) => r.rule_id === 'R-GB-03');
    expect(gb).toMatchObject({ kind: 'business_rule', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } });
    expect(gb.versions.map((v: { version: number; supersedes?: number; effect: string; effective: unknown }) => [v.version, v.supersedes ?? null, v.effect, v.effective])).toEqual([
      [1, null, 'obligation', { mode: 'from_date', from: '2026-01-01' }],
      [2, 1, 'withdrawn', { mode: 'scenario_only' }],
    ]);
    expect(gb.versions[1].change).toEqual({ kind: 'withdraws', summary: 'The TIN request before opening is withdrawn.' });
    for (const r of lib.rules) for (const v of r.versions) expect(v.text_sha256).toBe(sha(v.text));
    expect(gb.versions[0]).toMatchObject({ text: line(BANK, 1), source_text: line(BANK, 1), source: { document_id: docs.bank!.documentId, document_version: 1, quote: line(BANK, 1) }, approval: { state: 'approved', approved_by: pmId } });
    expect(lib.derived_facts).toEqual([{ id: 'us_person', type: 'boolean', definition: { fact: 'citizenship', op: 'in', value: ['US'] }, defined_by: { rule_id: 'R-US-PERSON-DEFINITION', version: 1 } }]);
    expect(lib.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ document_id: docs.federal!.documentId, kind: 'official_text', jurisdiction: 'US', capture: { source_url: 'https://example.invalid/federal', downloaded_on: '2026-11-20', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } }),
      expect.objectContaining({ document_id: docs.bank!.documentId, kind: 'bank_policy', jurisdiction: 'US' }),
    ]));
    const fed = lib.documents.find((d: { document_id: string }) => d.document_id === docs.federal!.documentId);
    expect(fed.capture.sha256).toBe(fed.sha256);
    // The owner's mandatory marking never travels (C1 has no such field).
    expect(JSON.stringify(lib)).not.toContain('marking');
  });

  it('the same library exports the same bytes; a change is the next revision; earlier versions never change', async () => {
    const gb = await library();
    const first = await exportNow();
    const again = await exportNow();
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ revision: 1, unchanged: true, sha256: first.json().sha256 });
    const raw1 = await api(pmCookie).get(`/projects/${projectId}/policy/library-exports/1`);
    expect(raw1.statusCode).toBe(200);
    expect(createHash('sha256').update(raw1.rawPayload).digest('hex')).toBe(first.json().sha256);
    expect(raw1.headers['x-policy-library-sha256']).toBe(first.json().sha256);
    const v1 = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: gb.ruleId, version: 1 } });
    await rule('ADDRESS', 'federal', line(FEDERAL, 4), { condition: OPENING, library: LIB });
    const second = await exportNow();
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ revision: 2 });
    expect(second.json().library.rules.map((r: { rule_id: string }) => r.rule_id)).toContain('R-ADDRESS');
    expect(await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: gb.ruleId, version: 1 } })).toEqual(v1);
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/library-exports`)).json().items.map((e: { revision: number }) => e.revision)).toEqual([2, 1]);
    await expect(db.$executeRaw`DELETE FROM "PolicyLibraryExport"`).rejects.toThrow();
  });

  it('refuses, with the list, when an approved rule or its document is not complete for C1; nothing is stored', async () => {
    await rule('NO-CONDITION', 'federal', line(FEDERAL, 2), { library: LIB });
    await rule('NO-LIBRARY', 'federal', line(FEDERAL, 3), { condition: null });
    const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Unclassified', text: 'Unclassified\nAlways keep records.', format: 'txt', granularity: 'line', jurisdiction: 'Narnia' });
    docs.other = { documentId: '', versionId: d.json().version.id };
    await rule('ODD-DOC', 'other', 'Always keep records.', { condition: null, library: LIB });
    const res = await exportNow();
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('LIBRARY_NOT_EXPORTABLE');
    const problems = res.json().details.problems.join('\n');
    expect(problems).toContain('R-NO-CONDITION v1: the condition is not set');
    expect(problems).toMatch(/R-NO-LIBRARY: missing kind, issuer, jurisdiction, subject, scope/);
    expect(problems).toMatch(/Unclassified: no document kind/);
    expect(problems).toMatch(/Unclassified: jurisdiction "Narnia" is not an ISO code/);
    expect(await db.policyLibraryExport.count()).toBe(0);
  });

  it('an official text needs its capture (where and when it was downloaded); no catalog means nothing to check conditions against', async () => {
    await rule('TIN', 'federal', line(FEDERAL, 2), { condition: OPENING, library: LIB });
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/documents/${docs.federal!.documentId}/library`, { kind: 'official_text' })).statusCode).toBe(422);
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/documents/${docs.federal!.documentId}/library`, { kind: 'bank_policy', jurisdiction: 'California' })).json()).toMatchObject({ kind: 'bank_policy', jurisdiction: 'US-CA' });
  });
});
