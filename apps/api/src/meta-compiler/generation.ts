import type { CompilerGenerationRun, Prisma } from '@prisma/client';
import { HarborBlueprint, type GeneratedArtifacts, type GenerationRunDto, type StudioStep } from '@praxis/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { actualOverCap, budgetProblem, spentTodayUsd } from './cost';
import type { MetaCompilerDeps } from './deps';
import { costUsd, DrafterError, estimate, type ContentDrafter, type DraftPrompt, type DrafterFactory } from './drafter';
import { blueprintContentPrompt, fullCodePrompt, missingContent, nothingMissing, parseDraftedContent, parseFullCode, PROMPT_VERSION, withDraftedContent } from './prompts';
import { redact } from './redact';

export type GenerationMode = 'BLUEPRINT' | 'FULL_CODE';

export interface Progress {
  ui: number;
  backend: number;
  message: string;
}

/** The stored output of a Step 1 run (S3-03): versioned, tied to template version, model and prompt hash. */
export const GenerationOutput = z.object({
  schema: z.literal('praxis.meta-compiler.generation.v1'),
  templateId: z.string(),
  templateVersion: z.number().int(),
  promptHash: z.string(),
  mode: z.enum(['BLUEPRINT', 'FULL_CODE']),
  provider: z.string(),
  model: z.string(),
  /** The blueprint the studio and the verification use: the saved blueprint, blanks filled with drafted content. */
  blueprint: HarborBlueprint,
  drafted: z.array(z.string()),
  artifacts: z.record(z.string(), z.string()),
  studioSteps: z.array(z.unknown()),
  code: z.record(z.string(), z.string()).nullable(),
});
export type GenerationOutput = z.infer<typeof GenerationOutput>;

export function promptHashOf(bp: HarborBlueprint, mode: GenerationMode, provider: string, model: string) {
  return sha256(stableStringify({ v: PROMPT_VERSION, bp, mode, provider, model }));
}

/** The model call a run needs: none when the blueprint is complete (BLUEPRINT mode), the code prompt for FULL_CODE. */
export function promptFor(bp: HarborBlueprint, mode: GenerationMode): DraftPrompt | null {
  if (mode === 'FULL_CODE') return fullCodePrompt(bp);
  const missing = missingContent(bp);
  return nothingMissing(missing) ? null : blueprintContentPrompt(bp, missing);
}

export function generationDto(r: CompilerGenerationRun): GenerationRunDto {
  return {
    id: r.id,
    templateId: r.templateId,
    templateVersion: r.templateVersion,
    mode: r.mode,
    provider: r.provider,
    model: r.model,
    status: r.status,
    progress: r.progress as unknown as Progress,
    estimatedCostUsd: r.estimatedCostUsd === null ? null : Number(r.estimatedCostUsd),
    actualCostUsd: r.actualCostUsd === null ? null : Number(r.actualCostUsd),
    outputSha256: r.outputSha256,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

export const generationOutputKey = (clientId: string, runId: string, sha: string) => `generations/${clientId}/${runId}/${sha}.json`;

/** Reads a run's output back from the evidence bucket and checks its SHA-256. */
export async function loadGenerationOutput(storage: ObjectStorage, run: Pick<CompilerGenerationRun, 'outputRef' | 'outputSha256'>): Promise<GenerationOutput> {
  if (!run.outputRef || !run.outputSha256) throw new Error('This generation run has no stored output');
  const bytes = await storage.get(run.outputRef);
  if (createHash('sha256').update(bytes).digest('hex') !== run.outputSha256) throw new Error('Generation output does not match its SHA-256');
  return GenerationOutput.parse(JSON.parse(bytes.toString('utf8')));
}

export interface GenerationWorkerDeps {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  drafters: DrafterFactory;
  deps: MetaCompilerDeps;
}

/**
 * The worker side of Step 1 (S3-01 to S3-03, S3-08). Idempotent: only a QUEUED or RUNNING run is (re)processed, and
 * its output key is content-addressed. Invalid model output or a cap breach ends the run with nothing applied.
 */
export async function processGeneration(w: GenerationWorkerDeps, runId: string): Promise<void> {
  const { db, storage } = w;
  const claimed = await db.compilerGenerationRun.updateMany({ where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'RUNNING', startedAt: new Date(), progress: progress(5, 0, 'Checking the blueprint') } });
  if (!claimed.count) return;
  const run = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id: runId }, include: { template: true } });
  const log: string[] = [`run ${run.id} mode=${run.mode} provider=${run.provider} model=${run.model}`];
  const set = (data: Prisma.CompilerGenerationRunUpdateInput) => db.compilerGenerationRun.update({ where: { id: run.id }, data });
  const end = async (status: 'FAILED' | 'CAPPED', error: string, extra: Prisma.CompilerGenerationRunUpdateInput = {}) => {
    log.push(`${status}: ${error}`);
    const logRef = await storeLog(storage, run, log);
    await set({ ...extra, status, error: redact(error), logRef, finishedAt: new Date(), progress: progress(0, 0, error.slice(0, 300)) });
  };

  try {
    const parsed = HarborBlueprint.safeParse(run.template.blueprint);
    if (!parsed.success) return end('FAILED', 'The template has no valid blueprint');
    const saved = parsed.data;
    if (promptHashOf(saved, run.mode, run.provider, run.model) !== run.promptHash) {
      return end('FAILED', 'The blueprint changed after this run was requested. Start a new generation.');
    }
    const drafter = w.drafters({ provider: run.provider, model: run.model });
    const prompt = promptFor(saved, run.mode);
    let effective = saved;
    let code: Record<string, string> | null = null;
    const drafted: string[] = [];
    if (prompt) {
      const est = estimate(drafter, prompt);
      const blocked = budgetProblem(w.config.metaCompiler, est.costUsd, await spentTodayUsd(db, run.clientId));
      if (blocked) return end('CAPPED', blocked);
      await set({ progress: progress(15, 10, `Drafting with ${drafter.provider}:${drafter.model}`) });
      const out = await callDrafter(drafter, prompt);
      const actual = costUsd(drafter.provider, drafter.model, out.inputTokens, out.outputTokens);
      const usage = { inputTokens: out.inputTokens, outputTokens: out.outputTokens, actualCostUsd: actual };
      log.push(`model usage: ${out.inputTokens} in, ${out.outputTokens} out, $${actual.toFixed(4)}`);
      const capped = actualOverCap(w.config.metaCompiler, actual);
      if (capped) return end('CAPPED', capped, usage);
      await set(usage);
      try {
        if (run.mode === 'FULL_CODE') {
          code = parseFullCode(out.text);
          drafted.push(...Object.keys(code).map((f) => `code:${f}`));
        } else {
          const missing = missingContent(saved);
          effective = withDraftedContent(saved, parseDraftedContent(out.text, missing));
          if (missing.instruction_md) drafted.push('authored_content.instruction_md');
          if (missing.solve_sh) drafted.push('authored_content.solve_sh');
          drafted.push(...missing.verifier_bodies.map((id) => `step_5_default_rubric.${id}.verifier_body`));
        }
      } catch (err) {
        return end('FAILED', err instanceof Error ? err.message : 'Model output failed validation', usage);
      }
    } else {
      log.push('blueprint complete: no model call needed');
    }

    await set({ progress: progress(60, 50, 'Building the studio configuration') });
    const artifacts: GeneratedArtifacts = w.deps.generate(effective, null);
    const studioSteps: StudioStep[] = w.deps.studioSteps(effective);
    await set({ progress: progress(100, 80, 'Storing the output') });
    const output: GenerationOutput = {
      schema: 'praxis.meta-compiler.generation.v1',
      templateId: run.templateId,
      templateVersion: run.templateVersion,
      promptHash: run.promptHash,
      mode: run.mode,
      provider: run.provider,
      model: run.model,
      blueprint: effective,
      drafted,
      artifacts,
      studioSteps,
      code,
    };
    const bytes = Buffer.from(stableStringify(output));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const outputRef = generationOutputKey(run.clientId, run.id, sha);
    await storage.put(outputRef, bytes, 'application/json');
    log.push(`output ${outputRef} (${bytes.length} bytes)`);
    const logRef = await storeLog(storage, run, log);
    await set({ status: 'SUCCEEDED', outputRef, outputSha256: sha, logRef, error: null, finishedAt: new Date(), progress: progress(100, 100, 'Generated') });
  } catch (err) {
    if (err instanceof DrafterError) return end('FAILED', err.message);
    await end('FAILED', 'Generation failed unexpectedly').catch(() => undefined);
    throw err;
  }
}

async function callDrafter(d: ContentDrafter, p: DraftPrompt) {
  try {
    return await d.complete(p);
  } catch (err) {
    throw err instanceof DrafterError ? err : new DrafterError(err instanceof Error ? err.message : 'Model call failed');
  }
}

async function storeLog(storage: ObjectStorage, run: Pick<CompilerGenerationRun, 'clientId' | 'id'>, lines: string[]) {
  const key = `generations/${run.clientId}/${run.id}/log.txt`;
  await storage.put(key, Buffer.from(redact(lines.join('\n'))), 'text/plain');
  return key;
}

export const progress = (ui: number, backend: number, message: string) => ({ ui, backend, message }) as unknown as Prisma.InputJsonValue;
