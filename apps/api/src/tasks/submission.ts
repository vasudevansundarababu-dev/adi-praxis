import type { Prisma, TaskInstance } from '@prisma/client';
import type { CoverageTags, SubmitTaskRequest, TaskCheck } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import type { OutboxInput } from '../outbox/outbox';
import { coverageChecks, definitionFor, finalCoverage, type SlotRef } from './definitions';
import { draftingChecks } from './drafting/service';
import { findSimilar, storeEmbedding, type SimilarMatch } from './similarity';
import { scanForRealData, type DataFlag } from './synthetic-scan';
import { templateRef } from './task-service';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

export interface StoredChecks {
  results: TaskCheck[];
  keyInputs: string[];
  similar: SimilarMatch[];
  embeddingModel: string | null;
}

export const blocking = (c: TaskCheck) => !c.ok && c.severity !== 'warning';

/** Every automated check for the task's current output (TASK-KYC section 5), without changing anything. */
export async function evaluateTask(tx: Db | Tx, task: Pick<TaskInstance, 'id' | 'projectId' | 'taskType' | 'output' | 'input' | 'drafting'>) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: task.projectId }, include: { template: true } });
  const template = await templateRef(tx, project.templateId);
  const def = definitionFor(template);
  const output = (task.output ?? {}) as Record<string, unknown>;
  const slot = task.taskType === 'AUTHORING' ? ((task.input as { slot?: SlotRef }).slot ?? null) : null;
  const checks: TaskCheck[] = [...coverageChecks(template, slot, output), ...def.validateSubmission(template, output, slot), ...draftingChecks(task)];
  const coverage: CoverageTags | null = task.taskType === 'AUTHORING' ? finalCoverage(slot, output) : null;
  return {
    project,
    template,
    checks,
    flags: task.taskType === 'AUTHORING' ? scanForRealData(output) : ([] as DataFlag[]),
    coverage,
    keyInputs: def.keyInputs(output),
    text: def.canonicalText(output),
    threshold: Number(project.template.similarityThreshold),
    lineageId: project.template.lineageId,
  };
}

/**
 * Submits the autosaved output. Blocked by any failing check or any unexplained synthetic-data flag. Near-duplicates
 * never block; they are flagged for the Reviewer. Each submission is kept as a numbered version.
 */
export async function submitTask(
  tx: Tx,
  args: { task: TaskInstance; body: SubmitTaskRequest; embedding: number[] | null; embeddingModel: string | null },
  audit: Audit,
  emit: (e: OutboxInput) => Promise<void>,
) {
  const t = args.task;
  if (!['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status)) throw new AppError(409, 'NOT_SUBMITTABLE', `This task is ${t.status.toLowerCase()} and cannot be submitted.`);
  if (t.revision !== args.body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: t.revision });
  if (!t.output) throw new AppError(422, 'EMPTY', 'Save your work before submitting.');

  const ev = await evaluateTask(tx, t);
  const unexplained = ev.flags.filter((f) => !args.body.flagExplanations[f.id]);
  if (ev.checks.some(blocking) || unexplained.length) {
    throw new AppError(422, 'CHECKS_FAILED', 'Some checks need attention before you can submit.', { checks: ev.checks, flags: ev.flags, unexplained: unexplained.map((f) => f.id) });
  }

  let similar: SimilarMatch[] = [];
  if (args.embedding && t.taskType === 'AUTHORING') {
    similar = await findSimilar(tx, { taskId: t.id, lineageId: ev.lineageId, embedding: args.embedding, coverage: ev.coverage, keyInputs: ev.keyInputs, threshold: ev.threshold });
    await storeEmbedding(tx, t.id, args.embedding);
    await tx.similarityCheck.deleteMany({ where: { taskInstanceId: t.id } });
    await tx.similarityCheck.createMany({
      data: similar.flatMap((m) => [
        { clientId: t.clientId, taskInstanceId: t.id, comparedToId: m.taskId, score: m.embeddingScore.toFixed(4), method: 'EMBEDDING' as const, flagged: m.embeddingScore >= ev.threshold },
        { clientId: t.clientId, taskInstanceId: t.id, comparedToId: m.taskId, score: m.structuredScore.toFixed(4), method: 'STRUCTURED' as const, flagged: m.flagged && m.embeddingScore < ev.threshold },
      ]),
    });
  }

  const stored: StoredChecks = { results: ev.checks, keyInputs: ev.keyInputs, similar, embeddingModel: args.embeddingModel };
  const flags = ev.flags.map((f) => ({ ...f, explanation: args.body.flagExplanations[f.id] }));
  const now = new Date();
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, revision: t.revision },
    data: {
      status: 'SUBMITTED',
      submittedAt: now,
      coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined,
      checks: stored as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
    },
  });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.');
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  const version = (await tx.taskSubmission.count({ where: { taskInstanceId: t.id } })) + 1;
  await tx.taskSubmission.create({ data: { clientId: t.clientId, taskInstanceId: t.id, version, output: t.output as Prisma.InputJsonValue, coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined, checks: stored as unknown as Prisma.InputJsonValue } });
  const flagged = similar.filter((m) => m.flagged);
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.submitted', before: { status: t.status }, after: { status: 'SUBMITTED', version, flaggedDuplicates: flagged.map((m) => m.taskId), dataFlags: flags.length } });
  await emit({ name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, projectId: t.projectId, version, flaggedDuplicate: flagged.length > 0 } });
  return { version, similar };
}
