import { z } from 'zod';

/**
 * Benchmark review (new RL Gym part 3; docs/design/FORGE-RLGYM-V2-DESIGN.md; AUTHORING-SNAPSHOT §3.1 b, §3.2 b). The RL
 * Gym sends an SME review batch of scored episodes into the ADI Forge project; the project's Reviewers and its PM
 * decide each item, and ADI Forge sends the decisions back. A decision is final. The RL Gym's suspected cause is a hint
 * only: a person decides (AI never makes the decision). Reference answers are never in a batch.
 */

export const SME_REVIEW_SCHEMA = 'rlgym.sme-review-package.v1' as const;
export const SME_DECISIONS_SCHEMA = 'rlgym.sme-decisions.v1' as const;

export const BENCHMARK_DECISIONS = ['agent_failure', 'task_correction', 'rubric_correction', 'grader_wrong', 'environment_wrong'] as const;
export type BenchmarkDecision = (typeof BENCHMARK_DECISIONS)[number];
export const BENCHMARK_DECISION_LABEL: Record<BenchmarkDecision, string> = {
  agent_failure: 'Agent failure confirmed',
  task_correction: 'Task needs correction',
  rubric_correction: 'Rubric needs correction',
  grader_wrong: 'Grader is wrong',
  environment_wrong: 'Environment is wrong',
};
/** Decisions that must name the criterion they are about. */
export const NEEDS_CRITERION: ReadonlySet<BenchmarkDecision> = new Set(['rubric_correction', 'grader_wrong']);

const Loose = z.record(z.string(), z.unknown());
export const ReviewCriterion = z.object({ criterion_id: z.string(), verdict: z.string().optional(), points: z.number().optional(), evaluator: z.string().optional(), detail: z.string().nullable().optional(), nodes: z.array(z.unknown()).optional() }).passthrough();
export const ReviewEpisode = z
  .object({
    item_id: z.string().min(1),
    episode_id: z.string().min(1),
    system: z.object({ id: z.string().optional(), version: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
    attempt: z.number().int().optional(),
    case_id: z.string().optional(),
    score: z.number().nullable().optional(),
    criteria: z.array(ReviewCriterion).default([]),
    path: z.object({ order: z.array(z.unknown()).optional(), failed_node: z.string().nullable().optional(), failed_why: z.string().nullable().optional(), summary: z.string().nullable().optional() }).passthrough().optional(),
    timeline: z.array(Loose).default([]),
    final_output: z.unknown().optional(),
    evidence: z.object({ sealed_sha256: z.string().optional(), manifest_sha256: z.string().optional() }).passthrough().optional(),
    suspected_cause: z.string().nullable().optional(),
    suspected_cause_source: z.string().nullable().optional(),
  })
  .passthrough();
export type ReviewEpisode = z.infer<typeof ReviewEpisode>;

/** The batch as the RL Gym sends it. Extra fields are kept as received. */
export const SmeReviewPackage = z
  .object({
    schema: z.literal(SME_REVIEW_SCHEMA),
    batch_id: z.string().min(1).max(200),
    run_id: z.string().min(1).max(200),
    project_id: z.string(),
    template: Loose.optional(),
    scoring_pass: Loose.optional(),
    rubric: z.array(z.object({ criterion_id: z.string() }).passthrough()).default([]),
    tasks: z.array(z.object({ task_id: z.string().min(1), revision: z.number().int().min(1), episodes: z.array(ReviewEpisode).min(1) }).passthrough()).min(1),
    synthetic: z.literal(true),
    note: z.string().nullable().optional(),
  })
  .passthrough();
export type SmeReviewPackage = z.infer<typeof SmeReviewPackage>;

export const DecisionRequest = z
  .object({
    itemId: z.string().min(1).max(200),
    decision: z.enum(BENCHMARK_DECISIONS),
    rationale: z.string().trim().min(1, 'Say why.').max(4000),
    criterionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((d) => !NEEDS_CRITERION.has(d.decision) || !!d.criterionId, { message: 'Name the criterion for a rubric or grader decision.', path: ['criterionId'] });
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const DeliveryDto = z.object({ outcome: z.enum(['delivered', 'rejected', 'unavailable']), httpStatus: z.number().int().nullable(), requestId: z.string().nullable(), error: z.object({ code: z.string(), message: z.string() }).nullable(), at: z.string() });
export type DeliveryDto = z.infer<typeof DeliveryDto>;

export const DecisionDto = z.object({
  id: z.string().uuid(),
  itemId: z.string(),
  decision: z.enum(BENCHMARK_DECISIONS),
  rationale: z.string(),
  criterionId: z.string().nullable(),
  decidedBy: z.string(),
  decidedAt: z.string(),
  /** The last attempt to send it to the RL Gym; null when not sent yet. */
  delivery: DeliveryDto.nullable(),
});
export type DecisionDto = z.infer<typeof DecisionDto>;

export const BatchSummaryDto = z.object({ id: z.string().uuid(), batchId: z.string(), runId: z.string(), receivedAt: z.string(), items: z.number().int(), decided: z.number().int(), undelivered: z.number().int() });
export type BatchSummaryDto = z.infer<typeof BatchSummaryDto>;

export const BatchDetailDto = BatchSummaryDto.extend({
  rubric: z.array(z.record(z.string(), z.unknown())),
  scoringPass: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().nullable(),
  tasks: z.array(z.object({ taskId: z.string(), revision: z.number().int(), title: z.string().nullable(), episodes: z.array(z.record(z.string(), z.unknown())) })),
  decisions: z.array(DecisionDto),
  /** Whether this person may decide (the project's Reviewers, its PM, Admins) and the RL Gym is connected to send. */
  canDecide: z.boolean(),
  connected: z.boolean(),
});
export type BatchDetailDto = z.infer<typeof BatchDetailDto>;
