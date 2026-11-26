import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FactCatalog } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { createDomainEventsQueue, dispatchOutboxBatch } from '../src/outbox/dispatcher';
import { POLICY_EVENT_NAMES } from '../src/policy-worker-events';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Policy page redesign (D-090, D-091, D-092; owner 26 Nov 2026: "Yes, build it"). Synthetic policy text only.
 * - D-090: a document's library details and its in-force date stay editable after upload; a rule without its own date
 *   takes its document's date (its own date wins), in the queue's checks and the export alike; jurisdictions are real
 *   ISO 3166 codes ("US-A" is refused).
 * - D-091: in a policy-library project (KYC Judgment) the review queue is the one approval route: the server refuses to
 *   mark a flagged rule Reviewed by the tick or by Mark reviewed, with the same check as Confirm selected. Other projects
 *   keep the tick as it was.
 * - D-092: each queue row says what to do next, in a fixed order; the US-person warning names the rule to approve; the
 *   AI suggestions step gives its estimate first and says plainly when no worker has picked the job up.
 */
const C2 = JSON.parse(readFileSync(new URL('./fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8')) as FactCatalog;
const POLICY = ['Synthetic bank policy', 'Each applicant must give a taxpayer ID.', 'When an account is opened.', 'For customer identification, a US person is a US citizen.', 'Keep records for five years.'].join('\n');
const line = (n: number) => POLICY.split('\n')[n]!;
const LIB = { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } };
const OPENING = { fact: 'process', op: 'eq', value: 'account_opening' };
const COMPLETE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: false, actors: ['The bank'], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: line(2) }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: '2026-01-01', to: null, conditionText: null }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [], condition: OPENING, library: LIB };
const NO_DATE = { ...COMPLETE, effective: { from: null, to: null, conditionText: null } };

let app: FastifyInstance;
let clientId: string;
let pmCookie: string;
let adminCookie: string;
let projectId: string;
let documentId: string;
let docVersionId: string;
const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown, key: Record<string, string> = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...key }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

beforeAll(async () => {
  app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage: new MemoryStorage() });
});
afterAll(async () => {
  await app.close();
});

/** A KYC Judgment template binds the environment's facts (execution.policy_bindings), as the published v4 does. */
const BINDS = { execution: { policy_bindings: { fact_catalog: 'kyc-judgment-openenv.facts@1', facts: [{ fact: 'process', type: 'enum', allowed_values: ['account_opening'] }, { fact: 'citizenship', type: 'string' }] } } };

async function project(name: string, withCatalog: boolean, bindsFacts = withCatalog) {
  const pm = await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'PM' } } });
  const domain = await db.domain.create({ data: { clientId, name: `Banking ${name}` } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: name, ...(bindsFacts ? { anvilSpec: BINDS } : {}) } });
  const id = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name } })).id;
  const d = await api(pmCookie).post(`/projects/${id}/policy/documents/text`, { title: `Synthetic policy ${name}`, text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  const versionId = d.json().version.id as string;
  const docId = (await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: versionId } })).documentId;
  if (withCatalog) expect((await api(pmCookie).put(`/projects/${id}/policy/fact-catalog`, C2)).statusCode).toBe(201);
  return { id, docId, versionId };
}

beforeEach(async () => {
  await resetDb();
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  const admin = await createUser(clientId, ['ADMIN']);
  pmCookie = await login(app, pm.email);
  adminCookie = await login(app, admin.email);
  const p = await project('KYC judgment', true);
  projectId = p.id;
  documentId = p.docId;
  docVersionId = p.versionId;
});

async function rule(key: string, body: Record<string, unknown> = COMPLETE, opts: { project?: string; versionId?: string; quoteCondition?: boolean; requirement?: string } = {}) {
  const requirement = opts.requirement ?? line(1);
  const citations = [{ fieldPath: 'requirement', role: 'supports', quote: requirement }, ...(opts.quoteCondition === false ? [] : [{ fieldPath: 'applicability.conditionText', role: 'qualifies', quote: line(2) }])];
  const r = await api(pmCookie).post(`/projects/${opts.project ?? projectId}/policy/rules`, { documentVersionId: opts.versionId ?? docVersionId, ruleKey: key, body: { ...body, title: key, requirement }, citations });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; contentHash: string };
}
interface Row { ruleKey: string; ruleId: string; contentHash: string; state: string; jurisdiction: string | null; documents: { id: string; title: string }[]; nextAction: { code: string; label: string; focus: string | null }; flags: { code: string }[] }
const queue = async (pid = projectId) => (await api(pmCookie).get(`/projects/${pid}/policy/review-queue`)).json() as { items: Row[]; approvalRoute: string; counts: { rules: number; approved: number }; projectFlags: { code: string; message: string; rule?: { ruleId: string; ruleKey: string } | null }[] };
const row = async (key: string) => (await queue()).items.find((i) => i.ruleKey === key)!;
const setLibrary = (body: Record<string, unknown>, docId = documentId, pid = projectId) => api(pmCookie).put(`/projects/${pid}/policy/documents/${docId}/library`, body);

describe('D-090: document details stay editable; the in-force date; real ISO jurisdictions', () => {
  it('kind, jurisdiction, source, downloaded on and in force from are saved, changed and cleared after upload, audited', async () => {
    const first = await setLibrary({ kind: 'official_text', jurisdiction: 'US', captureSourceUrl: 'https://example.gov/cip', captureDownloadedOn: '2026-11-20', effectiveFrom: '2026-01-01' });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ kind: 'official_text', jurisdiction: 'US', effectiveFrom: '2026-01-01' });
    const second = await setLibrary({ kind: 'bank_policy', jurisdiction: 'US-CA', effectiveFrom: '2026-03-01' });
    expect(second.statusCode, second.body).toBe(200);
    const d = await db.policyDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(d).toMatchObject({ libraryKind: 'bank_policy', jurisdiction: 'US-CA', captureSourceUrl: null, captureDownloadedOn: null });
    expect(d.effectiveFrom?.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect((await setLibrary({ kind: 'bank_policy', effectiveFrom: null })).statusCode).toBe(200);
    expect((await db.policyDocument.findUniqueOrThrow({ where: { id: documentId } })).effectiveFrom).toBeNull();
    const audits = await db.auditEvent.findMany({ where: { entityId: documentId, action: 'policy.document_library_set' }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(3);
    expect(audits[1]!.after).toMatchObject({ effectiveFrom: '2026-03-01' });
    const listed = (await api(pmCookie).get(`/projects/${projectId}/policy/documents`)).json().items[0];
    expect(listed).toMatchObject({ libraryKind: 'bank_policy', jurisdiction: 'US-CA', effectiveFrom: null });
  });

  it('refuses a jurisdiction that only looks like an ISO code ("US-A"), and an impossible date; nothing changes', async () => {
    for (const jurisdiction of ['US-A', 'US-XX', 'UK', 'GB-ENG']) {
      const r = await setLibrary({ kind: 'bank_policy', jurisdiction });
      expect(r.statusCode, jurisdiction).toBe(422);
      expect(r.json().error).toBe('JURISDICTION_NOT_ISO');
    }
    expect((await setLibrary({ kind: 'bank_policy', effectiveFrom: '2026-02-30' })).statusCode).toBe(422);
    expect((await db.policyDocument.findUniqueOrThrow({ where: { id: documentId } })).jurisdiction).toBeNull();
    // Plain names still normalise to the ISO code, as before.
    const ok = await setLibrary({ kind: 'bank_policy', jurisdiction: 'California' });
    expect(ok.json().jurisdiction).toBe('US-CA');
  });

  it('a stored jurisdiction that is not real ISO (saved before this check) is a document problem in the export', async () => {
    await db.policyDocument.update({ where: { id: documentId }, data: { libraryKind: 'bank_policy', jurisdiction: 'US-A' } });
    const r = await rule('DATED');
    expect((await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items: [{ ruleId: r.ruleId, expectedContentHash: r.contentHash }] })).statusCode).toBe(200);
    const exp = await api(pmCookie).post(`/projects/${projectId}/policy/library-exports`, {});
    expect(exp.statusCode).toBe(422);
    expect(exp.json().details.problems.join(' ')).toContain('jurisdiction "US-A" is not an ISO code');
  });

  it('a rule saved with a jurisdiction that is not real ISO is refused', async () => {
    const r = await rule('R1');
    const res = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}`, { expectedContentHash: r.contentHash, body: { ...COMPLETE, title: 'R1', requirement: line(1), library: { ...LIB, jurisdiction: 'US-A' } } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('JURISDICTION_NOT_ISO');
  });

  it('a rule without its own date takes its document’s date in the queue and the export; its own date wins', async () => {
    const inherits = await rule('INHERITS', NO_DATE);
    await rule('OWN', { ...COMPLETE, effective: { from: '2025-06-01', to: null, conditionText: null } });
    expect((await row('R-INHERITS')).flags.map((f) => f.code)).toEqual(expect.arrayContaining(['no_effective_date', 'not_ready']));
    expect((await row('R-INHERITS')).nextAction.code).toBe('set_date');
    await setLibrary({ kind: 'bank_policy', jurisdiction: 'US', effectiveFrom: '2026-02-01' });
    expect((await row('R-INHERITS')).flags).toEqual([]);
    expect((await row('R-INHERITS')).nextAction).toMatchObject({ code: 'ready', label: 'Ready to confirm' });
    const q = await queue();
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items: q.items.map((i) => ({ ruleId: i.ruleId, expectedContentHash: i.contentHash })) });
    expect(res.statusCode, res.body).toBe(200);
    const exp = await api(pmCookie).post(`/projects/${projectId}/policy/library-exports`, {});
    expect(exp.statusCode, exp.body).toBe(201);
    const byKey = Object.fromEntries((exp.json().library.rules as { rule_id: string; versions: { effective: { from?: string } }[] }[]).map((r) => [r.rule_id, r.versions[0]!.effective.from]));
    expect(byKey).toEqual({ 'R-INHERITS': '2026-02-01', 'R-OWN': '2025-06-01' });
    void inherits;
  });
});

describe('D-091: one approval route in a policy-library project', () => {
  it('the queue says which route the project uses', async () => {
    expect((await queue()).approvalRoute).toBe('review_queue');
    const other = await project('Marketing', false);
    expect((await queue(other.id)).approvalRoute).toBe('apply_tick');
    // A fact catalog alone (clause conditions) does not make a policy-library project.
    const catalogOnly = await project('Clauses', true, false);
    expect((await queue(catalogOnly.id)).approvalRoute).toBe('apply_tick');
  });

  it('the tick and Mark reviewed refuse a flagged rule with the queue’s check; nothing changes; an unflagged rule still applies', async () => {
    const flagged = await rule('FLAGGED', { ...COMPLETE, library: { kind: 'policy' } });
    const tick = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${flagged.ruleId}/applied`, { applied: true, expectedContentHash: flagged.contentHash });
    expect(tick.statusCode).toBe(409);
    expect(tick.json().error).toBe('RULE_FLAGGED');
    expect(tick.json().message).toContain('library_incomplete');
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: flagged.ruleId } });
    const review = await api(adminCookie).post(`/projects/${projectId}/policy/rule-versions/${v.id}/review`, { expectedContentHash: v.contentHash });
    expect(review.statusCode).toBe(409);
    expect(review.json().error).toBe('RULE_FLAGGED');
    expect(await db.policyRuleVersion.count({ where: { state: 'REVIEWED' } })).toBe(0);
    expect(await db.auditEvent.count({ where: { action: 'policy.rule_applied' } })).toBe(0);
    const clean = await rule('CLEAN');
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${clean.ruleId}/applied`, { applied: true, expectedContentHash: clean.contentHash })).statusCode).toBe(200);
    // Unticking is never blocked: it only takes a rule out.
    const after = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: clean.ruleId, state: 'REVIEWED' } });
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${clean.ruleId}/applied`, { applied: false, expectedContentHash: after.contentHash })).statusCode).toBe(200);
  });

  it('another project type keeps the tick as before (the library flags do not apply there)', async () => {
    const other = await project('Marketing', false);
    const r = await rule('MKT', { ...COMPLETE, library: undefined, condition: undefined }, { project: other.id, versionId: other.versionId });
    const tick = await api(pmCookie).put(`/projects/${other.id}/policy/rules/${r.ruleId}/applied`, { applied: true, expectedContentHash: r.contentHash });
    expect(tick.statusCode, tick.body).toBe(200);
  });

  it('Confirm selected takes more than 200 rules in one all-or-nothing batch', async () => {
    const a = await rule('A');
    const items = [{ ruleId: a.ruleId, expectedContentHash: a.contentHash }, ...Array.from({ length: 260 }, () => ({ ruleId: randomUUID(), expectedContentHash: a.contentHash }))];
    const res = await api(pmCookie).post(`/projects/${projectId}/policy/rules/apply-batch`, { items });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('BATCH_REFUSED');
    expect(await db.policyRuleVersion.count({ where: { state: 'REVIEWED' } })).toBe(0);
  });
});

describe('D-092: the review queue as a table', () => {
  it('each row has its document, jurisdiction, status and the next action, in the fixed order', async () => {
    const { condition: _c, ...noCondition } = COMPLETE;
    await rule('NO-CONDITION', noCondition);
    await rule('NO-LIBRARY', { ...NO_DATE, library: { kind: 'policy' } });
    await rule('NO-DATE', NO_DATE);
    await rule('UNQUOTED', COMPLETE, { quoteCondition: false });
    await rule('MISQUOTED', COMPLETE, { requirement: 'A sentence that is not in the document.' });
    await rule('READY');
    const r = await rule('ASKED');
    const v = await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId: r.ruleId } });
    await db.policyRuleSuggestion.create({ data: { clientId, projectId, ruleId: r.ruleId, ruleVersionId: v.id, contentHash: v.contentHash, source: 'enrichment', model: 'm', promptVersion: 'enrichment/1', content: { question: 'Does this apply to minors?' }, problems: [], createdById: 'x' } });
    const next = Object.fromEntries((await queue()).items.map((i) => [i.ruleKey, i.nextAction.code]));
    expect(next).toEqual({
      'R-NO-CONDITION': 'set_condition',
      'R-NO-LIBRARY': 'fill_library',
      'R-NO-DATE': 'set_date',
      'R-UNQUOTED': 'link_quote',
      'R-MISQUOTED': 'check_quote',
      'R-ASKED': 'answer_question',
      'R-READY': 'ready',
    });
    const ready = await row('R-READY');
    expect(ready).toMatchObject({ state: 'DRAFT', jurisdiction: 'US', documents: [{ id: documentId, title: 'Synthetic policy KYC judgment' }], nextAction: { label: 'Ready to confirm', focus: null } });
    expect((await row('R-NO-LIBRARY')).nextAction).toMatchObject({ label: 'Fill in library details', focus: 'library' });
    expect((await row('R-NO-CONDITION')).nextAction).toMatchObject({ label: 'Set when it applies', focus: 'condition' });
    expect((await row('R-MISQUOTED')).nextAction).toMatchObject({ label: 'Check the quote', focus: 'quote' });
  });

  it('a rule without its own jurisdiction shows its document’s; the counts are for the checklist', async () => {
    await setLibrary({ kind: 'bank_policy', jurisdiction: 'US-CA' });
    await rule('NO-JUR', { ...COMPLETE, library: { ...LIB, jurisdiction: undefined } });
    const done = await rule('DONE');
    expect((await api(pmCookie).put(`/projects/${projectId}/policy/rules/${done.ruleId}/applied`, { applied: true, expectedContentHash: done.contentHash })).statusCode).toBe(200);
    const q = await queue();
    expect(q.items.find((i) => i.ruleKey === 'R-NO-JUR')!.jurisdiction).toBe('US-CA');
    expect(q.counts).toEqual({ rules: 2, approved: 1, excluded: 0 });
  });

  it('the US-person warning names the rule to approve, with a link target', async () => {
    const def = await rule('US-PERSON-DEFINITION', { ...COMPLETE, requirementType: 'definition' }, { requirement: line(3) });
    const pf = (await queue()).projectFlags;
    expect(pf).toHaveLength(1);
    expect(pf[0]).toMatchObject({ code: 'us_person_undefined', rule: { ruleId: def.ruleId, ruleKey: 'R-US-PERSON-DEFINITION' } });
    expect(pf[0]!.message).toContain('R-US-PERSON-DEFINITION');
    expect(pf[0]!.message).toContain('us_person');
  });
});

describe('D-092: AI suggestions as one step (estimate first; no silent queue)', () => {
  it('estimates the run for all drafts or one document’s, without calling a model; PMs see no cost figure (D7)', async () => {
    const other = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Second policy', text: POLICY, format: 'txt', granularity: 'line' });
    const otherVersion = other.json().version.id as string;
    const otherDoc = (await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: otherVersion } })).documentId;
    await rule('ONE');
    await rule('TWO');
    await rule('THREE', COMPLETE, { versionId: otherVersion });
    const all = await api(adminCookie).get(`/projects/${projectId}/policy/enrichment/estimate`);
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json()).toMatchObject({ rules: 3, calls: 1, model: expect.any(String) });
    expect(all.json().estimatedUsd).toBeGreaterThan(0);
    const one = (await api(adminCookie).get(`/projects/${projectId}/policy/enrichment/estimate?documentId=${otherDoc}`)).json();
    expect(one.rules).toBe(1);
    expect(one.estimatedUsd).toBeLessThan(all.json().estimatedUsd);
    const pm = (await api(pmCookie).get(`/projects/${projectId}/policy/enrichment/estimate`)).json();
    expect(pm.rules).toBe(3);
    expect(pm.estimatedUsd).toBeUndefined();
    expect(await db.auditEvent.count({ where: { action: { startsWith: 'policy.rule_enrichment' } } })).toBe(0);
  });

  it('a run no worker has picked up within 60 seconds says so', async () => {
    await rule('ONE');
    const start = await api(pmCookie).post(`/projects/${projectId}/policy/enrichment`, {});
    expect(start.statusCode, start.body).toBe(202);
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/enrichment`)).json().status).toBe('running');
    await db.outboxEvent.updateMany({ where: { name: 'policy.enrichment_requested' }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const late = (await api(pmCookie).get(`/projects/${projectId}/policy/enrichment`)).json();
    expect(late).toMatchObject({ status: 'no_worker', message: expect.stringContaining('No worker is running') });
    // Once a worker takes it, it is running again.
    await db.outboxEvent.updateMany({ where: { name: 'policy.enrichment_requested' }, data: { dispatchedAt: new Date() } });
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/enrichment`)).json().status).toBe('running');
  });

  it('extraction waiting for a worker for over 60 seconds says so too', async () => {
    const batch = await db.extractionBatch.create({ data: { clientId, projectId, idempotencyKey: randomUUID(), profileId: 'p', profileRevision: 1, profileSnapshot: {}, selectionSource: 'project', schemaHash: 'x', promptHash: 'x', requestedById: 'x' } });
    const job = await db.extractionJob.create({ data: { clientId, batchId: batch.id, documentVersionId: docVersionId, provider: 'llamaextract' } });
    const event = await db.outboxEvent.create({ data: { clientId, name: 'policy.extraction_requested', aggregateType: 'ExtractionJob', aggregateId: job.id, payload: { jobId: job.id } } });
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/extraction`)).json().workerMissing).toBe(false);
    await db.outboxEvent.update({ where: { id: event.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const ex = (await api(pmCookie).get(`/projects/${projectId}/policy/extraction`)).json();
    expect(ex).toMatchObject({ workerMissing: true, workerMessage: expect.stringContaining('No worker is running') });
  });
});

describe('D-089: the policy worker dispatches only policy events, onto its own queue', () => {
  it('leaves every other event for the full worker', async () => {
    const mk = (name: string) => db.outboxEvent.create({ data: { clientId, name, aggregateType: 'X', aggregateId: randomUUID(), payload: {} } });
    const policyEvent = await mk('policy.enrichment_requested');
    const other = await mk('task.accepted');
    const added: string[] = [];
    const fakeQueue = { addBulk: async (jobs: { name: string }[]) => void added.push(...jobs.map((j) => j.name)) } as unknown as ReturnType<typeof createDomainEventsQueue>;
    expect(await dispatchOutboxBatch(db, fakeQueue, 100, POLICY_EVENT_NAMES)).toBe(1);
    expect(added).toEqual(['policy.enrichment_requested']);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: policyEvent.id } })).dispatchedAt).not.toBeNull();
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: other.id } })).dispatchedAt).toBeNull();
    expect(POLICY_EVENT_NAMES).toEqual(['policy.extraction_requested', 'policy.annotation_requested', 'policy.enrichment_requested']);
  });
});
