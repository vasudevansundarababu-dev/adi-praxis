import type { Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyOutput, rubricToFinish, setFieldValue, TemplateProfileSchema, type RubricView, type TemplateProfile } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { MockRubricAssistant } from '../src/tasks/rubric/assistant';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Rubric editor and recommendations on KYC v7 (docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md, both owner specs, D6, D8,
 * D9). The v7 template proposal is the synthetic fixture RL Gym sent; policies are synthetic text. Mocks only: no model,
 * no network, no paid calls.
 */
const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const V7_IDS = (V7.execution.evaluators as { criterion_id: string }[]).map((e) => e.criterion_id);
const WORKFLOW = 'KYC onboarding and refresh';
const POLICY = [
  '1. Identity. The bank must verify the identity of each owner and each person acting for an owner before the account is approved.',
  '2. Custodial authority. Before opening a custodial account, the bank must confirm the custodian authority to act for the minor from the custodial agreement.',
  '3. Sanctions screening. Every party must be screened against the sanctions list before approval.',
].join('\n\n');

describe('rubric recommendations (flag on)', () => {
  let app: FastifyInstance;
  let off: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  const assistant = new MockRubricAssistant();
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const kit = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const put = (cookie: string, url: string, payload: object) => call(app, 'PUT', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  const build = (enabled: boolean) =>
    buildApp({
      config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString(), RUBRIC_RECOMMENDATIONS_ENABLED: enabled ? 'true' : 'false' }),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
      rubricAssistant: assistant,
    });

  beforeAll(async () => {
    app = await build(true);
    off = await build(false);
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
    await off.close();
    await db.$disconnect();
  });

  async function v7Template() {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(V7) });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${id}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }

  async function project(templateId: string) {
    await kit.setFlow(true);
    const skills = (await db.template.findUniqueOrThrow({ where: { id: templateId } })).skills;
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const pid = created.json().id as string;
    await db.project.update({ where: { id: pid }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${pid}/submit`)).statusCode).toBe(200);
    return pid;
  }

  /** A synthetic policy document with three reviewed rules, published as the project's rule set. */
  async function publishPolicy(pid: string) {
    const doc = await post(pm, `/projects/${pid}/policy/documents/text`, { title: 'Golden Bank custodial policy', text: POLICY, granularity: 'section' });
    expect(doc.statusCode, doc.body).toBe(201);
    const dvId = doc.json().version.id as string;
    const rules = [
      ['R-ID-1', 'Verify each owner and person acting for an owner', 'The bank must verify the identity of each owner and each person acting for an owner before the account is approved.'],
      ['R-CU-1', 'Confirm the custodian authority', 'Before opening a custodial account, the bank must confirm the custodian authority to act for the minor from the custodial agreement.'],
      ['R-SC-1', 'Screen every party', 'Every party must be screened against the sanctions list before approval.'],
    ];
    for (const [ruleKey, title, quote] of rules) {
      const made = await post(pm, `/projects/${pid}/policy/rules`, {
        documentVersionId: dvId,
        ruleKey,
        body: { title, requirement: quote, requirementType: 'obligation', visibility: 'agent_visible', applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null }, prerequisites: [], precedence: [], exceptions: { kind: 'none', items: [] }, effective: { from: null, to: null, conditionText: 'always' }, evidenceNeeds: [], verificationHint: null, uncertainty: [] },
        citations: [{ fieldPath: 'requirement', role: 'supports', quote }],
      });
      expect(made.statusCode, made.body).toBe(201);
      const r = made.json();
      expect((await post(pm, `/projects/${pid}/policy/rule-versions/${r.versionId}/review`, { expectedContentHash: r.contentHash, required: true })).statusCode).toBe(200);
    }
    const set = await post(pm, `/projects/${pid}/policy/rule-set`, { expectedLatestVersion: null });
    expect(set.statusCode, set.body).toBe(201);
    return dvId;
  }

  const formOf = (t: Template) => TemplateProfileSchema.parse((t.anvilSpec as { authoring: { profile: unknown } }).authoring.profile) as TemplateProfile;

  /** A Custodian task's authored S1-S6 (synthetic), with the rubric left as given. */
  function authored(t: Template, o: { step5?: string; criteria?: unknown[]; s4?: unknown[] } = {}) {
    const f = formOf(t);
    let out = emptyOutput(f);
    const set = (s: string, k: string, v: unknown) => (out = setFieldValue(f, out, s as never, k, v));
    set('S1', 'title', 'SYNTHETIC custodial account KYC');
    set('S1', 'applicationType', 'custodial');
    set('S2', 'inputContract', 'Each episode receives one isolated application snapshot. The agent reads documents with document.read and compares versions with document.compare; a document can arrive in more than one version.');
    set('S3', 'tools', ['application.read', 'identity.check', 'document.check', 'document.compare', 'authority.check', 'screening.check', 'specialist.refer']);
    set('S5', 'steps', [
      { action: 'Read the application and identify the custodian and the minor beneficiary', tool: 'application.read', failureBehaviour: 'Record a finding and stop with request_information' },
      { action: "Verify the custodian's identity documents", tool: 'identity.check, document.check', failureBehaviour: 'Request a replacement document' },
      { action: 'Screen the custodian against the sanctions list', tool: 'screening.check', failureBehaviour: 'Refer an unresolved hit' },
      { action: 'Compare document versions and use the latest revision', tool: 'document.compare', failureBehaviour: 'Record the conflict' },
      { action: o.step5 ?? "Verify the custodian's authority and the custodial agreement", tool: 'authority.check, document.read', failureBehaviour: 'Refer unproven authority to a specialist' },
    ]);
    set('S6', 'outputContract', 'One recommendation per application from the allowed values, with cited evidence.');
    if (o.criteria) set('S7', 'criteria', o.criteria);
    if (o.s4) set('S4', 'statePolicies', o.s4);
    return out;
  }

  /** v7 project, Custodian task assigned to a signed-in SME, a published policy. */
  async function setup() {
    const v7 = await v7Template();
    const pid = await project(v7.id);
    const task = (await db.taskInstance.findMany({ where: { projectId: pid }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } }))[3]!;
    const sme = await kit.source(pid, 'SME', { email: 'author@gmail.test', first: 'Ada', last: 'Author' });
    expect((await kit.assign(pid, sme.id, task.id)).statusCode).toBe(200);
    const me = await kit.signIn('author@gmail.test');
    const dvId = await publishPolicy(pid);
    const save = async (output: object) => {
      const rev = (await get(me.cookie, `/me/tasks/${task.id}`)).json().revision as number;
      const r = await put(me.cookie, `/me/tasks/${task.id}`, { output, activeSecondsDelta: 5, expectedRevision: rev });
      expect(r.statusCode, r.body).toBe(200);
      return r;
    };
    const view = async () => {
      const r = await get(me.cookie, `/me/tasks/${task.id}/rubric`);
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as RubricView;
    };
    return { v7, pid, task, me, dvId, save, view };
  }

  const crit = (v: RubricView, id: string) => v.criteria.find((c) => c.id === id)!;

  // ── Release boundary (AC 12 / 12) ──

  it('flag off: no rubric routes, the task view says so, and a typed evaluator is saved as typed', async () => {
    const s = await setup();
    const g = (url: string) => off.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: s.me.cookie } });
    expect((await g(`/me/tasks/${s.task.id}/rubric`)).statusCode).toBe(404);
    expect((await g(`/me/tasks/${s.task.id}/policy-library`)).statusCode).toBe(404);
    expect((await g(`/me/tasks/${s.task.id}`)).json().formV2).toBe(false);
    expect((await get(s.me.cookie, `/me/tasks/${s.task.id}`)).json().formV2).toBe(true);
    const rev = (await g(`/me/tasks/${s.task.id}`)).json().revision;
    const typed = authored(s.v7, { criteria: [{ id: 'profile', name: 'Profile', weight: 5, passCondition: 'p', partialCredit: 'q', failCondition: 'r', critical: false, evidenceRefs: [], evaluatorKind: 'run_evidence', evaluatorVersion: '9', outputField: '', comparison: '', expectedValue: '' }] });
    const r = await off.inject({ method: 'PUT', url: `/api/v1/me/tasks/${s.task.id}`, headers: { cookie: s.me.cookie, ...idem() }, payload: { output: typed, activeSecondsDelta: 1, expectedRevision: rev } });
    expect(r.statusCode, r.body).toBe(200);
    const saved = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id } })).output as any;
    expect(saved.sections.S7.criteria[0]).toMatchObject({ evaluatorKind: 'run_evidence', evaluatorVersion: '9' });
  });

  // ── D8 / D9 / editor spec §4, §6 (AC 3, 5; editor AC 1, 2, 5, 7) ──

  it('lists the template’s 20 criteria in order, seeds S7 with IDs, names and the template evaluator; technical settings are read-only and never guessed', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    const v = await s.view();
    expect(v.criteria.map((c) => c.id)).toEqual(V7_IDS);
    expect(v.template).toMatchObject({ scale: 'five_two_zero', fixedSet: true, criterionFailureSupported: true, weightsFromTemplate: true });
    expect(v.template.scoreKeys.map((k) => [k.label, k.points])).toEqual([['Pass', 5], ['Partial', 2], ['Fail', 0]]);
    expect(v.seed!.map((i) => i.id)).toEqual(V7_IDS);
    // D8 (non-integration): the owner's 20-criterion table is the default, kept in Authoring; weight 5 each = 100.
    expect(v.seed![0]).toMatchObject({ id: 'identification_parties', name: 'All parties identified', evaluatorKind: 'golden-kyc-rubric-v1', evaluatorVersion: '1', weight: 5, critical: false });
    expect(v.seed![0]!.passCondition).toMatch(/^Every owner, signer and authorised party/);
    expect(v.seed!.reduce((n, i) => n + (i.weight as number), 0)).toBe(100);
    expect(v.seed!.filter((i) => i.critical === true).map((i) => i.id)).toEqual(['identification_verification', 'screening', 'decision']);
    const c = crit(v, 'account_authority');
    expect(c).toMatchObject({ origin: 'TEMPLATE_DEFAULT', exportable: true, defaults: expect.objectContaining({ id: 'account_authority', name: 'Authority' }) });
    expect(c.technical).toEqual(expect.arrayContaining([{ label: 'Evaluator', value: 'golden-kyc-rubric-v1', note: 'From template' }, { label: 'Evidence source', value: 'Recorded run', note: 'From template' }, { label: 'Output field', value: '—', note: 'Not used' }, { label: 'Comparison', value: '—', note: 'Not used' }]));
    expect(c.howChecked.setupNeeded).toBe(false);
    expect(c.howChecked.text).toMatch(/recorded run/);
    expect(JSON.stringify(v)).not.toMatch(/\bReady\b|Anvil|Praxis|ADI-Labs/);
    // Fields the derivation could not use are listed with a reason, never skipped silently.
    expect(v.unused).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'reviewerNotes', reason: 'private reviewer notes' })]));
  });

  it('D9: on save, a mapped criterion takes the template evaluator and version; correct values are saved byte for byte', async () => {
    const s = await setup();
    const item = (kind: string, version: string) => ({ id: 'profile', name: 'Profile', weight: 5, passCondition: 'p', partialCredit: 'q', failCondition: 'r', critical: false, evidenceRefs: ['S5-1'], evaluatorKind: kind, evaluatorVersion: version, outputField: '', comparison: '', expectedValue: '' });
    await s.save(authored(s.v7, { criteria: [item('run_evidence', '9')] }));
    let saved = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id } })).output as any;
    expect(saved.sections.S7.criteria[0]).toEqual(item('golden-kyc-rubric-v1', '1'));
    const right = authored(s.v7, { criteria: [item('golden-kyc-rubric-v1', '1')] });
    await s.save(right);
    saved = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id } })).output;
    // Stored as JSONB (key order is not kept); the export hashes canonical JSON (JCS), so deep equality is the test.
    expect(saved).toEqual(right);
  });

  // ── Derivation and links (AC 1, 2; editor AC 3) ──

  it('derives links from the task’s own sections and the selected rules, with readable labels, versions and snapshots', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    const v = await s.view();
    const auth = crit(v, 'account_authority');
    const labels = auth.links.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/^Workflow · Verify the custodian's authority/), 'S3 · Permitted tools · authority.check']));
    const rule = crit(v, 'identification_verification').links.find((l) => l.kind === 'POLICY_RULE');
    expect(rule).toMatchObject({ label: 'S4 · Policy rules · R-ID-1', ruleKey: 'R-ID-1', documentVersionId: s.dvId, templateId: s.v7.id, templateVersion: s.v7.version, taskId: s.task.id, state: 'OK' });
    expect(rule!.excerpt).toMatch(/verify the identity of each owner/);
    expect(rule!.snapshot).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.details.why).toMatch(/^Linked to /);
    expect(auth.details.stepLabel).toMatch(/authority/);
    expect(auth.details.applicability.kind).toBe('REQUIRED');
    expect(auth.details.applicability.condition).toMatch(/actual product/);
    // A criterion whose own text mentions rules and has no rule among the ticked sources needs one; nothing is invented.
    expect(crit(v, 'state_rule_selection').needs).toContain('Policy rule');
  });

  it('sources are checkboxes: defaults ticked, untick removes a document’s links, only offered sources can be added', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    let v = await s.view();
    expect(v.sources.items.map((i) => [i.kind, i.ticked])).toEqual([['POLICY_DOCUMENT', true], ['TEMPLATE_REFERENCE', true]]);
    expect(v.sources.available.map((a) => a.label)).toEqual(['Federal policy references from the template']);
    const typed = await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/sources`, { expectedVersion: 0, ticked: [], added: ['made-up-ref'] });
    expect(typed.statusCode).toBe(422);
    expect(typed.json().error).toBe('UNKNOWN_SOURCE');
    const r = await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/sources`, { expectedVersion: 0, ticked: [`template:${s.v7.id}`], added: [] });
    expect(r.statusCode, r.body).toBe(200);
    v = await s.view();
    expect(v.sources.items.find((i) => i.ref === s.dvId)!.ticked).toBe(false);
    expect(v.criteria.flatMap((c) => c.links).some((l) => l.kind === 'POLICY_RULE')).toBe(false);
    expect((await db.auditEvent.count({ where: { action: 'rubric.sources.saved' } }))).toBe(1);
  });

  // ── Editing, regeneration, source change (AC 4, 5, 6; editor AC 4) ──

  it('author edits survive regeneration; a different suggestion is shown as proposed, never applied', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    const run = await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().reused).toBe(false);
    const again = await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    expect(again.json()).toMatchObject({ reused: true, runId: run.json().runId });
    let c = crit(await s.view(), 'account_authority');
    const mine = { kind: 'REQUIRED_WHEN', condition: 'Someone acts for another party: a custodian, guardian or power of attorney.', exceptions: 'Approving an unproven authority is a bank officer’s decision.' };
    const saved = await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/account_authority`, { expectedVersion: c.annotationVersion, applicability: mine, evidenceRequired: 'authority.check result cited in the findings' });
    expect(saved.statusCode, saved.body).toBe(200);
    const stale = await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/account_authority`, { expectedVersion: c.annotationVersion, assesses: 'x' });
    expect(stale.statusCode).toBe(409);
    await s.save(authored(s.v7, { step5: 'Confirm the custodian authority to act for the minor with authority.check' }));
    expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' })).json().reused).toBe(false);
    c = crit(await s.view(), 'account_authority');
    expect(c.details.applicability).toEqual(mine);
    expect(c.editedFields.sort()).toEqual(['applicability', 'evidenceRequired']);
    expect(c.proposed.applicability).toMatchObject({ kind: 'REQUIRED' });
  });

  it('a changed source flags the criterion without rewriting it; "Reviewed, keep" re-snapshots (audited)', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    const before = await db.rubricCriterionAnnotation.findFirstOrThrow({ where: { taskInstanceId: s.task.id, criterionId: 'account_authority' }, orderBy: { version: 'desc' } });
    await s.save(authored(s.v7, { step5: "Verify the custodian's authority, the custodial agreement and any court order" }));
    let c = crit(await s.view(), 'account_authority');
    expect(c.sourceChanged).toBe(true);
    const changed = c.links.find((l) => l.state === 'CHANGED')!;
    expect(changed.label).toMatch(/^Workflow · Verify the custodian's authority/);
    expect(changed.currentExcerpt).toMatch(/court order/);
    const still = await db.rubricCriterionAnnotation.findFirstOrThrow({ where: { taskInstanceId: s.task.id, criterionId: 'account_authority' }, orderBy: { version: 'desc' } });
    expect(still.id).toBe(before.id);
    const keep = await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/account_authority/keep`, { expectedVersion: before.version });
    expect(keep.statusCode, keep.body).toBe(200);
    c = crit(await s.view(), 'account_authority');
    expect(c.sourceChanged).toBe(false);
    expect(c.details).toEqual(before.details);
    expect(await db.auditEvent.count({ where: { action: 'rubric.criterion.source_reviewed' } })).toBe(1);
  });

  // ── Whole-task failure, to-finish list, draft save (editor AC 6, 8; AC 8) ──

  it('whole-task failure needs an explicit condition; a behaviour a Fail does not cover needs evaluation setup; drafts save anyway', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    let v = await s.view();
    const items = v.seed!.map((i) => (i.id === 'identification_verification' ? { ...i, critical: true, failCondition: '' } : i));
    await s.save(authored(s.v7, { criteria: items }));
    const c = crit(await s.view(), 'identification_verification');
    expect((await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/identification_verification`, { expectedVersion: c.annotationVersion, wholeTaskFailure: { kind: 'FAIL_OF_CRITERION', condition: '' } })).statusCode).toBe(200);
    v = await s.view();
    let todo = rubricToFinish(v, items);
    expect(todo.filter((t) => t.criterionId === 'identification_verification').map((t) => t.kind)).toEqual(expect.arrayContaining(['WHOLE_TASK_CONDITION', 'SCORE_MISSING']));
    const v1 = crit(v, 'identification_verification').annotationVersion;
    await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/identification_verification`, { expectedVersion: v1, wholeTaskFailure: { kind: 'OTHER_BEHAVIOUR', condition: 'The agent recommends clearance while identity verification is incomplete.' } });
    v = await s.view();
    todo = rubricToFinish(v, items);
    expect(todo.some((t) => t.criterionId === 'identification_verification' && t.kind === 'EVALUATION_SETUP')).toBe(true);
    expect(todo.some((t) => t.criterionId === 'identification_verification' && t.kind === 'WHOLE_TASK_CONDITION')).toBe(false);
    // The exported flag is the existing `critical` only; the condition text never enters the output.
    const out = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id } })).output as any;
    expect(JSON.stringify(out)).not.toMatch(/recommends clearance/);
    // Submit still runs the existing checks: empty scoring text blocks it, as before.
    const rev = (await get(s.me.cookie, `/me/tasks/${s.task.id}`)).json().revision;
    const sub = await post(s.me.cookie, `/me/tasks/${s.task.id}/submit`, { expectedRevision: rev, syntheticDeclaration: true, flagExplanations: {} });
    expect(sub.statusCode).toBe(422);
    expect((sub.json().details.checks as { id: string; ok: boolean }[]).find((x) => x.id === 'anvil.criteria-anchors')!.ok).toBe(false);
  });

  it('D8 and D6 at submit (flag on): every template criterion present; S4 references must be library documents', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    const v = await s.view();
    const lib = (await get(s.me.cookie, `/me/tasks/${s.task.id}/policy-library`)).json();
    expect(lib.documents).toHaveLength(1);
    const d = lib.documents[0];
    expect(d).toMatchObject({ title: 'Golden Bank custodial policy', policyId: expect.any(String), version: 'rs1.d1', publicationRef: 'project rule set v1', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(d.rules.map((r: { ruleKey: string }) => r.ruleKey).sort()).toEqual(['R-CU-1', 'R-ID-1', 'R-SC-1']);
    const checkOf = async (out: object) => {
      await s.save(out);
      const r = await post(s.me.cookie, `/me/tasks/${s.task.id}/check`, {});
      return r.json().checks as { id: string; ok: boolean }[];
    };
    let checks = await checkOf(authored(s.v7, { criteria: v.seed!.slice(1), s4: [{ ruleId: 'GB-01', ruleVersion: 'typed', locator: 'typed', contentSha256: 'a'.repeat(64), appliesTo: '', rationale: '', exception: '' }] }));
    expect(checks.find((c) => c.id === 'rubric.template-criteria')!.ok).toBe(false);
    expect(checks.find((c) => c.id === 'policy.library-reference')!.ok).toBe(false);
    checks = await checkOf(authored(s.v7, { criteria: v.seed!, s4: [{ ruleId: d.policyId, ruleVersion: d.version, locator: d.publicationRef, contentSha256: d.sha256, appliesTo: '', rationale: '', exception: '' }] }));
    expect(checks.find((c) => c.id === 'rubric.template-criteria')!.ok).toBe(true);
    expect(checks.find((c) => c.id === 'policy.library-reference')!.ok).toBe(true);
    // With the flag off these checks do not exist.
    const offChecks = (await off.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.task.id}/check`, headers: { cookie: s.me.cookie, ...idem() }, payload: {} })).json().checks as { id: string }[];
    expect(offChecks.some((c) => c.id.startsWith('rubric.') || c.id === 'policy.library-reference')).toBe(false);
  });

  // ── Additions, coverage, AI (AC 3, 8; recommendations §4 "clearly label new AI suggestions") ──

  it('an uncovered mandatory rule becomes a suggested addition: internal only, evaluation setup needed, keep or dismiss', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    let v = await s.view();
    expect(v.coverage.total).toBeGreaterThan(0);
    for (const a of v.additions) expect(a).toMatchObject({ status: 'SUGGESTED', internalOnly: true });
    if (v.additions.length) {
      const a = v.additions[0]!;
      expect(rubricToFinish(v, v.seed!).some((t) => t.criterionId === a.id && t.kind === 'EVALUATION_SETUP')).toBe(true);
      expect((await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/additions/${a.id}/decision`, { decision: 'DISMISS', expectedVersion: a.annotationVersion })).statusCode).toBe(200);
      v = await s.view();
      expect(v.additions.some((x) => x.id === a.id)).toBe(false);
    }
    // Additions are never written to S7 (the template's 20 IDs are fixed).
    const out = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.task.id } })).output as any;
    expect((out.sections.S7.criteria as { id: string }[]).every((c) => V7_IDS.includes(c.id))).toBe(true);
  });

  it('AI wording is labelled, skips fields the author edited, and is kept until reworded', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    const c = crit(await s.view(), 'screening');
    await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/screening`, { expectedVersion: c.annotationVersion, assesses: 'Screen every party; resolve or escalate each hit.' });
    const calls = assistant.calls;
    const ai = await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'AI' });
    expect(ai.statusCode, ai.body).toBe(200);
    expect(assistant.calls).toBe(calls + 1);
    const v = await s.view();
    expect(crit(v, 'screening').details.assesses).toBe('Screen every party; resolve or escalate each hit.');
    expect(crit(v, 'screening').aiFields).not.toContain('assesses');
    expect(crit(v, 'profile').aiFields).toEqual(expect.arrayContaining(['assesses', 'evidenceRequired']));
    const run = await db.rubricRecommendationRun.findFirstOrThrow({ where: { taskInstanceId: s.task.id, mode: 'AI' } });
    expect(run.model).toBe('mock-rubric-1');
    // A rules-only refresh keeps the AI wording (it is not overwritten by the plainer derived text).
    await s.save(authored(s.v7, { step5: 'Confirm authority with authority.check' }));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    expect(crit(await s.view(), 'profile').details.assesses).toMatch(/^Carry out/);
  });

  // ── Restore and read-only views (recommendations §6; AC 11) ──

  it('restores a criterion as it stood at a submitted version; console and Reviewer read the same view', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    const v = await s.view();
    const original = crit(v, 'evidence');
    // A synthetic submitted version (history) holding the item as it was.
    const out = authored(s.v7, { criteria: v.seed! });
    await db.taskSubmission.create({ data: { clientId, taskInstanceId: s.task.id, version: 1, output: out as object, submittedAt: new Date() } });
    await new Promise((r) => setTimeout(r, 20));
    await put(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/evidence`, { expectedVersion: original.annotationVersion, assesses: 'Changed after submission' });
    const r = await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/criteria/evidence/restore`, { submissionVersion: 1 });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().item).toMatchObject({ id: 'evidence', evaluatorKind: 'golden-kyc-rubric-v1' });
    expect(crit(await s.view(), 'evidence').details.assesses).toBe(original.details.assesses);
    const pmView = await get(pm, `/projects/${s.pid}/forge-tasks/${s.task.id}/rubric`);
    expect(pmView.statusCode, pmView.body).toBe(200);
    expect((pmView.json() as RubricView).criteria.map((c) => c.id)).toEqual(V7_IDS);
    // Someone who is not the task's Reviewer cannot read it.
    const other = await kit.signIn('other@gmail.test');
    expect((await get(other.cookie, `/me/reviews/${s.task.id}/rubric`)).statusCode).toBeGreaterThanOrEqual(403);
  });

  it('every write is the author’s, idempotent and audited; AI is refused when switched off', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    const key = idem();
    const once = await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.task.id}/rubric/runs`, headers: { cookie: s.me.cookie, ...key }, payload: { mode: 'DERIVED' } });
    const twice = await app.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.task.id}/rubric/runs`, headers: { cookie: s.me.cookie, ...key }, payload: { mode: 'DERIVED' } });
    expect(twice.body).toBe(once.body);
    expect(await db.rubricRecommendationRun.count({ where: { taskInstanceId: s.task.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'rubric.recommendations.generated' } })).toBe(1);
    const stranger = await kit.signIn('stranger@gmail.test');
    expect((await post(stranger.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' })).statusCode).toBe(404);
    const noAi = await buildApp({ config: testConfig({ RUBRIC_RECOMMENDATIONS_ENABLED: 'true' }), db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider(), rubricAssistant: null });
    const r = await noAi.inject({ method: 'POST', url: `/api/v1/me/tasks/${s.task.id}/rubric/runs`, headers: { cookie: s.me.cookie, ...idem() }, payload: { mode: 'AI' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('RUBRIC_AI_OFF');
    expect((await noAi.inject({ method: 'GET', url: `/api/v1/me/tasks/${s.task.id}/rubric`, headers: { cookie: s.me.cookie } })).json().aiEnabled).toBe(false);
    await noAi.close();
  });

  it('the rubric tables are append-only in the database', async () => {
    const s = await setup();
    await s.save(authored(s.v7));
    await post(s.me.cookie, `/me/tasks/${s.task.id}/rubric/runs`, { mode: 'DERIVED' });
    const row = await db.rubricCriterionAnnotation.findFirstOrThrow({ where: { taskInstanceId: s.task.id } });
    await expect(db.$executeRawUnsafe(`UPDATE "RubricCriterionAnnotation" SET status = 'REMOVED' WHERE id = '${row.id}'`)).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "RubricRecommendationRun"`)).rejects.toThrow(/append-only/);
  });
  // ── D1: a case-selector template's target never goes above its number of cases ──

  it('D1: the target is capped at the case count (create and edit), the default is clamped, and sourced people without a task are listed', async () => {
    const s = await setup();
    const v7 = s.v7;
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v7.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const body = (o: object) => ({ authoringExperience: 'CLASSIC', reviewRoute: 'SME_PM', templateId: v7.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }], ...o });
    const tooMany = await post(pm, '/projects', body({ distinctTarget: 5 }));
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({ error: 'TARGET_ABOVE_CASES' });
    expect(tooMany.json().message).toBe('This template makes one task per product: 4 in all. Set the distinct-task target to 4 or fewer (you asked for 5).');
    const ok = await post(pm, '/projects', body({ distinctTarget: 4 }));
    expect(ok.statusCode, ok.body).toBe(201);
    const edit = await call(app, 'PATCH', pm, `/projects/${ok.json().id}`, { distinctTarget: 9 });
    expect(edit.statusCode).toBe(422);
    const dflt = await post(pm, '/projects', body({ name: `Q ${randomUUID().slice(0, 6)}` }));
    expect(dflt.statusCode, dflt.body).toBe(201);
    expect(dflt.json().distinctTarget).toBeLessThanOrEqual(4);
    const tpl = (await get(pm, `/templates/${v7.id}`)).json();
    expect(tpl).toMatchObject({ caseCount: 4, caseLabel: 'product' });

    // Resource assignments: a sourced SME with no task is listed with the reason.
    await kit.source(s.pid, 'SME', { email: 'fifth@gmail.test', first: 'Fifth', last: 'Person' });
    const people = (await get(pm, `/projects/${s.pid}/people`)).json();
    expect(people.withoutTask.items.map((p: { email: string }) => p.email)).toContain('fifth@gmail.test');
    expect(typeof people.withoutTask.openTasks).toBe('number');
  });
});

