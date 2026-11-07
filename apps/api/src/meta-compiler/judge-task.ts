import type { Prisma } from '@prisma/client';
import { AGENT_OUTPUT_ROOT, JudgeSpec, type JudgeResult } from '@praxis/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { JUDGE_DIR, type JudgeFile } from '../harbor/bundle';
import { readTarGz } from '../harbor/runner';
import { writeAudit } from '../platform/audit';
import { budgetProblem, spentTodayUsd, TASK_JUDGE_FAILED, TASK_JUDGED } from './cost';
import { estimateJudgeUsd, JudgeError, type JudgedMilestone, type LlmJudge } from './judge';
import { redact } from './redact';
import type { TaskVerificationEvidence } from './task-verification';

export interface TaskJudgeDeps {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  judge: LlmJudge;
}

/**
 * Stored in `SmeAuthoredTask.verificationEvidence.judge`. When MEASURED it is a `JudgeResult` (score weight-normalised
 * over the judged milestones) plus how it was produced; otherwise `score` is null and `error` says why.
 */
export type TaskJudgeEvidence = Omit<JudgeResult, 'score' | 'milestones'> & {
  status: 'MEASURED' | 'NOT_MEASURED';
  provider: LlmJudge['provider'];
  score: number | null;
  milestones: (JudgedMilestone & { weight: number })[];
  judgedAt: string;
  error: string | null;
};

const JudgeFileSchema = z.object({
  milestone_id: z.string(),
  weight: z.number().min(0),
  deliverable_path: JudgeSpec.shape.deliverable_path,
  system_prompt: z.string(),
  criteria: JudgeSpec.shape.criteria,
});

/** Judged milestones from the committed bundle's hidden `eval/judge/*.json`, in milestone id order. */
export function judgeFilesOf(bundle: Buffer): JudgeFile[] {
  return [...readTarGz(bundle)]
    .filter(([p]) => p.startsWith(JUDGE_DIR) && p.endsWith('.json'))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, data]) => JudgeFileSchema.parse(JSON.parse(data.toString('utf8'))));
}

/** Weighted 0..1 over the judged milestones; equal weights when every weight is 0. */
export function judgeScore(ms: { weight: number; pointsEarned: number; pointsPossible: number }[]): number {
  if (ms.length === 0) return 0;
  const total = ms.reduce((s, m) => s + m.weight, 0);
  const w = (m: { weight: number }) => (total > 0 ? m.weight / total : 1 / ms.length);
  return Math.round(ms.reduce((s, m) => s + w(m) * (m.pointsPossible > 0 ? m.pointsEarned / m.pointsPossible : 0), 0) * 10_000) / 10_000;
}

/**
 * Post-commit LLM judge job (owner decision, 7 Nov 2026): after per-task verification has recorded measured scores,
 * grade the oracle run's deliverables against each judged milestone's hidden checklist and store the result on
 * `SmeAuthoredTask.verificationEvidence.judge`. The audit holds the score, model and cost only, never the criteria or
 * the deliverable. Idempotent: a task already judged is left alone. A failure is recorded and rethrown so the outbox
 * retries; a budget refusal is recorded and not retried.
 */
export async function processTaskJudge(w: TaskJudgeDeps, authoredTaskId: string): Promise<void> {
  const { db, storage, judge, config } = w;
  const t = await db.smeAuthoredTask.findUnique({ where: { id: authoredTaskId } });
  if (!t) return;
  const evidence = (t.verificationEvidence ?? null) as TaskVerificationEvidence | null;
  if (!evidence || evidence.status !== 'MEASURED') return;
  if ((evidence.judge as TaskJudgeEvidence | undefined)?.status === 'MEASURED') return;

  const base = { provider: judge.provider, model: judge.model, judgedAt: new Date().toISOString() };
  const record = async (j: TaskJudgeEvidence) => {
    await db.$transaction(async (tx) => {
      const fresh = await tx.smeAuthoredTask.findUniqueOrThrow({ where: { id: t.id }, select: { verificationEvidence: true } });
      await tx.smeAuthoredTask.update({ where: { id: t.id }, data: { verificationEvidence: { ...(fresh.verificationEvidence as object), judge: j } as unknown as Prisma.InputJsonValue } });
      await writeAudit(tx, { clientId: t.clientId, actorType: 'SYSTEM', actorId: 'task-judge' }, {
        entityType: 'SmeAuthoredTask',
        entityId: t.id,
        action: j.status === 'MEASURED' ? TASK_JUDGED : TASK_JUDGE_FAILED,
        after: {
          status: j.status,
          score: j.score,
          provider: j.provider,
          model: j.model,
          costUsd: j.costUsd,
          milestones: j.milestones.map((m) => ({ milestoneId: m.milestoneId, pointsEarned: m.pointsEarned, pointsPossible: m.pointsPossible, truncated: m.truncated })),
          error: j.error,
        },
      });
    });
  };
  const notMeasured = (error: string, costUsd = 0, milestones: TaskJudgeEvidence['milestones'] = []) =>
    record({ ...base, status: 'NOT_MEASURED', score: null, costUsd, milestones, error });

  const bytes = await storage.get(t.bundleRef);
  if (createHash('sha256').update(bytes).digest('hex') !== t.bundleSha256) {
    await notMeasured('The stored bundle does not match its SHA-256');
    throw new Error('The stored bundle does not match its SHA-256');
  }
  const specs = judgeFilesOf(bytes);
  if (specs.length === 0) return;

  // Mirrors D-12: deployed environments never record a mock judge's result as measured.
  if (judge.provider === 'mock' && (config.appEnv === 'staging' || config.appEnv === 'production' || config.metaCompiler.runner !== 'mock')) {
    return notMeasured('The live judge is not configured (META_COMPILER_LIVE_AI with a Claude model).');
  }

  let costUsd = 0;
  const milestones: TaskJudgeEvidence['milestones'] = [];
  try {
    const outputs = evidence.oracleOutputsRef ? (z.record(z.string(), z.string()).parse(JSON.parse((await storage.get(evidence.oracleOutputsRef)).toString('utf8')))) : null;
    if (!outputs) return notMeasured('The runner returned no output files for the oracle run, so there is nothing to judge.');
    const deliverableOf = (s: JudgeFile) => outputs[s.deliverable_path.slice(AGENT_OUTPUT_ROOT.length)] ?? '';

    const estimated = specs.reduce((sum, s) => sum + estimateJudgeUsd(judge, s, deliverableOf(s)), 0);
    const blocked = budgetProblem(config.metaCompiler, estimated, await spentTodayUsd(db, t.clientId));
    if (blocked) return notMeasured(blocked);

    for (const s of specs) {
      const r = await judge.grade(s, deliverableOf(s));
      costUsd += r.costUsd;
      const { costUsd: _c, ...m } = r;
      milestones.push({ ...m, milestoneId: s.milestone_id, weight: s.weight });
    }
    await record({ ...base, status: 'MEASURED', score: judgeScore(milestones), costUsd: Math.round(costUsd * 10_000) / 10_000, milestones, error: null });
  } catch (err) {
    if (err instanceof JudgeError) costUsd += err.costUsd;
    await notMeasured(redact(err instanceof Error ? err.message : 'Judging failed'), Math.round(costUsd * 10_000) / 10_000);
    throw err;
  }
}

const JudgeViewCriterion = z.object({ num: z.number(), category: z.string(), text: z.string(), points: z.number(), awarded: z.number(), passed: z.boolean(), evidence: z.string() });
/** Admin and Reviewer view of a task's judge result (J4), with each criterion's text from the committed bundle. */
export const JudgeViewResponse = z.object({
  judge: z
    .object({
      status: z.enum(['MEASURED', 'NOT_MEASURED']),
      provider: z.string(),
      model: z.string(),
      score: z.number().nullable(),
      costUsd: z.number(),
      judgedAt: z.string(),
      error: z.string().nullable(),
      milestones: z.array(z.object({ milestoneId: z.string(), weight: z.number(), pointsEarned: z.number(), pointsPossible: z.number(), truncated: z.boolean(), criteria: z.array(JudgeViewCriterion) })),
    })
    .nullable(),
});
export type JudgeViewResponse = z.infer<typeof JudgeViewResponse>;

export async function judgeView(storage: ObjectStorage, t: { bundleRef: string; bundleSha256: string; verificationEvidence: unknown }): Promise<JudgeViewResponse> {
  const j = ((t.verificationEvidence ?? {}) as { judge?: TaskJudgeEvidence }).judge;
  if (!j) return { judge: null };
  let specs: JudgeFile[] = [];
  try {
    const bytes = await storage.get(t.bundleRef);
    if (createHash('sha256').update(bytes).digest('hex') === t.bundleSha256) specs = judgeFilesOf(bytes);
  } catch {
    // Without the bundle the scores still show; only the criterion text is missing.
  }
  return {
    judge: {
      status: j.status,
      provider: j.provider,
      model: j.model,
      score: j.score,
      costUsd: j.costUsd,
      judgedAt: j.judgedAt,
      error: j.error,
      milestones: j.milestones.map((m) => {
        const spec = specs.find((s) => s.milestone_id === m.milestoneId);
        return {
          milestoneId: m.milestoneId,
          weight: m.weight,
          pointsEarned: m.pointsEarned,
          pointsPossible: m.pointsPossible,
          truncated: m.truncated,
          criteria: m.criteria.map((c) => {
            const k = spec?.criteria.find((x) => x.num === c.num);
            return { num: c.num, category: k?.category ?? '', text: k?.text ?? '', points: k?.points ?? 0, awarded: c.awarded, passed: c.passed, evidence: c.evidence };
          }),
        };
      }),
    },
  };
}
