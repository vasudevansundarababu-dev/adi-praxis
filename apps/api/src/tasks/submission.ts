import type { Prisma, TaskInstance } from '@prisma/client';
import { praxisContractChecks } from '@praxis/shared';
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
import { chatOf } from './conversation/service';
import { effectivePolicy, snapshotTask } from '../policy/task-policy';
import { graphChecks } from './workflow-graph';
import { compileForSubmission, profileChecks, type ExportStatus } from './profile-output';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;

export interface StoredChecks {
  results: TaskCheck[];
  keyInputs: string[];
  similar: SimilarMatch[];
  embeddingModel: string | null;
  /** Anvil export readiness of a profile-driven task (compiled at submission); absent for other tasks. */
  export?: ExportStatus;
}

export const blocking = (c: TaskCheck) => !c.ok && c.severity !== 'warning';

/** Every automated check for the task's current output (TASK-KYC section 5), without changing anything. */
export async function evaluateTask(tx: Db | Tx, task: Pick<TaskInstance, 'id' | 'projectId' | 'taskType' | 'output' | 'input' | 'drafting' | 'revision'>) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: task.projectId }, include: { template: true } });
  const template = await templateRef(tx, project.templateId);
  const def = definitionFor(template);
  const output = (task.output ?? {}) as Record<string, unknown>;
  const slot = task.taskType === 'AUTHORING' ? ((task.input as { slot?: SlotRef }).slot ?? null) : null;
  const checks: TaskCheck[] = [...coverageChecks(template, slot, output), ...(def.key === 'kyc-onboarding-v1' ? praxisContractChecks(output) : []), ...def.validateSubmission(template, output, slot), ...(task.taskType === 'AUTHORING' ? profileChecks(template.workflowName, output) : []), ...draftingChecks(task), ...(task.taskType === 'AUTHORING' ? graphChecks(output, project.template) : [])];
  const chat = chatOf(task);
  if (task.taskType === 'AUTHORING' && project.authoringExperience) checks.push({id:'authoring.consent',section:'W06',ok:!!chat.consent && !!chat.humanOnly,message:'Accept human-authorship terms and review this revision before submission'});
  if (chat.humanOnly) checks.push({id:'conversation.authorship',section:'W06',ok:chat.declaration?.revision===task.revision,message:'Confirm human authorship, no external LLM generation and authorised sources for this revision'});
  if (chat.reviewedRevision !== undefined) checks.push({ id: 'conversation.reviewed_revision', section: 'W06', ok: chat.reviewedRevision === task.revision, message: 'Review the latest task revision after manual edits' });
  if (chat.policyDigest) {
    const policy = await effectivePolicy(tx, project.clientId, task);
    checks.push({ id: 'conversation.policy_version', section: 'W06', ok: chat.policyDigest === (policy?.digest ?? 'none'), message: 'Reconcile conversation against current published project rules' });
  }
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

  // Export readiness is separate from authoring: a blocked compile never blocks the submission.
  const compiled = t.taskType === 'AUTHORING' ? compileForSubmission(ev.template.workflowName, t.output as Record<string, unknown>, { taskId: t.id, revisionId: `${t.id}-r${t.revision}` }) : null;
  const output = (compiled?.output ?? t.output) as Prisma.InputJsonValue;
  const stored: StoredChecks = { results: ev.checks, keyInputs: ev.keyInputs, similar, embeddingModel: args.embeddingModel, ...(compiled ? { export: compiled.status } : {}) };
  const flags = ev.flags.map((f) => ({ ...f, explanation: args.body.flagExplanations[f.id] }));
  const now = new Date();
  const { count } = await tx.taskInstance.updateMany({
    where: { id: t.id, revision: t.revision },
    data: {
      status: 'SUBMITTED',
      submittedAt: now,
      ...(compiled ? { output } : {}),
      coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined,
      checks: stored as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
    },
  });
  if (!count) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.');
  if (t.slotId) await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
  const version = (await tx.taskSubmission.count({ where: { taskInstanceId: t.id } })) + 1;
  const policy = await snapshotTask(tx, { clientId: t.clientId, task: { id: t.id, projectId: t.projectId }, actorId: 'task-submission' });
  await tx.taskSubmission.create({ data: { clientId: t.clientId, taskInstanceId: t.id, version, policySnapshotId: policy?.snapshot.id ?? null, output, coverageTags: (ev.coverage ?? undefined) as Prisma.InputJsonValue | undefined, checks: stored as unknown as Prisma.InputJsonValue } });
  const flagged = similar.filter((m) => m.flagged);
  await audit({ entityType: 'TaskInstance', entityId: t.id, action: 'task.submitted', before: { status: t.status }, after: { status: 'SUBMITTED', version, ...(compiled ? { export: compiled.status.status } : {}), flaggedDuplicates: flagged.map((m) => m.taskId), dataFlags: flags.length } });
  await emit({ name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: t.id, payload: { taskId: t.id, projectId: t.projectId, version, flaggedDuplicate: flagged.length > 0 } });
  return { version, similar };
}
