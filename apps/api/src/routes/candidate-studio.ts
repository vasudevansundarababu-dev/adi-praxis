import type { Prisma } from '@prisma/client';
import { CommitStudioTaskRequest, SaveStudioDraftRequest, SmeAuthoredTaskDto, StudioConfigResponse, STUDIO_STEP_IDS } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { agentFacingBlueprint } from '../meta-compiler/blueprint';
import type { MetaCompilerDeps } from '../meta-compiler/deps';
import { deployedBlueprint, externalTaskId, openStudioTask, registerStudio, STUDIO_DEFINITION_KEY, studioFor, studioOutputOf, type StudioOutput } from '../meta-compiler/studio';
import { authoredTaskDto, authoredTaskInclude } from '../meta-compiler/task-store';
import { writeAudit } from '../platform/audit';
import { IDEMPOTENCY_HEADER, runCandidateCommand } from '../platform/command';
import type { SelectionGate } from '../staffing/selection-gate';
import type { EmbeddingProvider } from '../tasks/embeddings';
import { evaluateTask, submitTask } from '../tasks/submission';
import { allocateTasks } from '../tasks/task-service';
import { outstanding, ownTask, workContext } from './work';

const KeyParams = z.object({ studioKey: z.string().min(3).max(120).regex(/^[a-z0-9][a-z0-9_-]*$/) });

export interface StudioRouteOptions {
  db: Db;
  config: Config;
  storage: ObjectStorage;
  deps: MetaCompilerDeps;
  selectionGate: SelectionGate;
  embeddings: EmbeddingProvider;
  /** Test-only fault injection for the atomic commit (A8): runs after the bundle upload / inside the transaction. */
  faults?: { afterUpload?: () => Promise<void>; beforeRecord?: () => Promise<void> };
}

/** Screen 4 for the assigned SME (architecture section 7): studio configuration, autosave, Save & Commit, own tasks. */
export const candidateStudioRoutes: FastifyPluginAsyncZod<StudioRouteOptions> = async (app, { db, config, storage, deps, selectionGate, embeddings, faults }) => {
  const realData = config.metaCompiler.realDataEnabled;

  /** Deployment, verified blueprint and the work checks (identity, assignment, onboarding) for this SME. */
  async function enter(tx: Db | Tx, studioKey: string, smeUserId: string, clientId: string) {
    const d = await studioFor(tx, { studioKey, clientId, smeUserId });
    const ctx = await workContext(tx, selectionGate, smeUserId, d.projectId);
    if (!ctx.ok) outstanding(ctx);
    const bp = await deployedBlueprint(tx, storage, d.verificationRunId);
    registerStudio(d.template.domain.name, d.template.workflowName, d.templateId, bp, deps);
    return { d, bp, candidateId: ctx.candidateId };
  }

  app.get('/candidate/studio/:studioKey', { config: { access: 'candidate' }, schema: { tags: ['studio'], params: KeyParams, response: { 200: StudioConfigResponse } } }, async (req) => {
    const actor = req.candidate!;
    const { d, bp, candidateId } = await enter(db, req.params.studioKey, actor.smeUserId, actor.clientId);
    let task = await openStudioTask(db, d.projectId, candidateId);
    if (!task) {
      // First open: one task through the existing allocation (caps, coverage slots and review keep working).
      task = await db.$transaction(async (tx) => {
        const audit = (input: Parameters<typeof writeAudit>[2]) => writeAudit(tx, { clientId: actor.clientId, actorType: 'CANDIDATE', actorId: actor.smeUserId, requestId: String(req.id) }, input);
        const [issued] = await allocateTasks(tx, { projectId: d.projectId, candidateId, want: 1 }, audit);
        if (issued) await audit({ entityType: 'TaskInstance', entityId: issued.id, action: 'studio.task_opened', after: { studioKey: d.studioKey, deploymentId: d.id } });
        return issued ?? (await openStudioTask(tx, d.projectId, candidateId));
      });
      if (!task) throw new AppError(409, 'NO_TASK', 'No task is available in this studio right now: you may be at your limit for this project.');
    }
    const saved = studioOutputOf(task);
    return {
      studioKey: d.studioKey,
      deploymentStatus: d.status,
      workflowName: d.template.workflowName,
      templateVersion: d.templateVersion,
      projectName: d.project.name,
      taskInstanceId: task.id,
      revision: task.revision,
      answers: saved?.answers ?? null,
      blueprint: agentFacingBlueprint(bp),
      realDataEnabled: realData,
    };
  });

  app.put(
    '/candidate/studio/:studioKey/draft',
    { config: { access: 'candidate', rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['studio'], params: KeyParams, body: SaveStudioDraftRequest } },
    async (req, reply) => {
      await runCandidateCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const { d, candidateId } = await enter(tx, req.params.studioKey, actor.smeUserId, actor.clientId);
        const t = await openStudioTask(tx, d.projectId, candidateId);
        if (!t) throw new AppError(409, 'READ_ONLY', 'There is no open task in this studio. Reload to continue.');
        if (d.project.status === 'PAUSED') throw new AppError(409, 'PROJECT_PAUSED', 'This project is paused. Your work is saved; you can continue when it resumes.');
        const output: StudioOutput = { kind: STUDIO_DEFINITION_KEY, deploymentId: d.id, templateId: d.templateId, answers: req.body.answers };
        const now = new Date();
        const { count } = await tx.taskInstance.updateMany({
          where: { id: t.id, revision: req.body.expectedRevision, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'REWORK'] } },
          data: { output: output as unknown as Prisma.InputJsonValue, status: 'IN_PROGRESS', startedAt: t.startedAt ?? now, lastSavedAt: now, revision: { increment: 1 } },
        });
        if (!count) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: t.revision });
        if (t.slotId && t.status === 'ASSIGNED') await tx.coverageSlot.update({ where: { id: t.slotId }, data: { status: 'IN_PROGRESS' } });
        await audit({ entityType: 'TaskInstance', entityId: t.id, action: t.status === 'IN_PROGRESS' ? 'task.saved' : 'task.started', before: { status: t.status, revision: t.revision }, after: { status: 'IN_PROGRESS', revision: t.revision + 1, studioKey: d.studioKey } });
        return { status: 200, body: { revision: t.revision + 1, savedAt: now.toISOString() } };
      });
      return reply;
    },
  );

  app.post(
    '/candidate/studio/:studioKey/commit',
    { config: { access: 'candidate', rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['studio'], params: KeyParams, body: CommitStudioTaskRequest } },
    async (req, reply) => {
      const actor = req.candidate!;
      // A repeat click with the same Idempotency-Key replays the stored response before any pre-check (S4-10).
      const key = req.headers[IDEMPOTENCY_HEADER];
      if (typeof key === 'string' && (await db.idempotencyKey.findUnique({ where: { actorId_key: { actorId: `candidate:${actor.smeUserId}`, key } } }))) {
        await runCandidateCommand(db, req, reply, async () => {
          throw new AppError(409, 'NOT_SUBMITTABLE', 'This task was already committed.');
        });
        return reply;
      }
      // Steps 1 and 2 (architecture section 7), outside the transaction: build the bundle deterministically and upload it
      // under a content-addressed key, so a retry rewrites the same object.
      const { d, bp, candidateId } = await enter(db, req.params.studioKey, actor.smeUserId, actor.clientId);
      const pre = await openStudioTask(db, d.projectId, candidateId);
      if (!pre) throw new AppError(409, 'NOT_SUBMITTABLE', 'There is no open task in this studio.');
      if (pre.revision !== req.body.expectedRevision) throw new AppError(409, 'STALE_REVISION', 'This task changed in another window. Reload to continue.', { revision: pre.revision });
      const saved = studioOutputOf(pre);
      if (!saved) throw new AppError(422, 'EMPTY', 'Save your work before committing.');
      const problems = deps.studioAnswerProblems(bp, saved.answers);
      if (STUDIO_STEP_IDS.some((s) => problems[s].length)) throw new AppError(422, 'STUDIO_INCOMPLETE', 'Some steps need attention before you can commit.', { problems });
      if (req.body.dataClassification === 'REAL_PUBLIC' && !realData) throw new AppError(422, 'REAL_DATA_DISABLED', 'Real public data is not allowed yet: every task is synthetic (D5a).');
      const dataClassification = realData ? req.body.dataClassification : 'SYNTHETIC';
      const version = (await db.taskSubmission.count({ where: { taskInstanceId: pre.id } })) + 1;
      const extId = externalTaskId(bp, d.template.domain.name, pre.id, version, sha256);
      const title = typeof saved.answers.fields.title === 'string' && saved.answers.fields.title.trim() ? saved.answers.fields.title.trim().slice(0, 200) : bp.domain_meta.title;
      const executionMode = bp.template_meta.modes[0] ?? d.template.executionMode ?? 'HERMETIC_MCP';
      const bundle = deps.buildBundle(bp, saved.answers, { externalTaskId: extId, title, templateId: d.templateId, templateVersion: d.templateVersion, executionMode, dataClassification });
      const bundleRef = `bundles/${actor.clientId}/${bundle.sha256}.tar.gz`;
      await storage.put(bundleRef, Buffer.from(bundle.bytes), 'application/gzip');
      await faults?.afterUpload?.();
      const taskJson = JSON.parse(deps.generate(bp, saved.answers)['task.json']) as Prisma.InputJsonValue;
      // The duplicate check's embedding is a model call: computed before the transaction, like the existing submit.
      const embedding = await embeddings.embed((await evaluateTask(db, pre)).text).catch(() => {
        throw new AppError(503, 'SIMILARITY_UNAVAILABLE', 'The duplicate check is unavailable right now. Your work is saved; try again shortly.');
      });

      // Step 3: one transaction for the existing submit, the authored-task record, audit and outbox (no partial task).
      await runCandidateCommand(db, req, reply, async ({ tx, actor: a, audit, emit }) => {
        const t = await ownTask(tx, pre.id, a.smeUserId);
        const ctx = await workContext(tx, selectionGate, a.smeUserId, t.projectId);
        if (!ctx.ok) outstanding(ctx);
        if (t.project.status === 'PAUSED') throw new AppError(409, 'PROJECT_PAUSED', 'This project is paused. Your work is saved; you can commit when it resumes.');
        const r = await submitTask(tx, { task: t, body: { expectedRevision: req.body.expectedRevision, syntheticDeclaration: true, flagExplanations: {} }, embedding, embeddingModel: embeddings.model }, audit, emit);
        if (r.version !== version) throw new AppError(409, 'STALE_REVISION', 'This task changed meanwhile. Reload to continue.');
        await faults?.beforeRecord?.();
        const authored = await tx.smeAuthoredTask.create({
          data: {
            clientId: a.clientId,
            taskInstanceId: t.id,
            submissionVersion: version,
            deploymentId: d.id,
            templateId: d.templateId,
            templateVersion: d.templateVersion,
            projectId: d.projectId,
            candidateId,
            externalTaskId: extId,
            policySnapshotId: (await tx.taskSubmission.findUnique({ where: { taskInstanceId_version: { taskInstanceId: t.id, version } }, select: { policySnapshotId: true } }))?.policySnapshotId ?? null,
            title,
            tptEstimate: bp.template_meta.tpt_label || null,
            executionMode,
            taskJson,
            bundleRef,
            bundleSha256: bundle.sha256,
            dataClassification,
          },
        });
        await audit({ entityType: 'SmeAuthoredTask', entityId: authored.id, action: 'studio.task_committed', after: { externalTaskId: extId, taskInstanceId: t.id, version, bundleSha256: bundle.sha256, dataClassification, studioKey: d.studioKey } });
        await emit({ name: 'studio.task_committed', aggregateType: 'SmeAuthoredTask', aggregateId: authored.id, payload: { authoredTaskId: authored.id } });
        return { status: 200, body: { status: 'SUBMITTED', version, authoredTaskId: authored.id, externalTaskId: extId, bundleSha256: bundle.sha256, taskJson } };
      });
      return reply;
    },
  );

  app.get('/candidate/studio/:studioKey/tasks', { config: { access: 'candidate' }, schema: { tags: ['studio'], params: KeyParams, response: { 200: z.object({ items: z.array(SmeAuthoredTaskDto) }) } } }, async (req) => {
    const actor = req.candidate!;
    const d = await studioFor(db, { studioKey: req.params.studioKey, clientId: actor.clientId, smeUserId: actor.smeUserId });
    const rows = await db.smeAuthoredTask.findMany({ where: { clientId: actor.clientId, deploymentId: d.id, candidateId: d.candidateId }, include: authoredTaskInclude, orderBy: { createdAt: 'desc' } });
    return { items: rows.map((t) => authoredTaskDto(t, false)) };
  });
};
