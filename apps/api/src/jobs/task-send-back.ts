import type { Prisma } from '@prisma/client';
import type { Db } from '../db';
import { writeAudit } from '../platform/audit';

/**
 * Send an approved task back to its author for a new revision (owner, 23 Nov 2026: TSK-001). The same transition as
 * the RL Gym's `task_correction` decision: the task leaves Accepted for Rework with the reviewer's notes, so the SME
 * sees it in the bell and on the task page. Its approved record stays exactly as it is (append-only); it is not
 * exported while the task is being reworked, and the record a person writes by approving the revision replaces it.
 * Nothing here writes or changes an approval.
 *
 * Dry run by default; `--apply` writes. Authorised (an active Admin asks), audited (actor SYSTEM, this job, with the
 * Admin's user ID), idempotent (a task already sent back with the same notes is reported, not touched).
 */

const ACTOR = 'task-send-back';
export const TASK_SEND_BACK_USAGE = 'Use: task-send-back --task <task id> --requested-by <admin email> --notes "<what the author must fix>" [--apply]';

export interface SendBackArgs {
  taskId: string;
  requestedBy: string;
  notes: string;
  apply: boolean;
}

export function parseSendBackArgs(argv: string[]): SendBackArgs {
  const out: SendBackArgs = { taskId: '', requestedBy: '', notes: '', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') out.apply = true;
    else if (a === '--task' || a === '--requested-by' || a === '--notes') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value. ${TASK_SEND_BACK_USAGE}`);
      if (a === '--task') out.taskId = v;
      else if (a === '--requested-by') out.requestedBy = v;
      else out.notes = v;
    } else throw new Error(`Unknown argument "${a}". ${TASK_SEND_BACK_USAGE}`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.taskId)) throw new Error(`--task <task id> is required. ${TASK_SEND_BACK_USAGE}`);
  if (!/^[^@\s]+@[^@\s]+$/.test(out.requestedBy)) throw new Error(`--requested-by <admin email> is required. ${TASK_SEND_BACK_USAGE}`);
  if (out.notes.trim().length < 10) throw new Error(`--notes must say what the author must fix. ${TASK_SEND_BACK_USAGE}`);
  return out;
}

export type SendBackReport =
  | { outcome: 'refused'; reason: string }
  | { outcome: 'already_sent_back'; taskId: string }
  | { outcome: 'planned' | 'sent_back'; taskId: string; recordId: string; recordKept: true; fromStatus: 'ACCEPTED'; toStatus: 'REWORK' };

export async function taskSendBack(db: Db, args: SendBackArgs): Promise<SendBackReport> {
  const notes = args.notes.trim();
  return db.$transaction(async (tx) => {
    const t = await tx.taskInstance.findUnique({ where: { id: args.taskId } });
    if (!t) return { outcome: 'refused', reason: 'The task was not found.' };
    const admin = await tx.user.findFirst({ where: { clientId: t.clientId, email: { equals: args.requestedBy, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
    if (!admin) return { outcome: 'refused', reason: 'The requester is not an active Admin of the task’s client.' };
    if (t.status === 'REWORK' && t.reviewNotes === notes) return { outcome: 'already_sent_back', taskId: t.id };
    if (t.status !== 'ACCEPTED') return { outcome: 'refused', reason: `The task is ${t.status.toLowerCase()}, not approved.` };
    const record = await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: t.id }, orderBy: { seq: 'desc' } });
    if (!record) return { outcome: 'refused', reason: 'The task has no approved record.' };
    if (await tx.approvedTaskRecord.count({ where: { supersedesId: record.id } })) return { outcome: 'refused', reason: 'The latest approved record has been superseded.' };
    const plan = { taskId: t.id, recordId: record.id, recordKept: true as const, fromStatus: 'ACCEPTED' as const, toStatus: 'REWORK' as const };
    if (!args.apply) return { outcome: 'planned', ...plan };

    const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, status: 'ACCEPTED', revision: t.revision }, data: { status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 }, revision: { increment: 1 }, reviewNotes: notes, reviewerId: admin.id } });
    if (!count) throw new Error('The task changed while it was being sent back; nothing was written. Run the job again.');
    const sub = await tx.taskSubmission.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: sub?.version ?? 1, reviewerId: admin.id, decision: 'REWORK', checklist: {}, comments: [{ section: 'general', text: notes, source: 'admin_send_back' }] as Prisma.InputJsonValue, notes } });
    if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
    await writeAudit(tx, { clientId: t.clientId, actorType: 'SYSTEM', actorId: ACTOR }, { entityType: 'TaskInstance', entityId: t.id, action: 'task.sent_back_after_approval', before: { status: 'ACCEPTED', revision: t.revision }, after: { status: 'REWORK', requestedBy: admin.id, recordId: record.id, recordKept: true, notes } });
    return { outcome: 'sent_back', ...plan };
  });
}
