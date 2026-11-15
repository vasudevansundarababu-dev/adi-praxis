import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PolicyRuleBody, ProjectPolicyManifest, RuleAnnotationInput, validateProjectPolicyManifest, type CandidateRule } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import { stableStringify } from '../src/lib/crypto';
import { annotateDocument, policyAnnotationHandler } from '../src/policy/annotate-job';
import { POLICY_AI_ACTIONS } from '../src/policy/ai-cap';
import { processExtractionJob, type Adapters } from '../src/policy/extraction/service';
import type { ExtractionAdapter, ProviderResult } from '../src/policy/extraction/types';
import { ANNOTATE_SYSTEM, MockRuleAssistant, type AnnotateInput, type AnnotationItem, type PolicyRuleAssistant } from '../src/policy/rule-assistant';
import { contentHash } from '../src/policy/rules';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Policy rule classification, mandatory marking and annotations (docs/prd/PRD-POLICY-RULE-ANNOTATIONS.md §8). The AI is
 * the deterministic MockRuleAssistant (plus scripted links for thresholds); no test calls a live model.
 */

/** Synthetic, fictional policy text. */
const POLICY = [
  'Synthetic KYC policy for a fictional bank.',
  'The bank may accept a passport as primary identification.',
  'The bank may accept a foreign passport only with a non-documentary check.',
  'The bank must verify the residential address unless the customer is a minor under 13.',
  'Staff must not open an account without a completed CIP record.',
  'Staff may not rely on a utility bill older than 90 days.',
  'A large deposit means a single cash deposit above USD 10,000.',
  'The bank must file a report within 15 days of any large deposit.',
  'For California joint accounts, each joint holder must provide a California-compliant ID.',
].join('\n');

const APP_TYPES = ['individual', 'adult_joint', 'teen_joint', 'custodial'];

/** Mock annotations, with the threshold link a model is asked to add (defines_threshold_for). */
class ScriptedAssistant extends MockRuleAssistant {
  calls = 0;
  inputs: AnnotateInput[] = [];
  override async annotate(i: AnnotateInput): Promise<AnnotationItem[]> {
    this.calls++;
    this.inputs.push(i);
    const out = await super.annotate(i);
    const link = (ruleKey: string, relation: 'defines_threshold_for' | 'uses_definition') => [{ ruleKey, relation, note: null }];
    return out.map((x) =>
      x.ruleKey === 'R-LARGE-DEPOSIT-DEF' ? { ...x, annotation: { ...x.annotation, links: link('R-LARGE-DEPOSIT-REPORT', 'defines_threshold_for') } } : x.ruleKey === 'R-LARGE-DEPOSIT-REPORT' ? { ...x, annotation: { ...x.annotation, links: link('R-LARGE-DEPOSIT-DEF', 'uses_definition') } } : x,
    );
  }
}

class OneRuleProvider implements ExtractionAdapter {
  constructor(readonly provider: 'llamaextract' | 'google') {}
  availability() {
    return [];
  }
  async submit() {
    return { operationId: 'op-1' };
  }
  async getStatus() {
    return { status: 'succeeded' as const };
  }
  async getResult(): Promise<ProviderResult> {
    const c = { ruleKey: 'PASSPORT', title: 'Passport', requirement: 'The bank may accept a passport as primary identification.', ...BASE, requirementType: 'permission', citations: [{ fieldPath: 'requirement', role: 'supports', quote: 'The bank may accept a passport as primary identification.', page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: 0.9 }] } as unknown as CandidateRule;
    return { raw: {}, candidates: [c], partial: false, usage: { pages: 1, credits: 1, inputTokens: null, outputTokens: null, actualUsd: 0.01 } };
  }
  async cleanup() {
    return 'deleted' as const;
  }
}


let app: FastifyInstance;
let storage: MemoryStorage;
let ai: ScriptedAssistant;
let clientId: string;
let pmId: string;
let pmCookie: string;
let adminCookie: string;
let projectId: string;
let documentId: string;
let documentVersionId: string;

const api = (cookie: string) => ({
  get: (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
  post: (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
  put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object }),
});

const BASE = { requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: ['case record'], verificationHint: null, uncertainty: [] };

async function addRule(ruleKey: string, requirement: string, quote: string, over: Record<string, unknown> = {}, extra: string[] = []) {
  const citations = [{ fieldPath: 'requirement', role: 'supports', quote }, ...extra.map((fieldPath) => ({ fieldPath, role: fieldPath === 'exceptions' ? 'exception' : 'supports', quote }))];
  const r = await api(pmCookie).post(`/projects/${projectId}/policy/rules`, { documentVersionId, ruleKey, body: { ...BASE, title: ruleKey, requirement, ...over }, citations });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { ruleId: string; ruleKey: string; versionId: string; contentHash: string };
}

async function setup() {
  const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic KYC policy', text: POLICY, format: 'txt', granularity: 'line' });
  expect(d.statusCode, d.body).toBe(201);
  documentId = d.json().document?.id ?? d.json().documentId ?? (await db.policyDocument.findFirstOrThrow({ where: { projectId } })).id;
  documentVersionId = d.json().version.id;
  const lines = POLICY.split('\n');
  await addRule('PASSPORT', 'The bank may accept a passport as primary identification.', lines[1]!);
  await addRule('FOREIGN-PASSPORT', 'The bank may accept a foreign passport.', lines[2]!);
  await addRule('FOREIGN-NDC', 'Perform a non-documentary check when a foreign passport is accepted.', lines[2]!, { applicability: { ...BASE.applicability, conditionText: 'When a foreign passport is accepted' } }, ['applicability.conditionText']);
  await addRule('ADDRESS', 'The bank must verify the residential address unless the customer is a minor under 13.', lines[3]!, { exceptions: { kind: 'listed', items: [{ statement: 'The customer is a minor under 13.', conditions: null }] } }, ['exceptions']);
  await addRule('NO-CIP', 'Staff must not open an account without a completed CIP record.', lines[4]!);
  await addRule('UTILITY-BILL', 'Staff may not rely on a utility bill older than 90 days.', lines[5]!);
  await addRule('LARGE-DEPOSIT-DEF', 'A large deposit means a single cash deposit above USD 10,000.', lines[6]!);
  await addRule('LARGE-DEPOSIT-REPORT', 'The bank must file a report within 15 days of any large deposit.', lines[7]!);
  await addRule('CA-JOINT', 'For California joint accounts, each joint holder must provide a California-compliant ID.', lines[8]!, { applicability: { ...BASE.applicability, universal: false, jurisdictions: ['US-CA'], conditionText: 'California joint accounts' } }, ['applicability.conditionText']);
}

const annotate = () => annotateDocument(db, { storage, assistant: ai, dailyCap: 100, capActions: POLICY_AI_ACTIONS }, { clientId, projectId, documentId, runId: randomUUID(), requestedById: pmId, requestedRoles: ['PM'], trigger: 'manual' });
const rules = async () => (await api(pmCookie).get(`/projects/${projectId}/policy/rules`)).json().items as Array<Record<string, any>>;
const byKey = async (k: string) => (await rules()).find((r) => r.ruleKey === `R-${k}`)!;
const apply = async (k: string) => {
  const r = await byKey(k);
  const res = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/applied`, { applied: true, expectedContentHash: r.contentHash });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

beforeAll(async () => {
  storage = new MemoryStorage();
  ai = new ScriptedAssistant();
  app = await buildApp({ config: testConfig({ POLICY_BUDGET_LLAMA_USD: '20', POLICY_BUDGET_GOOGLE_USD: '30' }), db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, ruleAssistant: ai as PolicyRuleAssistant, policyAdapters: { llamaextract: new OneRuleProvider('llamaextract'), google: new OneRuleProvider('google') } as Adapters });
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  storage.objects.clear();
  ai.calls = 0;
  ai.inputs = [];
  clientId = (await createClient()).id;
  const pm = await createUser(clientId, ['PM']);
  pmId = pm.id;
  const domain = await db.domain.create({ data: { clientId, name: 'Banking' } });
  const template = await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC onboarding and refresh', caseSelector: { field: 'product', source: 'S1.applicationType', values: APP_TYPES } } });
  projectId = (await db.project.create({ data: { clientId, ownerId: pm.id, templateId: template.id, templateVersion: 1, name: 'KYC New York examples' } })).id;
  pmCookie = await login(app, pm.email);
  adminCookie = await login(app, (await createUser(clientId, ['ADMIN'])).email);
});

describe('AI annotation pass: classification and mandatory marking (AC1–AC5)', () => {
  it('AC1: "may accept a passport" is a Permission / Permitted option, never a compulsory passport requirement', async () => {
    await setup();
    await annotate();
    const r = await byKey('PASSPORT');
    expect(r.annotation).toMatchObject({ classification: 'permission', marking: 'permitted_option' });
    expect(r.requirementType).toBe('permission');
    expect(r.annotationSource).toMatchObject({ source: 'AI_SUGGESTION' });
  });

  it('AC2: "may accept … only with a check" gives linked permission and conditional-obligation components with the original statement', async () => {
    await setup();
    await annotate();
    const p = (await byKey('FOREIGN-PASSPORT')).annotation;
    const c = (await byKey('FOREIGN-NDC')).annotation;
    expect(p).toMatchObject({ classification: 'permission', marking: 'permitted_option' });
    expect(c).toMatchObject({ classification: 'obligation', marking: 'mandatory_when_applicable', appliesWhen: 'When a foreign passport is accepted' });
    expect(p.compound.groupKey).toBe(c.compound.groupKey);
    expect(p.compound.originalStatement).toBe('The bank may accept a foreign passport only with a non-documentary check.');
    expect(p.links).toEqual([{ ruleKey: 'R-FOREIGN-NDC', relation: 'companion_of', note: null }]);
    expect(c.links).toEqual([{ ruleKey: 'R-FOREIGN-PASSPORT', relation: 'companion_of', note: null }]);
    // The table shows the reverse direction without editing the other rule.
    expect((await byKey('FOREIGN-NDC')).linkedFrom).toEqual([{ ruleKey: 'R-FOREIGN-PASSPORT', relation: 'companion_of' }]);
  });

  it('AC2: a compound statement the AI quotes inexactly is dropped, never stored as source text', async () => {
    await setup();
    const bad = new (class extends ScriptedAssistant {
      override async annotate(i: AnnotateInput) {
        return (await super.annotate(i)).map((x) => (x.annotation.compound ? { ...x, annotation: { ...x.annotation, compound: { ...x.annotation.compound, originalStatement: 'The bank may take any passport it likes.' } } } : x));
      }
    })();
    await annotateDocument(db, { storage, assistant: bad, dailyCap: 100, capActions: POLICY_AI_ACTIONS }, { clientId, projectId, documentId, runId: randomUUID(), requestedById: pmId, requestedRoles: ['PM'], trigger: 'manual' });
    expect((await byKey('FOREIGN-PASSPORT')).annotation.compound).toBeNull();
  });

  it('AC3: an obligation with an exception keeps both through edit, apply and publish', async () => {
    await setup();
    await annotate();
    const r = await byKey('ADDRESS');
    expect(r.annotation).toMatchObject({ classification: 'obligation' });
    const bodyOf = async (ruleId: string) => (await db.policyRuleVersion.findFirstOrThrow({ where: { ruleId }, orderBy: { version: 'desc' } })).body as { exceptions: unknown };
    expect((await bodyOf(r.ruleId)).exceptions).toEqual({ kind: 'listed', items: [{ statement: 'The customer is a minor under 13.', conditions: null }] });
    await apply('ADDRESS');
    expect((await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null })).statusCode).toBe(201);
    const after = await byKey('ADDRESS');
    expect(after.annotation).toMatchObject({ classification: 'obligation' });
    expect((await bodyOf(r.ruleId)).exceptions).toMatchObject({ kind: 'listed' });
  });

  it('AC4: "must not" stays a prohibition; "may not" is not turned into a permission', async () => {
    await setup();
    await annotate();
    expect((await byKey('NO-CIP')).annotation).toMatchObject({ classification: 'prohibition' });
    expect((await byKey('NO-CIP')).requirementType).toBe('prohibition');
    const mayNot = (await byKey('UTILITY-BILL')).annotation;
    expect(mayNot.classification).not.toBe('permission');
    expect(mayNot).toMatchObject({ classification: 'unresolved', marking: 'needs_clarification' });
  });

  it('AC5: a binding threshold stays linked to the rule that uses it; leaving the definition out flags the dependant', async () => {
    await setup();
    await annotate();
    expect((await byKey('LARGE-DEPOSIT-DEF')).annotation.links).toEqual([{ ruleKey: 'R-LARGE-DEPOSIT-REPORT', relation: 'defines_threshold_for', note: null }]);
    expect((await byKey('LARGE-DEPOSIT-REPORT')).linkedFrom).toEqual([{ ruleKey: 'R-LARGE-DEPOSIT-DEF', relation: 'uses_definition' }]);
    await apply('LARGE-DEPOSIT-REPORT');
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    const w = preview.annotationWarnings.find((x: { ruleKey: string }) => x.ruleKey === 'R-LARGE-DEPOSIT-REPORT');
    expect(w.flags.map((f: { code: string }) => f.code).filter((c: string) => c === 'UNRESOLVED_LINK')).toHaveLength(1);
    expect(preview.blocking).toEqual([]);
    // Once the definition is applied and published, the dependant's warning goes away (internal data only; no export).
    await apply('LARGE-DEPOSIT-DEF');
    const after = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    const w2 = after.annotationWarnings.find((x: { ruleKey: string }) => x.ruleKey === 'R-LARGE-DEPOSIT-REPORT');
    expect((w2?.flags ?? []).some((f: { code: string }) => f.code === 'UNRESOLVED_LINK')).toBe(false);
  });

  it('the prompt states every classification rule of the spec and forbids inventing details', () => {
    for (const s of ['"may accept X only with Y"', '"must ... unless ..."', '"must not ..."', '"may not ..."', '"should ..."', 'defines_threshold_for', 'Never invent conditions, deadlines, exceptions or evidence', 'A project name or an example state never limits', 'Never turn a human approval requirement into permission for the agent to approve', 'not approval or legal validation', 'does NOT mean the bank\'s obligation is optional']) expect(ANNOTATE_SYSTEM).toContain(s);
  });
});

describe('editable annotations, history and flags (AC6–AC8)', () => {
  it('AC6: every rule row carries an editable Mandatory marking, Applies when and Why (or Not annotated)', async () => {
    await setup();
    const before = await rules();
    expect(before.every((r) => r.annotation === null && r.flags[0].code === 'NOT_ANNOTATED')).toBe(true);
    await annotate();
    for (const r of await rules()) {
      expect(r.annotation.marking).toBeTruthy();
      expect('appliesWhen' in r.annotation && 'why' in r.annotation).toBe(true);
    }
    const r = await byKey('PASSPORT');
    const res = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation: { ...RuleAnnotationInput.parse(r.annotation), appliesWhen: 'A passport is offered as identification.', why: 'An allowed route; other documents remain acceptable.' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await byKey('PASSPORT')).annotation).toMatchObject({ marking: 'permitted_option', appliesWhen: 'A passport is offered as identification.', version: 2 });
  });

  it('AC7: an author edit keeps the source quotation and the original AI suggestion; history is append-only', async () => {
    await setup();
    await annotate();
    const r = await byKey('PASSPORT');
    const quoteBefore = (await db.policyCitation.findMany({ where: { ruleVersionId: r.versionId } })).map((c) => c.quote);
    await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation: { ...RuleAnnotationInput.parse(r.annotation), marking: 'mandatory', why: 'Edited by the PM for the test.' } });
    const after = await byKey('PASSPORT');
    expect((await db.policyCitation.findMany({ where: { ruleVersionId: after.versionId } })).map((c) => c.quote)).toEqual(quoteBefore);
    const detail = (await api(pmCookie).get(`/projects/${projectId}/policy/rules/${r.ruleId}`)).json();
    expect(detail.annotationHistory.map((h: { annotationVersion: number; source: string; editedRole: string | null }) => [h.annotationVersion, h.source, h.editedRole])).toEqual([[2, 'AUTHOR_EDIT', 'PM'], [1, 'AI_SUGGESTION', 'PM']]);
    expect(detail.annotationHistory[1].annotation.marking).toBe('permitted_option');
    expect(detail.annotationSource).toMatchObject({ source: 'AUTHOR_EDIT', editedRole: 'PM' });
    const edited = await db.auditEvent.findFirstOrThrow({ where: { action: 'policy.rule_edited', entityId: after.versionId }, orderBy: { createdAt: 'desc' } });
    expect(edited.after).toMatchObject({ annotationVersion: 2, annotationSource: 'AUTHOR_EDIT' });
    const rev = await db.policyRuleAnnotationRevision.findFirstOrThrow({ where: { ruleId: r.ruleId, annotationVersion: 1 } });
    await expect(db.$executeRawUnsafe(`UPDATE "PolicyRuleAnnotationRevision" SET adopted = false WHERE id = '${rev.id}'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "PolicyRuleAnnotationRevision" WHERE id = '${rev.id}'`)).rejects.toThrow();
  });

  it('AC7: a later AI run never overwrites an author edit or an applied rule: it is only offered', async () => {
    await setup();
    await annotate();
    const r = await byKey('NO-CIP');
    await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation: { ...RuleAnnotationInput.parse(r.annotation), why: 'Author wording.' } });
    await apply('PASSPORT');
    const applied = await byKey('PASSPORT');
    await annotate();
    expect((await byKey('NO-CIP')).annotation.why).toBe('Author wording.');
    expect((await byKey('NO-CIP')).pendingAiSuggestion).toMatchObject({ annotation: { classification: 'prohibition' } });
    const still = await byKey('PASSPORT');
    expect([still.versionId, still.contentHash, still.applied]).toEqual([applied.versionId, applied.contentHash, true]);
    expect(still.pendingAiSuggestion).not.toBeNull();
  });

  it('AC8: missing details, needs-clarification, duplicates and unresolved links are flagged on the rule and in the preview', async () => {
    await setup();
    await annotate();
    const mayNot = await byKey('UTILITY-BILL');
    expect(mayNot.flags.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['UNKNOWN_FIELD', 'NEEDS_CLARIFICATION', 'OPEN_QUESTION']));
    expect(mayNot.flags.find((f: { code: string }) => f.code === 'UNKNOWN_FIELD').message).toContain('responsible actor');
    const r = await byKey('PASSPORT');
    await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation: { ...RuleAnnotationInput.parse(r.annotation), links: [{ ruleKey: 'R-FOREIGN-PASSPORT', relation: 'overlaps', note: null }] } });
    expect((await byKey('PASSPORT')).flags.map((f: { code: string }) => f.code)).toContain('DUPLICATE');
    await apply('PASSPORT');
    await apply('UTILITY-BILL');
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    const codes = Object.fromEntries(preview.annotationWarnings.map((w: { ruleKey: string; flags: Array<{ code: string }> }) => [w.ruleKey, w.flags.map((f) => f.code)]));
    expect(codes['R-PASSPORT']).toEqual(expect.arrayContaining(['DUPLICATE', 'UNRESOLVED_LINK']));
    expect(codes['R-UTILITY-BILL']).toContain('NEEDS_CLARIFICATION');
    expect(preview.markingCounts).toEqual({ permitted_option: 1, needs_clarification: 1 });
  });
});

describe('no new approval stage; Apply and the retired required flag (AC12, A1, A5)', () => {
  it('AC12: any marking (or none) is applied by the one PM tick, and publishing needs nothing else', async () => {
    await setup();
    await apply('PASSPORT'); // not annotated
    await annotate();
    await apply('UTILITY-BILL'); // unresolved + needs clarification (owner A5)
    await apply('FOREIGN-PASSPORT'); // permitted option (owner A1)
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    expect(preview.blocking).toEqual([]);
    expect(preview.markingCounts).toMatchObject({ not_annotated: 1, needs_clarification: 1, permitted_option: 1 });
    expect((await api(pmCookie).post(`/projects/${projectId}/policy/rule-set`, { expectedLatestVersion: null })).statusCode).toBe(201);
    const sets = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-sets`)).json().items;
    expect(sets[0]).toMatchObject({ version: 1, ruleCount: 3, markingCounts: { not_annotated: 1, needs_clarification: 1, permitted_option: 1 } });
    const actions = (await db.auditEvent.findMany({ where: { clientId }, select: { action: true } })).map((a) => a.action);
    expect(actions.filter((a) => /approv/i.test(a))).toEqual([]);
  });

  it('A5: an applied unresolved rule blocks unless it is openly marked "needs clarification"', async () => {
    await setup();
    await annotate();
    const r = await byKey('UTILITY-BILL');
    await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation: { ...RuleAnnotationInput.parse(r.annotation), marking: 'mandatory' } });
    await apply('UTILITY-BILL');
    const preview = (await api(pmCookie).get(`/projects/${projectId}/policy/rule-set/preview`)).json();
    expect(preview.blocking.join(' ')).toContain('R-UTILITY-BILL is applied but incomplete');
  });

  it('the retired required flag is accepted from older clients and ignored', async () => {
    await setup();
    const r = await byKey('PASSPORT');
    const res = await api(pmCookie).put(`/projects/${projectId}/policy/rules/${r.ruleId}/applied`, { applied: true, expectedContentHash: r.contentHash, required: false });
    expect(res.statusCode).toBe(200);
    expect((await db.policyRule.findUniqueOrThrow({ where: { id: r.ruleId } })).required).toBe(true);
  });
});

describe('when the AI runs (owner decision 2) and audit', () => {
  it('extraction queues an annotation run; the worker handler suggests annotations once per run (idempotent)', async () => {
    const d = await api(pmCookie).post(`/projects/${projectId}/policy/documents/text`, { title: 'Synthetic KYC policy', text: POLICY, format: 'txt', granularity: 'line' });
    await api(adminCookie).get(`/projects/${projectId}/policy/extraction`);
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/policy/extraction-profiles/llama-agentic-v1', headers: { cookie: adminCookie, ...idem() }, payload: { enabled: true } })).statusCode).toBe(200);
    const x = await api(pmCookie).post(`/projects/${projectId}/policy/extraction`, { documentVersionIds: [d.json().version.id] });
    expect(x.statusCode, x.body).toBe(202);
    const adapters = { llamaextract: new OneRuleProvider('llamaextract'), google: new OneRuleProvider('google') } as Adapters;
    await processExtractionJob({ db, storage, adapters, sleep: async () => undefined }, x.json().jobs[0].id);
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { clientId, name: 'policy.annotation_requested' } });
    expect(ev.payload).toMatchObject({ projectId, trigger: 'extraction' });
    const handler = policyAnnotationHandler({ storage, assistant: ai, dailyCap: 100, capActions: POLICY_AI_ACTIONS });
    await handler.run!(ev, db);
    await handler.run!(ev, db);
    expect(ai.calls).toBe(1);
    expect(ai.inputs[0]!.applicationTypes).toEqual(APP_TYPES);
    expect(ai.inputs[0]!.documentText).not.toContain('KYC New York examples');
    expect((await byKey('PASSPORT')).annotation).toMatchObject({ marking: 'permitted_option' });
    const done = await db.auditEvent.findFirstOrThrow({ where: { action: 'policy.rule_annotations_suggested' } });
    expect(done).toMatchObject({ actorType: 'SYSTEM', entityId: ev.payload && (ev.payload as { documentId: string }).documentId });
    expect(done.after).toMatchObject({ annotated: 1, offered: 0, model: 'mock-policy-1' });
  });

  it('"Suggest annotations" queues one run per document, reports progress and respects the daily cap', async () => {
    await setup();
    const r = await api(pmCookie).post(`/projects/${projectId}/policy/annotation-suggestions`, { documentId });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json().status).toBe('running');
    const again = await api(pmCookie).post(`/projects/${projectId}/policy/annotation-suggestions`, { documentId });
    expect(again.statusCode).toBe(200);
    expect(await db.outboxEvent.count({ where: { name: 'policy.annotation_requested' } })).toBe(1);
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/annotation-suggestions?documentId=${documentId}`)).json().status).toBe('running');
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { name: 'policy.annotation_requested' } });
    await policyAnnotationHandler({ storage, assistant: ai, dailyCap: 100, capActions: POLICY_AI_ACTIONS }).run!(ev, db);
    expect((await api(pmCookie).get(`/projects/${projectId}/policy/annotation-suggestions?documentId=${documentId}`)).json()).toMatchObject({ status: 'done', annotated: 9 });
    const capped = await annotateDocument(db, { storage, assistant: ai, dailyCap: 1, capActions: POLICY_AI_ACTIONS }, { clientId, projectId, documentId, runId: randomUUID(), requestedById: pmId, requestedRoles: ['PM'], trigger: 'manual' });
    expect(capped.status).toBe('skipped');
    const otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await api(otherPm).post(`/projects/${projectId}/policy/annotation-suggestions`, { documentId })).statusCode).toBe(404);
  });
});
