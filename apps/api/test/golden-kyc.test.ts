import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_KYC_EXAMPLE, KYC_ACCOUNT_OPENING_PROFILE, withRuleVersions, type CandidateRule } from '@praxis/shared';
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
import { PraxisPrecheckValidator, type AnvilTaskValidator, type ValidationItem } from '../src/anvil/validator';
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
  /** Praxis's pre-check, switchable to "Anvil did not answer". */
  const switchable = { down: false, inner: new PraxisPrecheckValidator() };
  const validator: AnvilTaskValidator = { name: 'praxis-precheck', version: 'test', validate: (items: ValidationItem[]) => (switchable.down ? Promise.reject(new Error('503 from validator')) : switchable.inner.validate(items)) };

  const post = (cookie: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const patch = (cookie: string, url: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  const put = (cookie: string, url: string, payload: object) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });
  /** POST that must succeed; the body is shown when it does not. */
  const ok = async (cookie: string, url: string, payload: object = {}) => {
    const r = await post(cookie, url, payload);
    expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
    return r;
  };
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google, identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage, selectionGate: stubSelectionGate, email, embeddings: new HashingEmbeddingProvider(), anvilValidator: validator });
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
  async function staffedProject(templateId: string, skills = ['KYC', 'CIP', 'Account opening']) {
    const pmUser = await createUser(clientId, ['PM']);
    const pm = await login(app, pmUser.email);
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC analyst (account opening)', responsibilities: 'Author synthetic account-opening investigations.', skills, wagePerTask: 60, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const created = await post(pm, '/projects', { authoringExperience: 'CLASSIC', reviewRoute: 'SME_EXPERT_PM', templateId, name: 'Golden KYC pilot', taskMode: 'AUTHORING', distinctTarget: 1, maxPerExpert: 1, tptMinutes: 90, startDate: '2026-11-16', endDate: '2026-11-30', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['US'], required: true }] });
    expect(created.statusCode, created.body).toBe(201);
    const p = created.json();
    await db.project.update({ where: { id: p.id }, data: { authoringExperience: null } });
    const versions = await publishGoldenRules(p.id, pmUser.id);
    const submitted = await post(pm, `/projects/${p.id}/submit`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    await ok(pm, `/projects/${p.id}/match`);
    const expertUser = await createUser(clientId, ['REVIEWER']);
    await ok(pm, `/projects/${p.id}/reviewers`, { userId: expertUser.id });
    const mail = `${randomUUID().slice(0, 8)}@example.test`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `sub-${mail}`, email: mail, name: 'Kai Author' }), adultAttested: true } });
    const smeUserId = res.json().id as string;
    await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
    const c = await db.candidate.create({ data: { clientId, smeUserId, country: 'US', languages: [{ language: 'en', level: 'C2' }], specialties: skills, skills, jurisdictions: ['US-NY'], domainExperienceYears: 10, hoursPerWeek: 20, timezone: 'America/New_York', lastValidatedAt: new Date() } });
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
  it('project export: validate one task any time, export when complete; the validator says which tasks need fixing', async () => {
    const { v2 } = await kycTemplates();
    await patch(admin, `/templates/${v2.id}`, { profileId: 'kyc-account-opening' });
    await post(admin, `/templates/${v2.id}/publish`);
    const s = await staffedProject(v2.id);
    const none = (await get(s.pm, `/projects/${s.projectId}/export`)).json();
    expect(none).toMatchObject({ canValidate: false, canExport: false, reason: 'Export needs at least one approved task.', validator: { name: 'praxis-precheck', isAnvil: false } });

    await save(s.sme, s.taskId, withRuleVersions(GOLDEN_KYC_EXAMPLE, s.versions));
    expect((await submit(s.sme, s.taskId)).statusCode).toBe(200);
    await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue });
    await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' });

    // Not complete yet: 1 of 2 required tasks, end date ahead. Validate one task; export waits.
    await db.project.update({ where: { id: s.projectId }, data: { distinctTarget: 2, endDate: new Date('2099-01-01'), status: 'IN_PROGRESS' } });
    const st = (await get(s.pm, `/projects/${s.projectId}/export`)).json();
    expect(st).toMatchObject({ canValidate: true, canExport: false });
    expect(st.reason).toContain('1 of 2 required tasks approved, or on 2099-01-01');
    const recordId = st.tasks[0].recordId as string;
    expect((await post(s.pm, `/projects/${s.projectId}/validate`, { recordIds: [recordId, recordId] })).statusCode).toBe(400);
    const v = await post(s.pm, `/projects/${s.projectId}/validate`, { recordIds: [recordId] });
    expect(v.statusCode, v.body).toBe(201);
    // The golden task's evaluator-graded checks have no Anvil binding yet (owner decision): it needs fixing.
    expect(v.json()).toMatchObject({ kind: 'VALIDATE', validator: 'praxis-precheck', counts: { valid: 0, needsFix: 1, notValidated: 0 }, results: [{ recordId, status: 'needs_fix' }], downloadPath: null });
    expect(v.json().results[0].issues.map((i: { code: string }) => i.code)).toContain('MISSING_BINDING');
    expect((await post(s.pm, `/projects/${s.projectId}/exports`)).statusCode).toBe(409);
    // Another PM cannot see or export this project.
    const other = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await get(other, `/projects/${s.projectId}/export`)).statusCode).toBe(404);

    // The end date has come: export every approved task; the file holds the record, its envelope and the verdict.
    await db.project.update({ where: { id: s.projectId }, data: { endDate: new Date('2020-01-01') } });
    const ex = await post(s.pm, `/projects/${s.projectId}/exports`);
    expect(ex.statusCode, ex.body).toBe(201);
    expect(ex.json()).toMatchObject({ kind: 'EXPORT', counts: { needsFix: 1 }, downloadPath: `/projects/${s.projectId}/exports/${ex.json().id}/download` });
    const file = await get(s.pm, ex.json().downloadPath);
    expect(file.statusCode).toBe(200);
    const line = JSON.parse(file.body.trim().split('\n')[0]!);
    expect(line).toMatchObject({ record: { id: recordId, taskInstanceId: s.taskId }, anvilExport: null, validation: { status: 'needs_fix' } });
    expect(await db.auditEvent.count({ where: { action: { in: ['project.validated', 'project.exported'] } } })).toBe(2);

    // The validator does not answer: tasks are "not validated", never guessed valid; the export record is kept.
    switchable.down = true;
    try {
      const down = await post(admin, `/projects/${s.projectId}/exports`);
      expect(down.statusCode, down.body).toBe(201);
      expect(down.json()).toMatchObject({ counts: { valid: 0, needsFix: 0, notValidated: 1 }, results: [{ status: 'not_validated', issues: [{ code: 'VALIDATOR_UNAVAILABLE' }] }] });
    } finally {
      switchable.down = false;
    }
    // Runs are append-only; the task and the dataset record are untouched by validation.
    await expect(db.$executeRawUnsafe(`UPDATE "ProjectValidationRun" SET kind = 'VALIDATE' WHERE project_id = '${s.projectId}'`)).rejects.toThrow();
    expect(await db.approvedTaskRecord.count({ where: { taskInstanceId: s.taskId } })).toBe(1);
  });

  it('a golden task pack is uploaded without a code change: new workflow, draft template, full cycle on the uploaded form', async () => {
    const id = `golden-pack-${randomUUID().slice(0, 8)}`;
    const workflow = `Golden pack demo ${id}`;
    const profile = { ...KYC_ACCOUNT_OPENING_PROFILE, profileId: id, catalogWorkflowName: workflow, agentMode: 'MULTI' as const, handoverName: 'Golden pack demo form' };
    const example = { ...GOLDEN_KYC_EXAMPLE, profile: { id, version: 1 } };
    const pack = {
      schemaVersion: 'praxis.golden_pack.v1',
      source: 'Golden reference (synthetic) for the upload test',
      profile,
      template: { domainName: 'Marketing', primaryWork: 'Author a synthetic investigation with its reference and rubric.', verificationCriteria: 'Evidence, reference and rubric agree.', humanGate: 'A person approves; the agent only recommends.', skills: ['Campaign compliance'], defaultTptMinutes: 90, coverageDimensions: { dimensions: [{ key: 'product', label: 'Product', values: ['teen_joint_checking'] }], cells: [{ tags: { product: 'teen_joint_checking' }, quota: 1, required: true }] } },
      examples: [{ name: 'Worked case 1', output: example }],
    };

    // Check first: nothing is stored. A broken pack lists its problems; PMs cannot upload.
    const bad = await post(admin, '/template-profiles/check', { ...pack, examples: [{ name: 'Broken', output: { ...example, sections: { ...example.sections, S6: {} } } }] });
    expect(bad.json().ok).toBe(false);
    expect(bad.json().problems.join(' ')).toMatch(/example "Broken"/);
    const pmUser = await createUser(clientId, ['PM']);
    expect((await post(await login(app, pmUser.email), '/template-profiles', pack)).statusCode).toBe(403);
    expect((await post(admin, '/template-profiles/check', pack)).json()).toMatchObject({ ok: true, examples: [{ name: 'Worked case 1', problems: [] }] });
    expect(await db.uploadedProfile.count()).toBe(0);

    // Upload: the form is stored append-only, and the new workflow gets a draft template that uses it.
    const up = await post(admin, '/template-profiles', pack);
    expect(up.statusCode, up.body).toBe(201);
    const templateId = up.json().createdTemplateId as string;
    expect(up.json()).toMatchObject({ profileId: id, source: 'uploaded', agentMode: 'MULTI', examples: 1 });
    expect((await post(admin, '/template-profiles', pack)).statusCode).toBe(422);
    await expect(db.$executeRawUnsafe(`UPDATE "UploadedProfile" SET source = 'x' WHERE profile_id = '${id}'`)).rejects.toThrow();
    expect((await get(admin, `/template-profiles?workflow=${encodeURIComponent(workflow)}`)).json().items).toEqual([expect.objectContaining({ profileId: id, source: 'uploaded', isDefault: false })]);
    const draft = (await get(admin, `/templates/${templateId}`)).json();
    expect(draft).toMatchObject({ workflowName: workflow, status: 'DRAFT', profileId: id, domainName: 'Marketing' });
    const pub = await post(admin, `/templates/${templateId}/publish`);
    expect(pub.statusCode, pub.body).toBe(200);

    // The full cycle on the uploaded form: the SME gets the form itself from the server.
    const s = await staffedProject(templateId, ['Campaign compliance']);
    const t = await view(s.sme, s.taskId);
    expect(t.template).toMatchObject({ workflow, profileId: id, profile: { profileId: id, agentMode: 'MULTI' } });
    expect((await save(s.sme, s.taskId, withRuleVersions(example, s.versions))).statusCode).toBe(200);
    const sub = await submit(s.sme, s.taskId);
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await stage(s.expert, s.taskId, { stage: 'EXPERT_REVIEW', decision: 'PASS', checklist: allTrue })).statusCode).toBe(200);
    expect((await stage(s.pm, s.taskId, { stage: 'PM_APPROVAL', decision: 'APPROVE' })).statusCode).toBe(200);
    const record = await db.approvedTaskRecord.findFirstOrThrow({ where: { taskInstanceId: s.taskId } });
    expect((record.output as { profile: { id: string } }).profile.id).toBe(id);
    expect(await db.auditEvent.count({ where: { action: 'template_profile.uploaded' } })).toBe(1);
  });
});
