import type { ApprovedTaskRecord, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyOutput, setFieldValue, TemplateProfileSchema, type TemplateProfile } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { buildGenericPackages } from '../src/anvil/generic-package';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { caseLockProblem, withCaseLocked } from '../src/tasks/definitions';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC v7 (application type) and the generic case selector (15 Nov 2026). The v7 template proposal (a synthetic
 * template spec, copied unchanged into test/fixtures/kyc-v7) and a made-up "risk tier" template run through the same
 * code: intake with its arrival check, one task per selector value, the locked selector field, the labels on the
 * Tasks list, and the export's case_selector. Mocks only: no network, no model, no paid calls.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const V6 = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const WORKFLOW = 'KYC onboarding and refresh';
const V7_VALUES = ['individual', 'adult_joint', 'teen_joint', 'custodial'];
const V7_LABELS = ['Single', 'Joint', 'Minor (joint with adult)', 'Custodian'];
const clone = () => structuredClone(V7);

/** A made-up template with a different selector ("risk_tier", three values, labels from the template): no code change. */
function riskTierProposal() {
  const b = clone();
  const profile = b.authoring.profile;
  profile.profileId = 'synthetic-risk-tier-review-v1';
  profile.catalogWorkflowName = 'Synthetic risk tier review';
  profile.templateId = 'SYN1';
  const s1 = profile.sections.find((s: { key: string }) => s.key === 'S1');
  const i = s1.fields.findIndex((f: { key: string }) => f.key === 'applicationType');
  s1.fields[i] = { key: 'riskTier', label: 'Risk tier', type: 'pick_list', required: true, help: 'Set by the task.', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] };
  b.anvil_template_key = 'synthetic-risk-tier-v1';
  b.authoring.template.caseSelector = { field: 'risk_tier', source: 'S1.riskTier', values: ['low', 'medium', 'high'], labels: { high: 'High risk' } };
  return b;
}

describe('KYC v7 and the generic case selector', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const { setFlow, source, signIn, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
    });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym QA', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const anvil = (path: 'validate' | 'proposals', body: object) => app.inject({ method: 'POST', url: `/api/v1/integrations/anvil/templates/${path}`, headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });

  /** The existing KYC workflow (an earlier published version), so a proposal becomes its next version. */
  async function kycWorkflow() {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  /** Proposes, then publishes as the Admin; returns the published version. */
  async function publishedFrom(body: object) {
    const res = await anvil('proposals', body);
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.template_version_id as string;
    const pub = await post(admin, `/templates/${id}/publish`);
    expect(pub.statusCode, pub.body).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }

  /** A new-flow project on a template, submitted; its tasks exist up front, one per slot. */
  async function project(templateId: string, distinctTarget: number) {
    await setFlow(true);
    const skills = (await db.template.findUniqueOrThrow({ where: { id: templateId } })).skills;
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget, maxPerExpert: distinctTarget, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const pid = created.json().id as string;
    await db.project.update({ where: { id: pid }, data: { authoringExperience: null } });
    const sub = await post(pm, `/projects/${pid}/submit`);
    expect(sub.statusCode, sub.body).toBe(200);
    return pid;
  }

  const tasksOf = (projectId: string) => db.taskInstance.findMany({ where: { projectId }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
  const rowsOf = async (projectId: string) => {
    const res = await get(pm, `/projects/${projectId}/forge-tasks`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json().items as { taskId: string; selector: { field: string; value: string; label: string } | null }[];
  };

  /** An authored output on the template's form, with the selector field set as given. */
  function authoredOn(t: Template, s1: Record<string, string>) {
    const form = TemplateProfileSchema.parse((t.anvilSpec as { authoring: { profile: unknown } }).authoring.profile) as TemplateProfile;
    let out = emptyOutput(form);
    out = setFieldValue(form, out, 'S1', 'title', 'SYNTHETIC reusable task');
    for (const [k, v] of Object.entries(s1)) out = setFieldValue(form, out, 'S1', k, v);
    return out;
  }

  // ── Intake and arrival check ──

  it('accepts the v7 proposal as the next KYC version: selector stored generically, four tasks, its own form', async () => {
    await kycWorkflow();
    const v = await anvil('validate', clone());
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().data).toMatchObject({ valid: true, errors: [] });
    const res = await anvil('proposals', clone());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data).toMatchObject({ status: 'draft_created', profile_id: 'golden-kyc-application-type-v1', version: 2 });
    const draft = await db.template.findUniqueOrThrow({ where: { id: res.json().data.template_version_id } });
    expect(draft).toMatchObject({ status: 'DRAFT', profileId: 'golden-kyc-application-type-v1', defaultDistinctTarget: 4 });
    expect(draft.caseSelector).toEqual({ field: 'product', source: 'S1.applicationType', values: V7_VALUES });
    expect(draft.coverageDimensions).toEqual({ dimensions: [], cells: [] });
  });

  it('v6 then v7 on the same lineage: both accepted (different forms); a repeated v7 form is TP_FORM_ID_TAKEN', async () => {
    await kycWorkflow();
    const v6 = await publishedFrom(structuredClone(V6));
    expect(v6.caseSelector).toMatchObject({ field: 'governing_state' });
    const v7 = await publishedFrom(clone());
    expect(v7.version).toBe(v6.version + 1);
    expect(v7.caseSelector).toMatchObject({ field: 'product' });
    const again = await anvil('validate', clone());
    expect(again.statusCode).toBe(422);
    expect(again.json().data.errors.map((e: { code: string }) => e.code)).toContain('TP_FORM_ID_TAKEN');
  });

  it('refuses whole, with TP_CASE_SELECTOR_UNSUPPORTED, any selector it cannot run; nothing is created', async () => {
    await kycWorkflow();
    const before = await db.template.count();
    const cases: [string, (b: Record<string, any>) => void][] = [
      ['unknown shape', (b) => (b.authoring.template.caseSelector.mode = 'per_application')],
      ['not an object', (b) => (b.authoring.template.caseSelector = ['individual'])],
      ['missing source field', (b) => (b.authoring.template.caseSelector.source = 'S1.accountProduct')],
      ['source in a missing section', (b) => (b.authoring.template.caseSelector.source = 'S9.applicationType')],
      ['source not a pick list', (b) => (b.authoring.template.caseSelector.source = 'S1.title')],
      ['source not required', (b) => (b.authoring.template.caseSelector.source = 'S1.exampleGoverningState')],
      ['empty values', (b) => (b.authoring.template.caseSelector.values = [])],
      ['duplicate values', (b) => (b.authoring.template.caseSelector.values = ['individual', 'individual', 'adult_joint', 'teen_joint', 'custodial'])],
      ['values unlike the options', (b) => (b.authoring.template.caseSelector.values = ['individual', 'adult_joint', 'teen_joint'])],
      ['label for an unknown value', (b) => (b.authoring.template.caseSelector.labels = { trust: 'Trust' })],
      ['target not one per value', (b) => (b.authoring.template.defaultDistinctTarget = 200)],
      ['coverage quotas', (b) => (b.authoring.template.coverageDimensions = { dimensions: [{ key: 'product', label: 'Product', values: ['a'] }], cells: [] })],
      ['edge-case quotas', (b) => (b.authoring.template.edgeCaseCatalog = [{ name: 'PEP link', quota: 1, required: true }])],
    ];
    for (const [name, edit] of cases) {
      const b = clone();
      edit(b);
      const r = await anvil('proposals', b);
      expect(r.statusCode, name).toBe(422);
      const errors = r.json().data.errors as { code: string; message: string; fix: string }[];
      expect(errors.map((e) => e.code), name).toContain('TP_CASE_SELECTOR_UNSUPPORTED');
      expect(errors.find((e) => e.code === 'TP_CASE_SELECTOR_UNSUPPORTED')!.message.length, name).toBeGreaterThan(10);
    }
    // An unknown field type keeps its own code.
    const odd = clone();
    odd.authoring.profile.sections[0].fields.find((f: { key: string }) => f.key === 'language').type = 'signature_pad';
    const r = await anvil('validate', odd);
    expect(r.statusCode).toBe(422);
    expect(r.json().data.errors.map((e: { code: string }) => e.code)).toContain('TP_FIELD_TYPE_UNSUPPORTED');
    expect(await db.template.count()).toBe(before);
    const contracts = await app.inject({ method: 'GET', url: '/api/v1/integrations/anvil/templates/contracts', headers: { authorization: `Bearer ${anvilKey}` } });
    expect(contracts.json().data.error_codes).toContain('TP_CASE_SELECTOR_UNSUPPORTED');
  });

  // ── Tasks and labels ──

  it('a v7 project gets four tasks, one per application type, labelled Single, Joint, Minor (joint with adult), Custodian', async () => {
    await kycWorkflow();
    const v7 = await publishedFrom(clone());
    const pid = await project(v7.id, 4);
    const tasks = await tasksOf(pid);
    expect(tasks.length).toBe(4);
    expect(tasks.map((t) => (t.input as { slot: { case: unknown } }).slot.case)).toEqual(V7_VALUES.map((value, i) => ({ field: 'product', source: 'S1.applicationType', value, label: V7_LABELS[i] })));
    expect(tasks.every((t) => t.slot && !t.slot.isOpen && t.slot.required)).toBe(true);
    expect(tasks[1]!.slot!.brief).toBe('Application type: Joint. Write this reusable task for Joint only; set Application type to Joint.');
    const rows = await rowsOf(pid);
    expect(rows.map((r) => r.selector)).toEqual(V7_VALUES.map((value, i) => ({ field: 'Application type', value, label: V7_LABELS[i] })));
    // D19: one SME place per task at least (the figures alone gave 1, which let only one SME be assigned).
    expect((await db.project.findUniqueOrThrow({ where: { id: pid } })).requiredWorkers).toBe(4);
  });

  it('the author cannot change the application type: a different value is refused, the slot value is kept', async () => {
    await kycWorkflow();
    const v7 = await publishedFrom(clone());
    const pid = await project(v7.id, 4);
    const task = (await tasksOf(pid))[3]!;
    const sme = await source(pid, 'SME', { email: 'author@gmail.test', first: 'Ada', last: 'Author' });
    expect((await assign(pid, sme.id, task.id)).statusCode).toBe(200);
    const me = await signIn('author@gmail.test');
    const rev = async () => (await get(me.cookie, `/me/tasks/${task.id}`)).json().revision as number;

    const wrong = await call(app, 'PUT', me.cookie, `/me/tasks/${task.id}`, { output: authoredOn(v7, { applicationType: 'individual' }), activeSecondsDelta: 5, expectedRevision: await rev() });
    expect(wrong.statusCode, wrong.body).toBe(422);
    expect(wrong.json()).toMatchObject({ error: 'CASE_SELECTOR_LOCKED' });
    expect(wrong.json().message).toMatch(/This task is for Custodian\. That choice is set by the task/);
    expect(wrong.json().message).not.toMatch(/Praxis|Anvil|ADI-Labs/);

    const right = await call(app, 'PUT', me.cookie, `/me/tasks/${task.id}`, { output: authoredOn(v7, { applicationType: 'custodial', exampleGoverningState: 'TX' }), activeSecondsDelta: 5, expectedRevision: await rev() });
    expect(right.statusCode, right.body).toBe(200);
    const saved = await db.taskInstance.findUniqueOrThrow({ where: { id: task.id } });
    expect((saved.output as { sections: { S1: Record<string, unknown> } }).sections.S1.applicationType).toBe('custodial');

    // Unit: an empty field may be saved (the editor fills it); a proposal's change is overwritten with the slot value.
    expect(caseLockProblem(task.input, { sections: { S1: {} } })).toBeNull();
    expect((withCaseLocked(task.input, { sections: { S1: { applicationType: 'individual', title: 'x' } } }) as { sections: { S1: Record<string, unknown> } }).sections.S1).toEqual({ applicationType: 'custodial', title: 'x' });
  });

  // ── Export ──

  /** Approved records for a project's tasks, authored with each slot's value (and an optional per-task override). */
  async function records(pid: string, t: Template, s1: (value: string, i: number) => Record<string, string>) {
    const tasks = await tasksOf(pid);
    return tasks.map((task, i) => {
      const value = (task.input as { slot: { case: { value: string } } }).slot.case.value;
      const record = { id: randomUUID(), taskInstanceId: task.id, contentHash: 'c'.repeat(64), templateId: t.id, input: task.input, output: authoredOn(t, s1(value, i)) } as unknown as ApprovedTaskRecord;
      return { record, template: t };
    });
  }

  it('export: each v7 task carries case_selector {product, value} from its slot; example state only when set', async () => {
    await kycWorkflow();
    const v7 = await publishedFrom(clone());
    const pid = await project(v7.id, 4);
    const built = buildGenericPackages(await records(pid, v7, (value, i) => ({ applicationType: value, ...(i === 0 ? { exampleGoverningState: 'CA' } : {}) })), { projectId: pid });
    expect(built.problems).toEqual([]);
    const entries = built.parts[0]!.manifest.tasks as Record<string, any>[];
    expect(entries.map((e) => e.case_selector)).toEqual(V7_VALUES.map((value) => ({ field: 'product', value })));
    expect(entries[0]!.coverage).toEqual({ example_governing_state: 'CA' });
    expect(entries.slice(1).every((e) => !('coverage' in e))).toBe(true);
  });

  it('export: a missing, unknown or conflicting selector value blocks the template’s tasks with a reason', async () => {
    await kycWorkflow();
    const v7 = await publishedFrom(clone());
    const pid = await project(v7.id, 4);
    const conflict = buildGenericPackages(await records(pid, v7, (value, i) => ({ applicationType: i === 2 ? 'individual' : value })), { projectId: pid });
    expect(conflict.parts).toEqual([]);
    expect(conflict.problems.map((p) => p.code).sort()).toEqual(['GENERIC_CASE_SELECTOR_BATCH_BLOCKED', 'GENERIC_CASE_SELECTOR_BATCH_BLOCKED', 'GENERIC_CASE_SELECTOR_BATCH_BLOCKED', 'GENERIC_CASE_SELECTOR_MISMATCH']);

    const unknown = await records(pid, v7, (value) => ({ applicationType: value }));
    (unknown[1]!.record.input as any).slot.case.value = 'trust';
    (unknown[1]!.record.output as any).sections.S1.applicationType = 'trust';
    const u = buildGenericPackages(unknown, { projectId: pid });
    expect(u.problems.find((p) => p.code === 'GENERIC_CASE_SELECTOR_UNKNOWN')!.message).toMatch(/"trust" is not one of the template's values/);
    expect(u.parts).toEqual([]);

    const missing = await records(pid, v7, (value) => ({ applicationType: value }));
    delete (missing[0]!.record.input as any).slot;
    (missing[0]!.record.output as any).sections.S1.applicationType = '';
    expect(buildGenericPackages(missing, { projectId: pid }).problems.map((p) => p.code)).toContain('GENERIC_CASE_SELECTOR_MISSING');

    const otherField = await records(pid, v7, (value) => ({ applicationType: value }));
    (otherField[0]!.record.input as any).slot.case.field = 'governing_state';
    expect(buildGenericPackages(otherField, { projectId: pid }).problems.map((p) => p.code)).toContain('GENERIC_CASE_SELECTOR_MISMATCH');
  });

  // ── v6 unchanged ──

  it('v6 (state selector) is unchanged: five state tasks with their labels, no case_selector in its export', async () => {
    await kycWorkflow();
    const v6 = await publishedFrom(structuredClone(V6));
    const pid = await project(v6.id, 5);
    const rows = await rowsOf(pid);
    expect(rows.map((r) => r.selector?.value)).toEqual(['CA', 'NY', 'TX', 'FL', 'IL']);
    expect(rows[0]!.selector).toMatchObject({ field: 'Governing state', label: 'California (CA)' });
    const tasks = await tasksOf(pid);
    expect(tasks[0]!.slot!.brief).toBe('Governing state: California (CA). Write this reusable task for California only; set Governing state to CA.');
    const built = buildGenericPackages(await records(pid, v6, (value) => ({ governingState: value })), { projectId: pid });
    expect(built.problems).toEqual([]);
    expect((built.parts[0]!.manifest.tasks as Record<string, unknown>[]).every((e) => !('case_selector' in e) && !('coverage' in e))).toBe(true);
  });

  // ── Generic: a made-up template ──

  it('a made-up "risk_tier" template (three values, labels from the template) works with no code change', async () => {
    const r = await anvil('proposals', riskTierProposal());
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${id}/publish`)).statusCode).toBe(200);
    const t = await db.template.findUniqueOrThrow({ where: { id } });
    expect(t.caseSelector).toEqual({ field: 'risk_tier', source: 'S1.riskTier', values: ['low', 'medium', 'high'], labels: { high: 'High risk' } });
    expect(t.defaultDistinctTarget).toBe(3);

    const pid = await project(t.id, 3);
    const rows = await rowsOf(pid);
    expect(rows.map((x) => x.selector)).toEqual([
      { field: 'Risk tier', value: 'low', label: 'Low' },
      { field: 'Risk tier', value: 'medium', label: 'Medium' },
      { field: 'Risk tier', value: 'high', label: 'High risk' },
    ]);
    const built = buildGenericPackages(await records(pid, t, (value) => ({ riskTier: value })), { projectId: pid });
    expect(built.problems).toEqual([]);
    expect((built.parts[0]!.manifest.tasks as Record<string, any>[]).map((e) => e.case_selector)).toEqual(['low', 'medium', 'high'].map((value) => ({ field: 'risk_tier', value })));
  });
});
