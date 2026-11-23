import type { ApprovedTaskRecord, Prisma, Template } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTHORSHIP_VERSION, benchmarkInputProblems, edgeCaseProblems, templateVerifiers, verifierProblems } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from '../src/anvil/joint-template';
import { taskPackageProblem } from '../src/anvil/generic-package';
import { jcsSha256 } from '../src/anvil/jcs';
import { templateVersionHash } from '../src/routes/anvil-templates';
import { projectIdFromRlGym, rlgymProjectId } from '../src/anvil/rlgym-export';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { writeApprovedRecord } from '../src/dataset/approved-records';
import { loadKycV8Inputs, successorTemplate } from '../src/jobs/kyc-v8-successor';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call, forgeKit } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Studio's edge cases and verifiers, the task's benchmark fields, project export to the new RL Gym, SME review batches
 * and SME needs to Studio (adi-labs-design praxis/AUTHORING-SPEC-EDGE-CASES-VERIFIERS-BRANDING.md; AUTHORING-SNAPSHOT
 * 3.1-3.3). The RL Gym and Studio are a recording mock: no live call is ever made.
 */

// Spec 1.3 / 2.2 examples, as Studio's proposal builder sends them.
const EDGE_CASES = [
  { tag: 'sanctions_dob_mismatch', archetype: 'sanctions_near_match', complexity: 'multi_hop', products: ['individual', 'adult_joint', 'teen_joint', 'custodial'], context: 'Applicant applies for an individual checking account.', twist: "Sanctions screening returns a name match, but the listed person's date of birth differs from the applicant's.", source: 'inb-0045' },
  { tag: 'minor_without_tin', archetype: 'missing_doc', complexity: 'single_hop', products: ['teen_joint'], context: 'A teen joint account is opened.', twist: 'The minor has no TIN on file.' },
];
const SME_VERIFIERS = {
  schema: 'adi.verifier-blocks.v1',
  expected_values_from: 'sme',
  failure_taxonomy: ['STATE_MUTATION_ERROR', 'POLICY_VIOLATION', 'MISSING_PRECONDITION', 'UNSAFE_ACTION', 'QUALITY'],
  slots: [
    { id: 'expected_recommendation', criterion_id: 'decision', label: 'Expected recommendation', type: 'enum', choices: ['ready_for_approval', 'request_information', 'specialist_review', 'not_eligible_for_requested_product'], required: true },
    { id: 'reason_contains', criterion_id: 'decision', label: 'Rationale must contain', type: 'text', required: true },
  ],
  allowed_checks: [
    { table: 'findings', row: 'case', fields: { status: ['open', 'resolved'], issue: 'string' }, ops: ['exists_where', 'not_exists', 'equals'] },
    { table: 'referrals', row: 'any', fields: { specialty: ['sanctions', 'fraud', 'legal'], reason: 'string' }, ops: ['exists_where', 'not_exists', 'contains'] },
  ],
  blocks: [
    { id: 'decision.status', criterion_id: 'decision', kind: 'state', name: 'Recommendation recorded', table: 'recommendations', row: 'any', column: 'recommendation', op: 'equals', value: { slot: 'expected_recommendation' }, on_fail: 'STATE_MUTATION_ERROR', query_preview: 'SELECT recommendation FROM recommendations   -- must equal :expected_recommendation' },
    { id: 'screening.order', criterion_id: 'screening', kind: 'process', name: 'Screen before recommending', must_call: 'screening.check', before: 'recommend', on_fail: 'POLICY_VIOLATION' },
    { id: 'next_action.tone', criterion_id: 'next_action', kind: 'rubric', name: 'Request to the customer is clear and polite', rubric_id: 'customer_tone_polite', share_percent: 20, on_fail: 'QUALITY' },
  ],
};
const CASE_REF_VERIFIERS = { ...SME_VERIFIERS, expected_values_from: 'case_reference', slots: [], allowed_checks: [], blocks: SME_VERIFIERS.blocks.filter((b) => b.kind !== 'state') };

describe('Studio edge cases and verifiers (unit)', () => {
  it('accepts the public edge-case fields and refuses grading data', () => {
    expect(edgeCaseProblems(EDGE_CASES)).toEqual([]);
    const withRecipe = [{ ...EDGE_CASES[0], recipe: [{ collection: 'documents' }], outcome: { recommendation: 'specialist_review' } }];
    expect(edgeCaseProblems(withRecipe)).toEqual([expect.objectContaining({ pointer: '/authoring/edge_cases/0', private: true })]);
    expect(edgeCaseProblems([{ ...EDGE_CASES[0], reference_answers: {} }])[0]).toMatchObject({ private: true });
    expect(edgeCaseProblems([EDGE_CASES[0], EDGE_CASES[0]]).map((p) => p.message)).toEqual([expect.stringContaining('Duplicate')]);
  });

  it('accepts sme and case_reference verifiers; refuses slots on case_reference and case-reference values', () => {
    expect(verifierProblems(SME_VERIFIERS)).toEqual([]);
    expect(verifierProblems(CASE_REF_VERIFIERS)).toEqual([]);
    expect(verifierProblems({ ...SME_VERIFIERS, expected_values_from: 'case_reference' }).length).toBeGreaterThan(0);
    const caseRef = { ...CASE_REF_VERIFIERS, blocks: [{ ...SME_VERIFIERS.blocks[0], value: { case_reference: 'reference_answers.recommendation' } }] };
    expect(verifierProblems(caseRef)).toEqual([expect.objectContaining({ private: true })]);
  });

  it('reads Studio’s execution.verifier_blocks shape too, without case-reference paths', () => {
    const v = templateVerifiers({ authoring: {}, execution: { verifier_blocks: { schema_version: 'adi.verifier-blocks.v1', expected_values_from: 'case_reference', failure_taxonomy: ['QUALITY'], criteria: [{ criterion_id: 'decision', blocks: [{ id: 'decision.status', kind: 'state', table: 'recommendations', row: 'any', column: 'recommendation', op: 'equals', value: { case_reference: 'reference_answers.recommendation' }, on_fail: 'QUALITY' }] }] } } })!;
    expect(v.expectedValuesFrom).toBe('case_reference');
    expect(v.slots).toEqual([]);
    expect(v.blocks[0]).toMatchObject({ criterionId: 'decision', kind: 'state', valueSource: 'case_reference' });
    expect(JSON.stringify(v)).not.toContain('reference_answers.recommendation');
  });

  it('checks the SME’s values: required slots for approval, choices, allowed checks only', () => {
    const t = { edgeCases: EDGE_CASES.map((e) => ({ ...e, source: e.source ?? null, name: null })), verifiers: templateVerifiers({ authoring: { verifiers: SME_VERIFIERS } }) };
    const empty = { edgeCase: null, slots: {}, extraStateChecks: [] };
    expect(benchmarkInputProblems(empty, t)).toEqual([]);
    expect(benchmarkInputProblems(empty, t, { forApproval: true })).toHaveLength(2);
    expect(benchmarkInputProblems({ ...empty, slots: { expected_recommendation: 'approve_now' } }, t)[0]).toContain('must be one of');
    const ok = { edgeCase: 'sanctions_dob_mismatch', slots: { expected_recommendation: 'specialist_review', reason_contains: 'DOB mismatch on sanctions hit' }, extraStateChecks: [{ table: 'referrals', row: 'any' as const, column: 'specialty', op: 'exists_where' as const, value: 'sanctions' }] };
    expect(benchmarkInputProblems(ok, t, { forApproval: true })).toEqual([]);
    expect(benchmarkInputProblems({ ...ok, extraStateChecks: [{ table: 'recommendations', row: 'any', column: 'recommendation', op: 'equals', value: 'x' }] }, t)[0]).toContain('not allowed');
    expect(benchmarkInputProblems({ ...ok, extraStateChecks: [{ table: 'referrals', row: 'any', column: 'specialty', op: 'equals', value: 'sanctions' }] }, t)[0]).toContain('operator');
    expect(benchmarkInputProblems({ ...ok, edgeCase: 'unknown_case' }, t)[0]).toContain('not one of');
  });
});

const SECRET = 'test-mock-secret';
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const EMBEDDED = loadKycV8Inputs();
const WORKFLOW = 'KYC onboarding and refresh';
const ADMIN_EMAIL = 'admin@test.local';
const RLGYM = 'http://127.0.0.1:8200';
const STUDIO = 'http://127.0.0.1:8060';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

describe('Authoring with Studio and the RL Gym (integration, mocks only)', () => {
  let app: FastifyInstance;
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  let anvilKey: string;
  const calls: Call[] = [];
  let answer: (c: Call) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
  const fetchMock = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const c = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const a = answer(c);
    return { status: a.status, text: async () => JSON.stringify(a.body) };
  };
  const { setFlow, signIn, source, assign } = forgeKit(() => ({ app, pm, admin }), google);
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);
  const asGym = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${anvilKey}`, ...(method === 'POST' ? idem() : {}) }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString(), RLGYM_API_URL: RLGYM, RLGYM_WORKSPACE: 'adi-labs-research', RLGYM_FORGE_CLIENT_KEY: 'test-rlgym-forge-key', STUDIO_API_URL: STUDIO, STUDIO_TENANT_ID: '00000000-0000-4000-8000-0000000000aa', STUDIO_ACTOR_ID: '00000000-0000-4000-8000-0000000000bb' }),
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage: new MemoryStorage(),
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
      outboundFetch: fetchMock,
    });
  });
  beforeEach(async () => {
    await resetDb();
    calls.length = 0;
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: ADMIN_EMAIL, SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, ADMIN_EMAIL, 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    anvilKey = (await post(admin, '/api-clients', { name: 'RL Gym local', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** A Studio-shaped proposal: the KYC v7 joint proposal plus S4 edge cases and S7 verifiers. */
  const studioProposal = (verifiers: object = CASE_REF_VERIFIERS) => {
    const p = structuredClone(V7);
    p.anvil_template_key = `golden-kyc-${randomUUID().slice(0, 6)}`;
    p.authoring.edge_cases = structuredClone(EDGE_CASES);
    p.authoring.verifiers = structuredClone(verifiers);
    return p;
  };
  const propose = (body: object) => asGym('POST', '/integrations/anvil/templates/proposals', body);

  it('Studio proposal: edge_cases and verifiers are accepted and stored; grading data is refused', async () => {
    const ok = await asGym('POST', '/integrations/anvil/templates/validate', studioProposal());
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.valid).toBe(true);

    const leaky = studioProposal();
    leaky.authoring.edge_cases[0].recipe = [{ collection: 'documents', field: 'kind', op: 'equals', value: 'screening_result' }];
    leaky.authoring.edge_cases[0].outcome = { recommendation: 'specialist_review' };
    const refused = await asGym('POST', '/integrations/anvil/templates/validate', leaky);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().data.errors).toEqual([expect.objectContaining({ code: 'TP_PRIVATE_GRADING_DATA', pointer: '/authoring/edge_cases/0' })]);

    const caseRef = studioProposal({ ...CASE_REF_VERIFIERS, blocks: [{ ...SME_VERIFIERS.blocks[0], value: { case_reference: 'reference_answers.recommendation' } }] });
    expect((await asGym('POST', '/integrations/anvil/templates/validate', caseRef)).json().data.errors[0].code).toBe('TP_PRIVATE_GRADING_DATA');
    const unknown = studioProposal();
    unknown.authoring.notes = 'x';
    expect((await asGym('POST', '/integrations/anvil/templates/validate', unknown)).json().data.errors[0]).toMatchObject({ code: 'TP_SPEC_SHAPE', pointer: '/authoring/notes' });

    // Stored on the template version, shown on Templates → version detail (edge cases and read-only checks).
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const made = await propose(studioProposal());
    expect(made.statusCode, made.body).toBe(201);
    const versionId = made.json().data.template_version_id as string;
    const view = await get(pm, `/templates/${versionId}/benchmark`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json().edgeCases.map((e: { tag: string }) => e.tag)).toEqual(['sanctions_dob_mismatch', 'minor_without_tin']);
    expect(view.json().edgeCases[0]).toMatchObject({ archetype: 'sanctions_near_match', complexity: 'multi_hop', context: expect.any(String), twist: expect.any(String), source: 'inb-0045' });
    expect(view.json().checks).toMatchObject({ expectedValuesFrom: 'case_reference', slots: [], failureTaxonomy: expect.arrayContaining(['QUALITY']) });
    expect(view.json().checks.blocks.map((b: { kind: string }) => b.kind)).toEqual(['process', 'rubric']);
    // The contracts list the new authoring fields.
    const contracts = (await asGym('GET', '/integrations/anvil/templates/contracts')).json().data;
    expect(Object.keys(contracts.authoring_schema.properties)).toEqual(expect.arrayContaining(['edge_cases', 'verifiers']));
    expect(contracts.error_codes).toEqual(expect.arrayContaining(['TP_PRIVATE_GRADING_DATA', 'TP_EDGE_CASE_INVALID', 'TP_VERIFIERS_INVALID']));
  });

  // ── A published KYC v8 project with approved tasks, as in part 1, on a template carrying edge cases/verifiers ──

  async function publishedV8(verifiers: object | null): Promise<Template> {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (await post(admin, '/templates', { domainId, workflowName: WORKFLOW, primaryWork: 'Earlier KYC.', verificationCriteria: 'Earlier.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] })).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    const res = await propose(structuredClone(V7));
    expect(res.statusCode, res.body).toBe(201);
    const v7Id = res.json().data.template_version_id as string;
    expect((await post(admin, `/templates/${v7Id}/publish`)).statusCode).toBe(200);
    const v7 = await db.template.findUniqueOrThrow({ where: { id: v7Id } });
    const spec = structuredClone(EMBEDDED.spec) as JointTemplateSpec;
    spec.template_id = v7.lineageId;
    spec.version = v7.version + 1;
    spec.requirement.successor_of = { template_id: v7.lineageId, version: v7.version, template_sha256: jointHashes(jointTemplateSpec(v7)!).template_sha256 };
    const made = await successorTemplate(db, { v7TemplateId: v7.id, requestedBy: ADMIN_EMAIL, apply: true, spec });
    expect(made.outcome, JSON.stringify(made)).toBe('created');
    const id = made.v8!.templateVersionId!;
    // Fixture: the Studio parts a Golden KYC V9-style release carries (set before publication, as a proposal would).
    const row = await db.template.findUniqueOrThrow({ where: { id } });
    const anvilSpec = structuredClone(row.anvilSpec) as Record<string, any>;
    anvilSpec.authoring.edge_cases = structuredClone(EDGE_CASES);
    if (verifiers) anvilSpec.authoring.verifiers = structuredClone(verifiers);
    await db.template.update({ where: { id }, data: { anvilSpec } });
    expect((await post(admin, `/templates/${id}/publish`)).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }

  /** The RL Gym's qualification of the version, naming Studio's release (as the RL Gym sends it). */
  async function qualify(t: Template) {
    const res = await asGym('POST', '/integrations/anvil/templates/qualifications', { template_id: t.lineageId, version: t.version, template_version_hash: templateVersionHash(t), status: 'QUALIFIED', receipt_id: `tq-${randomUUID().slice(0, 12)}`, receipt: { rlgym_template_id: 'tpl_x5rwt6d5eu', rlgym_template_version: 9, spec_sha256: 'c'.repeat(64) } });
    expect(res.statusCode, res.body).toBeLessThan(300);
  }

  async function project(v8: Template, reviewRoute: 'SME_PM' | 'SME_EXPERT_PM' = 'SME_PM') {
    await setFlow(true);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: v8.skills, wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute, templateId: v8.id, name: `KYC November ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 4, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-11-05', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const projectId = created.json().id as string;
    expect((await post(pm, `/projects/${projectId}/submit`)).statusCode).toBe(200);
    return projectId;
  }

  /** Tasks with the embedded v8 outputs; `benchmark` per task; approved by a person when `approve`. */
  async function authored(projectId: string, o: { benchmark?: (i: number) => object | null; approve?: boolean; smeUserId?: string } = {}) {
    const reviewer = await createUser(clientId, ['ADMIN']);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const out: { taskId: string; record: ApprovedTaskRecord | null }[] = [];
    let i = 0;
    for (const { candidate } of EMBEDDED.successors.values()) {
      const value = candidate.output.sections.S1!.applicationType as string;
      const task = tasks.find((t) => (t.input as { slot: { case: { value: string } } }).slot.case.value === value)!;
      const sme = o.smeUserId ? { id: o.smeUserId } : await db.smeUser.create({ data: { clientId, contactEmail: `${value}-${randomUUID().slice(0, 4)}@sme.test` } });
      const cand = (await db.candidate.findFirst({ where: { smeUserId: sme.id } })) ?? (await db.candidate.create({ data: { clientId, smeUserId: sme.id } }));
      const benchmark = o.benchmark?.(i) ?? null;
      await db.taskInstance.update({ where: { id: task.id }, data: { status: o.approve === false ? 'IN_PROGRESS' : 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: candidate.output as unknown as Prisma.InputJsonValue, ...(benchmark ? { benchmark: benchmark as Prisma.InputJsonValue } : {}) } });
      await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: candidate.output as unknown as Prisma.InputJsonValue, checks: {} } });
      const record = o.approve === false ? null : await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
      out.push({ taskId: task.id, record });
      i += 1;
    }
    return out;
  }
  const packable = async <R extends { record: ApprovedTaskRecord | null }>(rows: R[]) => {
    const templates = new Map((await db.template.findMany()).map((t) => [t.id, t]));
    return rows.filter((r) => r.record && !taskPackageProblem({ record: r.record, template: templates.get(r.record.templateId)! }));
  };
  const pkgOf = async (recordId: string) => JSON.parse((await db.authoredTaskPackage.findUniqueOrThrow({ where: { recordId } })).content);

  it('sme template: approval needs every required slot; slot values go only to the private part', async () => {
    const v8 = await publishedV8(SME_VERIFIERS);
    const projectId = await project(v8);
    // Without the required expected results, a person cannot approve the task.
    const reviewer = await createUser(clientId, ['ADMIN']);
    const [first] = await authored(projectId, { approve: false });
    await expect(db.$transaction((tx) => writeApprovedRecord(tx, { taskId: first!.taskId, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }))).rejects.toMatchObject({ code: 'BENCHMARK_INPUT_INCOMPLETE' });
    await resetDb();
  });

  it('sme template: package private part carries slots, edge case and slice tags; the actor part never does', async () => {
    const v8 = await publishedV8(SME_VERIFIERS);
    const projectId = await project(v8);
    const slots = { expected_recommendation: 'specialist_review', reason_contains: 'DOB mismatch on sanctions hit' };
    const rows = await packable(await authored(projectId, { benchmark: () => ({ edgeCase: 'sanctions_dob_mismatch', slots, extraStateChecks: [{ table: 'referrals', row: 'any', column: 'specialty', op: 'exists_where', value: 'sanctions' }], version: 1 }) }));
    expect(rows.length).toBeGreaterThan(0);
    const pkg = await pkgOf(rows[0]!.record!.id);
    expect(pkg.private).toMatchObject({ edge_case: 'sanctions_dob_mismatch', archetype: 'sanctions_near_match', complexity: 'multi_hop', verifiers: { slots, extra_state_checks: [{ table: 'referrals', column: 'specialty', value: 'sanctions' }] } });
    const actor = JSON.stringify(pkg.actor);
    expect(actor).not.toContain('specialist_review');
    expect(actor).not.toContain('DOB mismatch');
    expect(actor).not.toContain('sanctions_dob_mismatch');
  });

  it('a template without edge cases or verifiers keeps its exact package bytes (no new keys)', async () => {
    const v8 = await publishedV8(null);
    await db.template.update({ where: { id: v8.id }, data: { anvilSpec: (() => { const s = structuredClone(v8.anvilSpec) as Record<string, any>; delete s.authoring.edge_cases; return s; })() } });
    const projectId = await project(await db.template.findUniqueOrThrow({ where: { id: v8.id } }));
    const rows = await packable(await authored(projectId));
    const pkg = await pkgOf(rows[0]!.record!.id);
    for (const k of ['edge_case', 'archetype', 'complexity', 'verifiers']) expect(pkg.private).not.toHaveProperty(k);
  });

  it('Golden KYC (case_reference): the SME sees edge cases and slice lists, no expected results; saving is checked and versioned', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const me = await signIn('sme-golden@gmail.test');
    const [row] = await authored(projectId, { approve: false, smeUserId: me.smeUserId });
    const view = await get(me.cookie, `/me/tasks/${row!.taskId}/benchmark`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ expectedValuesFrom: 'case_reference', slots: [], allowedChecks: [], editable: true, value: { edgeCase: null, version: 0 } });
    expect(view.json().edgeCases).toHaveLength(2);
    expect(JSON.stringify(view.json())).not.toContain('query_preview');
    const put = (body: object) => call(app, 'PUT', me.cookie, `/me/tasks/${row!.taskId}/benchmark`, body);
    expect((await put({ edgeCase: 'sanctions_dob_mismatch', expectedVersion: 0 })).statusCode).toBe(200);
    expect((await put({ edgeCase: 'minor_without_tin', expectedVersion: 0 })).statusCode).toBe(409);
    expect((await put({ edgeCase: 'unknown_case', expectedVersion: 1 })).statusCode).toBe(422);
    expect((await put({ edgeCase: null, slots: { expected_recommendation: 'x' }, expectedVersion: 1 })).statusCode).toBe(422);
    const saved = await db.taskInstance.findUniqueOrThrow({ where: { id: row!.taskId } });
    expect(saved.benchmark).toMatchObject({ edgeCase: 'sanctions_dob_mismatch', version: 1 });
    // Submitted tasks are read-only.
    await db.taskInstance.update({ where: { id: row!.taskId }, data: { status: 'SUBMITTED' } });
    expect((await put({ edgeCase: null, expectedVersion: 1 })).statusCode).toBe(409);
  });

  it('export: one rlgym.project-export.v1 with Idempotency-Key = export_sha256, slice tags and edge case per task; receipt kept', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const rows = await packable(await authored(projectId, { benchmark: (i) => (i === 0 ? { edgeCase: 'sanctions_dob_mismatch', slots: {}, extraStateChecks: [], version: 1 } : null) }));
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'req-1' } } } : { status: 404, body: {} });
    const state = await get(pm, `/projects/${projectId}/rlgym-export`);
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toMatchObject({ connected: true, canExport: true, rlgymTemplate: { id: 'tpl_x5rwt6d5eu', version: 9 } });
    const res = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ outcome: 'received', receipt: { new: rows.length } });
    const sent = calls.find((c) => c.url.endsWith('/exports'))!;
    // The RL Gym accepts only prj_[a-z0-9]{4,40}: Authoring sends prj_ + the UUID's hex, reversibly.
    const gymProject = rlgymProjectId(projectId);
    expect(gymProject).toMatch(/^prj_[a-z0-9]{4,40}$/);
    expect(projectIdFromRlGym(gymProject)).toBe(projectId);
    expect(sent.url).toBe(`${RLGYM}/api/v1/workspaces/adi-labs-research/projects/${gymProject}/exports`);
    expect(sent.headers.Authorization).toBe('Bearer test-rlgym-forge-key');
    const { export_sha256, ...rest } = sent.body;
    expect(sent.headers['Idempotency-Key']).toBe(export_sha256);
    expect(jcsSha256(rest)).toBe(export_sha256);
    expect(sent.body).toMatchObject({ schema: 'rlgym.project-export.v1', project_id: gymProject, template: { id: 'tpl_x5rwt6d5eu', version: 9, spec_sha256: 'c'.repeat(64), forge_template_id: v8.lineageId, forge_version: v8.version }, project_config: { mode: 'single_agent' } });
    expect(sent.body.tasks).toHaveLength(rows.length);
    for (const t of sent.body.tasks) {
      expect(t).toMatchObject({ schema: 'praxis.authored-task-export.v1', revision: 1, package_ref: `forge://packages/${t.package_sha256}`, case_selector: expect.objectContaining({ application_type: expect.any(String) }) });
      expect(t).not.toHaveProperty('package');
      // The package the RL Gym fetches by hash is served with exactly that hash.
      const pkg = await asGym('GET', `/packages/${t.package_sha256}`);
      expect(createHash('sha256').update(pkg.rawPayload).digest('hex')).toBe(t.package_sha256);
    }
    const focused = sent.body.tasks.find((t: { task_id: string }) => t.task_id === rows[0]!.record!.taskInstanceId);
    expect(focused).toMatchObject({ edge_case: 'sanctions_dob_mismatch', archetype: 'sanctions_near_match', complexity: 'multi_hop' });
    expect(focused.case_selector.edge_cases).toContain('sanctions_dob_mismatch');
    const after = await get(pm, `/projects/${projectId}/rlgym-export`);
    expect(after.json().exported).toBe(true);
    const sentIds = new Set(rows.map((r) => r.record!.id));
    for (const t of after.json().tasks as { recordId: string; inRlGym: boolean }[]) expect(t.inRlGym).toBe(sentIds.has(t.recordId));
    // Append-only.
    await expect(db.$executeRaw`DELETE FROM "RlGymProjectExport"`).rejects.toThrow();
  });

  it('export is off and says why when the RL Gym has not qualified the version; an unreachable RL Gym is recorded', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    await authored(projectId);
    expect((await get(pm, `/projects/${projectId}/rlgym-export`)).json()).toMatchObject({ canExport: false, reason: 'RL Gym hasn’t qualified this template version yet.' });
    expect((await post(pm, `/projects/${projectId}/rlgym-exports`)).statusCode).toBe(409);
    await qualify(v8);
    answer = () => ({ status: 503, body: { error: { code: 'UNAVAILABLE', message: 'down', request_id: 'r' } } });
    const res = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ outcome: 'unavailable', error: { code: 'UNAVAILABLE' } });
  });

  it('SME needs: raise an edge case in four parts, PM merges and sends to Studio; the task is held from export', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const a = await signIn('sme-a@gmail.test');
    const rows = await authored(projectId, { smeUserId: a.smeUserId });
    const ok = await packable(rows);
    expect(ok.length).toBeGreaterThan(0);
    const task = ok[0]!;
    const other = rows.find((r) => !ok.includes(r))!;
    const APP999 = { kind: 'new_case_kind', context: 'Applicant APP-999 (Elena Vance) applies for an individual checking account.', twist: 'Sanctions screening returns a name match for "Elena Vance", but the listed DOB is 1962-04-11 and the applicant is 1991-09-03.', expectedOutcome: 'Do not auto-reject; manual review, citing "DOB mismatch on sanctions hit".', complexity: 'multi_hop', archetype: 'sanctions_near_match' };
    const first = await post(a.cookie, `/me/tasks/${task.taskId}/needs`, APP999);
    expect(first.statusCode, first.body).toBe(201);
    const second = await post(a.cookie, `/me/tasks/${other.taskId}/needs`, { ...APP999, context: 'Applicant APP-1000 applies for an individual checking account.' });
    expect(second.statusCode).toBe(201);
    expect((await post(a.cookie, `/me/tasks/${task.taskId}/needs`, { ...APP999, twist: 'short' })).statusCode).toBe(400);
    // The PM sees both, merges the duplicate and sends one item with one evidence entry per SME need.
    const needs = (await get(pm, `/projects/${projectId}/needs`)).json().items;
    expect(needs).toHaveLength(2);
    expect((await post(pm, `/projects/${projectId}/needs/${second.json().id}/merge`, { intoId: first.json().id })).statusCode).toBe(200);
    answer = (c) => (c.url.endsWith('/inbox-items') ? { status: 202, body: { id: 'inb-0045' } } : c.url.endsWith('/inbox-items/inb-0045') ? { status: 200, body: { id: 'inb-0045', state: 'planned', planned_version: '10' } } : { status: 404, body: {} });
    const sent = await post(pm, `/projects/${projectId}/needs/${first.json().id}/send`, { summary: 'Sanctions name match with a different date of birth' });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ state: 'sent', studioItemId: 'inb-0045' });
    const inbox = calls.find((c) => c.url === `${STUDIO}/api/v1/inbox-items`)!;
    expect(Object.keys(inbox.body).sort()).toEqual(['evidence', 'kind', 'project_id', 'source', 'summary', 'template_id', 'version']);
    expect(inbox.body).toMatchObject({ kind: 'new_case_kind', source: 'adi-forge', template_id: 'tpl_x5rwt6d5eu', version: 9, project_id: projectId });
    expect(inbox.body.evidence).toHaveLength(2);
    expect(inbox.body.evidence[0]).toMatchObject({ context: APP999.context, twist: APP999.twist, expected_outcome: APP999.expectedOutcome, complexity: 'multi_hop', archetype: 'sanctions_near_match', task_id: task.taskId, raised_by: expect.stringMatching(/^sme-/) });
    expect(inbox.headers['X-Actor-Kind']).toBe('service');
    // Held from export: "Waiting for new case kind inb-0045".
    const state = (await get(pm, `/projects/${projectId}/rlgym-export`)).json();
    expect(state.tasks.find((t: { taskId: string }) => t.taskId === task.taskId).waitingFor).toBe('inb-0045');
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'r' } } } : c.url.endsWith('/inbox-items/inb-0045') ? { status: 200, body: { id: 'inb-0045', state: 'planned', planned_version: '10' } } : { status: 404, body: {} });
    const exp = await post(pm, `/projects/${projectId}/rlgym-exports`);
    // With every packable task held, nothing is sent (422); otherwise the export goes without the held task (201).
    expect([201, 422], exp.body).toContain(exp.statusCode);
    expect(exp.statusCode === 201 ? exp.json().notSent : exp.json().details.notSent).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.taskId, code: 'WAITING_FOR_NEW_CASE_KIND' })]));
    // Status read back from Studio and shown on the need.
    const refreshed = await post(pm, `/projects/${projectId}/needs/${first.json().id}/refresh`);
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json()).toMatchObject({ studioState: 'planned', planned_version: '10' });
    // The SME sees their need's state on the task.
    expect((await get(a.cookie, `/me/tasks/${task.taskId}/benchmark`)).json().needs[0]).toMatchObject({ state: 'sent', studioItemId: 'inb-0045', studioState: 'planned' });
    // A rejected need carries the reason back.
    const third = (await post(a.cookie, `/me/tasks/${task.taskId}/needs`, { kind: 'more_data', edgeCase: 'minor_without_tin', howMany: 5, why: 'Only one teen joint case without a TIN.' })).json();
    expect((await post(pm, `/projects/${projectId}/needs/${third.id}/reject`, { reason: 'Already planned for V10.' })).statusCode).toBe(200);
    expect((await get(a.cookie, `/me/tasks/${task.taskId}/benchmark`)).json().needs.find((n: { id: string }) => n.id === third.id)).toMatchObject({ state: 'rejected', rejectReason: 'Already planned for V10.' });
  });

  it('task correction end to end (owner, 23 Nov 2026): PM sends a run task back, the SME edits every field and resubmits, a person approves, Re-export sends revision 2 with the focus edge case', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    // A real SME, sourced and directly assigned by the PM, as on the project's Resource assignments tab.
    const anyTask = (await db.taskInstance.findMany({ where: { projectId } }))[0]!;
    const person = await source(projectId, 'SME', { email: 'sme-correction@gmail.test', first: 'John', last: 'Doe' });
    expect((await assign(projectId, person.id, anyTask.id)).statusCode).toBe(200);
    const me = await signIn('sme-correction@gmail.test');
    const rows = await packable(await authored(projectId, { smeUserId: me.smeUserId }));
    const t = rows[0]!.record!;
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'e1' } } } : c.url.includes('/sme-review-batches/') ? { status: 200, body: { data: { accepted: c.body.decisions.length, inbox_items: [] }, meta: { request_id: 'd1' } } } : { status: 404, body: {} });
    expect((await post(pm, `/projects/${projectId}/rlgym-exports`)).statusCode).toBe(201);
    const first = calls.filter((c) => c.url.endsWith('/exports')).at(-1)!.body.tasks.find((x: { task_id: string }) => x.task_id === t.taskInstanceId);
    expect(first).toMatchObject({ revision: 1, case_selector: { edge_cases: [] } });

    // 1. Benchmark review → Task needs correction, with a rationale.
    const batch = { schema: 'rlgym.sme-review-package.v1', batch_id: 'smr-0051', run_id: 'run-0228', project_id: projectId, template: {}, rubric: [], tasks: [{ task_id: t.taskInstanceId, revision: 1, episodes: [{ item_id: 'it-1', episode_id: 'ep-1', score: { score: 42.86, passed: false, failed_criteria: ['account_agreements'] }, criteria: [] }] }], synthetic: true };
    const ref = (await asGym('POST', `/projects/${rlgymProjectId(projectId)}/run-reviews`, batch)).json().forge_batch_ref as string;
    const rationale = 'The account agreements step does not say which agreements the applicant must sign.';
    const decided = await post(pm, `/projects/${projectId}/run-reviews/${ref}/decisions`, { decisions: [{ itemId: 'it-1', decision: 'task_correction', rationale }] });
    expect(decided.statusCode, decided.body).toBe(201);

    // 2. The SME sees it in Rework with the rationale, and every field is editable.
    const view = await get(me.cookie, `/me/tasks/${t.taskInstanceId}`);
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ status: 'REWORK', readOnly: false });
    expect(JSON.stringify(view.json().review)).toContain(rationale);
    const bench = (await get(me.cookie, `/me/tasks/${t.taskInstanceId}/benchmark`)).json();
    expect(bench.editable).toBe(true);
    const saveBench = await call(app, 'PUT', me.cookie, `/me/tasks/${t.taskInstanceId}/benchmark`, { edgeCase: 'sanctions_dob_mismatch', expectedVersion: bench.value.version });
    expect(saveBench.statusCode, saveBench.body).toBe(200);
    // The SME accepted the human-authorship terms when first writing the task; this fixture task skipped that step.
    const consent = await post(me.cookie, `/me/tasks/${t.taskInstanceId}/conversation/consent`, { version: AUTHORSHIP_VERSION, accepted: true });
    expect(consent.statusCode, consent.body).toBe(200);
    const output = structuredClone(view.json().output) as Record<string, any>;
    output.sections.S8.reviewerNotes = `${String(output.sections.S8.reviewerNotes ?? '')} The applicant must sign the deposit agreement and the e-sign consent.`.trim();
    const saved = await call(app, 'PUT', me.cookie, `/me/tasks/${t.taskInstanceId}`, { output, expectedRevision: view.json().revision });
    expect(saved.statusCode, saved.body).toBe(200);
    const rev = (await get(me.cookie, `/me/tasks/${t.taskInstanceId}`)).json().revision as number;
    // Review this revision and confirm human authorship (the task page's Review step).
    const reviewed = await post(me.cookie, `/me/tasks/${t.taskInstanceId}/conversation/review`, { expectedRevision: rev, ownWork: true, noExternalLlm: true, authorisedSources: true });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const submitted = await post(me.cookie, `/me/tasks/${t.taskInstanceId}/submit`, { expectedRevision: (await get(me.cookie, `/me/tasks/${t.taskInstanceId}`)).json().revision, syntheticDeclaration: true });
    expect(submitted.statusCode, submitted.body).toBeLessThan(300);

    // 3. A person approves it in the console (SME → PM route).
    const task = (await get(admin, `/projects/${projectId}/forge-tasks/${t.taskInstanceId}`)).json();
    const approved = await post(admin, `/projects/${projectId}/tasks/${t.taskInstanceId}/decision`, { decision: 'APPROVE', expectedVersion: task.expectedVersion, expectedRevision: task.expectedRevision, checklist: Object.fromEntries((task.checklist as { key: string }[]).map((c) => [c.key, true])) });
    expect(approved.statusCode, approved.body).toBeLessThan(300);
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } })).status).toBe('ACCEPTED');

    // 4. Re-export: revision 2 corrects revision 1, names the batch, and carries the focus edge case (D-012).
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: 0, superseding: 1, unchanged: c.body.tasks.length - 1, blocked: [] }, meta: { request_id: 'e2' } } } : { status: 404, body: {} });
    const again = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(again.statusCode, again.body).toBe(201);
    const sent = calls.filter((c) => c.url.endsWith('/exports')).at(-1)!.body.tasks.find((x: { task_id: string }) => x.task_id === t.taskInstanceId);
    expect(sent).toMatchObject({ revision: 2, corrects_revision: 1, sme_batch_id: 'smr-0051', edge_case: 'sanctions_dob_mismatch' });
    expect(sent.case_selector.edge_cases).toEqual(['sanctions_dob_mismatch']);
  });

  it('D-004: a PM assigns each task’s run review to its author or a project SME Reviewer; only that SME (or PM/Admin) decides; inboxes show what waits', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    // SME Reviewers exist on the SME → Expert → PM route.
    const projectId = await project(v8, 'SME_EXPERT_PM');
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const authorP = await source(projectId, 'SME', { email: 'author-d004@gmail.test', first: 'Ann', last: 'Author' });
    expect((await assign(projectId, authorP.id, tasks[0]!.id)).statusCode).toBe(200);
    const author = await signIn('author-d004@gmail.test');
    await source(projectId, 'REVIEWER', { email: 'reviewer-d004@gmail.test', first: 'Rae', last: 'Reviewer' });
    const reviewer = await signIn('reviewer-d004@gmail.test');
    const outsider = await signIn('outsider-d004@gmail.test');
    const rows = await authored(projectId, { smeUserId: author.smeUserId });
    const [t0, t1] = [rows[0]!.taskId, rows[1]!.taskId];
    const ep = (id: string) => ({ item_id: id, episode_id: id, score: 40, criteria: [] });
    const batch = { schema: 'rlgym.sme-review-package.v1', batch_id: 'smr-d004', run_id: 'run-d004', project_id: projectId, template: {}, rubric: [], tasks: [{ task_id: t0, revision: 1, episodes: [ep('a-1'), ep('a-2')] }, { task_id: t1, revision: 1, episodes: [ep('b-1')] }], synthetic: true };
    const ref = (await asGym('POST', `/projects/${projectId}/run-reviews`, batch)).json().forge_batch_ref as string;
    answer = (c) => (c.url.includes('/sme-review-batches/') ? { status: 200, body: { data: { accepted: c.body.decisions.length, inbox_items: [] }, meta: { request_id: 'd4' } } } : { status: 404, body: {} });

    // Staff bell (PM): both tasks need a reviewer. A staff Reviewer has no bell and can no longer decide.
    const kinds = async () => ((await get(pm, '/me/inbox')).json().items as { kind: string; count: number; href: string }[]).filter((i) => i.href.includes(projectId));
    expect(await kinds()).toEqual([expect.objectContaining({ kind: 'run_review_unassigned', count: 2, href: `/projects/${projectId}?tab=benchmark` })]);
    const staffReviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    expect((await get(staffReviewer, '/me/inbox')).statusCode).toBe(403);
    expect((await post(staffReviewer, `/projects/${projectId}/run-reviews/${ref}/decisions`, { decisions: [{ itemId: 'a-1', decision: 'agent_failure', rationale: 'x' }] })).statusCode).toBe(403);

    // Eligible: the author first, then the project's SME Reviewers. Anyone else is refused.
    const view = (await get(pm, `/projects/${projectId}/run-reviews`)).json().items[0];
    expect(view.tasks.find((x: { taskId: string }) => x.taskId === t0).eligible.map((e: { smeUserId: string; role: string }) => [e.smeUserId, e.role])).toEqual([[author.smeUserId, 'author'], [reviewer.smeUserId, 'reviewer']]);
    const assignTo = (taskId: string, smeUserId: string) => post(pm, `/projects/${projectId}/run-reviews/${ref}/assignments`, { taskId, smeUserId });
    expect((await assignTo(t0, outsider.smeUserId)).statusCode).toBe(422);
    expect((await assignTo(t0, author.smeUserId)).statusCode).toBe(201);
    const same = await assignTo(t0, author.smeUserId);
    expect(same.json().unchanged, same.body).toBe(true);
    expect((await assignTo(t1, reviewer.smeUserId)).statusCode).toBe(201);
    expect(await kinds()).toEqual([expect.objectContaining({ kind: 'run_review_waiting', count: 3 })]);

    // Each SME sees only their tasks' episodes, and may decide only those.
    const mine = (await get(author.cookie, '/me/run-reviews')).json().items;
    expect(mine).toHaveLength(1);
    expect(mine[0].items.map((i: { itemId: string }) => i.itemId)).toEqual(['a-1', 'a-2']);
    expect((await get(outsider.cookie, '/me/run-reviews')).json().items).toEqual([]);
    expect(((await get(reviewer.cookie, '/me/forge/inbox')).json().items as { kind: string; count: number }[])).toEqual([expect.objectContaining({ kind: 'run_review', count: 1, href: '/run-reviews' })]);
    const decideAs = (cookie: string, body: object) => post(cookie, `/me/run-reviews/${ref}/decisions`, body);
    expect((await decideAs(author.cookie, { decisions: [{ itemId: 'b-1', decision: 'agent_failure', rationale: 'Not mine.' }] })).statusCode).toBe(403);
    expect((await decideAs(outsider.cookie, { decisions: [{ itemId: 'a-1', decision: 'agent_failure', rationale: 'Not mine.' }] })).statusCode).toBe(403);
    const res = await decideAs(author.cookie, { decisions: [{ itemId: 'a-1', decision: 'task_correction', rationale: 'Step 4 names the wrong agreement.' }, { itemId: 'a-2', decision: 'agent_failure', rationale: 'The agent skipped screening.' }] });
    expect(res.statusCode, res.body).toBe(201);
    const sent = calls.filter((c) => c.url.includes('/sme-review-batches/')).at(-1)!;
    expect(sent.body.decisions[0]).toMatchObject({ item_id: 'a-1', decision: 'task_correction', decided_by: expect.any(String) });
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t0 } })).status).toBe('REWORK');
    // The author's bell now shows the Rework with the reason; the run review is done. Reassigning a decided task is refused.
    const authorBell = (await get(author.cookie, '/me/forge/inbox')).json().items as { kind: string; detail: string; href: string }[];
    expect(authorBell).toEqual([expect.objectContaining({ kind: 'rework', href: `/tasks/${t0}`, detail: expect.stringContaining('Step 4 names the wrong agreement.') })]);
    expect((await assignTo(t0, reviewer.smeUserId)).statusCode).toBe(409);
    // PM or Admin can still decide any task themselves.
    expect((await post(pm, `/projects/${projectId}/run-reviews/${ref}/decisions`, { decisions: [{ itemId: 'b-1', decision: 'environment_wrong', rationale: 'The sandbox lost the screening tool.' }] })).statusCode).toBe(201);
    expect(await kinds()).toEqual([]);
    expect(await db.auditEvent.count({ where: { action: 'run_review.assigned' } })).toBe(2);
    await expect(db.$executeRaw`DELETE FROM "RunReviewAssignment"`).rejects.toThrow();
  });

  it('SME review batches: received idempotently; a person decides; decisions go to the RL Gym; task_correction reopens the task', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const rows = await packable(await authored(projectId));
    const t = rows[0]!.record!;
    const batch = { schema: 'rlgym.sme-review-package.v1', batch_id: 'smr-0008', run_id: 'run-0107', project_id: projectId, template: {}, scoring_pass: { pass: 1, reason: 'first' }, rubric: [{ criterion_id: 'decision', configuration_id: 'c', version: 1, weight: 5, is_gate: false, skill_group: 'g' }], tasks: [{ task_id: t.taskInstanceId, revision: 1, episodes: [{ item_id: 'it-1', episode_id: 'ep-1', system: { id: 'm', version: '1', name: 'Mock' }, attempt: 1, case_id: 'kyc-1', score: 40, criteria: [], path: {}, timeline: [], final_output: {}, evidence: { sealed_sha256: 'a'.repeat(64), manifest_sha256: 'b'.repeat(64) }, suspected_cause: 'task', suspected_cause_source: 'rules' }, { item_id: 'it-2', episode_id: 'ep-2', criteria: [] }] }], synthetic: true };
    // The RL Gym calls back with the project ID it was given (prj_…); the UUID works too.
    const first = await asGym('POST', `/projects/${rlgymProjectId(projectId)}/run-reviews`, batch);
    expect(first.statusCode, first.body).toBe(202);
    const again = await asGym('POST', `/projects/${projectId}/run-reviews`, batch);
    expect(again.json().forge_batch_ref).toBe(first.json().forge_batch_ref);
    expect((await asGym('POST', `/projects/${projectId}/run-reviews`, { ...batch, batch_id: 'smr-9', tasks: [{ reference_answers: {} }] })).statusCode).toBe(422);
    expect((await asGym('POST', `/projects/${randomUUID()}/run-reviews`, { ...batch, batch_id: 'smr-10' })).statusCode).toBe(404);
    expect((await asGym('POST', '/projects/prj_unknown/run-reviews', { ...batch, batch_id: 'smr-11' })).statusCode).toBe(404);
    expect((await call(app, 'POST', pm, `/projects/${projectId}/run-reviews`, batch)).statusCode).toBe(403);
    const ref = first.json().forge_batch_ref as string;
    const list = (await get(pm, `/projects/${projectId}/run-reviews`)).json();
    expect(list.items[0]).toMatchObject({ batchId: 'smr-0008', items: [expect.objectContaining({ itemId: 'it-1', decision: null }), expect.objectContaining({ itemId: 'it-2' })] });
    // Console Home and the Benchmark tab are told the batch is waiting (owner, 23 Nov 2026).
    const waitingFor = async () => (await get(pm, '/run-reviews/waiting')).json().items.filter((w: { projectId: string }) => w.projectId === projectId);
    expect(await waitingFor()).toEqual([expect.objectContaining({ batchId: 'smr-0008', runId: 'run-0107', items: 2, waiting: 2, href: `/projects/${projectId}?tab=benchmark` })]);

    answer = (c) => (c.url.includes('/sme-review-batches/') ? { status: 200, body: { data: { accepted: c.body.decisions.length, inbox_items: [] }, meta: { request_id: 'r2' } } } : { status: 404, body: {} });
    const decide = (body: object) => post(pm, `/projects/${projectId}/run-reviews/${ref}/decisions`, body);
    expect((await decide({ decisions: [{ itemId: 'it-2', decision: 'grader_wrong', rationale: 'The grader misread the output.' }] })).statusCode).toBe(422);
    const res = await decide({ decisions: [{ itemId: 'it-1', decision: 'task_correction', rationale: 'The expiry date field is ambiguous.' }, { itemId: 'it-2', decision: 'rubric_correction', rationale: 'Criterion too strict.', criterionId: 'decision' }] });
    expect(res.statusCode, res.body).toBe(201);
    const sent = calls.find((c) => c.url.includes('/sme-review-batches/'))!;
    expect(sent.url).toBe(`${RLGYM}/api/v1/workspaces/adi-labs-research/sme-review-batches/smr-0008/decisions`);
    expect(sent.headers['Idempotency-Key']).toBeTruthy();
    expect(sent.body).toMatchObject({ schema: 'rlgym.sme-decisions.v1', batch_id: 'smr-0008', decisions: [{ item_id: 'it-1', decision: 'task_correction', rationale: expect.any(String), decided_by: expect.any(String) }, { item_id: 'it-2', criterion_id: 'decision' }] });
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } })).status).toBe('REWORK');
    expect(await waitingFor()).toEqual([]);
    // A decision is final.
    expect((await decide({ decisions: [{ itemId: 'it-1', decision: 'agent_failure', rationale: 'Changed my mind.' }] })).statusCode).toBe(409);
    await expect(db.$executeRaw`UPDATE "RunReviewDecision" SET "decision" = 'agent_failure'`).rejects.toThrow();

    // The corrected task, approved again as usual, is re-exported as revision 2 with corrects_revision and sme_batch_id.
    await qualify(v8);
    const reviewer = await createUser(clientId, ['ADMIN']);
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } });
    const output = structuredClone(task.output) as Record<string, any>;
    output.sections.S8.reviewerNotes = `${String(output.sections.S8.reviewerNotes ?? '')} Expiry date clarified.`.trim();
    await db.taskInstance.update({ where: { id: task.id }, data: { status: 'ACCEPTED', output } });
    await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: task.id, reviewerId: reviewer.id, reviewNotes: 'correction', duplicateDecision: null, decidedAt: new Date() }));
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: 0, superseding: 1, unchanged: c.body.tasks.length - 1, blocked: [] }, meta: { request_id: 'r3' } } } : { status: 404, body: {} });
    expect((await post(pm, `/projects/${projectId}/rlgym-exports`)).statusCode).toBe(201);
    const exported = calls.filter((c) => c.url.endsWith('/exports')).at(-1)!;
    expect(exported.body.tasks.find((x: { task_id: string }) => x.task_id === task.id)).toMatchObject({ revision: 2, corrects_revision: 1, sme_batch_id: 'smr-0008' });
  });
});
