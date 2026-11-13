import { hasQuotas } from './definitions';
import { Prisma } from '@prisma/client';
import { EXECUTABLE_WORKFLOW, jsonDiff, materialPaths, praxisContractChecks, STAGE_LABELS, type ExpertEditRequest, type PendingStage, type StageDecisionRequest } from '@praxis/shared';
import type { InternalActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, forbidden, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import type { OutboxInput } from '../outbox/outbox';
import { compileForSubmission, COMPILED_MARKER, profileSaveProblems } from './profile-output';
import { acceptTask, rejectTask, reviewableTask } from './review-service';
import { blocking, evaluateTask, refreshSimilarity, type StoredChecks } from './submission';
import type { SimilarMatch } from './similarity';

/**
 * Authoring v2.1 Wave 2: the SME -> Expert -> PM review route (handover ch. 08; ch. 17 §2, §4, §12).
 *
 * - Submit puts the task in Expert review. An Expert is a Validator assigned to the project; never the author, never
 *   with a declared conflict. The Expert passes the exact version to PM approval, returns it for rework, rejects it,
 *   or edits it with a recorded reason (a new version; checks re-run; earlier decisions void; a material edit goes
 *   back to the author to reconfirm).
 * - PM approval (the project's PM or an Admin) approves the exact version the Expert passed, or returns it. Only that
 *   approval writes the ApprovedTaskRecord and emits `task.accepted` (the single earning).
 * - Every decision is a TaskReview row (append-only) bound to the submission version and its content hash. A decision
 *   is in force only while its version is the latest and its hash matches; any content change creates a new version.
 */

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
type Emit = (e: OutboxInput) => Promise<void>;

/** sha256 of the stable JSON of an output: the identity a stage decision binds to. */
export const contentHash = (output: unknown) => sha256(stableStringify(output ?? null));

/** Checks that attest the author's own actions (consent, own-work declaration, chat review); not re-asked of an Expert. */
const AUTHOR_ATTESTATION = (id: string) => id.startsWith('authoring.') || id.startsWith('conversation.');

/** The compiled Anvil contract is derived data; diffs compare what people wrote. */
export function authoredContent(output: unknown) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return output ?? null;
  const o = output as Record<string, unknown>;
  if (!o[COMPILED_MARKER]) return o;
  const { praxisContract: _c, [COMPILED_MARKER]: _m, ...rest } = o;
  void _c;
  void _m;
  return rest;
}

const TASK_INCLUDE = {
  project: { include: { template: true } },
  assignedTo: { include: { smeUser: true } },
  slot: true,
  submissions: { orderBy: { version: 'asc' } },
  reviews: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TaskInstanceInclude;

export type StageTask = Prisma.TaskInstanceGetPayload<{ include: typeof TASK_INCLUDE }>;

export interface ReviewAccess {
  t: StageTask;
  twoStage: boolean;
  /** Assigned Validator on a two-stage project: may act at Expert review. */
  canExpert: boolean;
  /** The project's PM or an Admin on a two-stage project: may act at PM approval. */
  canPm: boolean;
}

/**
 * Who may open a task for review. SME -> PM projects keep the one-stage rule unchanged (Validators assigned to the
 * project and Admins). On SME -> Expert -> PM projects the assigned Validators (Expert) and the project's PM or an
 * Admin (PM approval) may open it; the author and anyone with a declared conflict never may, Admins included.
 */
export async function reviewAccess(tx: Db | Tx, actor: InternalActor, taskId: string): Promise<ReviewAccess> {
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId: actor.clientId, taskType: { in: ['AUTHORING', 'ANNOTATION'] } }, include: TASK_INCLUDE });
  if (!t) throw notFound('Task not found');
  if (t.project.reviewRoute !== 'SME_EXPERT_PM') {
    if (!actor.roles.includes('REVIEWER') && !actor.roles.includes('ADMIN')) throw forbidden();
    await reviewableTask(tx, actor, taskId);
    return { t, twoStage: false, canExpert: false, canPm: false };
  }
  const admin = actor.roles.includes('ADMIN');
  const assigned = (actor.roles.includes('REVIEWER') || admin) && !!(await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: t.projectId, userId: actor.userId } } }));
  const pm = admin || (actor.roles.includes('PM') && t.project.ownerId === actor.userId);
  if (!assigned && !pm) throw notFound('Task not found');
  const author = t.assignedTo?.smeUser;
  if (author) {
    const me = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const conflict = await tx.conflictDeclaration.findFirst({ where: { reviewerId: actor.userId, smeUserId: author.id, resolvedAt: null } });
    if (conflict || (author.contactEmail ?? author.id).toLowerCase() === me.email.toLowerCase()) {
      throw forbidden('You cannot review this task: you wrote it, or you declared a conflict with its author.');
    }
  }
  return { t, twoStage: true, canExpert: assigned, canPm: pm };
}

const latest = (t: StageTask) => {
  const v = t.submissions.at(-1);
  if (!v) throw new AppError(409, 'NOT_AWAITING_REVIEW', 'This task has no submitted version.');
  return v;
};

/** The Expert pass in force: on the latest version, for its exact content. Null when none (or it was voided). */
export function passInForce(t: StageTask) {
  const v = t.submissions.at(-1);
  if (!v) return null;
  const hash = contentHash(v.output);
  return t.reviews.filter((r) => r.stage === 'EXPERT_REVIEW' && r.decision === 'PASS' && r.submissionVersion === v.version && r.contentHash === hash).at(-1) ?? null;
}

/** The submitted version and content are exactly what the actor looked at, and the task is where they think it is. */
function assertCurrent(t: StageTask, body: { expectedVersion: number; expectedRevision: number }) {
  if (t.status !== 'SUBMITTED' || !t.reviewStage) throw new AppError(409, 'NOT_AWAITING_REVIEW', `This task is ${t.status.toLowerCase()}, not awaiting review.`);
  const v = latest(t);
  if (body.expectedVersion !== v.version) {
    const edit = t.reviews.find((r) => r.decision === 'EDIT' && r.submissionVersion === v.version);
    throw new AppError(
      409,
      'STALE_STAGE_DECISION',
      `Version ${body.expectedVersion} is no longer current: version ${v.version} ${edit ? 'was created by an Expert edit' : 'was submitted'} since. Decisions on version ${body.expectedVersion} are void; reload and review version ${v.version}.`,
      { expectedVersion: body.expectedVersion, currentVersion: v.version, stage: t.reviewStage },
    );
  }
  if (t.revision !== body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'The task changed; reload before deciding.', { revision: t.revision });
  if (contentHash(t.output) !== contentHash(v.output)) throw new AppError(409, 'VERSION_MISMATCH', 'The task content does not match its submitted version; reload before deciding.');
  return v;
}

async function lock(tx: Tx, taskId: string) {
  await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${taskId}::uuid FOR UPDATE`;
}

function assertRole(a: ReviewAccess, stage: PendingStage) {
  if (stage === 'EXPERT_REVIEW' && !a.canExpert) throw new AppError(403, 'NOT_PROJECT_EXPERT', 'Only a Validator assigned to this project can do the Expert review.');
  if (stage === 'PM_APPROVAL' && !a.canPm) throw new AppError(403, 'NOT_PROJECT_PM', 'Only the project’s PM or an Admin can give PM approval.');
}

/** A stage decision: Expert PASS / REWORK / REJECT, or PM APPROVE / REWORK / REJECT. */
export async function decideStage(tx: Tx, actor: InternalActor, taskId: string, body: StageDecisionRequest, audit: Audit, emit: Emit) {
  await lock(tx, taskId);
  const a = await reviewAccess(tx, actor, taskId);
  const t = a.t;
  if (!a.twoStage) throw new AppError(409, 'NOT_TWO_STAGE', 'This project uses SME → PM approval; record the review decision instead.');
  assertRole(a, body.stage);
  const v = assertCurrent(t, body);
  if (body.stage !== t.reviewStage) throw new AppError(409, 'WRONG_STAGE', `This task is at ${STAGE_LABELS[t.reviewStage!]}, not ${STAGE_LABELS[body.stage]}.`, { stage: t.reviewStage });
  const hash = contentHash(v.output);
  const now = new Date();
  const responsibility = body.stage === 'EXPERT_REVIEW' ? 'EXPERT' : 'PM';
  const flaggedDuplicate = ((t.checks as StoredChecks | null)?.similar ?? []).some((m) => m.flagged);
  const record = (decision: 'PASS' | 'ACCEPT' | 'REWORK' | 'REJECT', extra: Partial<Prisma.TaskReviewUncheckedCreateInput> = {}) =>
    tx.taskReview.create({
      data: {
        clientId: t.clientId,
        taskInstanceId: t.id,
        submissionVersion: v.version,
        reviewerId: actor.userId,
        decision,
        stage: body.stage,
        contentHash: hash,
        checklist: (body.checklist ?? {}) as Prisma.InputJsonValue,
        comments: body.comments as Prisma.InputJsonValue,
        notes: body.notes ?? null,
        ...extra,
      },
    });
  const common = { reviewNotes: body.notes ?? null, revision: { increment: 1 } };

  if (body.stage === 'EXPERT_REVIEW' && flaggedDuplicate) {
    const expectedDup = body.decision === 'PASS' ? 'ACCEPT_AS_DISTINCT' : body.decision === 'REWORK' ? 'REWORK' : body.rejectReason === 'DUPLICATE' ? 'REJECT_DUPLICATE' : null;
    if (expectedDup && body.duplicateDecision !== expectedDup) throw new AppError(400, 'DUPLICATE_DECISION_REQUIRED', 'This task was flagged as a likely duplicate: confirm your duplicate decision.');
  }
  const contractIssues = () => {
    const issues = praxisContractChecks((t.output ?? {}) as Record<string, unknown>, t.project.template.workflowName === EXECUTABLE_WORKFLOW).filter((c) => !c.ok);
    if (issues.length) throw new AppError(422, 'CONTRACT_INVALID', 'Executable contract needs attention before acceptance.', { checks: issues });
  };

  if (body.decision === 'PASS') {
    contractIssues();
    const isOpen = t.slot?.isOpen ?? false;
    if (isOpen && hasQuotas(t.project.template) && !body.confirmedCoverage) throw new AppError(400, 'CONFIRM_TAGS', 'Open slot: confirm (or correct) the author’s coverage tags and edge case before passing to PM approval.');
    await record('PASS', { duplicateDecision: flaggedDuplicate ? 'ACCEPT_AS_DISTINCT' : null });
    await tx.taskInstance.update({
      where: { id: t.id },
      data: { ...common, reviewStage: 'PM_APPROVAL', ...(isOpen && body.confirmedCoverage ? { coverageTags: { tags: body.confirmedCoverage.tags, edgeCase: body.confirmedCoverage.edgeCase } as Prisma.InputJsonValue } : {}) },
    });
    await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.expert_passed', before: { status: 'SUBMITTED', stage: 'EXPERT_REVIEW' }, after: { status: 'SUBMITTED', stage: 'PM_APPROVAL', responsibility, version: v.version, contentHash: hash } });
    return { status: 'SUBMITTED', stage: 'PM_APPROVAL', version: v.version };
  }

  if (body.decision === 'APPROVE') {
    const pass = passInForce(t);
    if (!pass) throw new AppError(409, 'STALE_STAGE_DECISION', `No Expert review is in force for version ${v.version}; it needs Expert review again.`, { currentVersion: v.version });
    contractIssues();
    await record('ACCEPT');
    const samePerson = pass.reviewerId === actor.userId;
    const r = await acceptTask(
      tx,
      t,
      {
        reviewerId: actor.userId,
        notes: body.notes ?? null,
        coverage: null,
        duplicateDecision: pass.duplicateDecision === 'ACCEPT_AS_DISTINCT' ? 'ACCEPT_AS_DISTINCT' : null,
        now,
        extraUpdate: { ...common, reviewerId: actor.userId, reviewStage: null },
        auditAfter: { version: v.version, contentHash: hash, stage: 'PM_APPROVAL', responsibility, expertId: pass.reviewerId, expertPassedAt: pass.createdAt.toISOString(), samePersonAsExpert: samePerson },
      },
      audit,
      emit,
    );
    return { status: 'ACCEPTED', recordId: r.id, version: v.version };
  }

  if (body.decision === 'REWORK') {
    await record('REWORK', { duplicateDecision: flaggedDuplicate && body.stage === 'EXPERT_REVIEW' ? (body.duplicateDecision ?? null) : null });
    await tx.taskInstance.update({ where: { id: t.id }, data: { ...common, reviewerId: actor.userId, status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 } } });
    await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.rework_requested', before: { status: 'SUBMITTED', stage: body.stage }, after: { status: 'REWORK', stage: body.stage, responsibility, comments: body.comments.length, version: v.version } });
    return { status: 'REWORK', version: v.version };
  }

  // REJECT, by the Expert or (owner decision, 11 Nov 2026) the PM.
  await record('REJECT', { rejectReason: body.rejectReason!, duplicateDecision: flaggedDuplicate ? (body.duplicateDecision ?? null) : null });
  await rejectTask(tx, t, { reason: body.rejectReason!, now, extraUpdate: { ...common, reviewerId: actor.userId, reviewStage: null }, auditAfter: { version: v.version, stage: body.stage, responsibility } }, audit);
  return { status: 'REJECTED', version: v.version };
}

/** The content an Expert edit would store, pre-validated outside the transaction so the embedding can be computed first. */
export async function editPreview(db: Db, actor: InternalActor, taskId: string, body: ExpertEditRequest) {
  const a = await reviewAccess(db, actor, taskId);
  if (!a.twoStage || a.t.taskType !== 'AUTHORING' || a.t.revision !== body.expectedRevision) return null;
  return evaluateTask(db, { ...a.t, output: body.output as Prisma.JsonValue });
}

/**
 * An Expert edit: a new immutable version authored by the Expert, with a reason. The task checks re-run on it (author
 * attestations excepted), every earlier stage decision is void, and the task restarts at Expert review; a material edit
 * instead returns it to the author (Authoring) to reconfirm by resubmitting. Never counts as author rework.
 */
export async function expertEdit(tx: Tx, actor: InternalActor, taskId: string, body: ExpertEditRequest, sim: { embedding: number[] | null; embeddingModel: string | null }, audit: Audit) {
  await lock(tx, taskId);
  const a = await reviewAccess(tx, actor, taskId);
  const t = a.t;
  if (!a.twoStage) throw new AppError(409, 'NOT_TWO_STAGE', 'Expert edits exist only on the SME → Expert → PM route.');
  assertRole(a, 'EXPERT_REVIEW');
  const v = assertCurrent(t, body);
  const workflow = t.project.template.workflowName;
  const shape = t.taskType === 'AUTHORING' ? profileSaveProblems(t.project.template, body.output) : [];
  if (shape.length) throw new AppError(422, 'INVALID_PROFILE_OUTPUT', 'This edit does not match the template profile.', { problems: shape });
  const changes = jsonDiff(authoredContent(v.output), authoredContent(body.output));
  if (!changes.length) throw new AppError(400, 'NO_CHANGE', 'The edit changes nothing; pass or return the task instead.');
  // Owner decision (11 Nov 2026): a change to the rubric or the reference answer is always material.
  const forced = materialPaths(changes);
  const material = body.material || forced.length > 0;

  const ev = await evaluateTask(tx, { ...t, output: body.output as Prisma.JsonValue });
  const failing = ev.checks.filter((c) => blocking(c) && !AUTHOR_ATTESTATION(c.id));
  const earlier = (t.flags ?? []) as { id: string; explanation?: string }[];
  const flags = ev.flags.map((f) => ({ ...f, explanation: body.flagExplanations[f.id] ?? earlier.find((e) => e.id === f.id)?.explanation }));
  const unexplained = flags.filter((f) => !f.explanation);
  if (failing.length || unexplained.length) {
    throw new AppError(422, 'CHECKS_FAILED', 'The edited task fails checks; fix them before saving the edit.', { checks: failing, flags: ev.flags, unexplained: unexplained.map((f) => f.id) });
  }

  let similar: SimilarMatch[] = ((t.checks as StoredChecks | null)?.similar ?? []);
  if (sim.embedding && t.taskType === 'AUTHORING') similar = await refreshSimilarity(tx, t, ev, sim.embedding);
  const compiled = t.taskType === 'AUTHORING' ? compileForSubmission(t.project.template, body.output, { taskId: t.id, revisionId: `${t.id}-r${t.revision}` }) : null;
  const output = (compiled?.output ?? body.output) as Prisma.InputJsonValue;
  const stored: StoredChecks = { results: ev.checks, keyInputs: ev.keyInputs, similar, embeddingModel: sim.embeddingModel ?? (t.checks as StoredChecks | null)?.embeddingModel ?? null, ...(compiled ? { export: compiled.status } : {}) };
  const version = v.version + 1;
  const hash = contentHash(output);
  const voided = t.reviews.filter((r) => r.stage && r.submissionVersion === v.version && r.decision === 'PASS').map((r) => r.id);

  await tx.taskSubmission.create({ data: { clientId: t.clientId, taskInstanceId: t.id, version, policySnapshotId: v.policySnapshotId, output, coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined, checks: stored as unknown as Prisma.InputJsonValue } });
  await tx.taskReview.create({
    data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: version, reviewerId: actor.userId, decision: 'EDIT', stage: t.reviewStage, contentHash: hash, editReason: body.reason, material, checklist: {}, comments: [] },
  });
  await tx.taskInstance.update({
    where: { id: t.id },
    data: {
      output,
      checks: stored as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined,
      revision: { increment: 1 },
      reviewNotes: body.reason,
      ...(material ? { status: 'REWORK', reviewStage: null } : { reviewStage: 'EXPERT_REVIEW' }),
    },
  });
  const after = material ? { status: 'REWORK', stage: null, awaiting: 'AUTHOR_RECONFIRMATION' } : { status: 'SUBMITTED', stage: 'EXPERT_REVIEW' };
  await audit({
    entityType: 'TaskInstance',
    entityId: t.id,
    action: 'task.expert_edited',
    before: { status: 'SUBMITTED', stage: t.reviewStage, version: v.version, contentHash: contentHash(v.output) },
    after: { ...after, responsibility: 'EXPERT', version, contentHash: hash, reason: body.reason, material, materialDeclared: body.material, materialPaths: forced.slice(0, 50), changedPaths: changes.slice(0, 50).map((c) => c.path), voidedDecisions: voided },
  });
  return { status: after.status, stage: after.stage, version, material, materialBecause: forced.length ? 'rubric or reference answer changed' : body.material ? 'declared by the Expert' : null, changed: changes.length };
}

/** What the reviewer screen shows about stages: history with void markers, the diff and the viewer's actions. */
export async function stageView(db: Db | Tx, a: ReviewAccess) {
  const t = a.t;
  const current = t.submissions.at(-1) ?? null;
  const previous = t.submissions.length > 1 ? t.submissions.at(-2)! : null;
  const people = await db.user.findMany({ where: { id: { in: [...new Set(t.reviews.map((r) => r.reviewerId))] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Unknown';
  const inForce = passInForce(t);
  const actions: string[] = [];
  if (a.twoStage && t.status === 'SUBMITTED') {
    if (t.reviewStage === 'EXPERT_REVIEW' && a.canExpert) actions.push('PASS', 'REWORK', 'REJECT', 'EDIT');
    if (t.reviewStage === 'PM_APPROVAL' && a.canPm) actions.push(...(inForce ? ['APPROVE'] : []), 'REWORK', 'REJECT');
    if (t.reviewStage === 'PM_APPROVAL' && a.canExpert) actions.push('EDIT');
  }
  return {
    reviewRoute: t.project.reviewRoute,
    stage: t.status === 'SUBMITTED' ? (t.reviewStage ?? (a.twoStage ? null : 'PM_APPROVAL')) : null,
    currentVersion: current?.version ?? null,
    currentContentHash: current ? contentHash(current.output) : null,
    viewer: { canExpert: a.canExpert, canPm: a.canPm, bothResponsibilities: a.canExpert && a.canPm },
    actions,
    expertPass: inForce ? { by: nameOf(inForce.reviewerId), byId: inForce.reviewerId, version: inForce.submissionVersion, at: inForce.createdAt.toISOString() } : null,
    stageHistory: t.reviews
      .filter((r) => r.stage)
      .map((r) => ({
        id: r.id,
        stage: r.stage,
        decision: r.decision,
        by: nameOf(r.reviewerId),
        byId: r.reviewerId,
        version: r.submissionVersion,
        contentHash: r.contentHash,
        at: r.createdAt.toISOString(),
        reason: r.editReason,
        material: r.material,
        notes: r.notes,
        comments: r.comments,
        // In force only for the latest version's exact content; a later version voids it.
        void: r.decision === 'PASS' ? r.id !== inForce?.id : false,
      })),
    diff: current && previous ? { fromVersion: previous.version, toVersion: current.version, changes: jsonDiff(authoredContent(previous.output), authoredContent(current.output)) } : null,
  };
}
