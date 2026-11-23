import type { Db } from '../db';
import { writeAudit } from '../platform/audit';
import { latestApprovedRecord, sendBackApproved } from '../tasks/send-back';

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
    const latest = await latestApprovedRecord(tx, t.id);
    if (!latest.ok) return { outcome: 'refused', reason: latest.problem };
    const plan = { taskId: t.id, recordId: latest.record.id, recordKept: true as const, fromStatus: 'ACCEPTED' as const, toStatus: 'REWORK' as const };
    if (!args.apply) return { outcome: 'planned', ...plan };
    await sendBackApproved(tx, t, { actorId: admin.id, notes, source: 'admin_send_back', audit: (a) => writeAudit(tx, { clientId: t.clientId, actorType: 'SYSTEM', actorId: ACTOR }, a), auditExtra: { requestedBy: admin.id } });
    return { outcome: 'sent_back', ...plan };
  });
}
