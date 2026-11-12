import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_MARKETING_EXAMPLE, marketingTask2Graph, withRuleVersions, type CandidateRule } from '@praxis/shared';
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
 * Golden Task2, Marketing (owner, 12 Nov 2026): an SME authors, and an Expert and PM accept, a five-agent campaign task
 * like the owner's Task2 handoff, on DM03 template version 2 (form marketing-campaign-task2). The whole cycle runs here:
 * template version (multi-agent by its form), project, policy rules, staffing, authoring with the five-agent workflow,
 * checks, Expert review, PM approval and the Approved Task Dataset. Everything is fictional; no model is called.
 */
const SECRET = 'test-mock-secret';
const WORKFLOW = 'Launch of Noise Cancelling Phone';
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

describe('Golden Task2 (Marketing): the full Praxis cycle on DM03 template version 2', () => {
  let app: FastifyInstance;
  const email = new MemoryEmailSender();
  const google = new MockGoogleVerifier(SECRET);
  const storage = new MemoryStorage();
  const config = testConfig();
  let clientId: string;
  let admin: string;

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
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  /** DM03 version 1 (single-agent form) published, then a version 2 draft. */
  async function templates() {
    const domainId = (await post(admin, '/domains', { name: 'Marketing' })).json().id;
    const v1 = (
      await post(admin, '/templates', {
        domainId,
        workflowName: WORKFLOW,
        primaryWork: 'Plan and maintain a product launch campaign within budget authority.',
        verificationCriteria: 'Evidence, budget and policy agree; approvals bind exact versions.',
        humanGate: 'Publication and spending stay authorised human decisions.',
        defaultTptMinutes: 240,
        skills: SKILLS,
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'locale', label: 'Locale', values: ['US_en-US', 'FR_fr-FR'] }], cells: [{ tags: { locale: 'US_en-US' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${v1.id}/publish`)).statusCode).toBe(200);
    const draft = await post(admin, `/templates/${v1.id}/versions`);
    expect(draft.statusCode, draft.body).toBe(201);
    return { v1, v2: draft.json() };
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

  it('choosing the five-agent form makes version 2 multi-agent (audited); version 1 stays single-agent', async () => {
    const { v1, v2 } = await templates();
    const set = await patch(admin, `/templates/${v2.id}`, { profileId: 'marketing-campaign-task2' });
    expect(set.statusCode, set.body).toBe(200);
    expect((await post(admin, `/templates/${v2.id}/publish`)).json()).toMatchObject({ version: 2, status: 'PUBLISHED', profileId: 'marketing-campaign-task2' });
    expect((await db.template.findUniqueOrThrow({ where: { id: v2.id } })).agentMode).toBe('MULTI');
    expect((await db.template.findUniqueOrThrow({ where: { id: v1.id } })).agentMode).toBe('SINGLE');
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: v2.id, action: 'template.updated' } });
    expect(audit.before).toMatchObject({ agentMode: 'SINGLE' });
    expect(audit.after).toMatchObject({ profileId: 'marketing-campaign-task2', agentMode: 'MULTI' });
  });

  it('SME authors the Task2 case with the five-agent workflow; Expert passes, PM approves; it enters the dataset', async () => {
    const { v2 } = await templates();
    await patch(admin, `/templates/${v2.id}`, { profileId: 'marketing-campaign-task2' });
    expect((await post(admin, `/templates/${v2.id}/publish`)).statusCode).toBe(200);
    const s = await staffedProject(v2.id);

    // The SME gets the Task2 form and starts from the five-agent workflow.
    const t = await view(s.sme, s.taskId);
    expect(t.definition).toBe('profile:marketing-campaign-task2');
    expect(t.template).toMatchObject({ workflow: WORKFLOW, profileId: 'marketing-campaign-task2' });
    expect(t.agentMode).toBe('MULTI');
    expect(t.startingGraph).toMatchObject({ agentMode: 'MULTI', templateVersion: 2 });
    expect(t.startingGraph.roles).toHaveLength(5);

    // The worked case plus the workflow, with the project's published rule versions, passes every check.
    const output = { ...withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions), workflowGraph: marketingTask2Graph(2) };
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
    expect((await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue })).statusCode).toBe(200);
    const approved = await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' });
    expect(approved.statusCode, approved.body).toBe(200);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.taskId } });
    const rec = record.output as { profile: { id: string }; sections: { S6: { caseOutcome: string }; S2: { sourceRefs: { checksum: string }[] } } };
    expect(rec.profile.id).toBe('marketing-campaign-task2');
    expect(rec.sections.S6.caseOutcome).toBe('campaign_closed');
    // Source data travels by reference only.
    expect(rec.sections.S2.sourceRefs.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
  });

  it('a single-agent workflow on the five-agent version, or a rubric group that does not add up, blocks submission', async () => {
    const { v2 } = await templates();
    await patch(admin, `/templates/${v2.id}`, { profileId: 'marketing-campaign-task2' });
    await post(admin, `/templates/${v2.id}/publish`);
    const s = await staffedProject(v2.id);
    const good = withRuleVersions(GOLDEN_MARKETING_EXAMPLE, s.versions) as unknown as { sections: { S7: { criteria: { id: string; group: string }[] } } };
    const bad = JSON.parse(JSON.stringify(good)) as typeof good;
    bad.sections.S7.criteria.find((c) => c.id === 'B1')!.group = 'C';
    const single = { ...marketingTask2Graph(2), agentMode: 'SINGLE' as const, roles: [marketingTask2Graph(2).roles[0]!] };
    expect((await save(s.sme, s.taskId, { ...bad, workflowGraph: single })).statusCode).toBe(200);
    const refused = await submit(s.sme, s.taskId);
    expect(refused.statusCode).toBe(422);
    const text = JSON.stringify(refused.json());
    expect(text).toMatch(/group B \(Adaptation\) weights must total 20/);
  });
});
