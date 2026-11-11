import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyOutput, KYC_EXAMPLE_TASK, praxisContractIssues, sampleProfileOutput, setFieldValue, TEMPLATE_PROFILES, type KycTask, type SectionKey, type TemplateProfile } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const EDGE = 'Complex or circular ownership';
type Who = { cookie: string; smeUserId: string; candidateId: string };
const NON_KYC = TEMPLATE_PROFILES.filter((p) => p.storage === 'sections');
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

/** The KYC example with typed criterion bindings, so it compiles to an Anvil contract. */
const KYC_BOUND: KycTask = {
  ...structuredClone(KYC_EXAMPLE_TASK),
  rubric: {
    ...structuredClone(KYC_EXAMPLE_TASK.rubric!),
    criteria: [
      { id: 'C1', name: 'Escalates instead of approving', weight: 60, passCondition: 'Final disposition is ESCALATE', critical: true, outputField: 'disposition', comparison: 'json_equals', expectedValue: 'ESCALATE' },
      { id: 'C2', name: 'Rates the case high risk', weight: 40, passCondition: 'Risk rating is HIGH', outputField: 'risk_rating', comparison: 'json_equals', expectedValue: 'HIGH' },
    ],
    commonErrors: [{ description: 'Approving despite layered ownership', caughtBy: 'C1' }],
  },
};

describe('Wave 1 to Wave 3 template profiles: save, checks, agent view and Anvil export', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig();
  let clientId: string;
  let admin: string;
  let pm: string;

  const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  async function deliver(name: string) {
    for (const ev of await db.outboxEvent.findMany({ where: { name }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, defaultHandlers({ email, config }), ev.id);
  }

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** One expert's non-open authoring task on a fresh template for `workflowName`, plus a project reviewer. */
  async function authoringTask(workflowName: string, domain = 'Banking') {
    const domainId = (await db.domain.findFirst({ where: { clientId, name: domain } }))?.id ?? (await post(admin, '/domains', { name: domain })).json().id;
    const kyc = workflowName === 'KYC onboarding and refresh';
    const tpl = (
      await post(admin, '/templates', {
        domainId,
        workflowName,
        primaryWork: 'Author a realistic synthetic case with its reference solution and rubric.',
        verificationCriteria: 'Evidence, reference and rubric are consistent.',
        humanGate: 'A reviewer approves every task; the agent only recommends.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }, { key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate'] }], cells: [{ tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: kyc ? [{ name: EDGE, quota: 1, required: true }] : [],
      })
    ).json();
    expect((await post(admin, `/templates/${tpl.id}/publish`)).statusCode).toBe(200);
    const jd = (await post(pm, '/job-descriptions', { title: 'Analyst', responsibilities: 'Author cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (await post(pm, '/projects', { authoringExperience: 'CLASSIC', templateId: tpl.id, name: `P ${randomUUID().slice(0, 6)}`, taskMode: 'AUTHORING', distinctTarget: 2, maxPerExpert: 2, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-10-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] })).json();
    // Historical editing behaviour (no human-authorship consent step), as in the existing task tests.
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const r = await createUser(clientId, ['REVIEWER']);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: r.id })).statusCode).toBe(200);
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Ada Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC'], jurisdictions: [], domainExperienceYears: 8, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() } });
    const a: Who = { cookie: `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`, smeUserId, candidateId: c.id };
    expect((await post(pm, `/projects/${p.id}/assignments`, { candidateIds: [c.id] })).statusCode).toBe(200);
    await deliver('candidate.assigned');
    const mine = await db.taskInstance.findMany({ where: { projectId: p.id, assignedToId: c.id }, include: { slot: true } });
    const t = (kyc ? mine.find((x) => (x.input as { slot?: { edgeCase?: string | null } }).slot?.edgeCase === EDGE) : mine.find((x) => !x.slot?.isOpen)) ?? mine[0]!;
    return { a, id: t.id, reviewer: await login(app, r.email) };
  }

  const view = async (a: Who, id: string) => (await get(a.cookie, `/me/tasks/${id}`)).json();
  async function save(a: Who, id: string, output: object) {
    const t = await view(a, id);
    return put(a.cookie, `/me/tasks/${id}`, { output, activeSecondsDelta: 10, expectedRevision: t.revision });
  }
  async function submit(a: Who, id: string) {
    const t = await view(a, id);
    return post(a.cookie, `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations: {} });
  }
  async function accept(reviewer: string, id: string) {
    const t = (await get(reviewer, `/review/tasks/${id}`)).json();
    return post(reviewer, `/review/tasks/${id}/decision`, { expectedRevision: t.revision, checklist: allTrue, decision: 'ACCEPT' });
  }

  it.each(NON_KYC.map((p) => [p.catalogWorkflowName, p] as const))('%s: every section saves and reloads', async (name, profile: TemplateProfile) => {
    const { a, id } = await authoringTask(name, name.includes('Phone') || name.includes('Omnichannel') || name.includes('Paid Search') ? 'Digital Marketing' : 'Banking');
    expect((await view(a, id)).definition).toBe('generic');
    const full = sampleProfileOutput(profile);
    let out = emptyOutput(profile);
    for (const s of profile.sections) {
      for (const f of s.fields) out = setFieldValue(profile, out, s.key as SectionKey, f.key, (full.sections as Record<string, Record<string, unknown>>)[s.key]![f.key]);
      const saved = await save(a, id, out);
      expect(saved.statusCode, saved.body).toBe(200);
      const reloaded = (await view(a, id)).output;
      expect(reloaded.sections[s.key], s.key).toEqual((out.sections as Record<string, unknown>)[s.key]);
    }
    expect((await view(a, id)).output).toEqual(full);
  });

  it('a save that does not match the profile is rejected with its problems', async () => {
    const profile = NON_KYC[0]!;
    const { a, id } = await authoringTask(profile.catalogWorkflowName);
    const bad = setFieldValue(profile, emptyOutput(profile), 'S1', 'title', 'A case');
    const res = await save(a, id, { ...bad, header: { title: 'Different' }, sections: { ...(bad.sections as object), S2: { evidence: 'not a list' } } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('INVALID_PROFILE_OUTPUT');
    expect(res.json().details.problems).toEqual(expect.arrayContaining(['sections.S2.evidence must be a list', 'header.title must equal sections.S1.title']));
    const other = await save(a, id, { ...bad, profile: { id: 'aml-transaction-monitoring-alerts', version: 1 } });
    expect(other.statusCode).toBe(422);
  });

  it.each(NON_KYC.map((p) => [p.catalogWorkflowName, p] as const))('%s: submit is blocked with precise section and field problems', async (name, profile: TemplateProfile) => {
    const { a, id } = await authoringTask(name);
    let out = setFieldValue(profile, emptyOutput(profile), 'S1', 'title', 'An incomplete case');
    out = setFieldValue(profile, out, 'S2', 'evidence', [{ id: 'E1', type: 'other', source: '', date: '', content: '' }]);
    expect((await save(a, id, out)).statusCode).toBe(200);
    const res = await submit(a, id);
    expect(res.statusCode).toBe(422);
    const failed = res.json().details.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { id: string; section: string }) => `${c.section}:${c.id}`);
    expect(failed).toEqual(expect.arrayContaining(['S1:profile.S1.businessContext', 'S2:profile.S2.evidence[0].content', 'S6:profile.S6.' + profile.sections[5]!.fields[0]!.key, 'S7:profile.S7.criteria', 'S8:profile.S8.sourcesUsed']));
    expect(failed).not.toContain('S1:profile.S1.title');
    if (profile.profileId === 'enhanced-due-diligence') expect(failed).toContain('S5:profile.S5.humanHandoff');
    if (profile.profileId === 'customer-risk-rating') expect(failed).toEqual(expect.arrayContaining(['S5:profile.S5.factorAssessments', 'S6:profile.S6.override']));
    if (profile.profileId === 'q4-global-paid-search-query-clustering') expect(failed).toEqual(expect.arrayContaining(['S5:profile.S5.clusters', 'S5:profile.S5.queryAssignments', 'S5:profile.S5.exclusions', 'S6:profile.S6.assignment']));
    if (profile.profileId === 'fraud-risk-and-compliance-handoffs') expect(failed).toEqual(expect.arrayContaining(['S5:profile.S5.handoffPackage', 'S6:profile.S6.recommendation']));
    if (profile.profileId === 'compliance-monitoring') expect(failed).toEqual(expect.arrayContaining(['S5:profile.S5.obligationAssessments', 'S5:profile.S5.proposedFollowUp', 'S6:profile.S6.severity']));
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
  });

  it.each(NON_KYC.map((p) => [p.catalogWorkflowName, p] as const))('%s: agent preview excludes private fields', async (name, profile: TemplateProfile) => {
    const { a, id } = await authoringTask(name);
    expect((await save(a, id, sampleProfileOutput(profile))).statusCode).toBe(200);
    const res = await get(a.cookie, `/me/tasks/${id}/agent-preview`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('PRIVATE-');
    expect(res.json().task).toMatchObject({ profile: { id: profile.profileId, version: 1 }, title: 'Title (synthetic sample)' });
    expect(res.json().task.sections.S2.evidence[0]).toEqual({ id: 'E1', type: profile.sections[1]!.fields[0]!.options![0]!.value, source: 'Source / issuer (synthetic sample)', date: '2026-05-01', content: 'Content (synthetic sample)' });
  });

  it.each(['kyb-and-beneficial-ownership', 'enhanced-due-diligence', 'q4-global-paid-search-query-clustering', 'fraud-risk-and-compliance-handoffs', 'compliance-monitoring'])('%s: a profile task submits, is approved and exports its compiled contract to Anvil', async (profileId) => {
    const profile = NON_KYC.find((p) => p.profileId === profileId)!;
    const { a, id, reviewer } = await authoringTask(profile.catalogWorkflowName, profile.templateId.startsWith('DM') ? 'Digital Marketing' : 'Banking');
    expect((await save(a, id, sampleProfileOutput(profile))).statusCode).toBe(200);
    const sub = await submit(a, id);
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await view(a, id)).exportStatus).toEqual({ status: 'ready', profile: { id: profile.profileId, version: 1 }, blockers: [] });
    expect((await get(reviewer, `/review/tasks/${id}`)).json().exportStatus.status).toBe('ready');
    const decision = await accept(reviewer, id);
    expect(decision.statusCode, decision.body).toBe(200);
    const recordId = decision.json().recordId;
    const exp = await get(admin, `/dataset/records/${recordId}/praxis-contract`);
    expect(exp.statusCode, exp.body).toBe(200);
    const contract = exp.json();
    expect(praxisContractIssues(contract)).toEqual([]);
    expect(contract).toMatchObject({ schema_version: 'praxis.anvil.task.v1', task_id: id, environment: { binding: 'structured-decision-v1' }, provenance: { classification: 'synthetic' } });
    expect(JSON.stringify(contract.evidence.filter((e: { visibility: string }) => e.visibility === 'actor'))).not.toContain('PRIVATE-');
    const envelope = await get(admin, `/dataset/records/${recordId}/praxis-contract?envelope=true`);
    expect(envelope.statusCode).toBe(200);
    const env = envelope.json();
    expect(env).toMatchObject({ schema_version: 'praxis.anvil.export.v1', source: { record_id: recordId, client_id: clientId } });
    expect(env.payload_sha256).toBe(createHash('sha256').update(env.payload_json).digest('hex'));
    expect(JSON.parse(env.payload_json)).toEqual(contract);
    const s6 = profile.sections[5]!.fields.filter((f) => f.outputField);
    for (const f of s6) expect(contract.rubric.reference_output[f.outputField!]).toBe(f.options![0]!.value);
  });

  it('a KYC workbench task submits, is approved and exports its compiled contract to Anvil', async () => {
    const { a, id, reviewer } = await authoringTask('KYC onboarding and refresh');
    expect((await view(a, id)).definition).toBe('kyc-onboarding-v1');
    expect((await save(a, id, KYC_BOUND)).statusCode).toBe(200);
    const sub = await submit(a, id);
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await view(a, id)).exportStatus.status).toBe('ready');
    const decision = await accept(reviewer, id);
    expect(decision.statusCode, decision.body).toBe(200);
    const envelope = await get(admin, `/dataset/records/${decision.json().recordId}/praxis-contract?envelope=true`);
    expect(envelope.statusCode, envelope.body).toBe(200);
    const env = envelope.json();
    expect(env.payload_sha256).toBe(createHash('sha256').update(env.payload_json).digest('hex'));
    const contract = JSON.parse(env.payload_json);
    expect(praxisContractIssues(contract)).toEqual([]);
    expect(contract.rubric.reference_output).toEqual({ disposition: 'ESCALATE', risk_rating: 'HIGH' });
    expect(JSON.stringify(contract)).not.toContain('PRIVATE-');
  });

  it('blocked export never blocks submission: the task shows the adapter blocker', async () => {
    const { a, id, reviewer } = await authoringTask('KYC onboarding and refresh');
    expect((await save(a, id, KYC_EXAMPLE_TASK)).statusCode).toBe(200);
    expect((await submit(a, id)).statusCode).toBe(200);
    const status = (await view(a, id)).exportStatus;
    expect(status.status).toBe('blocked');
    expect(status.blockers[0]).toMatchObject({ code: 'MISSING_BINDING', path: 'rubric.criteria[0].outputField' });
    expect((await db.taskInstance.findUniqueOrThrow({ where: { id } })).output).not.toHaveProperty('praxisContract');
    expect((await accept(reviewer, id)).statusCode).toBe(200);
    expect((await get(reviewer, `/review/tasks/${id}`)).json().exportStatus.status).toBe('blocked');
  });

  it('a legacy generic task still saves and submits as before', async () => {
    for (const workflow of ['Communications surveillance', 'KYB and beneficial ownership', 'Enhanced due diligence', 'Compliance monitoring']) {
      const { a, id } = await authoringTask(workflow);
      const legacy = { header: { title: `Legacy ${workflow}` }, body: `A synthetic ${workflow} case written in the generic editor, with evidence, steps and a decision.` };
      expect((await save(a, id, legacy)).statusCode).toBe(200);
      expect((await view(a, id)).output).toEqual(legacy);
      const res = await submit(a, id);
      expect(res.statusCode, res.body).toBe(200);
      const stored = await db.taskInstance.findUniqueOrThrow({ where: { id } });
      expect(stored.output).toEqual(legacy);
      expect((await view(a, id)).exportStatus).toBeNull();
      expect((stored.checks as { results: { id: string }[] }).results.some((c) => c.id.startsWith('profile.'))).toBe(false);
    }
  });
});
