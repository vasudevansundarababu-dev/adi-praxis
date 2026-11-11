import { z } from 'zod';

/** FLOW 4 inbound review request from RL Gym (SPEC field names). `(rl_run_id, rl_task_id)` is unique. */
export const TrajectoryStep = z.object({
  index: z.number().int().min(0),
  action: z.string().max(2000),
  tool: z.string().max(200).optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  thought: z.string().max(10_000).optional(),
});
export type TrajectoryStep = z.infer<typeof TrajectoryStep>;

export const EvalResult = z.object({
  metric: z.string().trim().min(1).max(200),
  score: z.number().optional(),
  passed: z.boolean(),
  details: z.string().max(4000).optional(),
});
export type EvalResult = z.infer<typeof EvalResult>;

export const RLReviewRequestInput = z.object({
  rl_run_id: z.string().trim().min(1).max(200),
  rl_task_id: z.string().trim().min(1).max(200),
  source_record_ids: z.array(z.string().uuid()).min(1).max(50),
  eval_results: z.array(EvalResult).min(1).max(100),
  /** Inline steps, or a signed URL when large. */
  trajectories: z.union([z.object({ steps: z.array(TrajectoryStep).min(1).max(2000) }), z.object({ signedUrl: z.string().url().max(4000) })]),
  rubric_id: z.string().max(200).nullable().optional(),
  /**
   * The run's final output.json, when RL Gym / Anvil sends it (optional; Praxis-side field, to be confirmed with Anvil).
   * Used to score Q4 query clustering by pairwise F1 for the Reviewer; never a verdict on its own.
   */
  final_output: z.record(z.string(), z.unknown()).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(0),
  due_by: z.string().datetime().nullable().optional(),
});
export type RLReviewRequestInput = z.infer<typeof RLReviewRequestInput>;

export const RL_VERDICTS = ['PASS', 'FAIL', 'NEEDS_EXPERT'] as const;

export const RLVerdictRequest = z.object({
  expectedRevision: z.number().int().min(0),
  verdict: z.enum(RL_VERDICTS),
  /** One per automated eval metric: does the Reviewer agree with its result? */
  metricVerdicts: z.array(z.object({ metric: z.string().max(200), agree: z.boolean(), comment: z.string().trim().max(4000).optional() })).max(100),
  /** Comments, optionally pinned to a trajectory step and tagged with a failure reason code. */
  comments: z.array(z.object({ text: z.string().trim().min(1).max(4000), trajectoryStep: z.number().int().min(0).optional(), reasonCode: z.string().max(60).optional() })).max(200).default([]),
});
export type RLVerdictRequest = z.infer<typeof RLVerdictRequest>;

/**
 * SPEC FLOW 4 rules: every eval metric gets exactly one verdict; a comment is required on every FAIL and every
 * disagreement; reason codes must be active codes; pinned steps must exist.
 */
export function rlVerdictProblems(v: RLVerdictRequest, ctx: { metrics: string[]; reasonCodes: string[]; stepCount: number | null }): string[] {
  const p: string[] = [];
  const seen = new Map<string, number>();
  for (const m of v.metricVerdicts) seen.set(m.metric, (seen.get(m.metric) ?? 0) + 1);
  for (const m of ctx.metrics) if (seen.get(m) !== 1) p.push(`Give exactly one verdict for the metric “${m}”`);
  for (const m of v.metricVerdicts) if (!ctx.metrics.includes(m.metric)) p.push(`Unknown metric “${m.metric}”`);
  for (const m of v.metricVerdicts) if (!m.agree && !m.comment?.trim()) p.push(`Explain why you disagree with “${m.metric}”`);
  if (v.verdict === 'FAIL' && v.comments.length === 0) p.push('A FAIL verdict needs at least one comment');
  const codes = new Set(ctx.reasonCodes);
  for (const c of v.comments) {
    if (c.reasonCode && !codes.has(c.reasonCode)) p.push(`Unknown failure reason code “${c.reasonCode}”`);
    if (c.trajectoryStep !== undefined && ctx.stepCount !== null && c.trajectoryStep >= ctx.stepCount) p.push(`Step ${c.trajectoryStep} is not in the trajectory`);
  }
  return p;
}
