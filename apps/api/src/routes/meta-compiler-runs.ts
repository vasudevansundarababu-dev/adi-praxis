import { GenerationRunDto, HarborBlueprint, ModelOptionDto, StartGenerationRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { isComplete, serverProblems } from '../meta-compiler/blueprint';
import { budgetProblem, spentTodayUsd } from '../meta-compiler/cost';
import type { MetaCompilerDeps } from '../meta-compiler/deps';
import { DrafterError, estimate, type DrafterFactory } from '../meta-compiler/drafter';
import { generationDto, progress, promptFor, promptHashOf } from '../meta-compiler/generation';
import { runCommand } from '../platform/command';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;

export interface RunRoutesOptions {
  db: Db;
  config: Config;
  storage: ObjectStorage;
  drafters: DrafterFactory;
  deps: MetaCompilerDeps;
}

/** Screen 3 of the Meta-Compiler: generate, verify, deploy (architecture sections 5 and 6). Admin only (D9). */
export const metaCompilerRunRoutes: FastifyPluginAsyncZod<RunRoutesOptions> = async (app, { db, config, drafters }) => {
  const mc = config.metaCompiler;

  // S3-01: the configured Claude and Gemini models; the mock when live AI is off (local, demo, tests).
  app.get('/meta-compiler/models', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], response: { 200: z.object({ items: z.array(ModelOptionDto), liveAi: z.boolean(), codegenEnabled: z.boolean() }) } } }, async () => ({
    items: [
      ...mc.models.map((m) => ({ provider: m.provider, model: m.model, label: `${m.provider === 'claude' ? 'Claude' : 'Gemini'} ${m.model} (Vertex AI)`, available: mc.liveAi })),
      ...(mc.liveAi ? [] : [{ provider: 'mock' as const, model: 'mock-drafter-1', label: 'Local mock drafter (no paid calls)', available: true }]),
    ],
    liveAi: mc.liveAi,
    codegenEnabled: mc.codegenEnabled,
  }));

  app.post(
    '/templates/:id/generations',
    { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, body: StartGenerationRequest, response: { 200: GenerationRunDto, 201: GenerationRunDto } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        const t = await tx.template.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!t) throw notFound('Template not found');
        // S2-17, S3-03: generation needs a saved blueprint that passes all 6 sections on the server.
        const parsed = t.blueprint === null ? null : HarborBlueprint.safeParse(t.blueprint);
        if (!parsed?.success) throw new AppError(422, 'BLUEPRINT_REQUIRED', 'Save a blueprint for this template before generating.');
        const bp = parsed.data;
        const problems = await serverProblems(tx, t, bp);
        if (!isComplete(problems)) throw new AppError(422, 'BLUEPRINT_INCOMPLETE', 'All 6 sections must be valid before generating.', { problems });
        if (req.body.mode === 'FULL_CODE' && !mc.codegenEnabled) throw new AppError(403, 'CODEGEN_DISABLED', 'Full code generation is switched off in this environment.');
        let drafter;
        try {
          drafter = drafters({ provider: req.body.provider, model: req.body.model });
        } catch (err) {
          throw new AppError(422, 'MODEL_NOT_AVAILABLE', err instanceof DrafterError ? err.message : 'This model is not available.');
        }
        const promptHash = promptHashOf(bp, req.body.mode, drafter.provider, drafter.model);
        const key = { templateId_promptHash_mode_model: { templateId: t.id, promptHash, mode: req.body.mode, model: drafter.model } };
        const existing = await tx.compilerGenerationRun.findUnique({ where: key });
        // S3-03: the same template, prompt, mode and model is the same run. A failed or capped run is queued again.
        if (existing && !['FAILED', 'CAPPED'].includes(existing.status)) {
          await audit({ entityType: 'CompilerGenerationRun', entityId: existing.id, action: 'meta_compiler.generation_reused', after: { status: existing.status } });
          return { status: 200, body: generationDto(existing) };
        }
        const prompt = promptFor(bp, req.body.mode);
        const est = prompt ? estimate(drafter, prompt) : { costUsd: 0 };
        const blocked = budgetProblem(mc, est.costUsd, await spentTodayUsd(tx, actor.clientId));
        const data = {
          status: blocked ? ('CAPPED' as const) : ('QUEUED' as const),
          estimatedCostUsd: est.costUsd,
          error: blocked,
          progress: progress(0, 0, blocked ?? 'Queued'),
          finishedAt: blocked ? new Date() : null,
          requestedById: actor.userId,
        };
        const run = existing
          ? await tx.compilerGenerationRun.update({ where: { id: existing.id }, data: { ...data, actualCostUsd: null, inputTokens: null, outputTokens: null, outputRef: null, outputSha256: null, logRef: null, startedAt: null } })
          : await tx.compilerGenerationRun.create({ data: { ...data, clientId: actor.clientId, templateId: t.id, templateVersion: t.version, mode: req.body.mode, provider: drafter.provider, model: drafter.model, promptHash } });
        if (!blocked) await emit({ name: 'compiler.generation_requested', aggregateType: 'CompilerGenerationRun', aggregateId: run.id, payload: { runId: run.id } });
        await audit({
          entityType: 'CompilerGenerationRun',
          entityId: run.id,
          action: existing ? 'meta_compiler.generation_requeued' : 'meta_compiler.generation_requested',
          after: { templateId: t.id, templateVersion: t.version, mode: run.mode, provider: run.provider, model: run.model, promptHash, estimatedCostUsd: est.costUsd, status: run.status },
        });
        return { status: existing ? 200 : 201, body: generationDto(run) };
      });
      return reply;
    },
  );

  app.get('/generations/:id', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, response: { 200: GenerationRunDto } } }, async (req) => {
    const run = await db.compilerGenerationRun.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!run) throw notFound('Generation run not found');
    return generationDto(run);
  });
};
