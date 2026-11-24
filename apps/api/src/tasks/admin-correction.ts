import type { Prisma, TaskInstance, Template } from '@prisma/client';
import { jsonDiff } from '@praxis/shared';
import { jointTemplateSpec } from '../anvil/joint-template';
import { writeApprovedRecord } from '../dataset/approved-records';
import type { Tx } from '../db';
import { AppError } from '../lib/errors';
import { caseLockProblem } from './definitions';
import { authoredContent, compileForSubmission, profileSaveProblems } from './profile-output';
import { approvalExportBlocker, approvalIntegrity, revalidateTask, type RevalidationTask } from './revalidation';
import { latestApprovedRecord } from './send-back';
import { contentHash } from './stage-review';

type Audit = (a: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) => Promise<void>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Owner (24 Nov 2026): "every day I am paying $1000 for SME time ... as long as it's a small fix I can do it myself".
 * A PM or Admin corrects one field of an approved task without an SME, and the correction is the human approval of a
 * new revision:
 * - the earlier approved record stays exactly as it is (append-only); the new record replaces it in exports, which send
 *   it as the next revision (corrects_revision);
 * - every check runs on the corrected content first (the submit checks, the package check, the stronger checks), and a
 *   failing one changes nothing;
 * - the author keeps the authorship; the corrector is recorded as the reviewer, and the edit, the approval and the audit
 *   event name the reason and the changed paths;
 * - stale (another change since the page was opened) or empty corrections are refused.
 */
export interface CorrectionInput {
  section: string;
  field: string;
  value?: unknown;
  reason: string;
  expectedRevision: number;
}

export async function correctApproved(
  tx: Tx,
  t: RevalidationTask & Pick<TaskInstance, 'status' | 'benchmark'> & { project: { template: Template } },
  actorUserId: string,
  body: CorrectionInput,
  audit: Audit,
) {
  if (body.value === undefined) throw new AppError(422, 'VALUE_REQUIRED', 'Give the corrected value.');
  if (t.status !== 'ACCEPTED') throw new AppError(409, 'NOT_APPROVED', 'Only an approved task can be corrected here.');
  if (t.revision !== body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'The task changed since you opened it. Reload and try again.');
  const latest = await latestApprovedRecord(tx, t.id);
  if (!latest.ok) throw new AppError(409, 'NO_APPROVED_RECORD', latest.problem);
  const current = authoredContent(t.output) as Record<string, unknown>;
  const sections = isObj(current?.sections) ? current.sections : null;
  if (!sections || !isObj(sections[body.section])) throw new AppError(422, 'UNKNOWN_FIELD', `The task has no section ${body.section}.`);
  const next = structuredClone(current) as Record<string, unknown> & { sections: Record<string, Record<string, unknown>> };
  next.sections[body.section]![body.field] = body.value;
  const changes = jsonDiff(current, next);
  if (!changes.length) throw new AppError(400, 'NO_CHANGE', 'The correction changes nothing.');
  const template = t.project.template;
  // A Studio (joint) template's form is in its spec; the package check below compares the task with that form.
  const shape = jointTemplateSpec(template) ? [] : profileSaveProblems(template, next);
  if (shape.length) throw new AppError(422, 'INVALID_PROFILE_OUTPUT', `This correction does not fit the template’s form: ${shape.join(' ')}`, { problems: shape });
  const locked = caseLockProblem(t.input, next);
  if (locked) throw new AppError(422, 'CASE_SELECTOR_LOCKED', locked);

  // Every check runs on the corrected content; any blocking problem stops the correction and nothing changes.
  const blocker = approvalExportBlocker(template, t, next);
  if (blocker) throw new AppError(409, 'NOT_EXPORTABLE', blocker);
  const corrected = { ...t, output: next as Prisma.JsonValue };
  const integrity = await approvalIntegrity(tx, corrected);
  const rv = await revalidateTask(tx, corrected, next);
  const failing = [...rv.failing, ...integrity.authorChecks];
  if (integrity.stop || failing.length) {
    const problems = [...failing.map((c) => `${c.section}: ${c.message}`), ...(integrity.stop ? [integrity.stop] : [])];
    throw new AppError(422, 'CORRECTION_FAILS_CHECKS', `The corrected task fails ${problems.length} check${problems.length === 1 ? '' : 's'}, so nothing was changed: ${problems.join(' · ')}`, { problems, checks: failing });
  }

  const compiled = compileForSubmission(template, next, { taskId: t.id, revisionId: `${t.id}-r${t.revision + 1}` });
  const output = (compiled?.output ?? next) as Prisma.InputJsonValue;
  const hash = contentHash(output);
  const last = await tx.taskSubmission.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;
  const reason = body.reason.trim();
  const prevChecks = isObj(t.checks) ? t.checks : {};
  const stored = { ...prevChecks, results: rv.checks, ...(compiled ? { export: compiled.status } : {}), correction: { by: actorUserId, at: new Date().toISOString(), reason } };

  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, status: 'ACCEPTED', revision: t.revision },
    data: { output, revision: { increment: 1 }, reviewNotes: `Corrected by a PM or Admin: ${reason}`, reviewerId: actorUserId, checks: stored as unknown as Prisma.InputJsonValue },
  });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'The task changed since you opened it. Reload and try again.');
  await tx.taskSubmission.create({ data: { clientId: t.clientId, taskInstanceId: t.id, version, output, ...(last?.coverageTags ? { coverageTags: last.coverageTags as Prisma.InputJsonValue } : {}), checks: stored as unknown as Prisma.InputJsonValue, ...(last?.policySnapshotId ? { policySnapshotId: last.policySnapshotId } : {}) } });
  await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: version, reviewerId: actorUserId, decision: 'EDIT', contentHash: hash, editReason: reason, material: false, checklist: {}, notes: reason } });
  await tx.taskReview.create({ data: { clientId: t.clientId, taskInstanceId: t.id, submissionVersion: version, reviewerId: actorUserId, decision: 'ACCEPT', contentHash: hash, checklist: {}, notes: `Approved with a correction: ${reason}` } });
  const record = await writeApprovedRecord(tx, { taskId: t.id, reviewerId: actorUserId, reviewNotes: `Corrected by a PM or Admin: ${reason}`, duplicateDecision: null, decidedAt: new Date() });
  await audit({
    entityType: 'TaskInstance',
    entityId: t.id,
    action: 'task.corrected_after_approval',
    before: { status: 'ACCEPTED', revision: t.revision, recordId: latest.record.id },
    after: { status: 'ACCEPTED', revision: t.revision + 1, version, recordId: record.id, previousRecordKept: true, reason, field: `${body.section}.${body.field}`, changedPaths: changes.slice(0, 50).map((c) => c.path), contentHash: hash },
  });
  return { status: 'ACCEPTED' as const, revision: t.revision + 1, version, recordId: record.id, previousRecordId: latest.record.id, recordKept: true as const, changed: changes.length };
}
