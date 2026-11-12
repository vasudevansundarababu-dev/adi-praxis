import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_KYC_EXAMPLE, withRuleVersions, type CandidateRule } from '@praxis/shared';
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
 * Golden KYC benchmark task (owner, 11 Nov 2026): Praxis must let an SME author, and an Expert and PM accept, a task
 * like the Golden Bank KYC authoring reference, on the KYC template (version 2: account opening), with the project's
 * policy rules bound by version. The whole cycle runs here: template version, project, policy, staffing, authoring,
 * checks, Expert review, PM approval and the Approved Task Dataset. Everything is synthetic.
 */
const SECRET = 'test-mock-secret';
const WORKFLOW = 'KYC onboarding and refresh';
const allTrue = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

/** Golden Bank rules GB-01 to GB-07 (reference section 3), as the PM publishes them for the project. */
const GOLDEN_RULES: { key: string; title: string; requirement: string }[] = [
  { key: 'GB-01', title: 'Product, structure and applicability', requirement: 'Establish requested product, evidenced structure, every party role, jurisdiction facts and dates; bind exact federal, state and product versions.' },
  { key: 'GB-02', title: 'Risk-based identity route', requirement: 'Apply the approved risk-based identity route to each CIP customer, identifying the actual opener for minors.' },
  { key: 'GB-03', title: 'Documents and address', requirement: 'Resolve address using current lease, government correspondence or a utility statement issued within 90 days plus required verification.' },
  { key: 'GB-04', title: 'Each owner separately', requirement: 'Assess each owner separately. Distinguish owner, signer, parent, guardian, custodian and beneficiary.' },
  { key: 'GB-05', title: 'Sanctions screening', requirement: 'Investigate potential sanctions match with approved attributes; similar name alone neither clears nor blocks.' },
  { key: 'GB-06', title: 'Information requests', requirement: 'Request only specific missing information, explain why, permitted evidence, responding party, deadline and next step; at most 3 rounds.' },
  { key: 'GB-07', title: 'Recommendation', requirement: 'Submit evidence-backed ready_for_approval only when all applicable conditions are satisfied; recommend only.' },
];

const rule = (r: (typeof GOLDEN_RULES)[number]): CandidateRule => ({
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

describe('Golden KYC: the full Praxis cycle on KYC template version 2', () => {
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

  /** KYC template v1 (workbench) published, then v2 with the account-opening form. Returns both. */
  async function kycTemplates() {
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const v1 = (
      await post(admin, '/templates', {
        domainId,
        workflowName: WORKFLOW,
        primaryWork: 'Assemble identity evidence, reconcile fields, detect gaps and recommend a risk-based disposition.',
        verificationCriteria: 'Document and data checks, completeness, policy adherence, reviewer agreement.',
        humanGate: 'Approval, rejection and high-risk classification remain authorised human decisions.',
        defaultTptMinutes: 90,
        skills: ['KYC', 'CIP', 'Account opening'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['teen_joint_checking', 'adult_joint_checking'] }], cells: [{ tags: { product: 'teen_joint_checking' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${v1.id}/publish`)).statusCode).toBe(200);
    const draft = await post(admin, `/templates/${v1.id}/versions`);
    expect(draft.statusCode, draft.body).toBe(201);
    const v2 = draft.json();
    return { v1, v2 };
  }

  /** The PM publishes GB-01 to GB-07 for the project (document upload, rule review, publication). Version IDs by key. */
  async function publishGoldenRules(projectId: string, pmUserId: string) {
    return db.$transaction(
      async (tx) => {
        const audit = (a: Parameters<typeof writeAudit>[2]) => writeAudit(tx, { clientId, actorType: 'USER', actorId: pmUserId }, a);
        const base = { clientId, projectId, actorId: pmUserId };
        const text = `Golden Bank KYC rules (synthetic reference golden-kyc-1.0.0)\n${GOLDEN_RULES.map((r) => `${r.key}. ${r.requirement}`).join('\n')}`;
        const doc = await addDocumentVersion(tx, { storage, scanner: stubScanner, maxPages: 20 }, { ...base, meta: { title: 'Golden Bank KYC rules', category: 'Bank policy' }, fileName: 'golden-kyc-rules.md', buf: Buffer.from(text, 'utf8'), origin: 'UPLOAD' }, audit);
        const docRef = { ...(await loadVersionText(storage, doc.version)), format: doc.version.format };
        const versions: Record<string, string> = {};
        for (const r of GOLDEN_RULES) {
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

  /** Project on KYC v2 with the Expert -> PM route, rules published, one Expert and one SME assigned. */
  async function staffedProject(templateId: string) {
    const pmUser = await createUser(clientId, ['PM']);
    const pm = await login(app, pmUser.email);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC analyst (account opening)', responsibilities: 'Author synthetic account-opening investigations.', skills: ['KYC', 'CIP', 'Account opening'], wagePerTask: 60, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_EXPERT_PM', templateId, name: 'Golden KYC pilot', taskMode: 'AUTHORING', distinctTarget: 1, maxPerExpert: 1, tptMinutes: 90, startDate: '2026-11-16', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    const versions = await publishGoldenRules(p.id, pmUser.id);
    expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    expect((await post(pm, `/projects/${p.id}/match`)).statusCode).toBe(200);
    const expertUser = await createUser(clientId, ['REVIEWER']);
    expect((await post(pm, `/projects/${p.id}/reviewers`, { userId: expertUser.id })).statusCode).toBe(200);
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Kai Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'US', languages: [{ language: 'en', level: 'C2' }], specialties: ['KYC'], skills: ['KYC', 'CIP'], jurisdictions: ['US-NY'], domainExperienceYears: 10, hoursPerWeek: 20, timezone: 'America/New_York', lastValidatedAt: new Date() } });
    expect((await post(pm, `/projects/${p.id}/assignments`, { candidateIds: [c.id] })).statusCode).toBe(200);
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

  it('Admin publishes KYC v2 with the account-opening form; v1 keeps the KYC workbench; an unknown form is refused', async () => {
    const { v1, v2 } = await kycTemplates();
    expect(v1.profileId).toBeNull();
    expect((await patch(admin, `/templates/${v2.id}`, { profileId: 'no-such-form' })).statusCode).toBe(400);
    const set = await patch(admin, `/templates/${v2.id}`, { profileId: 'kyc-account-opening' });
    expect(set.statusCode, set.body).toBe(200);
    expect((await post(admin, `/templates/${v2.id}/publish`)).json()).toMatchObject({ version: 2, status: 'PUBLISHED', profileId: 'kyc-account-opening' });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: v2.id, action: 'template.updated' } });
    expect(audit.after).toMatchObject({ profileId: 'kyc-account-opening' });
  });

  it('SME authors the golden task, rules bound by version; Expert passes, PM approves; it enters the Approved Task Dataset', async () => {
    const { v2 } = await kycTemplates();
    await patch(admin, `/templates/${v2.id}`, { profileId: 'kyc-account-opening' });
    expect((await post(admin, `/templates/${v2.id}/publish`)).statusCode).toBe(200);
    const s = await staffedProject(v2.id);

    // The SME gets the account-opening form, not the v1 workbench.
    const t = await view(s.sme, s.taskId);
    expect(t.definition).toBe('profile:kyc-account-opening');
    expect(t.template).toMatchObject({ workflow: WORKFLOW, profileId: 'kyc-account-opening' });

    // A citation to a rule version that is not published for this project blocks submission.
    const unbound = withRuleVersions(GOLDEN_KYC_EXAMPLE, { ...s.versions, 'GB-03': randomUUID() });
    expect((await save(s.sme, s.taskId, unbound)).statusCode).toBe(200);
    const refused = await submit(s.sme, s.taskId);
    expect(refused.statusCode).toBe(422);
    expect(JSON.stringify(refused.json())).toContain('policy.bound-versions');

    // The golden case with the project's published rule versions passes every check.
    const golden = withRuleVersions(GOLDEN_KYC_EXAMPLE, s.versions);
    const saved = await save(s.sme, s.taskId, golden);
    expect(saved.statusCode, saved.body).toBe(200);
    const sub = await submit(s.sme, s.taskId);
    expect(sub.statusCode, sub.body).toBe(200);
    const checks = (await db.taskInstance.findUniqueOrThrow({ where: { id: s.taskId } })).checks as { results: { id: string; ok: boolean }[]; export?: { status: string; blockers: { code: string }[] } };
    expect(checks.results.filter((c) => !c.ok)).toEqual([]);
    expect(checks.results.find((c) => c.id === 'policy.bound-versions')).toMatchObject({ ok: true });
    expect(checks.results.find((c) => c.id === 'profile.complete')).toMatchObject({ ok: true });
    // Anvil task v1 export: evaluator-graded checks have no output binding yet; reported, not invented.
    expect(checks.export).toMatchObject({ status: 'blocked' });
    expect(checks.export!.blockers.every((b) => ['MISSING_BINDING', 'WEIGHTS'].includes(b.code))).toBe(true);

    // The Expert reviews and passes; the PM approves. A human decides at each stage.
    const expertView = (await get(s.expert, `/review/tasks/${s.taskId}`)).json();
    expect(expertView).toMatchObject({ reviewRoute: 'SME_EXPERT_PM', stage: 'EXPERT_REVIEW' });
    expect((await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue })).statusCode).toBe(200);
    const approved = await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' });
    expect(approved.statusCode, approved.body).toBe(200);

    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.taskId } });
    const output = record.output as { profile: { id: string }; sections: { S4: { policies: { ruleVersion: string }[] }; S6: { recommendation: string } } };
    expect(output.profile.id).toBe('kyc-account-opening');
    expect(output.sections.S6.recommendation).toBe('ready_for_approval');
    expect(output.sections.S4.policies.map((p) => p.ruleVersion).sort()).toEqual(Object.values(s.versions).sort());
  });
});
