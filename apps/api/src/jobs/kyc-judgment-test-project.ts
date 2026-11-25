import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ProjectRuleSetContent, templateRubric, type TemplateProfile, type TemplateProfileField } from '@praxis/shared';
import type { Prisma, Template } from '@prisma/client';
import type { ObjectStorage } from '../candidate/storage';
import { stubScanner } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { emitEvent } from '../outbox/outbox';
import { writeAudit, type AuditInput } from '../platform/audit';
import { addDocumentVersion } from '../policy/documents';
import { latestRuleSet } from '../policy/rule-sets';
import { snapshotTask } from '../policy/task-policy';
import { evaluatorMap, jointTemplateSpec } from '../anvil/joint-template';
import { check, storeProposal } from '../routes/anvil-templates';
import { compileForSubmission, profileFor } from '../tasks/profile-output';
import { checkOptions, revalidateTask } from '../tasks/revalidation';
import type { StoredChecks } from '../tasks/submission';
import { ensureSlotTasks } from '../tasks/task-service';
import { loadUploadedProfiles } from '../templates/uploaded-profiles';

/**
 * `run.ts kyc-judgment-test-project import|project|task --requested-by <admin email> [--apply] [...]` (KYC Judgment v1
 * end-to-end integration test; coordinator, 25 Nov 2026). Three phases, each a dry run by default, audited as SYSTEM
 * with the requesting Admin, and idempotent:
 * 1. `import --file <proposal.json>`: Studio's joint proposal through the same checks and store as the proposals route
 *    (attributed to the client's Studio/Anvil API client). A DRAFT; an Admin publishes it in the console.
 * 2. `project --source-project <id>`: on the PUBLISHED template, the project "KYC Judgment v1 — INTEGRATION TEST
 *    (test-only)" with testOnly=true (exports carry test_only: true; never on a leaderboard), its one slot, and ONLY the
 *    source project's federal document copied byte for byte (no rules, no approvals).
 * 3. `task --project <id>`: a test SME account (marked test-only) and ONE synthetic task covering all four application
 *    types, submitted. The checks an approval re-runs must pass. A person (the owner, as Admin) approves it in the
 *    console; nothing here approves anything. Refused on any project that is not test-only.
 * Synthetic wording only; no real customer data.
 */
const ACTOR = 'kyc-judgment-test-project';
export const TEST_PROJECT_NAME = 'KYC Judgment v1 — INTEGRATION TEST (test-only)';
export const WORKFLOW = 'KYC Judgment v1';
export const TEST_SME_EMAIL = 'kyc-judgment-test-sme@praxis.test';

export interface TestProjectArgs {
  phase: 'import' | 'project' | 'task' | 'retire-draft';
  templateId?: string;
  reason?: string;
  requestedBy: string;
  apply: boolean;
  file?: string;
  sourceProjectId?: string;
  projectId?: string;
}
export function parseTestProjectArgs(argv: string[]): TestProjectArgs {
  const phase = argv[0];
  if (phase !== 'import' && phase !== 'project' && phase !== 'task' && phase !== 'retire-draft') throw new Error('kyc-judgment-test-project needs a phase: import | project | task | retire-draft');
  const a: TestProjectArgs = { phase, requestedBy: '', apply: false };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i]!;
    if (k === '--apply') a.apply = true;
    else if (k === '--requested-by' && argv[i + 1]) a.requestedBy = argv[++i]!;
    else if (k === '--file' && argv[i + 1]) a.file = argv[++i]!;
    else if (k === '--source-project' && argv[i + 1]) a.sourceProjectId = argv[++i]!;
    else if (k === '--project' && argv[i + 1]) a.projectId = argv[++i]!;
    else if (k === '--template' && argv[i + 1]) a.templateId = argv[++i]!;
    else if (k === '--reason' && argv[i + 1]) a.reason = argv[++i]!;
    else throw new Error(`Unknown argument "${k}".`);
  }
  if (!a.requestedBy) throw new Error('--requested-by <admin email> is required');
  return a;
}

type Report = { outcome: 'refused' | 'would_create' | 'created' | 'already_created'; reason?: string; [k: string]: unknown };
const refuse = (reason: string, extra: Record<string, unknown> = {}): Report => ({ outcome: 'refused', reason, ...extra });
const adminOf = (tx: Db | Tx, email: string) => tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
const auditAs = (tx: Tx, clientId: string) => (a: AuditInput) => writeAudit(tx, { clientId, actorType: 'SYSTEM', actorId: ACTOR }, a);

// ───────────────────────── Phase 1: import ─────────────────────────
export async function importTemplate(db: Db, args: { requestedBy: string; file: string; apply: boolean; body?: unknown }): Promise<Report> {
  const admin = await adminOf(db, args.requestedBy);
  if (!admin) return refuse('The requester must be an active Admin.');
  const body = args.body ?? (JSON.parse(readFileSync(args.file, 'utf8')) as unknown);
  const formId = (body as { authoring?: { profile?: { profileId?: unknown } } }).authoring?.profile?.profileId;
  const existing = await db.template.findFirst({ where: { clientId: admin.clientId, workflowName: { equals: WORKFLOW, mode: 'insensitive' } }, orderBy: { version: 'desc' } });
  // The same form already stored (and not retired): done. A draft of another form blocks the next version.
  if (existing && existing.status !== 'RETIRED' && existing.profileId === formId) return { outcome: 'already_created', templateId: existing.id, version: existing.version, status: existing.status };
  if (existing?.status === 'DRAFT') return refuse(`Version ${existing.version} (${existing.profileId}) is still a draft: an Admin publishes or retires it first.`, { templateId: existing.id });
  const studio = await db.apiClient.findFirst({ where: { clientId: admin.clientId, kind: 'ANVIL', revokedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!studio) return refuse('No active Studio (ANVIL) API client for this client, so the proposal cannot be attributed to Studio.');
  const r = await check(db, admin.clientId, body);
  if (!r.valid || !r.joint) return refuse('Authoring refuses the proposal.', { errors: r.errors.map((e) => `${e.pointer}: ${e.message}`) });
  if (!args.apply) return { outcome: 'would_create', workflow: WORKFLOW };
  const out = await db.$transaction(async (tx) => storeProposal(tx, { clientId: admin.clientId, apiClientId: studio.id }, r, body, auditAs(tx, admin.clientId)));
  await loadUploadedProfiles(db);
  return { outcome: 'created', templateId: out.draft.id, version: out.draft.version, status: out.draft.status, proposalId: out.proposal.id, next: 'An Admin publishes it: Templates → KYC Judgment v1 → Publish.' };
}

/**
 * Retires one unpublished KYC Judgment v1 DRAFT that nothing uses (owner, 25 Nov 2026, via the coordinator: "Authoring
 * may retire it"), so a correctly identified proposal can be stored as the next version. The console's Retire only
 * takes published versions; this is the same state change for a draft, with the owner's words as the reason. Refused
 * for anything else: another workflow, a published version, or a draft any project uses.
 */
export async function retireDraft(db: Db, args: { requestedBy: string; templateId: string; reason: string; apply: boolean }): Promise<Report> {
  return db.$transaction(async (tx) => {
    const admin = await adminOf(tx, args.requestedBy);
    if (!admin) return refuse('The requester must be an active Admin.');
    if (args.reason.trim().length < 5) return refuse('Give the reason (the owner’s words).');
    const t = await tx.template.findFirst({ where: { id: args.templateId, clientId: admin.clientId } });
    if (!t) return refuse('Template not found.');
    if (t.workflowName.toLowerCase() !== WORKFLOW.toLowerCase()) return refuse(`Only a ${WORKFLOW} draft can be retired here.`);
    if (t.status === 'RETIRED') return { outcome: 'already_created', templateId: t.id, status: t.status };
    if (t.status !== 'DRAFT') return refuse(`Version ${t.version} is ${t.status}; only an unpublished draft is retired here (use the console for a published one).`);
    const used = await tx.project.count({ where: { templateId: t.id } });
    if (used) return refuse(`${used} project(s) use this draft.`);
    if (!args.apply) return { outcome: 'would_create', templateId: t.id, version: t.version, profileId: t.profileId };
    await tx.template.update({ where: { id: t.id }, data: { status: 'RETIRED', retiredAt: new Date() } });
    await auditAs(tx, admin.clientId)({ entityType: 'Template', entityId: t.id, action: 'template.draft_retired', before: { status: 'DRAFT', version: t.version, profileId: t.profileId }, after: { status: 'RETIRED', reason: args.reason.trim(), requestedBy: admin.id } });
    return { outcome: 'created', templateId: t.id, status: 'RETIRED' };
  });
}

// ───────────────────────── Phase 2: project ─────────────────────────
export async function createTestProject(db: Db, deps: { storage: ObjectStorage }, args: { requestedBy: string; sourceProjectId: string; apply: boolean }): Promise<Report> {
  return db.$transaction(
    async (tx) => {
      const admin = await adminOf(tx, args.requestedBy);
      if (!admin) return refuse('The requester must be an active Admin.');
      const t = await tx.template.findFirst({ where: { clientId: admin.clientId, workflowName: { equals: WORKFLOW, mode: 'insensitive' }, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
      if (!t) return refuse('KYC Judgment v1 is not published yet: an Admin publishes it in the console first.');
      const existing = await tx.project.findFirst({ where: { clientId: admin.clientId, name: TEST_PROJECT_NAME } });
      if (existing) return { outcome: 'already_created', projectId: existing.id, testOnly: existing.testOnly };
      const src = await tx.project.findFirst({ where: { id: args.sourceProjectId, clientId: admin.clientId } });
      if (!src) return refuse('Source project not found.');
      const set = await latestRuleSet(tx, admin.clientId, src.id);
      const content = set ? ProjectRuleSetContent.parse(set.content) : null;
      const dvIds = [...new Set(content?.rules.flatMap((r) => r.sources.map((s) => s.documentVersionId)) ?? [])];
      const dvs = await tx.policyDocumentVersion.findMany({ where: { id: { in: dvIds } }, include: { document: true } });
      if (dvs.length !== 1) return refuse(`The source project's rule set cites ${dvs.length} document versions; expected exactly the federal document.`);
      const dv = dvs[0]!;
      const plan = { template: { id: t.id, version: t.version }, name: TEST_PROJECT_NAME, testOnly: true, document: { title: dv.document.title, sha256: dv.sha256 } };
      if (!args.apply) return { outcome: 'would_create', ...plan };
      const audit = auditAs(tx, admin.clientId);
      const now = new Date();
      const p = await tx.project.create({
        data: { clientId: admin.clientId, ownerId: admin.id, templateId: t.id, templateVersion: t.version, name: TEST_PROJECT_NAME, description: 'End-to-end integration test (Authoring → Studio → RL Gym). Test-only: never on a leaderboard. Synthetic data only.', testOnly: true, taskMode: 'AUTHORING', reviewRoute: 'SME_PM', distinctTarget: 1, maxPerExpert: 1, requiredWorkers: 1, tptMinutes: 60, startDate: now, endDate: new Date(now.getTime() + 30 * 86_400_000) },
      });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.test_created', after: { ...plan, requestedBy: admin.id } });
      const tasks = await ensureSlotTasks(tx, p.id);
      const buf = await deps.storage.get(dv.storageKey);
      if (createHash('sha256').update(buf).digest('hex') !== dv.sha256) throw new Error('The stored federal document does not match its sha256.');
      const meta = { title: dv.document.title, category: dv.document.category, language: dv.document.language, jurisdiction: dv.document.jurisdiction, effectiveFrom: dv.document.effectiveFrom?.toISOString().slice(0, 10) ?? null, effectiveTo: dv.document.effectiveTo?.toISOString().slice(0, 10) ?? null };
      const added = await addDocumentVersion(tx, { storage: deps.storage, scanner: stubScanner, maxPages: 200 }, { clientId: admin.clientId, projectId: p.id, actorId: admin.id, meta, fileName: dv.fileName, buf, origin: dv.origin === 'SME_PROPOSAL' ? 'UPLOAD' : dv.origin }, audit);
      return { outcome: 'created', projectId: p.id, tasks, documentVersionId: added.version.id, ...plan };
    },
    { timeout: 120_000 },
  );
}

// ───────────────────────── Phase 3: the one synthetic task ─────────────────────────
/** Synthetic, generic wording for one task covering every application type (no type named; §16). */
export function syntheticSections(profile: TemplateProfile, template: Template, doc: { documentId: string; version: number; title: string }): Record<string, Record<string, unknown>> {
  const f = (s: string, k: string) => profile.sections.find((x) => x.key === s)?.fields.find((x) => x.key === k) as TemplateProfileField | undefined;
  const opts = (s: string, k: string) => (f(s, k)?.options ?? []).map((o) => o.value);
  const tools = opts('S3', 'tools');
  const has = (t: string) => tools.includes(t);
  const step = (action: string, tool: string, failureBehaviour: string) => (has(tool) ? [{ action, tool, failureBehaviour }] : []);
  const yes = (o: string[]) => o.find((v) => /^(yes|true)$/i.test(v)) ?? o[0] ?? 'yes';
  const no = (o: string[]) => o.find((v) => /^(no|false)$/i.test(v)) ?? o[1] ?? 'no';
  const who = opts('S5', 'decisionRights').length ? opts('S5', 'decisionRights') : ((f('S5', 'decisionRights')?.itemFields ?? []).find((x) => x.key === 'whoMay')?.options ?? []).map((o) => o.value);
  const irr = ((f('S5', 'decisionRights')?.itemFields ?? []).find((x) => x.key === 'irreversible')?.options ?? []).map((o) => o.value);
  const rubric = templateRubric(profile, (template.anvilSpec as { execution?: unknown } | null)?.execution ?? null);
  const critical = new Set(['rules_applied', 'decision_next_action', 'evidence_faithfulness']);
  const spec = jointTemplateSpec(template);
  const evaluators = spec ? evaluatorMap(spec) : new Map<string, { id: string; version: string }>();
  const criteria = (rubric?.criteria ?? []).map((c) => ({
    id: c.id,
    // The template's own evaluator for this criterion (RL Gym grades by it).
    ...(evaluators.get(c.id) ? { evaluatorKind: evaluators.get(c.id)!.id, evaluatorVersion: evaluators.get(c.id)!.version } : {}),
    name: c.defaults?.name ?? c.id.replace(/_/g, ' '),
    weight: c.defaults?.weight ?? 5,
    critical: c.defaults?.critical ?? critical.has(c.id),
    passCondition: c.defaults?.passCondition ?? `Synthetic test criterion ${c.id}: fully met for every party, with evidence ids.`,
    partialCredit: c.defaults?.partialCredit ?? `Synthetic test criterion ${c.id}: partly met; one gap with no effect on the decision.`,
    failCondition: c.defaults?.failCondition ?? `Synthetic test criterion ${c.id}: not met, or contradicted by the evidence.`,
  }));
  const max = criteria.reduce((n, c) => n + Number(c.weight), 0);
  return {
    S1: {
      title: 'Assess a deposit account application against the rules its facts trigger (integration test)',
      trigger: 'A new deposit account application is assigned for KYC review.',
      businessContext: 'Synthetic integration test of the bank’s onboarding review. The application may be of any covered type; its records say which.',
      deliverable: 'One evidence-backed recommendation for the application, with an assessment for each party and the rules applied.',
      coveredApplicationTypes: opts('S1', 'coveredApplicationTypes'),
      scope: 'In scope: identifying each party, verifying identity and address, screening, and the account-opening rules the facts trigger. Out of scope: lending, card and mortgage products, and any process other than account opening.',
      language: 'English',
    },
    S2: { inputContract: 'The assigned application and its parties, documents and check results, read through the declared tools. No case facts are given in this task.' },
    S3: { environment: opts('S3', 'environment')[0], tools, failureBehaviour: 'If a tool fails or a check is pending, record the gap against the party it concerns and carry it into the recommendation as outstanding.' },
    S4: { policyLibrary: [{ documentId: doc.documentId, documentVersion: doc.version, title: doc.title }], expectedRules: [], notes: 'Synthetic integration test: the expected rules come from the library conditions and the references.' },
    S5: {
      steps: [
        ...step('Read the assigned application and list every party with its role.', 'application.read', 'If the application cannot be read, record the failure and stop.'),
        ...step('List the parties of the application.', 'parties.list', 'If a party cannot be listed, record the gap.'),
        ...step('Read the published policy library and decide which rules apply to this application and to each party, from the facts.', 'policy.read', 'If a rule cannot be read, record the gap and leave dependent requirements open.'),
        ...step('Read any policy notices published so far.', 'notices.read', 'If notices cannot be read, record that the rule in force may be unknown.'),
        ...step('List and read each party’s documents.', 'documents.list', 'A successful empty list shows which documents were not submitted.'),
        ...step('Verify each party’s identity using that party’s own evidence and the rules that apply to it.', 'identity.check', 'Record a pending or inconclusive result against that party.'),
        ...step('Where the applicable rules require an item a party has not provided, request that item from that party.', 'information.request', 'If an equivalent request is already open, do not duplicate it.'),
        ...step('Submit one evidence-backed recommendation with an assessment for each party and every outstanding item.', 'recommend', 'Never record an automated final approval.'),
      ],
      decisionRights: [{ action: 'Recommend a decision on the application', whoMay: who[0] ?? 'agent', needsApprovalFrom: 'The human final decision-maker', irreversible: irr.length ? yes(irr) : 'yes', escalateWhen: 'The applicable rules reserve a matter for specialist review.', escalateTo: 'The designated specialist' }, ...(irr.length ? [{ action: 'Request information from a party', whoMay: who[0] ?? 'agent', irreversible: no(irr) }] : [])],
    },
    S6: { outputContract: 'The template’s output schema: one recommendation, rules_applied with each rule’s id and version, an assessment per party, the notices considered and the rationale.' },
    S7: { criteria, scoringRule: `Award 5 points for pass, 2 for partial and 0 for fail. The max is ${max} points. The task passes with at least ${Math.round(max * 0.84)} points.` },
    S8: { sourcesUsed: `The project policy library (${doc.title}). Synthetic integration test: no real customer or employer data.`, reviewerNotes: 'Test-only task for the end-to-end integration; never on a leaderboard.' },
  };
}

export async function createTestTask(db: Db, args: { requestedBy: string; projectId: string; apply: boolean }): Promise<Report> {
  await loadUploadedProfiles(db);
  return db.$transaction(
    async (tx) => {
      const admin = await adminOf(tx, args.requestedBy);
      if (!admin) return refuse('The requester must be an active Admin.');
      const p = await tx.project.findFirst({ where: { id: args.projectId, clientId: admin.clientId }, include: { template: true } });
      if (!p) return refuse('Project not found.');
      if (!p.testOnly) return refuse('This job only writes tasks into a test-only project.');
      const task = await tx.taskInstance.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
      if (!task) return refuse('The project has no task slot.');
      if (task.status !== 'CREATED') return { outcome: 'already_created', taskId: task.id, status: task.status };
      const profile = profileFor({ workflowName: p.template.workflowName, profileId: p.template.profileId });
      if (!profile) return refuse('The template’s form is not registered.');
      const dv = await tx.policyDocumentVersion.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' }, include: { document: true } });
      if (!dv) return refuse('The test project has no policy document (run the project phase first).');
      const output = { profile: { id: profile.profileId, version: 1 }, header: { title: 'Assess a deposit account application (integration test)' }, sections: syntheticSections(profile, p.template, { documentId: dv.documentId, version: dv.version, title: dv.document.title }) };
      const options = checkOptions(null);
      const compiled = compileForSubmission(p.template, output, { taskId: task.id, revisionId: `${task.id}-r${task.revision + 1}` });
      const stored = (compiled?.output ?? output) as Prisma.InputJsonValue;
      const rv = await revalidateTask(tx, { ...task, output: stored as Prisma.JsonValue, project: { template: p.template }, checks: { results: [], keyInputs: [], similar: [], embeddingModel: null, options } as unknown as Prisma.JsonValue });
      if (rv.failing.length) return refuse('The synthetic task does not pass the checks its approval re-runs.', { failing: rv.failing.map((c) => `${c.section}: ${c.message}`) });
      if (!args.apply) return { outcome: 'would_create', taskId: task.id };
      const audit = auditAs(tx, admin.clientId);
      // The test SME: a synthetic account marked test-only, the task's author (the owner, who approves, is not).
      const sme = (await tx.smeUser.findFirst({ where: { clientId: admin.clientId, contactEmail: TEST_SME_EMAIL } })) ?? (await tx.smeUser.create({ data: { clientId: admin.clientId, contactEmail: TEST_SME_EMAIL, displayName: 'TEST SME — integration (test-only)' } }));
      const cand = (await tx.candidate.findFirst({ where: { smeUserId: sme.id } })) ?? (await tx.candidate.create({ data: { clientId: admin.clientId, smeUserId: sme.id } }));
      const now = new Date();
      const checks: StoredChecks = { results: rv.checks, keyInputs: [], similar: [], embeddingModel: null, ...(compiled ? { export: compiled.status } : {}), options };
      const { count } = await tx.taskInstance.updateMany({ where: { id: task.id, revision: task.revision, status: 'CREATED' }, data: { status: 'SUBMITTED', output: stored, assignedToId: cand.id, assignedAt: now, submittedAt: now, checks: checks as unknown as Prisma.InputJsonValue } });
      if (!count) throw new Error('The task changed while the test task was created.');
      if (task.slotId) await tx.coverageSlot.update({ where: { id: task.slotId }, data: { status: 'IN_PROGRESS', assignedToId: cand.id } });
      const policy = await snapshotTask(tx, { clientId: admin.clientId, task: { id: task.id, projectId: p.id }, actorId: ACTOR });
      await tx.taskSubmission.create({ data: { clientId: admin.clientId, taskInstanceId: task.id, version: 1, policySnapshotId: policy?.snapshot.id ?? null, output: stored, checks: checks as unknown as Prisma.InputJsonValue } });
      await audit({ entityType: 'TaskInstance', entityId: task.id, action: 'task.test_submitted', before: { status: 'CREATED' }, after: { status: 'SUBMITTED', version: 1, author: { smeUserId: sme.id, candidateId: cand.id, testOnly: true }, requestedBy: admin.id } });
      await emitEvent(tx, admin.clientId, { name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: task.id, payload: { taskId: task.id, projectId: p.id, version: 1, flaggedDuplicate: false } });
      return { outcome: 'created', projectId: p.id, taskId: task.id, approve: `/projects/${p.id}/tasks/${task.id}/review` };
    },
    { timeout: 120_000 },
  );
}
