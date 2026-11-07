import type { TaskInstance } from '@prisma/client';
import { STUDIO_STEP_IDS, StudioAnswers, type HarborBlueprint, type TaskCheck } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { notFound } from '../lib/errors';
import { genericDefinition, registerDefinition, type TaskDefinition } from '../tasks/definitions';
import type { MetaCompilerDeps } from './deps';
import { loadGenerationOutput } from './generation';

export const STUDIO_DEFINITION_KEY = 'harbor-studio-v1';

/** What a studio task stores in `TaskInstance.output` (the existing autosave column). */
export interface StudioOutput {
  kind: typeof STUDIO_DEFINITION_KEY;
  deploymentId: string;
  templateId: string;
  answers: StudioAnswers;
}

export function studioOutputOf(t: Pick<TaskInstance, 'output'>): StudioOutput | null {
  const o = t.output as Partial<StudioOutput> | null;
  if (!o || o.kind !== STUDIO_DEFINITION_KEY) return null;
  const answers = StudioAnswers.safeParse(o.answers);
  return answers.success ? { ...(o as StudioOutput), answers: answers.data } : null;
}

/** Deployed blueprints by template id, so the task definition can validate answers synchronously. */
const blueprints = new Map<string, HarborBlueprint>();
let answerProblems: MetaCompilerDeps['studioAnswerProblems'] | null = null;

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

/**
 * `harbor-studio-v1` (architecture section 7): the existing submit runs it, so the blueprint validators check the
 * SME's answers before a studio task reaches review.
 */
export const studioDefinition: TaskDefinition = {
  key: STUDIO_DEFINITION_KEY,
  validateTaskInput: genericDefinition.validateTaskInput,
  validateSubmission: (_t, output) => {
    const o = studioOutputOf({ output: output as never });
    if (!o) return [{ id: 'studio.answers', section: 'confirm', ok: false, message: 'The studio answers are missing or invalid' }];
    const bp = blueprints.get(o.templateId);
    if (!bp || !answerProblems) return [{ id: 'studio.blueprint', section: 'confirm', ok: false, message: 'Open the studio again before committing' }];
    const problems = answerProblems(bp, o.answers);
    const checks: TaskCheck[] = STUDIO_STEP_IDS.flatMap((step) => problems[step].map((message, i) => ({ id: `studio.${step}.${i}`, section: step, ok: false, message })));
    return checks.length ? checks : [{ id: 'studio.complete', section: 'confirm', ok: true, message: 'Every studio step is complete' }];
  },
  canonicalText: (output) => strings((output as Partial<StudioOutput>).answers ?? {}).join('\n'),
  keyInputs: (output) => {
    const a = (output as Partial<StudioOutput>).answers;
    return a ? Object.entries(a.sliders ?? {}).map(([k, v]) => `${k}=${v}`).sort() : [];
  },
};

export function registerStudio(domainName: string, workflowName: string, templateId: string, bp: HarborBlueprint, deps: MetaCompilerDeps) {
  answerProblems = deps.studioAnswerProblems;
  blueprints.set(templateId, bp);
  registerDefinition(domainName, workflowName, studioDefinition);
}

const outputs = new Map<string, HarborBlueprint>();

/** The blueprint the deployment was verified with (the generation output), checked against its SHA-256. */
export async function deployedBlueprint(tx: Db | Tx, storage: ObjectStorage, verificationRunId: string): Promise<HarborBlueprint> {
  const v = await tx.compilerVerificationRun.findUniqueOrThrow({ where: { id: verificationRunId }, include: { generationRun: true } });
  const key = v.generationRun.outputSha256 ?? '';
  const hit = outputs.get(key);
  if (hit) return hit;
  const bp = (await loadGenerationOutput(storage, v.generationRun)).blueprint;
  if (outputs.size > 500) outputs.clear();
  outputs.set(key, bp);
  return bp;
}

/**
 * The deployment behind a studio key, only for its own SME (S4-02, D14). Anyone else, another client, or a stopped
 * studio gets the same 404, so a key reveals nothing.
 */
export async function studioFor(tx: Db | Tx, args: { studioKey: string; clientId: string; smeUserId: string }) {
  const d = await tx.studioDeployment.findFirst({
    where: { studioKey: args.studioKey, clientId: args.clientId, status: 'ACTIVE', candidate: { smeUserId: args.smeUserId } },
    include: { template: { include: { domain: true } }, project: true },
  });
  if (!d) throw notFound('Studio not found');
  return d;
}

export const OPEN_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'REWORK'] as const;

export async function openStudioTask(tx: Db | Tx, projectId: string, candidateId: string) {
  return tx.taskInstance.findFirst({
    where: { projectId, assignedToId: candidateId, taskType: 'AUTHORING', status: { in: [...OPEN_STATUSES] } },
    orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
  });
}

/** `TASK-MKTG-1A2B3C4D`: stable for a task's submission version, so a retried commit builds the same bundle. */
export function externalTaskId(bp: HarborBlueprint, domainName: string, taskInstanceId: string, version: number, hash: (s: string) => string) {
  const prefix = (bp.template_meta.domain_category || domainName).replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'TASK';
  return `TASK-${prefix}-${hash(`${taskInstanceId}:${version}`).slice(0, 10).toUpperCase()}`;
}
