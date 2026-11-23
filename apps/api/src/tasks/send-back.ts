import type { ApprovedTaskRecord, Prisma, TaskInstance } from '@prisma/client';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';

type Audit = (a: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) => Promise<void>;

/**
 * Send an approved task back to its author for a new revision (owner, 23 Nov 2026). The same transition as the RL
 * Gym's `task_correction`: Accepted -> Rework with the notes the SME sees in the bell and on the task page. The approved
 * record stays exactly as it is (append-only); the task is not exported while in Rework, and the record a person writes
 * by approving the revision replaces it in exports. Nothing here writes or changes an approval.
 */
export async function latestApprovedRecord(tx: Db | Tx, taskId: string): Promise<{ ok: true; record: ApprovedTaskRecord } | { ok: false; problem: string }> {
  const record = await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: taskId }, orderBy: { seq: 'desc' } });
  if (!record) return { ok: false, problem: 'The task has no approved record.' };
  if (await tx.approvedTaskRecord.count({ where: { supersedesId: record.id } })) return { ok: false, problem: 'The latest approved record has been superseded.' };
  return { ok: true, record };
}

export async function sendBackApproved(tx: Tx, t: Pick<TaskInstance, 'id' | 'clientId' | 'status' | 'revision' | 'slotId'>, args: { actorId: string; notes: string; source: string; audit: Audit; auditExtra?: Record<string, unknown> }) {
  if (t.status !== 'ACCEPTED') throw new AppError(409, 'NOT_APPROVED', 'Only an approved task can be sent back for rework.');
  const latest = await latestApprovedRecord(tx, t.id);
  if (!latest.ok) throw new AppError(409, 'NO_APPROVED_RECORD', latest.problem);
  const notes = args.notes.trim();
  const { count } = await tx.taskInstance.updateMany({ where: { id: t.id, status: 'ACCEPTED', revision: t.revision }, data: { status: 'REWORK', reviewStage: null, reworkCount: { increment: 1 }, revision: { increment: 1 }, reviewNotes: notes, reviewerId: args.actorId } });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'The task changed since you opened it. Reload and try again.');
  const sub = await tx.taskSubmission.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' }, select: { version: true } });
  await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: sub?.version ?? 1, reviewerId: args.actorId, decision: 'REWORK', checklist: {}, comments: [{ section: 'general', text: notes, source: args.source }] as Prisma.InputJsonValue, notes } });
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  await args.audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.sent_back_after_approval', before: { status: 'ACCEPTED', revision: t.revision }, after: { status: 'REWORK', recordId: latest.record.id, recordKept: true, notes, ...args.auditExtra } });
  return { recordId: latest.record.id };
}
