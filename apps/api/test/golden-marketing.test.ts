import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_MARKETING_EXAMPLE, MARKETING_CAMPAIGN_TASK2_PROFILE, MARKETING_CAMPAIGN_TASK2_PROFILE_V2, MARKETING_T2_TOOLS, marketingTask2Graph, withRuleVersions, type CandidateRule } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage, stubScanner } from '../src/candidate/storage';
import { MemoryEmailSender } from '../src/lib/email';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { writeAudit } from '../src/platform/audit';
import { addDocumentVersion, loadVersionText } from '../src/policy/documents';
import { publishRuleSet } from '../src/policy/rule-sets';
import { createRuleFromCandidate, markReviewed } from '../src/policy/rules';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { marketingFormV2 } from '../src/jobs/marketing-form-v2';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Golden Task2, Marketing (owner, 12-13 Nov 2026): the VEYRA Hush One headphone launch as ONE reusable five-agent task.
 * The whole cycle runs here: Anvil's proposal (form, template block with target 1 and no quotas, execution v3 with the
 * agreed 0-4 rubric descriptor) creates a new workflow's DRAFT; an Admin publishes it; then project, policy rules,
 * staffing, authoring with the five-agent workflow, checks, Expert review, PM approval and the Approved Task Dataset.
 * Everything is fictional; no model is called and Anvil is not contacted.
 */
const SECRET = 'test-mock-secret';
const WORKFLOW = 'VEYRA Hush One headphone launch';
const PROFILE_ID = 'veyra-hush-one-launch-v1';
/** The reviewed Task2 rubric's criterion IDs, each bound to Keystone's Marketing evaluator. */
const CRITERION_IDS = ((GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: { id: string }[] } }).S7.criteria).map((c) => c.id);
const RUBRIC = { scale: 'zero_to_four', formula: 'criterion weight * level / 4', groups: { A: 10, B: 20, C: 15, D: 10, E: 15, F: 15, G: 15 }, minimum: { total: 80, adaptation: 12 }, critical_rule_ids: ['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06'] };

/** Anvil's proposal as Keystone assembles it from Praxis's form and graph (synthetic execution part). */
function proposal(rubric: object = RUBRIC) {
  return {
    schemaVersion: 'praxis.anvil.template-spec.v1',
    anvil_template_key: 'veyra-hush-one-launch',
    requirement: { reference: 'Golden-KYC-Marketing-approved-requirement-49172', summary: 'Golden Task2: VEYRA Hush One headphone launch, one reusable five-agent task.' },
    authoring: {
      profile: MARKETING_CAMPAIGN_TASK2_PROFILE,
      template: { domainName: 'Marketing', primaryWork: 'Plan and maintain a product launch campaign within budget authority.', verificationCriteria: 'Evidence, budget and policy agree; approvals bind exact versions.', humanGate: 'Publication and spending stay authorised human decisions.', skills: SKILLS, defaultTptMinutes: 240, defaultDistinctTarget: 1, coverageDimensions: {}, edgeCaseCatalog: [] },
    },
    execution: {
      schema_version: 'anvil.template-execution.v3',
      catalogue_version: '1.3.0',
      environment: { id: 'marketing-task2-us-v1', version: '1' },
      tools: MARKETING_T2_TOOLS.map((t) => ({ id: t, input_schema: { type: 'object' }, output_schema: { type: 'object' }, error_schema: { type: 'object' } })),
      evaluators: CRITERION_IDS.map((id) => ({ criterion_id: id, capability: { id: 'marketing-task2-evidence-v1', version: '1' }, evidence_source: 'run_evidence' })),
      output_schema: { type: 'object', properties: { outcome: { type: 'string' } }, required: ['outcome'], additionalProperties: true },
      rubric,
      paid_calls: false,
    },
    skills: { schema_version: 'anvil.template-skills.v1', authoring: { mandatory: SKILLS, languages: ['en'] }, reviewing: { mandatory: ['Campaign review'], languages: ['en'] } },
  };
}
const SKILLS = ['Paid search', 'Campaign planning', 'Marketing analytics'];
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

/** The Task2 company rules the worked case cites (handoff policies.json, fictional benchmark rules). */
const RULES: { key: string; title: string; requirement: string }[] = [
  { key: 'POL-01', title: 'SKU evidence', requirement: 'Claims need exact SKU evidence.' },
  { key: 'POL-04', title: 'Current local offer', requirement: 'Offer and destination must be current and local.' },
  { key: 'POL-13', title: 'Corpus is not demand', requirement: 'Corpus counts and confidence are not demand or CTR.' },
  { key: 'POL-14', title: 'Comparable evidence', requirement: 'Changes need dated comparable evidence.' },
  { key: 'POL-16', title: 'Visits and missing data', requirement: 'Clicks are not verified visits; missing is not zero.' },
  { key: 'POL-17', title: 'Commitments and limits', requirement: 'Account for outstanding commitments and limits.' },
  { key: 'POL-18', title: 'Version-bound authority', requirement: 'Version-bound environment-fixture authority required.' },
  { key: 'POL-23', title: 'Escalate gaps', requirement: 'Escalate unresolved consequential evidence gaps.' },
];

const rule = (r: (typeof RULES)[number]): CandidateRule => ({
  ruleKey: r.key,
  title: r.title,
  requirement: r.requirement,
  requirementType: 'obligation',
  visibility: 'agent_visible',
  applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
  prerequisites: [],
  precedence: [],
  exceptions: { kind: 'none', items: [] },
  effective: { from: null, to: null, conditionText: 'always' },
  evidenceNeeds: [],
  verificationHint: null,
  uncertainty: [],
  citations: [{ fieldPath: 'requirement', role: 'supports', quote: r.requirement, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null }],
});

describe('Golden Task2 (Marketing): the full Praxis cycle on the reusable VEYRA Hush One template', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  // The rubric editor, S4 picker and their submit checks are ON here (RUBRIC_RECOMMENDATIONS_ENABLED): Marketing must keep
  // working end to end with them, on its own 0-4 scale and groups.
  const config = testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString(), RUBRIC_RECOMMENDATIONS_ENABLED: 'true' });
  let clientId: string;
  let admin: string;
  let anvilKey: string;

  const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const patch = (cookie: string, url: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const ok = async (cookie: string, url: string, payload: object = {}) => {
    const r = await post(cookie, url, payload);
    expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
    return r;
  };

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    anvilKey = (await post(admin, '/api-clients', { name: 'Anvil QA', kind: 'ANVIL' })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const propose = (body: object) => app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: body });

  /** Anvil proposes the VEYRA template (a new workflow); an Admin publishes the draft. */
  async function published() {
    await post(admin, '/domains', { name: 'Marketing' });
    const res = await propose(proposal());
    expect(res.statusCode, res.body).toBe(201);
    const d = res.json().data;
    expect((await post(admin, `/templates/${d.template_version_id}/publish`)).statusCode).toBe(200);
    return { id: d.template_version_id as string, d };
  }

  async function publishRules(projectId: string, pmUserId: string) {
    return db.$transaction(
      async (tx) => {
        const audit = (a: Parameters<typeof writeAudit>[2]) => writeAudit(tx, { clientId, actorType: 'USER', actorId: pmUserId }, a);
        const base = { clientId, projectId, actorId: pmUserId };
        const text = `Veyra campaign rules (fictional Task2 benchmark rules)\n${RULES.map((r) => `${r.key}. ${r.requirement}`).join('\n')}`;
        const doc = await addDocumentVersion(tx, { storage, scanner: stubScanner, maxPages: 20 }, { ...base, meta: { title: 'Veyra campaign rules', category: 'Company rules' }, fileName: 'task2-rules.md', buf: Buffer.from(text, 'utf8'), origin: 'UPLOAD' }, audit);
        const docRef = { ...(await loadVersionText(storage, doc.version)), format: doc.version.format };
        const versions: Record<string, string> = {};
        for (const r of RULES) {
          const made = await createRuleFromCandidate(tx, { ...base, documentVersion: doc.version, doc: docRef, candidate: rule(r), origin: 'manual', editedById: pmUserId, ruleKey: r.key });
          await markReviewed(tx, { ...base, ruleVersionId: made.version.id, expectedContentHash: made.version.contentHash, required: true }, audit);
          versions[r.key] = made.version.id;
        }
        await publishRuleSet(tx, { ...base, expectedLatestVersion: null }, audit);
        return versions;
      },
      { timeout: 60_000 },
    );
  }

  async function staffedProject(templateId: string) {
    const pmUser = await createUser(clientId, ['PM']);
    const pm = await login(app, pmUser.email);
    const jd = (await post(pm, '/job-descriptions', { title: 'Campaign strategist (five-agent benchmark)', responsibilities: 'Author fictional campaign planning cases.', skills: SKILLS, wagePerTask: 120, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_EXPERT_PM', templateId, name: 'Golden Task2 pilot', taskMode: 'AUTHORING', distinctTarget: 1, maxPerExpert: 1, tptMinutes: 240, startDate: '2026-11-16', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    const versions = await publishRules(p.id, pmUser.id);
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    await ok(pm, `/projects/${p.id}/match`);
    const expertUser = await createUser(clientId, ['REVIEWER']);
    await ok(pm, `/projects/${p.id}/reviewers`, { userId: expertUser.id });
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Rae Planner' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'US', languages: [{ language: 'en', level: 'C2' }], specialties: SKILLS, skills: SKILLS, jurisdictions: ['US'], domainExperienceYears: 9, hoursPerWeek: 20, timezone: 'America/New_York', lastValidatedAt: new Date() } });
    await ok(pm, `/projects/${p.id}/assignments`, { candidateIds: [c.id] });
    for (const ev of await db.outboxEvent.findMany({ where: { name: 'candidate.assigned' }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, defaultHandlers({ email, config }), ev.id);
    const task = await db.taskInstance.findFirstOrThrow({ where: { projectId: p.id, assignedToId: c.id } });
    const sme = `praxis_candidate=${res.cookies.find((x) => x.name === 'praxis_candidate')!.value}`;
    return { pm, expert: await login(app, expertUser.email), sme, taskId: task.id, projectId: p.id as string, versions };
  }

  const view = async (sme: string, id: string) => (await get(sme, `/me/tasks/${id}`)).json();
  async function save(sme: string, id: string, output: object) {
    const t = await view(sme, id);
    return put(sme, `/me/tasks/${id}`, { output, activeSecondsDelta: 30, expectedRevision: t.revision });
  }
  async function submit(sme: string, id: string) {
    const t = await view(sme, id);
    return post(sme, `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations: {} });
  }
  async function stage(cookie: string, id: string, body: object) {
    const r = (await get(cookie, `/review/tasks/${id}`)).json();
    return post(cookie, `/review/tasks/${id}/stage-decision`, { expectedRevision: r.revision, expectedVersion: r.currentVersion, ...body });
  }

  it('Anvil\'s proposal creates a new multi-agent workflow with target 1 and no quotas; the old Phone workflow is untouched; a wrong rubric descriptor is refused', async () => {
    await post(admin, '/domains', { name: 'Marketing' });
    for (const bad of [{ ...RUBRIC, groups: { A: 20, B: 20, C: 15, D: 10, E: 15, F: 10, G: 10 } }, { ...RUBRIC, critical_rule_ids: ['CR01', 'CR02', 'CR03', 'CR04', 'CR05', 'CR06'] }, { ...RUBRIC, scale: 'pass_partial_fail' }]) {
      const r = await propose(proposal(bad));
      expect(r.statusCode, r.body).toBe(422);
      expect(JSON.stringify(r.json().data.errors)).toMatch(/rubric/);
    }
    const res = await propose(proposal());
    expect(res.statusCode, res.body).toBe(201);
    const d = res.json().data;
    expect(d).toMatchObject({ status: 'draft_created', version: 1, workflow: WORKFLOW, profile_id: PROFILE_ID });
    const t = await db.template.findUniqueOrThrow({ where: { id: d.template_version_id } });
    expect(t).toMatchObject({ status: 'DRAFT', agentMode: 'MULTI', defaultDistinctTarget: 1, profileId: PROFILE_ID });
    expect(t.coverageDimensions).toEqual({ dimensions: [], cells: [] });
    expect(t.edgeCaseCatalog).toEqual([]);
    expect((t.anvilSpec as { execution: { rubric: unknown } }).execution.rubric).toEqual(RUBRIC);
    // The template page shows "Defined by Anvil" (execution schema, rubric, roles) instead of the n/6 blueprint counter.
    expect((await get(admin, `/templates/${t.id}/anvil`)).json().definition).toEqual({
      anvilTemplateKey: 'veyra-hush-one-launch',
      executionSchemaVersion: 'anvil.template-execution.v3',
      rubricSummary: `0–4 scale, 7 groups, minimum 80; ${CRITERION_IDS.length} criteria mapped to evaluators`,
      roleIds: expect.arrayContaining([expect.any(String)]),
    });
    expect((await get(admin, `/templates/${t.id}/anvil`)).json().definition.roleIds).toHaveLength(5);
    const row = (await get(admin, '/templates/directory')).json().domains.flatMap((d: { rows: { templateId: string }[] }) => d.rows).find((r: { templateId: string }) => r.templateId === t.id);
    expect(row).toMatchObject({ definedByAnvil: true, hasBlueprint: false });
    expect(await db.template.count({ where: { workflowName: 'Launch of Noise Cancelling Phone' } })).toBe(0);
  });

  it('SME authors the Task2 case with the five-agent workflow; Expert passes; on form v1 the PM’s approval is refused because the benchmark could not receive it', async () => {
    const v = await published();
    const s = await staffedProject(v.id);

    // The SME gets the Task2 form and starts from the five-agent workflow.
    const t = await view(s.sme, s.taskId);
    expect(t.definition).toBe(`profile:${PROFILE_ID}`);
    expect(t.template).toMatchObject({ workflow: WORKFLOW, profileId: PROFILE_ID });
    expect(t.agentMode).toBe('MULTI');
    expect(t.startingGraph).toMatchObject({ agentMode: 'MULTI', templateVersion: 1 });
    expect(t.startingGraph.roles).toHaveLength(5);

    // The rubric editor reads Marketing's own conventions: levels 0-4, groups A-G, no KYC defaults, no criterion-level
    // whole-task failure (its critical rules are CR-01..CR-06).
    const rv = (await get(s.sme, `/me/tasks/${s.taskId}/rubric`)).json();
    expect(rv.template).toMatchObject({ scale: 'zero_to_four', criterionFailureSupported: false, fixedSet: true });
    expect(rv.template.scoreKeys.map((k: { points: number }) => k.points)).toEqual([4, 3, 2, 1, 0]);
    expect(JSON.stringify(rv)).not.toMatch(/partialCredit|golden-kyc/);
    // D22: every criterion arrives filled from the template (name, group, weight, Level 4 / 2 / 0), never KYC's 5/2/0,
    // and "what should the agent do?" explains it.
    const golden = (GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: Record<string, unknown>[] } }).S7.criteria;
    expect(rv.template.weightsFromTemplate).toBe(true);
    for (const g of golden) {
      expect(rv.seed.find((x: { id: string }) => x.id === g.id)).toMatchObject({ name: g.name, group: g.group, weight: g.weight, passCondition: g.passCondition, level2: g.level2, failCondition: g.failCondition, critical: g.id === 'E3' });
      expect(rv.criteria.find((x: { id: string }) => x.id === g.id)).toMatchObject({ origin: 'TEMPLATE_DEFAULT', defaults: { name: g.name }, details: { assesses: g.passCondition } });
    }
    // D28: when it applies and where it comes from arrive from the template; E3 arrives critical with CR-05's condition.
    const a1 = rv.criteria.find((x: { id: string }) => x.id === 'A1');
    expect(a1.details.applicability).toMatchObject({ kind: 'REQUIRED', condition: 'Required throughout this workflow.' });
    expect(a1.needs).toEqual([]);
    expect(a1.links[0]).toMatchObject({ kind: 'TEMPLATE_REFERENCE', label: 'Template rubric · A1 Relevance', state: 'OK' });
    expect(rv.criteria.find((x: { id: string }) => x.id === 'E3').details.wholeTaskFailure.condition).toMatch(/CR-05/);
    expect(rv.seed.find((x: { id: string }) => x.id === 'A1')).toMatchObject({ level3: expect.stringMatching(/^Between Level 4 and Level 2/), level1: expect.stringMatching(/^Between Level 2 and Level 0/) });
    // A criterion whose suggestions were stored before D28 (Undefined, no source, no condition) shows the template's.
    await db.rubricCriterionAnnotation.create({ data: { clientId, taskInstanceId: s.taskId, criterionId: 'E3', version: 1, origin: 'TEMPLATE_DEFAULT', status: 'ACTIVE', exportable: true, details: { ...rv.criteria.find((x: { id: string }) => x.id === 'E3').details, applicability: { kind: 'UNSET', condition: '', exceptions: '' }, wholeTaskFailure: null }, sources: [], editedFields: [], aiFields: [], createdById: randomUUID() } });
    const e3 = (await get(s.sme, `/me/tasks/${s.taskId}/rubric`)).json().criteria.find((x: { id: string }) => x.id === 'E3');
    expect(e3).toMatchObject({ annotationVersion: 1, needs: [], details: { applicability: { kind: 'REQUIRED' }, wholeTaskFailure: { condition: expect.stringMatching(/CR-05/) } } });
    expect(e3.links.map((l: { kind: string }) => l.kind)).toEqual(['TEMPLATE_REFERENCE']);
    // A task opened before the defaults existed holds criteria with only their IDs: opening it offers the template text.
    const shells = golden.map((g) => ({ id: g.id, name: g.id, weight: null, passCondition: '', level3: '', level2: '', level1: '', failCondition: '', critical: false, group: '', evaluatorKind: 'marketing-task2-evidence-v1', evaluatorVersion: '1' }));
    const early = structuredClone(withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions)) as unknown as { sections: { S7: { criteria: unknown[] } } };
    early.sections.S7.criteria = shells;
    const savedEarly = await save(s.sme, s.taskId, early);
    expect(savedEarly.statusCode, savedEarly.body).toBe(200);
    const reopened = (await get(s.sme, `/me/tasks/${s.taskId}/rubric`)).json();
    expect(reopened.seed).toHaveLength(golden.length);
    expect(reopened.seed[0]).toMatchObject({ id: golden[0]!.id, name: golden[0]!.name, weight: golden[0]!.weight, passCondition: golden[0]!.passCondition });

    // D21: S4 picks the project's published rules: each library rule carries its exact version, quotation and locator.
    const lib = (await get(s.sme, `/me/tasks/${s.taskId}/policy-library`)).json();
    const libRules = lib.documents.flatMap((d: { rules: unknown[] }) => d.rules) as { ruleKey: string; ruleVersionId: string; quote: string | null; locator: unknown }[];
    // Rule keys are stored with an `R-` prefix; the bound-versions check accepts either form.
    expect(libRules.map((r) => r.ruleKey).sort()).toEqual(RULES.map((r) => `R-${r.key}`).sort());
    for (const r of libRules) expect(r.ruleVersionId).toBe(s.versions[r.ruleKey.replace(/^R-/, '')]);
    expect(libRules.every((r) => !!r.quote)).toBe(true);
    // The worked case plus the workflow, with the project's published rule versions, passes every check.
    const output = { ...withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions), workflowGraph: marketingTask2Graph(1) };
    const saved = await save(s.sme, s.taskId, output);
    expect(saved.statusCode, saved.body).toBe(200);
    const sub = await submit(s.sme, s.taskId);
    expect(sub.statusCode, sub.body).toBe(200);
    const checks = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.taskId } })).checks as { results: { id: string; ok: boolean; message: string; severity?: string }[] };
    expect(checks.results.filter((c) => !c.ok && c.severity !== 'warning')).toEqual([]);
    // Advisory only: two steps are reached by exclusive routes, which the checker cannot tell from a parallel merge.
    expect(checks.results.filter((c) => !c.ok).map((c) => c.id)).toEqual(['graph.merge_without_join.0', 'graph.merge_without_join.1']);
    expect(checks.results.find((c) => c.id === 'policy.bound-versions')).toMatchObject({ ok: true });

    // Expert passes, PM approves: people decide at each stage.
    const ex = await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue });
    expect(ex.statusCode, ex.body).toBe(200);
    // Owner, 23 Nov 2026: approval runs the same package check as Validate. On this form (v1) the S4 policy citations do
    // not declare the sub-fields ADI Forge keeps from agents (appliesTo, rationale) as private, so the benchmark could not
    // receive the task: the PM's approval is refused with that reason (the form's problem, not the author's), nothing
    // enters the dataset, and the task stays waiting for approval. v2 fixes the form (next test).
    const approved = await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' });
    expect(approved.statusCode, approved.body).toBe(409);
    expect(approved.json()).toMatchObject({ error: 'NOT_EXPORTABLE' });
    expect(approved.json().message).toMatch(/fields ADI Forge keeps private/);
    expect(approved.json().message).toMatch(/not something the author can fix/);
    expect(approved.body).not.toMatch(/Name the output field|MISSING_BINDING|NO_EXECUTABLE_CONTRACT/);
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.taskId } })).toBe(0);
    expect(await db.taskInstance.findUniqueOrThrow({ where: { id: s.taskId } })).toMatchObject({ status: 'SUBMITTED', reviewStage: 'PM_APPROVAL' });

    // D26: the template's evaluators grade this form, so no per-task bound contract is compiled: no "Name the output
    // field…" blocker the author or PM cannot fix.
    const stored = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.taskId } })).checks as { export?: unknown };
    expect(stored.export).toBeUndefined();
    expect((await view(s.sme, s.taskId)).exportStatus).toBeNull();
    const review = (await get(s.pm, `/review/tasks/${s.taskId}`)).json();
    expect(review.id).toBe(s.taskId);
    expect(review.exportStatus).toBeNull();
  });

  it('D26 follow-up: form v2 declares S4 citation visibility; its draft keeps every RL Gym part; a task approved on v2 validates', async () => {
    const v1 = await published();
    const before = await db.template.findUniqueOrThrow({ where: { id: v1.id } });
    // Dry run: nothing is created; the report names the form change and the unchanged parts.
    const dry = await marketingFormV2(db, { templateId: v1.id, requestedBy: 'admin@test.local', apply: false });
    expect(dry).toMatchObject({ outcome: 'would_create', source: { version: 1, profileId: PROFILE_ID } });
    expect(dry.formChanges).toEqual([`profileId: ${PROFILE_ID} -> veyra-hush-one-launch-v2`, 'S4.policies.itemFields: ruleId, ruleVersion, locator, quote, appliesTo (private), rationale (private), exception (private)']);
    expect(await db.template.count({ where: { lineageId: before.lineageId } })).toBe(1);
    // Only an active Admin may ask for it.
    expect(await marketingFormV2(db, { templateId: v1.id, requestedBy: 'nobody@test.local', apply: true })).toMatchObject({ outcome: 'refused' });

    const made = await marketingFormV2(db, { templateId: v1.id, requestedBy: 'admin@test.local', apply: true });
    expect(made).toMatchObject({ outcome: 'created', draft: { version: 2, profileId: 'veyra-hush-one-launch-v2' } });
    const draft = await db.template.findUniqueOrThrow({ where: { id: made.draft!.templateId } });
    expect(draft).toMatchObject({ status: 'DRAFT', lineageId: before.lineageId, workflowName: WORKFLOW, agentMode: 'MULTI' });
    // RL Gym's parts travel verbatim; only the form differs, and it differs only in the declared citation visibility.
    const a = before.anvilSpec as Record<string, any>;
    const b = draft.anvilSpec as Record<string, any>;
    for (const k of ['anvil_template_key', 'requirement', 'execution', 'skills']) expect(b[k], k).toEqual(a[k]);
    expect(b.authoring.profile).toEqual(JSON.parse(JSON.stringify(MARKETING_CAMPAIGN_TASK2_PROFILE_V2)));
    expect(await db.auditEvent.count({ where: { entityId: draft.id, action: 'template.form_revised' } })).toBe(1);
    // A second run is refused (v2 is the newest version now); the published v1 is untouched.
    expect(await marketingFormV2(db, { templateId: v1.id, requestedBy: 'admin@test.local', apply: true })).toMatchObject({ outcome: 'refused' });
    expect(await db.template.findUniqueOrThrow({ where: { id: v1.id } })).toMatchObject({ status: 'PUBLISHED', profileId: PROFILE_ID });

    // An Admin publishes v2; a task authored and approved on it is exportable: no private exposure.
    expect((await post(admin, `/templates/${draft.id}/publish`)).statusCode).toBe(200);
    const s = await staffedProject(draft.id);
    expect((await view(s.sme, s.taskId)).template).toMatchObject({ profileId: 'veyra-hush-one-launch-v2' });
    const worked = withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions) as unknown as Record<string, any>;
    const output = { ...worked, profile: { ...worked.profile, id: 'veyra-hush-one-launch-v2' }, workflowGraph: marketingTask2Graph(1) };
    expect((await save(s.sme, s.taskId, output)).statusCode).toBe(200);
    const sub = await submit(s.sme, s.taskId);
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue })).statusCode).toBe(200);
    expect((await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' })).statusCode).toBe(200);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.taskId } });
    const run = await post(s.pm, `/projects/${s.projectId}/validate`, { recordIds: [record.id] });
    expect(run.statusCode, run.body).toBe(201);
    expect(run.json().results[0]).toMatchObject({ status: 'valid', issues: [] });
  });

  it('a single-agent workflow on the five-agent version, or a rubric group that does not add up, blocks submission', async () => {
    const v = await published();
    const s = await staffedProject(v.id);
    const good = withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions) as unknown as { sections: { S7: { criteria: { id: string; group: string }[] } } };
    const bad = JSON.parse(JSON.stringify(good)) as typeof good;
    bad.sections.S7.criteria.find((c) => c.id === 'B1')!.group = 'C';
    const single = { ...marketingTask2Graph(1), agentMode: 'SINGLE' as const, roles: [marketingTask2Graph(1).roles[0]!] };
    expect((await save(s.sme, s.taskId, { ...bad, workflowGraph: single })).statusCode).toBe(200);
    const refused = await submit(s.sme, s.taskId);
    expect(refused.statusCode).toBe(422);
    const text = JSON.stringify(refused.json());
    expect(text).toMatch(/group B \(Adaptation\) weights must total 20/);
  });
});
