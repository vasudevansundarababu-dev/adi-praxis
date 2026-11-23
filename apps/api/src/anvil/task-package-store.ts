import { clausesFor } from './clause-export';
import type { ApprovedTaskRecord } from '@prisma/client';
import type { Db, Tx } from '../db';
import { buildTaskPackage, TASK_PACKAGE_SCHEMA, type PackageProblem } from './generic-package';

/**
 * New RL Gym part 1 (docs/design/FORGE-RLGYM-V2-DESIGN.md): every approved revision is kept as an authored task
 * package that RL Gym fetches by hash. Packages are written when a record is appended and again (idempotently) before
 * an export, so records approved before this change get theirs too.
 */

/** The task's revision number for a record: its position among the task's approved records, by chain order. */
async function revisionOf(tx: Db | Tx, r: ApprovedTaskRecord): Promise<number> {
  return tx.approvedTaskRecord.count({ where: { clientId: r.clientId, taskInstanceId: r.taskInstanceId, seq: { lte: r.seq } } });
}

export type StoreResult = { status: 'stored' | 'existing'; packageSha256: string; revision: number } | { status: 'problem'; problem: PackageProblem };

/**
 * Builds and keeps the package for one approved record. Idempotent: a record has at most one package, and the same
 * content is never stored twice. A task that cannot be packaged returns its problem and stores nothing.
 */
/**
 * The benchmark input that belongs to a record: on approval the caller passes it; later (an export of an older record)
 * only the task's latest record can use the task's stored input, and only while the task is still accepted, because
 * the input is locked from submission until the next approval.
 */
async function benchmarkFor(tx: Db | Tx, record: ApprovedTaskRecord): Promise<unknown> {
  const task = await tx.taskInstance.findUnique({ where: { id: record.taskInstanceId }, select: { status: true, benchmark: true } });
  if (!task || task.status !== 'ACCEPTED' || !task.benchmark) return null;
  const latest = await tx.approvedTaskRecord.findFirst({ where: { clientId: record.clientId, taskInstanceId: record.taskInstanceId }, orderBy: { seq: 'desc' }, select: { id: true } });
  return latest?.id === record.id ? task.benchmark : null;
}

export async function storeTaskPackage(tx: Db | Tx, record: ApprovedTaskRecord, benchmark?: unknown): Promise<StoreResult> {
  const existing = await tx.authoredTaskPackage.findUnique({ where: { recordId: record.id }, select: { packageSha256: true, revision: true } });
  if (existing) return { status: 'existing', ...existing };
  const template = await tx.template.findUnique({ where: { id: record.templateId } });
  if (!template) return { status: 'problem', problem: { recordId: record.id, taskId: record.taskInstanceId, code: 'GENERIC_TEMPLATE_MISSING', message: 'The task’s template version was not found.' } };
  const revision = await revisionOf(tx, record);
  const built = buildTaskPackage({ record, template }, revision, benchmark === undefined ? await benchmarkFor(tx, record) : benchmark, await clausesFor(tx, record, template.anvilSpec));
  if ('code' in built) return { status: 'problem', problem: built };
  await tx.authoredTaskPackage.createMany({
    data: [{ packageSha256: built.packageSha256, clientId: record.clientId, projectId: record.projectId, taskInstanceId: record.taskInstanceId, recordId: record.id, revision, schema: TASK_PACKAGE_SCHEMA, content: built.bytes.toString('utf8') }],
    skipDuplicates: true,
  });
  return { status: 'stored', packageSha256: built.packageSha256, revision };
}

/**
 * Called right after a record is appended. Never fails the approval: a task that cannot be packaged is reported at
 * export (part 2), exactly as today. The insert skips duplicates, so it cannot abort the transaction on a repeat.
 */
export async function storeTaskPackageOnApproval(tx: Tx, record: ApprovedTaskRecord): Promise<void> {
  try {
    // The task's benchmark input as approved: it is locked from submission until this approval.
    const task = await tx.taskInstance.findUnique({ where: { id: record.taskInstanceId }, select: { benchmark: true } });
    await storeTaskPackage(tx, record, task?.benchmark ?? null);
  } catch (e) {
    // A database error has already aborted the transaction and will surface from the caller; anything else (building
    // the package) is not allowed to stop the approval.
    if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string' && String((e as { code: string }).code).startsWith('P')) throw e;
  }
}

/** The stored package bytes for a hash, within the caller's client; null when unknown. */
export async function packageContent(db: Db, clientId: string, packageSha256: string): Promise<string | null> {
  const row = await db.authoredTaskPackage.findUnique({ where: { clientId_packageSha256: { clientId, packageSha256 } }, select: { content: true } });
  return row?.content ?? null;
}
