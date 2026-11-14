import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_MARKETING_EXAMPLE, MARKETING_CAMPAIGN_TASK2_PROFILE, MARKETING_T2_TOOLS, marketingTask2Graph, withRuleVersions, type CandidateRule } from '@praxis/shared';
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
  const config = testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() });
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

  it('SME authors the Task2 case with the five-agent workflow; Expert passes, PM approves; it enters the dataset', async () => {
    const v = await published();
    const s = await staffedProject(v.id);

    // The SME gets the Task2 form and starts from the five-agent workflow.
    const t = await view(s.sme, s.taskId);
    expect(t.definition).toBe(`profile:${PROFILE_ID}`);
    expect(t.template).toMatchObject({ workflow: WORKFLOW, profileId: PROFILE_ID });
    expect(t.agentMode).toBe('MULTI');
    expect(t.startingGraph).toMatchObject({ agentMode: 'MULTI', templateVersion: 1 });
    expect(t.startingGraph.roles).toHaveLength(5);

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
    const approved = await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' });
    expect(approved.statusCode, approved.body).toBe(200);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.taskId } });
    const rec = record.output as { profile: { id: string }; sections: { S6: Record<string, unknown>; S2: { sourceRefs: { checksum: string }[] }; S7: { criticalFailures: string[] } } };
    expect(rec.profile.id).toBe(PROFILE_ID);
    // One reusable task: no per-case outcome; wire critical-rule IDs.
    expect(Object.keys(rec.sections.S6)).toEqual(['outputContract']);
    expect(rec.sections.S7.criticalFailures).toEqual(['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06']);
    // Source data travels by reference only.
    expect(rec.sections.S2.sourceRefs.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
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
