import { normEmail, smeTaskStatus, type ForgeDecisionRequest, type ForgePerson, type ForgeTaskRow, type ReviewerDecisionRequest, type ReviewerTaskStatus } from '@praxis/shared';
import type { Actor, CandidateActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { AppError, forbidden, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import type { OutboxInput } from '../outbox/outbox';
import { hasQuotas } from '../tasks/definitions';
import { profileFor } from '../tasks/profile-output';
import { CHECKLIST, decideOneStep } from '../tasks/review-service';
import { assertCurrent, contentHash, decideStageFor, lock, passInForce, reviewerNames, TASK_INCLUDE, type StageTask } from '../tasks/stage-review';
import type { StoredChecks } from '../tasks/submission';
import { EXPERT_TASK_TYPES, templateRef } from '../tasks/task-service';
import { forgeSettings } from './settings';
import { tutorialOf } from './tutorial';
import { sourcingProject, taskLabel } from './sourcing';

type Audit = (i: AuditInput) => Promise<void>;
type Emit = (e: OutboxInput) => Promise<void>;

/**
 * MVP1 step 2 (docs/design/PROJECT-SCREEN-DESIGN.md: Tasks; Candidate app, Reviewer part): the PM's or Admin's decision
 * box on the project's Tasks tab, and the external Reviewer in the candidate app. Both reuse the review engines
 * (decideOneStep for Author -> PM/Admin, decideStageFor for Author -> Reviewer -> PM/Admin); only a PM or Admin approval
 * writes the ApprovedTaskRecord.
 */

export const newFlowOff = () => new AppError(409, 'NEW_FLOW_OFF', 'Task review from the Tasks tab is not switched on for this platform.');

export async function requireNewFlow(tx: Db | Tx, clientId: string) {
  if (!(await forgeSettings(tx, clientId)).newFlow) throw newFlowOff();
}

const slotLabel = (t: { slot?: { position: number } | null }) => (t.slot ? `Task ${t.slot.position + 1}` : 'Task');
const person = (u: { displayName: string | null; contactEmail: string | null } | null | undefined): ForgePerson | null =>
  u ? { name: u.displayName ?? u.contactEmail ?? 'Unknown', email: u.contactEmail } : null;

/** Last status change: the latest of the task's dated steps and its review decisions. */
export function lastChange(t: { createdAt: Date; assignedAt: Date | null; startedAt: Date | null; submittedAt: Date | null }, reviewDates: Date[]) {
  const all = [t.createdAt, t.assignedAt, t.startedAt, t.submittedAt, ...reviewDates].filter((d): d is Date => !!d);
  return new Date(Math.max(...all.map((d) => d.getTime()))).toISOString();
}

/** The console user wrote the task (email match) or declared a conflict with its author: they never decide on it. */
async function ownOrConflicted(tx: Db | Tx, actor: Actor, author: { id: string; contactEmail: string | null } | null | undefined) {
  if (!author) return false;
  const me = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
  if (author.contactEmail && normEmail(author.contactEmail) === normEmail(me.email)) return true;
  return !!(await tx.conflictDeclaration.findFirst({ where: { reviewerId: actor.userId, smeUserId: author.id, resolvedAt: null } }));
}

/** Whose turn it is, for the console viewer. */
function turn(t: Pick<StageTask, 'status' | 'reviewStage'> & { project: { reviewRoute: string } }, blocked: boolean) {
  const submitted = t.status === 'SUBMITTED';
  const atReviewer = submitted && t.project.reviewRoute === 'SME_EXPERT_PM' && t.reviewStage === 'EXPERT_REVIEW';
  const canDecide = submitted && !atReviewer && !blocked;
  return { canDecide, waitingFor: atReviewer ? ('REVIEWER' as const) : submitted && !canDecide ? ('PM' as const) : null };
}

async function consoleTask(tx: Db | Tx, actor: Actor, projectId: string, taskId: string) {
  const p = await sourcingProject(tx, actor, projectId);
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, projectId: p.id, taskType: EXPERT_TASK_TYPES }, include: TASK_INCLUDE });
  if (!t) throw notFound('Task not found');
  return t;
}

/** The Tasks tab: one row per task, in slot order. */
export async function forgeTaskRows(tx: Db | Tx, actor: Actor, projectId: string): Promise<ForgeTaskRow[]> {
  const tasks = await tx.taskInstance.findMany({
    where: { projectId, taskType: EXPERT_TASK_TYPES },
    include: { project: { select: { reviewRoute: true } }, assignedTo: { include: { smeUser: true } }, slot: { select: { position: true } }, reviews: { select: { createdAt: true } } },
    orderBy: [{ slot: { position: 'asc' } }, { createdAt: 'asc' }],
  });
  const reviewers = await tx.smeUser.findMany({ where: { id: { in: tasks.map((t) => t.reviewerSmeUserId).filter((x): x is string => !!x) } } });
  const me = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
  const conflicted = new Set((await tx.conflictDeclaration.findMany({ where: { reviewerId: actor.userId, resolvedAt: null } })).map((c) => c.smeUserId));
  return tasks.map((t) => {
    const author = t.assignedTo?.smeUser ?? null;
    const blocked = !!author && (conflicted.has(author.id) || (!!author.contactEmail && normEmail(author.contactEmail) === normEmail(me.email)));
    return {
      taskId: t.id,
      label: taskLabel(t),
      slotLabel: slotLabel(t),
      status: t.status,
      smeStatus: smeTaskStatus(t.status),
      author: person(author),
      reviewer: person(reviewers.find((r) => r.id === t.reviewerSmeUserId)),
      reviewStage: t.reviewStage,
      date: lastChange(t, t.reviews.map((r) => r.createdAt)),
      ...turn(t, blocked),
    };
  });
}

/** The output to show: none before authoring, the draft while it is being written, else the latest submitted version. */
function shownOutput(t: StageTask) {
  if (t.quarantinedAt || t.status === 'CREATED') return null;
  if (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS') return t.output ?? null;
  return t.submissions.at(-1)?.output ?? t.output ?? null;
}

async function templateView(tx: Db | Tx, t: StageTask) {
  const template = await templateRef(tx, t.project.templateId);
  // The template's chosen form, or its workflow's default form.
  const profile = profileFor({ workflowName: template.workflowName, profileId: template.profileId });
  return {
    workflow: template.workflowName,
    profileId: profile?.profileId ?? template.profileId ?? null,
    profile,
    coverageDimensions: template.coverageDimensions,
  };
}

async function reviewHistory(tx: Db | Tx, t: StageTask) {
  const nameOf = await reviewerNames(tx, t.reviews.map((r) => r.reviewerId));
  return t.reviews.map((r) => ({
    id: r.id,
    by: nameOf(r.reviewerId),
    byId: r.reviewerId,
    decision: r.decision,
    stage: r.stage,
    comments: r.comments,
    notes: r.notes,
    rejectReason: r.rejectReason,
    version: r.submissionVersion,
    at: r.createdAt.toISOString(),
  }));
}

const flaggedDuplicate = (t: StageTask) => ((t.checks as StoredChecks | null)?.similar ?? []).some((m) => m.flagged);

/** The console task page: the authored form, statuses, people, every decision, and the decision box's inputs. */
export async function forgeTaskView(tx: Db | Tx, actor: Actor, projectId: string, taskId: string) {
  const t = await consoleTask(tx, actor, projectId, taskId);
  const author = t.assignedTo?.smeUser ?? null;
  const reviewer = t.reviewerSmeUserId ? await tx.smeUser.findUnique({ where: { id: t.reviewerSmeUserId } }) : null;
  const latest = t.submissions.at(-1) ?? null;
  const inForce = passInForce(t);
  const checks = t.checks as StoredChecks | null;
  return {
    taskId: t.id,
    label: taskLabel(t),
    slotLabel: slotLabel(t),
    status: t.status,
    smeStatus: smeTaskStatus(t.status),
    reviewRoute: t.project.reviewRoute,
    reviewStage: t.reviewStage,
    project: { id: t.projectId, name: t.project.name },
    author: person(author),
    reviewer: person(reviewer),
    template: await templateView(tx, t),
    input: t.input,
    output: shownOutput(t),
    outputVersion: t.status === 'CREATED' || t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' ? null : (latest?.version ?? null),
    versions: t.submissions.map((v) => ({ version: v.version, submittedAt: v.submittedAt.toISOString() })),
    coverageTags: t.coverageTags,
    checks: checks?.results ?? [],
    flags: t.flags ?? [],
    reviews: await reviewHistory(tx, t),
    date: lastChange(t, t.reviews.map((r) => r.createdAt)),
    ...turn(t, await ownOrConflicted(tx, actor, author)),
    expertPass: inForce ? { version: inForce.submissionVersion, at: inForce.createdAt.toISOString() } : null,
    expectedVersion: latest?.version ?? null,
    expectedRevision: t.revision,
    // The decision box's extra inputs: the checklist on the Author -> PM/Admin route, duplicate and open-slot confirmations.
    checklist: CHECKLIST,
    checklistRequired: t.project.reviewRoute !== 'SME_EXPERT_PM',
    flaggedDuplicate: flaggedDuplicate(t),
    confirmCoverage: (t.slot?.isOpen ?? false) && hasQuotas(t.project.template) && t.project.reviewRoute !== 'SME_EXPERT_PM',
  };
}

/** The PM's or Admin's decision on the Tasks tab (Approve, Rework, Reject), for whichever route the project uses. */
export async function forgeDecide(tx: Tx, actor: Actor, projectId: string, taskId: string, body: ForgeDecisionRequest, audit: Audit, emit: Emit) {
  await requireNewFlow(tx, actor.clientId);
  await lock(tx, taskId);
  const t = await consoleTask(tx, actor, projectId, taskId);
  if (await ownOrConflicted(tx, actor, t.assignedTo?.smeUser)) throw forbidden('You cannot decide on this task: you wrote it, or you declared a conflict with its author.');
  const me = { id: actor.userId, kind: 'USER' as const };
  const auditExtra = { via: 'tasks_tab' };
  const common = { comments: body.comments, notes: body.notes, rejectReason: body.rejectReason, duplicateDecision: body.duplicateDecision, confirmedCoverage: body.confirmedCoverage };

  if (t.project.reviewRoute === 'SME_EXPERT_PM') {
    if (t.status === 'SUBMITTED' && t.reviewStage === 'EXPERT_REVIEW') throw new AppError(409, 'WAITING_FOR_REVIEWER', 'This task is waiting for its Reviewer.');
    return decideStageFor(tx, t, me, { ...common, stage: 'PM_APPROVAL', decision: body.decision, expectedVersion: body.expectedVersion, expectedRevision: body.expectedRevision, checklist: body.checklist }, audit, emit, auditExtra);
  }

  const v = assertCurrent(t, body, { staged: false });
  if (body.decision === 'APPROVE') {
    const missing = CHECKLIST.filter((c) => body.checklist?.[c.key] !== true).map((c) => c.key);
    if (missing.length) throw new AppError(400, 'CHECKLIST_INCOMPLETE', 'Every checklist item must hold to approve.', { missing });
  }
  return decideOneStep(
    tx,
    t,
    me,
    { ...common, decision: body.decision === 'APPROVE' ? 'ACCEPT' : body.decision, checklist: body.checklist ?? {} },
    { version: v.version, contentHash: contentHash(v.output), auditExtra },
    audit,
    emit,
  );
}

// ── External Reviewer (candidate app) ──

const isAuthor = (t: StageTask, me: { id: string; contactEmail: string | null }) =>
  t.assignedTo?.smeUserId === me.id || (!!me.contactEmail && !!t.assignedTo?.smeUser.contactEmail && normEmail(me.contactEmail) === normEmail(t.assignedTo.smeUser.contactEmail));

async function reviewerTask(tx: Db | Tx, actor: CandidateActor, taskId: string) {
  const t = await tx.taskInstance.findFirst({ where: { id: taskId, clientId: actor.clientId, reviewerSmeUserId: actor.smeUserId, taskType: EXPERT_TASK_TYPES }, include: TASK_INCLUDE });
  if (!t) throw notFound('Task not found');
  const me = await tx.smeUser.findUniqueOrThrow({ where: { id: actor.smeUserId }, select: { id: true, contactEmail: true } });
  if (isAuthor(t, me)) throw new AppError(403, 'OWN_TASK', 'You cannot review a task you wrote.');
  return t;
}

const reviewerCanDecide = (t: StageTask) => t.project.reviewRoute === 'SME_EXPERT_PM' && t.status === 'SUBMITTED' && t.reviewStage === 'EXPERT_REVIEW';

/** The Reviewer's own status for a task: To review, Sent back or Approved; null when there is nothing to show yet. */
function reviewerStatus(t: { status: string; reviewStage: string | null }, mine: { decision: string } | undefined): ReviewerTaskStatus | null {
  if (t.status === 'SUBMITTED' && t.reviewStage === 'EXPERT_REVIEW') return 'To review';
  if (mine?.decision === 'REWORK') return 'Sent back';
  if (mine?.decision === 'PASS') return 'Approved';
  return null;
}

/** Home: the tasks this person reviews, in any project of their client. */
export async function reviewerTaskList(db: Db, actor: CandidateActor) {
  const tasks = await db.taskInstance.findMany({
    where: { clientId: actor.clientId, reviewerSmeUserId: actor.smeUserId, taskType: EXPERT_TASK_TYPES },
    include: { project: { select: { id: true, name: true } }, assignedTo: { include: { smeUser: true } }, slot: { select: { position: true } }, reviews: { where: { reviewerId: actor.smeUserId }, orderBy: { createdAt: 'desc' } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  return tasks.flatMap((t) => {
    const mine = t.reviews[0];
    const status = reviewerStatus(t, mine);
    if (!status) return [];
    return [
      {
        taskId: t.id,
        label: taskLabel(t),
        slotLabel: slotLabel(t),
        projectId: t.project.id,
        projectName: t.project.name,
        author: t.assignedTo?.smeUser.displayName ?? null,
        status,
        date: (status === 'To review' ? (t.submittedAt ?? t.updatedAt) : mine!.createdAt).toISOString(),
      },
    ];
  });
}

/** The Review page: the latest submitted version read-only, the form to render it, and this Reviewer's decisions. */
export async function reviewerTaskView(db: Db, actor: CandidateActor, taskId: string) {
  const t = await reviewerTask(db, actor, taskId);
  const latest = t.submissions.at(-1) ?? null;
  const checks = t.checks as StoredChecks | null;
  const history = await reviewHistory(db, t);
  const mine = history.filter((r) => r.byId === actor.smeUserId);
  return {
    taskId: t.id,
    label: taskLabel(t),
    slotLabel: slotLabel(t),
    project: { id: t.projectId, name: t.project.name },
    author: t.assignedTo?.smeUser.displayName ?? null,
    status: reviewerStatus(t, mine.at(-1)),
    taskStatus: t.status,
    reviewStage: t.reviewStage,
    template: await templateView(db, t),
    // MVP1 step 7: the template's tutorial video, or null.
    tutorial: tutorialOf(t.project.template),
    input: t.input,
    // Mirrors what the console review shows a Validator: the authored output, checks and flags; never other authors' content.
    output: t.quarantinedAt ? null : (latest?.output ?? null),
    version: latest?.version ?? null,
    versions: t.submissions.map((v) => ({ version: v.version, submittedAt: v.submittedAt.toISOString() })),
    coverageTags: t.coverageTags,
    checks: checks?.results ?? [],
    flags: t.flags ?? [],
    myDecisions: mine,
    canDecide: reviewerCanDecide(t),
    expectedVersion: latest?.version ?? null,
    expectedRevision: t.revision,
    flaggedDuplicate: flaggedDuplicate(t),
    confirmCoverage: (t.slot?.isOpen ?? false) && hasQuotas(t.project.template),
  };
}

/** The Reviewer passes the exact version to the PM or Admin, or sends it back to the author. */
export async function reviewerDecide(tx: Tx, actor: CandidateActor, taskId: string, body: ReviewerDecisionRequest, audit: Audit, emit: Emit) {
  await requireNewFlow(tx, actor.clientId);
  await lock(tx, taskId);
  const t = await reviewerTask(tx, actor, taskId);
  if (t.project.reviewRoute !== 'SME_EXPERT_PM') throw new AppError(409, 'NO_REVIEWER_STEP', 'This project has no Reviewer step.');
  if (t.status === 'SUBMITTED' && t.reviewStage !== 'EXPERT_REVIEW') throw new AppError(409, 'NOT_AWAITING_REVIEW', 'You have already decided on this version.');
  return decideStageFor(
    tx,
    t,
    { id: actor.smeUserId, kind: 'SME' },
    { stage: 'EXPERT_REVIEW', decision: body.decision, expectedVersion: body.expectedVersion, expectedRevision: body.expectedRevision, checklist: body.checklist, comments: body.comments, notes: body.notes, duplicateDecision: body.duplicateDecision, confirmedCoverage: body.confirmedCoverage },
    audit,
    emit,
    { reviewer: 'external', smeUserId: actor.smeUserId },
  );
}
