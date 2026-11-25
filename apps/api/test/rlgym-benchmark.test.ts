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
  async function authored(projectId: string, o: { benchmark?: (i: number) => object | null; approve?: boolean; smeUserId?: string; output?: (i: number, output: any) => any } = {}) {
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
      const output = o.output ? o.output(i, structuredClone(candidate.output)) : candidate.output;
      await db.taskInstance.update({ where: { id: task.id }, data: { status: o.approve === false ? 'IN_PROGRESS' : 'ACCEPTED', assignedToId: cand.id, assignedAt: new Date(), submittedAt: new Date(), output: output as unknown as Prisma.InputJsonValue, ...(benchmark ? { benchmark: benchmark as Prisma.InputJsonValue } : {}) } });
      await db.taskSubmission.create({ data: { clientId, taskInstanceId: task.id, version: 1, output: output as unknown as Prisma.InputJsonValue, checks: {} } });
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

  it('D-056: S4 policy ids are mapped to the environment’s at export only; unmapped ones are flagged in Validate and Export, never guessed; packages are unchanged', async () => {
    const { buildRlGymExport } = await import('../src/anvil/rlgym-export');
    const { citedRules } = await import('../src/anvil/clause-export');
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const rows = await packable(await authored(projectId));
    const records = rows.map((r) => r.record!);
    const cites = citedRules(records[0]!.output);
    expect(cites.length).toBeGreaterThan(0);
    const before = await db.approvedTaskRecord.findMany({ where: { projectId }, orderBy: { seq: 'asc' } });
    // Validate: each cited policy with no mapping is a warning for ADI Forge support; it does not make the task need a fix.
    const v = await post(pm, `/projects/${projectId}/validate`, { recordIds: [records[0]!.id] });
    expect(v.statusCode, v.body).toBe(201);
    const flagged = (v.json().results[0].issues as { code: string }[]).filter((i) => i.code === 'POLICY_ID_UNMAPPED');
    expect(flagged).toHaveLength(cites.length);
    for (const i of flagged) expect(i).toMatchObject({ section: 'S4', owner: 'authoring', severity: 'warning', retryHelps: false, message: expect.stringContaining('policy.read') });
    expect(v.json().results[0].status).toBe('valid');
    // Export with no reviewed mapping (the shipped state): sent as before, no policy_id_map, flagged on the run.
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'req-1' } } } : { status: 404, body: {} });
    const res = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(res.statusCode, res.body).toBe(201);
    const sent = calls.find((c) => c.url.endsWith('/exports'))!;
    for (const t of sent.body.tasks) expect(t).not.toHaveProperty('policy_id_map');
    const run = await db.rlGymProjectExport.findFirstOrThrow({ where: { projectId } });
    for (const t of run.tasks as { warnings?: string[]; policyIdsUnmapped?: unknown[] }[]) {
      expect(t.warnings).toContain('POLICY_ID_UNMAPPED');
      expect(t.policyIdsUnmapped?.length).toBeGreaterThan(0);
    }
    // A reviewed mapping for this release: the export carries the environment's ids; the package bytes stay the same.
    const ref = { id: 'tpl_x5rwt6d5eu', version: 9, specSha256: 'c'.repeat(64) };
    const env = (id: string) => ({ id, version: 'golden-kyc-1.0.0', content_sha256: 'b'.repeat(64) });
    const map = { studio_template_id: ref.id, studio_version: ref.version, environment: 'golden-kyc-openenv', environment_policies: [env('KYC-01'), env('GB-02')], entries: [{ forge: { kind: 'document' as const, id: cites[0]!.ruleId, content_sha256: cites[0]!.contentSha256 }, environment_policy_ids: ['KYC-01', 'GB-02'], confirmed_by: 'owner', confirmed_at: '2026-11-24' }] };
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { template: true } });
    const mapped = await db.$transaction((tx) => buildRlGymExport(tx, p, records, ref, { exported: true, policyIdMap: map }));
    const first = mapped.body.tasks as { task_id: string; package_sha256: string; policy_id_map?: unknown }[];
    const t0 = first.find((t) => t.task_id === records[0]!.taskInstanceId)!;
    expect(t0.policy_id_map).toEqual([{ forge_rule_id: cites[0]!.ruleId, forge_content_sha256: cites[0]!.contentSha256, environment_policy_ids: ['KYC-01', 'GB-02'] }]);
    for (const t of first) expect(t.package_sha256).toBe((sent.body.tasks as { task_id: string; package_sha256: string }[]).find((x) => x.task_id === t.task_id)!.package_sha256);
    // An entry naming a policy the environment does not declare is flagged, not sent.
    const wrong = { ...map, entries: [{ ...map.entries[0]!, environment_policy_ids: ['KYC-09'] }] };
    const refused = await db.$transaction((tx) => buildRlGymExport(tx, p, records, ref, { exported: true, policyIdMap: wrong }));
    for (const t of refused.body.tasks as Record<string, unknown>[]) expect(t).not.toHaveProperty('policy_id_map');
    expect(refused.tasks.find((t) => t.taskId === records[0]!.taskInstanceId)!.policyIdsUnmapped![0]!.message).toMatch(/KYC-09/);
    // Nothing about the tasks or their approvals changed.
    expect(await db.approvedTaskRecord.findMany({ where: { projectId }, orderBy: { seq: 'asc' } })).toEqual(before);
  });

  it('E-007 phase 2: stronger checks on the frozen snapshot in Validate, approval and Export; JSON report; receipt; the RL Gym’s answer per task', async () => {
    const { approvalIntegrity } = await import('../src/tasks/revalidation');
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    // Task 0 names a step tool its S3 does not offer (as the custodial task of 23 Nov did).
    let dropped = '';
    const rows = await packable(
      await authored(projectId, {
        output: (i, out) => {
          if (i !== 0) return out;
          const used = (out.sections.S5.steps as { tool?: string }[]).map((st) => st.tool).filter(Boolean) as string[];
          dropped = used.find((t) => (out.sections.S3.tools as string[]).includes(t))!;
          out.sections.S3.tools = (out.sections.S3.tools as string[]).filter((t) => t !== dropped);
          return out;
        },
      }),
    );
    const bad = rows[0]!.record!;
    expect(dropped).not.toBe('');
    // JSON report: section, field, code, owner, retry.
    const report = await get(pm, `/projects/${projectId}/tasks/${bad.taskInstanceId}/check-report`);
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json()).toMatchObject({ schema: 'praxis.task-check-report.v1', taskId: bad.taskInstanceId, recordId: bad.id, status: 'fail', snapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const problems = report.json().problems as Record<string, unknown>[];
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) expect(p).toMatchObject({ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', field: expect.stringMatching(/^S5\.steps\[\d+\]\.tool$/), owner: 'author', retryHelps: false, severity: 'blocking', message: expect.stringContaining(dropped) });
    // Owner (24 Nov 2026): a task approved before the stronger checks is never blocked: its problems are warnings with
    // the explicit gap, and it still exports.
    const { taskCheckReport, CHECKS_GAP } = await import('../src/tasks/task-integrity');
    const tOld = await db.taskInstance.findUniqueOrThrow({ where: { id: bad.taskInstanceId }, include: { project: { include: { template: true } } } });
    const earlier = await taskCheckReport(db, tOld, bad.output, { ...bad, createdAt: new Date('2026-11-23T20:00:00Z') });
    expect(earlier).toMatchObject({ status: 'pass', gap: CHECKS_GAP });
    expect(earlier.problems.length).toBe(problems.length);
    for (const p of earlier.problems) expect(p).toMatchObject({ code: 'STEP_TOOL_NOT_OFFERED', severity: 'warning', message: expect.stringContaining('Approved before the stronger checks') });
    // Approval: the author's problem joins the D18 checks.
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: bad.taskInstanceId }, include: { project: { include: { template: true } } } });
    const integrity = await db.$transaction((tx) => approvalIntegrity(tx, t));
    expect(integrity.stop).toBeNull();
    expect(integrity.authorChecks.length).toBe(problems.length);
    for (const c of integrity.authorChecks) expect(c).toMatchObject({ id: 'integrity.STEP_TOOL_NOT_OFFERED', section: 'S5', ok: false });
    // Validate: the task needs a fix, and the issue says who fixes it.
    const v = await post(pm, `/projects/${projectId}/validate`, { recordIds: [bad.id] });
    expect(v.statusCode, v.body).toBe(201);
    expect(v.json().results[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', owner: 'author', retryHelps: false })]));
    expect(v.json().results[0].status).not.toBe('valid');
    // Export: the failing task is not sent, with why and who fixes it (here it was the only task, so nothing goes).
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'req-1' } } } : { status: 404, body: {} });
    const blocked = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(blocked.statusCode, blocked.body).toBe(422);
    expect(blocked.json().details.notSent).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: bad.taskInstanceId, code: 'CHECKS_FAILED', problems: expect.arrayContaining([expect.objectContaining({ code: 'STEP_TOOL_NOT_OFFERED', owner: 'author' })]) })]));
    expect(calls.some((c) => c.url.endsWith('/exports'))).toBe(false);

    // A clean project: the check report passes; the export carries ADI Forge's receipt and the RL Gym's answer per task.
    const cleanProject = await project(v8);
    const clean = await packable(await authored(cleanProject));
    expect(clean.length).toBeGreaterThan(0);
    expect((await get(pm, `/projects/${cleanProject}/tasks/${clean[0]!.record!.taskInstanceId}/check-report`)).json()).toMatchObject({ status: 'pass', problems: [] });
    const res = await post(pm, `/projects/${cleanProject}/rlgym-exports`);
    expect(res.statusCode, res.body).toBe(201);
    const run = await db.rlGymProjectExport.findFirstOrThrow({ where: { projectId: cleanProject } });
    const { receipt_sha256, ...rest } = run.authoringReceipt as Record<string, unknown>;
    expect(receipt_sha256).toBe(jcsSha256(rest));
    expect(rest).toMatchObject({ schema: 'praxis.export-receipt.v1', export_id: run.exportId, export_sha256: run.exportSha256, signature: null });
    expect((rest.not_sent as { code: string }[]).some((n) => n.code === 'CHECKS_FAILED')).toBe(false);
    const sentIds = clean.map((r) => r.record!.taskInstanceId);
    expect((rest.tasks as { task_id: string; snapshot_sha256: string; package_sha256: string; record_content_hash: string }[]).map((x) => x.task_id).sort()).toEqual([...sentIds].sort());
    for (const x of rest.tasks as { snapshot_sha256: string; package_sha256: string; check_report_sha256: string }[]) expect([x.snapshot_sha256, x.package_sha256, x.check_report_sha256].every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(res.json()).toMatchObject({ authoringReceiptSha256: receipt_sha256 });
    expect(Object.values(res.json().taskAnswers)).toEqual(Array(clean.length).fill('accepted'));
    // Exporting again with nothing changed: the RL Gym already has those revisions.
    const again = await post(pm, `/projects/${cleanProject}/rlgym-exports`);
    expect(again.statusCode, again.body).toBe(201);
    expect(Object.values(again.json().taskAnswers)).toEqual(Array(clean.length).fill('duplicate'));
    const state = (await get(pm, `/projects/${cleanProject}/rlgym-export`)).json();
    expect(state.runs[0]).toMatchObject({ authoringReceiptSha256: expect.stringMatching(/^[0-9a-f]{64}$/), taskAnswers: expect.any(Object) });
  });

  it('Owner small fix (24 Nov 2026): a PM corrects one field of an approved task without an SME; checks re-run; the earlier record is kept; Re-export sends the correction', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    let dropped = '';
    const rows = await packable(
      await authored(projectId, {
        output: (i, out) => {
          if (i !== 0) return out;
          const used = (out.sections.S5.steps as { tool?: string }[]).map((st) => st.tool).filter(Boolean) as string[];
          dropped = used.find((tl) => (out.sections.S3.tools as string[]).includes(tl))!;
          out.sections.S3.tools = (out.sections.S3.tools as string[]).filter((tl) => tl !== dropped);
          return out;
        },
      }),
    );
    const rec = rows[0]!.record!;
    const t = await db.taskInstance.findUniqueOrThrow({ where: { id: rec.taskInstanceId } });
    const tools = (t.output as any).sections.S3.tools as string[];
    const view = (await get(pm, `/projects/${projectId}/forge-tasks/${t.id}`)).json();
    expect(view).toMatchObject({ canCorrect: true, expectedRevision: t.revision });
    const correct = (body: object) => post(pm, `/projects/${projectId}/tasks/${t.id}/correct`, { section: 'S3', field: 'tools', reason: `Added ${dropped} to S3, because S5 uses it.`, expectedRevision: t.revision, ...body });
    // A correction that still fails the checks changes nothing.
    const still = await correct({ value: [...tools, 'search'] });
    expect(still.statusCode, still.body).toBe(422);
    expect(still.json().error).toBe('CORRECTION_FAILS_CHECKS');
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } })).revision).toBe(t.revision);
    expect((await correct({ value: tools })).statusCode).toBe(400);
    expect((await correct({ value: [...tools, dropped], expectedRevision: t.revision + 5 })).statusCode).toBe(409);
    expect((await correct({ value: [...tools, dropped], reason: 'short' })).statusCode).toBe(400);
    // The fix: every check passes; a new approved revision; the earlier record kept.
    const before = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: rec.id } });
    const ok = await correct({ value: [...tools, dropped] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'ACCEPTED', revision: t.revision + 1, previousRecordId: rec.id, recordKept: true });
    expect(await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: rec.id } })).toEqual(before);
    const next = await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: ok.json().recordId } });
    expect(((next.output as any).sections.S3.tools as string[])).toContain(dropped);
    expect(next.candidateId).toBe(before.candidateId);
    const after = await db.taskInstance.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ status: 'ACCEPTED', revision: t.revision + 1 });
    expect(await db.auditEvent.count({ where: { action: 'task.corrected_after_approval', entityId: t.id } })).toBe(1);
    expect((await get(pm, `/projects/${projectId}/tasks/${t.id}/check-report`)).json()).toMatchObject({ status: 'pass', problems: [] });
    // Re-export sends the corrected task as revision 2, correcting revision 1.
    answer = (c) => (c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'rq' } } } : { status: 404, body: {} });
    const exp = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(exp.statusCode, exp.body).toBe(201);
    const sent = calls.filter((c) => c.url.endsWith('/exports')).at(-1)!;
    expect(sent.body.tasks.find((x: { task_id: string }) => x.task_id === t.id)).toMatchObject({ revision: 2, corrects_revision: 1 });
  });

  it('E-001 §6b: families from Studio’s catalog; a task focused on a family exports every variant that counts; a single edge case reads as its family without being rewritten', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const anyTask = (await db.taskInstance.findMany({ where: { projectId } }))[0]!;
    const person = await source(projectId, 'SME', { email: 'sme-family@gmail.test', first: 'Fay', last: 'Mily' });
    expect((await assign(projectId, person.id, anyTask.id)).statusCode).toBe(200);
    const me = await signIn('sme-family@gmail.test');
    const catalog = {
      schema: 'edge-case-catalog.v2', template: { id: 'tpl_x5rwt6d5eu', version: 9 }, environment_key: 'golden-kyc-openenv', catalog_revision: 3,
      outcome_fields: [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowed_values: ['approve', 'request_information', 'refer'] }],
      families: [
        { family_id: 'expired_id', name: 'Expired ID', description: 'An identity document that is not valid on the application date.', archetype: 'missing_doc', complexity: 'single_hop', products: ['individual'], variants: [
          { variant_id: 'expired_document', tag: 'expired_document', name: 'Expired passport', description: '', boundary: null, proposed_by: 'sme', state: 'available', outcome: { decision: 'request_information', fields: {}, rationale: 'Ask for a current ID.', evidence: [], written_by: 'migration' }, cases_available: 40 },
          { variant_id: 'expires_today', tag: 'expires_today', name: 'Expires today', description: '', boundary: 'expires on the application date', proposed_by: 'rl_engineer', state: 'available', outcome: { decision: 'approve', fields: {}, rationale: 'Valid on the day.', evidence: ['document.read'], written_by: 'sme-0a1b2c3d' }, cases_available: 12 },
          { variant_id: 'expires_in_30', tag: 'expires_in_30', name: 'Expires within 30 days', description: '', boundary: null, proposed_by: 'rl_engineer', state: 'waiting_outcome', outcome: null, cases_available: 0 },
        ] },
      ],
    };
    answer = (c) => (c.url.includes('/edge-case-catalog') ? { status: 200, body: catalog } : c.url.endsWith('/exports') ? { status: 201, body: { data: { new: c.body.tasks.length, superseding: 0, unchanged: 0, blocked: [] }, meta: { request_id: 'rq' } } } : { status: 404, body: {} });
    // One task keeps a single edge case (as tasks authored before families do); one focuses on the family.
    await authored(projectId, { smeUserId: me.smeUserId, approve: false, benchmark: (i) => (i === 0 ? { edgeCase: 'expired_document', slots: {}, extraStateChecks: [], version: 1 } : null) });
    const single = (await db.taskInstance.findMany({ where: { projectId } })).find((x) => (x.benchmark as { edgeCase?: string } | null)?.edgeCase === 'expired_document')!;
    const before = structuredClone(single.benchmark);
    await db.taskInstance.update({ where: { id: single.id }, data: { status: 'IN_PROGRESS' } });
    const view = (await get(me.cookie, `/me/tasks/${single.id}/benchmark`)).json();
    expect(view.families).toMatchObject({ source: 'catalog', items: [{ familyId: 'expired_id', variants: expect.any(Array) }] });
    expect(view.families.items[0].variants.map((v: { tag: string; needsConfirmation: boolean }) => [v.tag, v.needsConfirmation])).toEqual([['expired_document', true], ['expires_today', false], ['expires_in_30', true]]);
    expect(JSON.stringify(view.families)).not.toContain('Ask for a current ID.');
    expect(view.focus).toMatchObject({ familyId: 'expired_id', derived: true });
    // Read-time only: the stored benchmark is unchanged.
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: single.id } })).benchmark).toEqual(before);
    // A focus on a variant without an outcome is refused; the family focus is saved.
    const put = (body: object) => call(app, 'PUT', me.cookie, `/me/tasks/${single.id}/benchmark`, { edgeCase: null, slots: {}, extraStateChecks: [], expectedVersion: 1, ...body });
    expect((await put({ familyFocus: { familyId: 'expired_id', variants: ['expires_in_30'] } })).statusCode).toBe(422);
    const saved = await put({ familyFocus: { familyId: 'expired_id', variants: 'all' } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ familyFocus: { familyId: 'expired_id', variants: 'all' }, edgeCase: null, version: 2 });
    // Approve it and export: the case selector carries every variant that counts (not the one waiting for an outcome).
    const reviewer = await createUser(clientId, ['ADMIN']);
    await db.taskInstance.update({ where: { id: single.id }, data: { status: 'ACCEPTED' } });
    await db.$transaction((tx) => writeApprovedRecord(tx, { taskId: single.id, reviewerId: reviewer.id, reviewNotes: null, duplicateDecision: null, decidedAt: new Date() }));
    const exp = await post(pm, `/projects/${projectId}/rlgym-exports`);
    expect(exp.statusCode, exp.body).toBe(201);
    const sent = calls.filter((c) => c.url.endsWith('/exports')).at(-1)!;
    const task = sent.body.tasks.find((x: { task_id: string }) => x.task_id === single.id);
    expect(task.case_selector.edge_cases.sort()).toEqual(['expired_document', 'expires_today']);
  });

  it('E-001 §6b outcome batches: the owner confirms migrated outcomes as Admin in one batch; an SME answers another with a second check; Studio gets outcome-request.v1 whole', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const anyTask = (await db.taskInstance.findMany({ where: { projectId } }))[0]!;
    const person = await source(projectId, 'SME', { email: 'sme-outcomes@gmail.test', first: 'Otto', last: 'Comes' });
    expect((await assign(projectId, person.id, anyTask.id)).statusCode).toBe(200);
    const me = await signIn('sme-outcomes@gmail.test');
    const fieldsDef = [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowed_values: ['approve', 'request_information', 'refer'] }, { name: 'request_type', label: 'Request type', help: '', required: false, allowed_values: ['proof_of_address', 'current_id'] }];
    const v = (id: string, extra: object) => ({ variant_id: id, tag: id, name: id.replace(/_/g, ' '), description: '', boundary: null, proposed_by: 'sme', cases_available: 10, ...extra });
    const catalog = { schema: 'edge-case-catalog.v2', template: { id: 'tpl_x5rwt6d5eu', version: 9 }, environment_key: 'golden-kyc-openenv', catalog_revision: 4, outcome_fields: fieldsDef, families: [
      { family_id: 'expired_id', name: 'Expired ID', variants: [v('expired_document', { state: 'available', outcome: { decision: 'request_information', fields: { request_type: 'current_id' }, rationale: 'Ask for a current, valid ID.', evidence: [], written_by: 'migration' } }), v('expires_in_30', { state: 'waiting_outcome', outcome: null })] },
      { family_id: 'id_document_set', name: 'Identity document set', variants: [v('passport_only', { state: 'available', outcome: { decision: 'request_information', fields: {}, rationale: 'Ask for a proof of address.', evidence: [], written_by: 'migration' } })] },
    ] };
    const posted: Call[] = [];
    answer = (c) => {
      if (c.url.includes('/edge-case-catalog')) return { status: 200, body: catalog };
      if (c.url.endsWith('/outcome-requests')) { posted.push(c); return { status: 202, body: { data: { accepted: c.body.outcomes.length, variants: [] } } }; }
      return { status: 404, body: {} };
    };
    const state = (await get(pm, `/projects/${projectId}/edge-outcomes`)).json();
    expect(state.catalog).toMatchObject({ source: 'catalog', revision: 4 });
    expect(state.waiting.map((w: { variantId: string; migrated: boolean }) => [w.variantId, w.migrated])).toEqual([['expired_document', true], ['expires_in_30', false], ['passport_only', true]]);

    // The owner: the two migrated outcomes, answered as Admin in one short batch.
    const made = await post(pm, `/projects/${projectId}/edge-outcomes/batches`, { variantIds: ['expired_document', 'passport_only'], answerer: 'admin' });
    expect(made.statusCode, made.body).toBe(201);
    const batch = made.json();
    expect(batch.items.map((i: { variantId: string; proposedOutcome: { decision: string } }) => [i.variantId, i.proposedOutcome.decision])).toEqual([['expired_document', 'request_information'], ['passport_only', 'request_information']]);
    expect((await post(pm, `/projects/${projectId}/edge-outcomes/batches`, { variantIds: ['passport_only'], answerer: 'admin' })).statusCode).toBe(409);
    const answerAs = (itemId: string, body: object) => call(app, 'PUT', pm, `/projects/${projectId}/edge-outcomes/batches/${batch.id}/items/${itemId}`, body);
    const [i1, i2] = batch.items as { id: string }[];
    expect((await answerAs(i1!.id, { verdict: 'confirm', decision: 'deny', fields: {}, rationale: 'Not allowed decision.', evidence: ['x1'] })).statusCode).toBe(422);
    expect((await answerAs(i1!.id, { verdict: 'confirm', decision: 'request_information', fields: { request_type: 'current_id' }, rationale: 'Ask for a current, valid ID.', evidence: [] })).statusCode).toBe(400);
    expect((await answerAs(i1!.id, { verdict: 'confirm', decision: 'request_information', fields: { request_type: 'current_id' }, rationale: 'Ask for a current, valid ID before approval.', evidence: ['the expiry date on the ID (document.read)'] })).statusCode).toBe(200);
    expect((await post(pm, `/projects/${projectId}/edge-outcomes/batches/${batch.id}/send`)).statusCode).toBe(422);
    expect((await answerAs(i2!.id, { verdict: 'confirm', decision: 'request_information', fields: {}, rationale: 'A passport proves identity, not the address.', evidence: ['no address document in documents.list'] })).statusCode).toBe(200);
    // An SME cannot answer an Admin batch.
    expect((await call(app, 'PUT', me.cookie, `/me/edge-outcomes/${batch.id}/items/${i1!.id}`, { verdict: 'cannot_decide', rationale: 'I would need the full file.' })).statusCode).toBe(403);
    const sent = await post(pm, `/projects/${projectId}/edge-outcomes/batches/${batch.id}/send`);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ state: 'sent' });
    const body = posted.at(-1)!.body;
    const { request_sha256, ...rest } = body;
    expect(request_sha256).toBe(jcsSha256(rest));
    expect(body).toMatchObject({ schema: 'outcome-request.v1', template: { id: 'tpl_x5rwt6d5eu', version: 9 }, second_check: false, request_id: batch.requestId });
    expect(body.outcomes[0]).toMatchObject({ variant_id: 'expired_document', family_id: 'expired_id', verdict: 'confirm', counts: true, decision: 'request_information', fields: { request_type: 'current_id' }, written_by: expect.stringMatching(/^admin-[0-9a-f]{8}$/) });
    expect(JSON.stringify(body)).not.toMatch(/@|Otto|admin@test/);
    expect((await post(pm, `/projects/${projectId}/edge-outcomes/batches/${batch.id}/send`)).statusCode).toBe(409);

    // An SME batch with a second check: the SME answers in the SME app; a PM checks; then it goes to Studio.
    const smeBatch = (await post(pm, `/projects/${projectId}/edge-outcomes/batches`, { variantIds: ['expires_in_30'], answerer: 'sme', smeUserId: me.smeUserId, secondCheck: true })).json();
    expect(((await get(me.cookie, '/me/forge/inbox')).json().items as { kind: string }[]).some((i) => i.kind === 'edge_outcomes')).toBe(true);
    const mine = (await get(me.cookie, '/me/edge-outcomes')).json().items;
    expect(mine[0]).toMatchObject({ id: smeBatch.id, outcomeFields: expect.any(Array), items: [expect.objectContaining({ variantId: 'expires_in_30', proposedOutcome: null })] });
    const item = mine[0].items[0].id as string;
    expect((await call(app, 'PUT', me.cookie, `/me/edge-outcomes/${smeBatch.id}/items/${item}?activeSeconds=120`, { verdict: 'confirm', decision: 'approve', fields: {}, rationale: 'Still valid on the application date.', evidence: ['expiry date vs application date'] })).statusCode).toBe(200);
    const before = posted.length;
    const submitted = await call(app, 'POST', me.cookie, `/me/edge-outcomes/${smeBatch.id}/submit`, {});
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json()).toMatchObject({ state: 'awaiting_check' });
    expect(posted.length).toBe(before);
    const checked = await post(pm, `/projects/${projectId}/edge-outcomes/batches/${smeBatch.id}/send`);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(posted.at(-1)!.body).toMatchObject({ second_check: true, outcomes: [{ variant_id: 'expires_in_30', written_by: expect.stringMatching(/^sme-[0-9a-f]{8}$/), checked_by: expect.stringMatching(/^admin-[0-9a-f]{8}$/) }] });
    expect(await db.auditEvent.count({ where: { action: 'outcome_batch.sent' } })).toBe(2);
    // Default c: SME time per week and person (reporting only).
    const { weekOf } = await import('../src/forge/outcome-batches');
    expect(weekOf(new Date('2026-11-26T10:00:00Z'))).toBe('2026-11-23');
    expect(weekOf(new Date('2026-11-23T00:00:00Z'))).toBe('2026-11-23');
    const time = (await get(pm, `/projects/${projectId}/edge-outcomes/time`)).json().rows as { who: string; kind: string; items: number; minutes: number; batches: number; week: string }[];
    expect(time.find((r) => r.kind === 'sme')).toMatchObject({ who: 'Otto Comes', items: 1, minutes: 2, batches: 1, week: weekOf(new Date()) });
    expect(time.find((r) => r.kind === 'admin')).toMatchObject({ items: 2, batches: 1, who: expect.stringContaining('(Admin, for an SME)') });
  });

  it('E-001 §6b: an SME raises a new edge-case family with its variants and outcomes; the PM sends it to Studio as new_edge_case_family; the task is not held', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const a = await signIn('sme-fam@gmail.test');
    const task = (await packable(await authored(projectId, { smeUserId: a.smeUserId })))[0]!;
    const FAMILY = {
      kind: 'new_edge_case_family',
      name: 'Deceased applicant',
      whyItMatters: 'Opening an account in a dead person’s name is a classic identity fraud route.',
      archetype: 'sanctions_near_match',
      variants: [
        { name: 'Death record match', description: 'Screening returns a death record for the applicant’s name and date of birth.', outcome: { counts: true, decision: 'refer', rationale: 'Possible identity fraud: a specialist must confirm.', evidence: ['screening.check result', 'date of birth on the ID'] } },
        { name: 'Death recorded yesterday', description: 'The death record is dated the day before the application.', boundary: 'one day before the application', outcome: { counts: false, rationale: 'Same as the first variant; it adds nothing to test.' } },
      ],
    };
    expect((await post(a.cookie, `/me/tasks/${task.taskId}/needs`, { ...FAMILY, variants: [{ ...FAMILY.variants[0], outcome: { counts: true, decision: 'refer', rationale: 'short', evidence: [] } }] })).statusCode).toBe(400);
    const raised = await post(a.cookie, `/me/tasks/${task.taskId}/needs`, FAMILY);
    expect(raised.statusCode, raised.body).toBe(201);
    expect(raised.json()).toMatchObject({ kind: 'new_edge_case_family', state: 'open' });
    const mine = (await get(a.cookie, `/me/tasks/${task.taskId}/benchmark`)).json();
    expect(mine.needs[0]).toMatchObject({ kind: 'new_edge_case_family', content: expect.objectContaining({ name: 'Deceased applicant' }) });
    answer = (c) => (c.url.endsWith('/inbox-items') ? { status: 202, body: { id: 'inb-0077' } } : { status: 404, body: {} });
    const sent = await post(pm, `/projects/${projectId}/needs/${raised.json().id}/send`, { summary: 'New family: deceased applicant' });
    expect(sent.statusCode, sent.body).toBe(200);
    const inbox = calls.filter((c) => c.url === `${STUDIO}/api/v1/inbox-items`).at(-1)!;
    expect(inbox.body).toMatchObject({ kind: 'new_edge_case_family', template_id: 'tpl_x5rwt6d5eu', version: 9 });
    expect(inbox.body.evidence[0]).toEqual({
      family: { name: 'Deceased applicant', why_it_matters: FAMILY.whyItMatters, archetype: 'sanctions_near_match' },
      variants: [
        { name: 'Death record match', description: FAMILY.variants[0]!.description, boundary: null, outcome: { verdict: 'confirm', decision: 'refer', rationale: 'Possible identity fraud: a specialist must confirm.', evidence: ['screening.check result', 'date of birth on the ID'] } },
        { name: 'Death recorded yesterday', description: FAMILY.variants[1]!.description, boundary: 'one day before the application', outcome: { verdict: 'reject', rationale: 'Same as the first variant; it adds nothing to test.' } },
      ],
      task_id: task.taskId,
      raised_by: expect.stringMatching(/^sme-[0-9a-f]{8}$/),
    });
    expect(JSON.stringify(inbox.body)).not.toContain('sme-fam@gmail.test');
    // Unlike a new case kind, a new family never holds the task from export (no re-authoring when it lands).
    expect((await get(pm, `/projects/${projectId}/rlgym-export`)).json().tasks.find((t: { taskId: string }) => t.taskId === task.taskId).waitingFor).toBeNull();
  });

  it('Owner (24 Nov 2026): an SME proposes a new variant of an existing family for PM/Admin review; Studio gets new_edge_case_variant; no task changes', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const a = await signIn('sme-variant@gmail.test');
    const task = (await packable(await authored(projectId, { smeUserId: a.smeUserId })))[0]!;
    const catalog = { schema: 'edge-case-catalog.v2', environment_key: 'golden-kyc-openenv', catalog_revision: 1,
      outcome_fields: [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowed_values: ['ready_for_approval', 'request_information'] }, { name: 'request_type', label: 'Request type', help: '', required: false, allowed_values: ['tin', 'none'] }, { name: 'reason_keyword', label: 'Reason keyword', help: '', required: false, suggested_values: ['TIN'] }],
      families: [{ family_id: 'minor_tin', name: "Minor's TIN", variants: [{ variant_id: 'minor_without_tin', tag: 'minor_without_tin', name: 'Without a TIN', state: 'available', outcome: { decision: 'request_information', written_by: 'migration' } }] }] };
    answer = (c) => (c.url.includes('/edge-case-catalog') ? { status: 200, body: catalog } : c.url.endsWith('/inbox-items') ? { status: 202, body: { id: 'inb-0090' } } : { status: 404, body: {} });
    const view = (await get(a.cookie, `/me/tasks/${task.taskId}/benchmark`)).json();
    expect(view.families.outcomeFields.map((f: { name: string }) => f.name)).toEqual(['recommendation', 'request_type', 'reason_keyword']);
    const before = await db.taskInstance.findUniqueOrThrow({ where: { id: task.taskId } });
    const VARIANT = { kind: 'new_edge_case_variant', familyId: 'minor_tin', name: 'TIN one digit short', meaning: 'The minor’s TIN is given but has 8 digits instead of 9.', twist: 'A TIN is present, so a quick check would pass it.', boundary: 'one digit short', outcome: { decision: 'request_information', fields: { request_type: 'tin', reason_keyword: 'TIN' }, rationale: 'An invalid TIN is the same as no TIN for CIP.', evidence: ['the TIN on the application (application.read)'] } };
    const raise = (body: object) => post(a.cookie, `/me/tasks/${task.taskId}/needs`, body);
    expect((await raise({ ...VARIANT, familyId: 'no_such_family' })).statusCode).toBe(422);
    expect((await raise({ ...VARIANT, name: 'Without a TIN' })).statusCode).toBe(422);
    expect((await raise({ ...VARIANT, outcome: { ...VARIANT.outcome, decision: 'approve' } })).statusCode).toBe(422);
    expect((await raise({ ...VARIANT, outcome: { ...VARIANT.outcome, fields: { request_type: 'passport' } } })).statusCode).toBe(422);
    const raised = await raise(VARIANT);
    expect(raised.statusCode, raised.body).toBe(201);
    expect(raised.json()).toMatchObject({ kind: 'new_edge_case_variant', state: 'open', content: expect.objectContaining({ familyName: "Minor's TIN" }) });
    // PM/Admin review: it waits with the PM until sent; then Studio gets it in the family.
    const needs = (await get(pm, `/projects/${projectId}/needs`)).json().items;
    expect(needs.find((n: { id: string }) => n.id === raised.json().id)).toMatchObject({ kind: 'new_edge_case_variant', state: 'open' });
    const sent = await post(pm, `/projects/${projectId}/needs/${raised.json().id}/send`, { summary: "New variant of Minor's TIN: TIN one digit short" });
    expect(sent.statusCode, sent.body).toBe(200);
    const inbox = calls.filter((c) => c.url === `${STUDIO}/api/v1/inbox-items`).at(-1)!;
    expect(inbox.body).toMatchObject({ kind: 'new_edge_case_variant', template_id: 'tpl_x5rwt6d5eu', version: 9 });
    expect(inbox.body.evidence[0]).toEqual({ family_id: 'minor_tin', variant: { name: 'TIN one digit short', meaning: VARIANT.meaning, twist: VARIANT.twist, boundary: 'one digit short', outcome: { verdict: 'confirm', decision: 'request_information', fields: { request_type: 'tin', reason_keyword: 'TIN' }, rationale: VARIANT.outcome.rationale, evidence: VARIANT.outcome.evidence } }, task_id: task.taskId, raised_by: expect.stringMatching(/^sme-[0-9a-f]{8}$/) });
    // Studio's state for the proposed variant reads back on the need: waiting for recipe.
    answer = (c) => (c.url.endsWith('/inbox-items/inb-0090') ? { status: 200, body: { id: 'inb-0090', state: 'received', catalog_variants: [{ tag: 'tin_one_digit_short', family_id: 'minor_tin', state: 'needs_recipe' }] } } : { status: 404, body: {} });
    expect((await post(pm, `/projects/${projectId}/needs/${raised.json().id}/refresh`)).statusCode).toBe(200);
    const read = (await get(pm, `/projects/${projectId}/needs`)).json().items.find((n: { id: string }) => n.id === raised.json().id);
    expect(read).toMatchObject({ studioState: 'received', studioDetail: { catalog_variants: [{ tag: 'tin_one_digit_short', state: 'needs_recipe' }] } });
    expect((await get(a.cookie, `/me/tasks/${task.taskId}/benchmark`)).json().needs[0]).toMatchObject({ studioDetail: { catalog_variants: [{ state: 'needs_recipe' }] } });
    // No change to the task.
    const after = await db.taskInstance.findUniqueOrThrow({ where: { id: task.taskId } });
    expect([after.status, after.revision, after.benchmark, after.output]).toEqual([before.status, before.revision, before.benchmark, before.output]);
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

  it('task-send-back job (owner, 23 Nov 2026, TSK-001): an Admin sends an approved task back to its author; the record is kept; dry run, refusals and a repeat change nothing', async () => {
    const { parseSendBackArgs, taskSendBack } = await import('../src/jobs/task-send-back');
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const anyTask = (await db.taskInstance.findMany({ where: { projectId } }))[0]!;
    const person = await source(projectId, 'SME', { email: 'sme-sendback@gmail.test', first: 'Sara', last: 'Back' });
    expect((await assign(projectId, person.id, anyTask.id)).statusCode).toBe(200);
    const me = await signIn('sme-sendback@gmail.test');
    const t = (await packable(await authored(projectId, { smeUserId: me.smeUserId })))[0]!.record!;
    const notes = 'S2 names parties.list, which S3 does not offer. S5 step 4 reads document contents with documents.list; use document.read.';
    expect(() => parseSendBackArgs(['--task', t.taskInstanceId, '--notes', notes])).toThrow(/requested-by/);
    expect(() => parseSendBackArgs(['--task', 'x', '--requested-by', ADMIN_EMAIL, '--notes', notes])).toThrow(/--task/);
    const args = parseSendBackArgs(['--task', t.taskInstanceId, '--requested-by', ADMIN_EMAIL, '--notes', notes]);
    expect(await taskSendBack(db, { ...args, requestedBy: 'sme-sendback@gmail.test' })).toMatchObject({ outcome: 'refused' });
    const audits = await db.auditEvent.count();
    expect(await taskSendBack(db, args)).toMatchObject({ outcome: 'planned', recordId: t.id, recordKept: true });
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } })).status).toBe('ACCEPTED');
    expect(await db.auditEvent.count()).toBe(audits);

    expect(await taskSendBack(db, { ...args, apply: true })).toMatchObject({ outcome: 'sent_back', recordId: t.id });
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } })).toMatchObject({ status: 'REWORK', reviewNotes: notes, reviewStage: null });
    expect(await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ contentHash: t.contentHash });
    expect(await db.auditEvent.count({ where: { action: 'task.sent_back_after_approval', entityId: t.taskInstanceId } })).toBe(1);
    // The SME sees it in Rework with the notes, editable, and in the bell.
    const view = (await get(me.cookie, `/me/tasks/${t.taskInstanceId}`)).json();
    expect(view).toMatchObject({ status: 'REWORK', readOnly: false });
    expect(JSON.stringify(view.review)).toContain('document.read');
    expect(((await get(me.cookie, '/me/forge/inbox')).json().items as { kind: string; detail: string }[])).toEqual([expect.objectContaining({ kind: 'rework', detail: notes })]);
    // A repeat is reported and writes nothing.
    expect(await taskSendBack(db, { ...args, apply: true })).toMatchObject({ outcome: 'already_sent_back' });
    expect(await db.auditEvent.count({ where: { action: 'task.sent_back_after_approval' } })).toBe(1);
  });

  it('Send back for rework (owner, 23 Nov 2026): the PM sends an approved task back from the task page; the record is kept; a stale or repeated request is refused', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const anyTask = (await db.taskInstance.findMany({ where: { projectId } }))[0]!;
    const person = await source(projectId, 'SME', { email: 'sme-button@gmail.test', first: 'Bea', last: 'Button' });
    expect((await assign(projectId, person.id, anyTask.id)).statusCode).toBe(200);
    const me = await signIn('sme-button@gmail.test');
    const t = (await packable(await authored(projectId, { smeUserId: me.smeUserId })))[0]!.record!;
    const view = (await get(pm, `/projects/${projectId}/forge-tasks/${t.taskInstanceId}`)).json();
    expect(view).toMatchObject({ status: 'ACCEPTED', canSendBack: true });
    const url = `/projects/${projectId}/tasks/${t.taskInstanceId}/send-back`;
    expect((await post(pm, url, { notes: 'short', expectedRevision: view.expectedRevision })).statusCode).toBe(400);
    expect((await post(pm, url, { notes: 'S5 step 4 should use document.read.', expectedRevision: view.expectedRevision + 1 })).statusCode).toBe(409);
    const sent = await post(pm, url, { notes: 'S5 step 4 should use document.read.', expectedRevision: view.expectedRevision });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'REWORK', recordId: t.id, recordKept: true });
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: t.taskInstanceId } })).toMatchObject({ status: 'REWORK', reviewNotes: 'S5 step 4 should use document.read.' });
    expect(await db.approvedTaskRecord.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ contentHash: t.contentHash });
    expect(await db.auditEvent.count({ where: { action: 'task.sent_back_after_approval', entityId: t.taskInstanceId } })).toBe(1);
    expect((await get(pm, `/projects/${projectId}/forge-tasks/${t.taskInstanceId}`)).json().canSendBack).toBe(false);
    expect((await post(pm, url, { notes: 'S5 step 4 should use document.read.', expectedRevision: view.expectedRevision + 1 })).statusCode).toBe(409);
    expect(((await get(me.cookie, '/me/forge/inbox')).json().items as { kind: string; detail: string }[])).toEqual([expect.objectContaining({ kind: 'rework', detail: 'S5 step 4 should use document.read.' })]);
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

  it('D-016: the SME drafts steps from business language (mock drafter); the reviewer sees the procedure with the tool guide’s warnings', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const person = await source(projectId, 'SME', { email: 'sme-d016@gmail.test', first: 'Sam', last: 'Steps' });
    expect((await assign(projectId, person.id, tasks[0]!.id)).statusCode).toBe(200);
    const me = await signIn('sme-d016@gmail.test');
    const [row] = await authored(projectId, { approve: false, smeUserId: me.smeUserId });
    const res = await post(me.cookie, `/me/tasks/${row!.taskId}/steps/translate`, { text: 'Screen both joint applicants. If either has an unresolved match, record the finding and refer the case according to policy. Submit the final recommendation with the evidence.' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ model: 'mock-step-translator-1', warnings: [], steps: [{ tool: 'screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] }, { tool: 'recommend' }] });
    expect((await post(me.cookie, `/me/tasks/${row!.taskId}/steps/translate`, { text: 'short' })).statusCode).toBe(400);
    const other = await signIn('not-the-author-d016@gmail.test');
    expect((await post(other.cookie, `/me/tasks/${row!.taskId}/steps/translate`, { text: 'Screen both joint applicants please.' })).statusCode).toBe(404);
    // Nothing was stored by drafting.
    const before = (await db.taskInstance.findUniqueOrThrow({ where: { id: row!.taskId } })).output as Record<string, any>;
    expect(JSON.stringify(before.sections.S5)).not.toContain('either has an unresolved match');

    // The reviewer's view: purposes, follow-ups and the guide's warnings for the task's own steps.
    const output = structuredClone(before);
    output.sections.S5.steps = [{ action: 'Perform watch-list screening on both applicants', tool: 'specialist.refer' }, { action: 'Screen both joint applicants.', tool: 'screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] }];
    await db.taskInstance.update({ where: { id: row!.taskId }, data: { output } });
    const view = (await get(admin, `/projects/${projectId}/forge-tasks/${row!.taskId}`)).json();
    expect(view.procedure.steps[1]).toEqual({ action: 'Screen both joint applicants.', tool: 'screening.check', toolLabel: 'Screen an applicant — screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] });
    expect(view.procedure.warnings.map((w: { code: string }) => w.code)).toEqual(['TOOL_PURPOSE_MISMATCH', 'CONDITIONAL_TOOL_AS_MAIN', 'NO_FINAL_RECOMMEND']);
    // The SME's own check shows them as warnings (never blocking).
    const checks = (await post(me.cookie, `/me/tasks/${row!.taskId}/check`)).json().checks as { id: string; ok: boolean; severity?: string }[];
    expect(checks.filter((c) => c.id.startsWith('steps.tool.')).every((c) => !c.ok && c.severity === 'warning')).toBe(true);
    expect(checks.some((c) => c.id === 'steps.tool.tool_purpose_mismatch.1')).toBe(true);
  });

  it('D-020: Help on a task knows the template’s edge cases, the task’s focus and the tool guide', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const person = await source(projectId, 'SME', { email: 'sme-d020@gmail.test', first: 'Hal', last: 'Help' });
    expect((await assign(projectId, person.id, tasks[0]!.id)).statusCode).toBe(200);
    const me = await signIn('sme-d020@gmail.test');
    const [row] = await authored(projectId, { approve: false, smeUserId: me.smeUserId });
    await db.taskInstance.update({ where: { id: row!.taskId }, data: { benchmark: { edgeCase: 'minor_without_tin', slots: {}, extraStateChecks: [], version: 1 } } });
    const res = await post(me.cookie, `/me/tasks/${row!.taskId}/help`, { question: 'Explain each item in the Focus on edge case dropdown: sanctions_dob_mismatch and minor_without_tin.' });
    expect(res.statusCode, res.body).toBe(200);
    // The local assistant answers from the help pack and the task's record, which now carries the edge cases.
    expect(res.json().answer).toMatch(/minor_without_tin|sanctions_dob_mismatch|FOCUS ON EDGE CASE/);
  });

  it('E-001 Q4: a task held 3 days waiting for a new case kind prompts the PM; releasing it drops the focus and it exports as a normal case', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    await qualify(v8);
    const projectId = await project(v8);
    const a = await signIn('sme-hold@gmail.test');
    const rows = await packable(await authored(projectId, { smeUserId: a.smeUserId, benchmark: (i) => (i === 0 ? { edgeCase: 'sanctions_dob_mismatch', slots: {}, extraStateChecks: [], version: 1 } : null) }));
    const task = rows[0]!;
    const need = await post(a.cookie, `/me/tasks/${task.taskId}/needs`, { kind: 'new_case_kind', context: 'Applicant APP-999 applies for an individual checking account.', twist: 'Sanctions screening returns a name match with a different date of birth.', expectedOutcome: 'Manual review, citing the DOB mismatch.', complexity: 'multi_hop', archetype: 'sanctions_near_match' });
    expect(need.statusCode, need.body).toBe(201);
    answer = (c) => (c.url.endsWith('/inbox-items') ? { status: 202, body: { id: 'inb-0077' } } : { status: 404, body: {} });
    expect((await post(pm, `/projects/${projectId}/needs/${need.json().id}/send`, { summary: 'Sanctions DOB mismatch' })).statusCode).toBe(200);
    const heldKinds = async () => ((await get(pm, '/me/inbox')).json().items as { kind: string; href: string }[]).filter((i) => i.kind === 'held_over_3_days' && i.href.includes(projectId));
    expect(await heldKinds()).toEqual([]);
    // Three days later the PM is asked.
    await db.smeNeed.update({ where: { id: need.json().id }, data: { sentAt: new Date(Date.now() - 4 * 86_400_000) } });
    expect(await heldKinds()).toEqual([expect.objectContaining({ kind: 'held_over_3_days' })]);
    // Release: only a held task; a reason is needed; the focus is dropped as a new benchmark version.
    expect((await post(pm, `/projects/${projectId}/held-tasks/${rows[1]?.taskId ?? randomUUID()}/release`, { reason: 'Not held.' })).statusCode).toBe(409);
    expect((await post(pm, `/projects/${projectId}/held-tasks/${task.taskId}/release`, { reason: '' })).statusCode).toBe(400);
    const rel = await post(pm, `/projects/${projectId}/held-tasks/${task.taskId}/release`, { reason: 'The bank needs months to generate these cases; export as a normal case.' });
    expect(rel.statusCode, rel.body).toBe(201);
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id: task.taskId } })).benchmark).toMatchObject({ edgeCase: null, version: 2 });
    expect(await heldKinds()).toEqual([]);
    const state = (await get(pm, `/projects/${projectId}/rlgym-export`)).json();
    expect(JSON.stringify(state.notSent ?? [])).not.toContain(task.taskId);
    await expect(db.$executeRaw`DELETE FROM "TaskHoldRelease"`).rejects.toThrow();
  });

  it('D-027: the SME checks a weak S1 trigger and gets plain findings and a rewrite; examples come from the template or say plainly they are not available', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const tasks = await db.taskInstance.findMany({ where: { projectId } });
    const person = await source(projectId, 'SME', { email: 'sme-d027@gmail.test', first: 'Cara', last: 'Coach' });
    expect((await assign(projectId, person.id, tasks[0]!.id)).statusCode).toBe(200);
    const me = await signIn('sme-d027@gmail.test');
    const [row] = await authored(projectId, { approve: false, smeUserId: me.smeUserId });
    const check = await post(me.cookie, `/me/tasks/${row!.taskId}/fields/coach`, { section: 'S1', field: 'trigger', mode: 'check', text: 'Application APP-999 for "Elena Vance" is submitted on 2026-03-14.' });
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toMatchObject({ reviewedBy: 'rules', findings: [expect.objectContaining({ kind: 'too_specific' })], rewrite: 'An application for the applicant is submitted on the application date.' });
    const ex = await post(me.cookie, `/me/tasks/${row!.taskId}/fields/coach`, { section: 'S1', field: 'trigger', mode: 'example' });
    expect([200, 503]).toContain(ex.statusCode);
    if (ex.statusCode === 200) expect(ex.json()).toMatchObject({ example: expect.any(String), avoid: expect.arrayContaining([expect.objectContaining({ why: expect.stringContaining('every application') })]) });
    else expect(ex.json().message).toContain('Use the field’s help text');
    expect((await post(me.cookie, `/me/tasks/${row!.taskId}/fields/coach`, { section: 'S1', field: 'nope', mode: 'check', text: 'x' })).statusCode).toBe(404);
    const other = await signIn('not-mine-d027@gmail.test');
    expect((await post(other.cookie, `/me/tasks/${row!.taskId}/fields/coach`, { section: 'S1', field: 'trigger', mode: 'check', text: 'x' })).statusCode).toBe(404);
  });

  it('E-007 phase 2: a Benchmark review item shows the run, score pass and evidence digest; Accept, Dispute or Can’t assess; a stale or superseded decision is refused', async () => {
    const v8 = await publishedV8(CASE_REF_VERIFIERS);
    const projectId = await project(v8);
    const t = (await packable(await authored(projectId)))[0]!.record!;
    const ep = (id: string, score: number) => ({ item_id: id, episode_id: `ep-${id}`, system: { id: 'm', version: '1', name: 'Mock' }, attempt: 1, case_id: 'kyc-1', score, criteria: [], path: {}, timeline: [], final_output: {}, suspected_cause: 'agent', suspected_cause_source: 'rules' });
    const batch = (batchId: string, pass: number, score: number) => ({ schema: 'rlgym.sme-review-package.v1', batch_id: batchId, run_id: 'run-0300', project_id: projectId, template: {}, scoring_pass: { pass, reason: pass === 1 ? 'first' : 'rescored' }, rubric: [], tasks: [{ task_id: t.taskInstanceId, revision: 1, episodes: [ep('it-1', score), ep('it-2', score)] }], synthetic: true });
    const first = await asGym('POST', `/projects/${projectId}/run-reviews`, batch('smr-p1', 1, 40));
    expect(first.statusCode, first.body).toBe(202);
    const ref1 = first.json().forge_batch_ref as string;
    const item = (await get(pm, `/projects/${projectId}/run-reviews`)).json().items[0].items[0];
    expect(item).toMatchObject({ itemId: 'it-1', runId: 'run-0300', scorePass: 1, evidenceSha256: jcsSha256(ep('it-1', 40)) });
    answer = (c) => (c.url.includes('/sme-review-batches/') ? { status: 200, body: { data: { accepted: c.body.decisions.length }, meta: { request_id: 'r' } } } : { status: 404, body: {} });
    const decide = (ref: string, body: object) => post(pm, `/projects/${projectId}/run-reviews/${ref}/decisions`, body);
    // Stale: the reviewer saw another score pass, or other evidence.
    expect((await decide(ref1, { scorePass: 2, decisions: [{ itemId: 'it-1', decision: 'agent_failure', rationale: 'Agent missed the expiry.' }] })).json().error).toBe('STALE_SCORE_PASS');
    expect((await decide(ref1, { scorePass: 1, decisions: [{ itemId: 'it-1', decision: 'agent_failure', rationale: 'Agent missed the expiry.', evidenceSha256: 'f'.repeat(64) }] })).json().error).toBe('EVIDENCE_CHANGED');
    // Accept, bound to pass 1 and the evidence; the RL Gym is told the verdict, pass and digest.
    const ok = await decide(ref1, { scorePass: 1, decisions: [{ itemId: 'it-1', decision: 'agent_failure', rationale: 'Agent missed the expiry.', evidenceSha256: item.evidenceSha256 }] });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().decisions[0]).toMatchObject({ verdict: 'accept', scorePass: 1, evidenceSha256: item.evidenceSha256 });
    expect(calls.filter((c) => c.url.includes('/sme-review-batches/')).at(-1)!.body.decisions[0]).toMatchObject({ item_id: 'it-1', decision: 'agent_failure', verdict: 'accept', score_pass: 1, evidence_sha256: item.evidenceSha256 });
    // Can't assess stays in ADI Forge: nothing is sent to the RL Gym.
    const before = calls.length;
    const cant = await decide(ref1, { scorePass: 1, decisions: [{ itemId: 'it-2', decision: 'cannot_assess', rationale: 'The timeline is empty, so I cannot judge it.' }] });
    expect(cant.statusCode, cant.body).toBe(201);
    expect(cant.json().decisions[0]).toMatchObject({ verdict: 'cannot_assess' });
    expect(calls.length).toBe(before);
    expect(await db.runReviewDecision.findFirstOrThrow({ where: { itemId: 'it-2' } })).toMatchObject({ verdict: 'cannot_assess', sendOutcome: 'kept_in_forge', scorePass: 1 });
    // The RL Gym re-scores the run (pass 2): the earlier decisions do not decide the new batch, and nothing more can be
    // decided on pass 1.
    const second = await asGym('POST', `/projects/${projectId}/run-reviews`, batch('smr-p2', 2, 55));
    const ref2 = second.json().forge_batch_ref as string;
    const list = (await get(pm, `/projects/${projectId}/run-reviews`)).json().items;
    const p2 = list.find((b: { batchId: string }) => b.batchId === 'smr-p2');
    expect(p2.items.map((i: { decision: unknown; scorePass: number }) => [i.scorePass, i.decision])).toEqual([[2, null], [2, null]]);
    const third = await asGym('POST', `/projects/${projectId}/run-reviews`, { ...batch('smr-p1b', 1, 40), tasks: [{ task_id: t.taskInstanceId, revision: 1, episodes: [ep('it-9', 40)] }] });
    expect(third.statusCode).toBe(202);
    const old = await decide(ref1, { scorePass: 1, decisions: [{ itemId: 'it-1', decision: 'grader_wrong', rationale: 'x', criterionId: 'decision' }] });
    expect(old.statusCode).toBe(409);
    // Deciding the newer pass works.
    const p2item = p2.items[0];
    const newer = await decide(ref2, { scorePass: 2, decisions: [{ itemId: 'it-1', decision: 'grader_wrong', rationale: 'The grader missed the cited evidence.', criterionId: 'decision', evidenceSha256: p2item.evidenceSha256 }] });
    expect(newer.statusCode, newer.body).toBe(201);
    expect(newer.json().decisions[0]).toMatchObject({ verdict: 'dispute', scorePass: 2 });
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
