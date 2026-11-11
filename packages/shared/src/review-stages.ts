import { z } from 'zod';
import type { PendingStage } from './task-phase';

/**
 * Authoring v2.1 Wave 2: the SME -> Expert -> PM review route (handover ch. 08, ch. 17 §2 and §4).
 * Stage decisions bind to one exact submission version; any content change creates a new version and voids them.
 */
export const STAGE_LABELS: Record<PendingStage, string> = { EXPERT_REVIEW: 'Expert review', PM_APPROVAL: 'PM approval' };

/**
 * A review comment pinned to where the problem is: a workbench or profile section, a graph node or a field path.
 * At least one anchor is required, so every comment is actionable for the author.
 */
export const StageComment = z
  .object({
    section: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/).optional(),
    target: z.object({ kind: z.enum(['node', 'field']), id: z.string().trim().min(1).max(200) }).optional(),
    text: z.string().trim().min(1).max(2000),
  })
  .refine((c) => !!c.section || !!c.target, { message: 'Pin the comment to a section, graph node or field' });
export type StageComment = z.infer<typeof StageComment>;

const CHECKLIST_KEYS = ['realistic', 'correct', 'coversSlot', 'difficultyFair', 'distinct', 'rubricCatches'] as const;

/** A decision for the stage the task is in. `expectedVersion` is the submission version the actor looked at. */
export const StageDecisionRequest = z
  .object({
    stage: z.enum(['EXPERT_REVIEW', 'PM_APPROVAL']),
    /** Expert: PASS (route to PM), REWORK (return to the author) or REJECT. PM: APPROVE or REWORK. */
    decision: z.enum(['PASS', 'APPROVE', 'REWORK', 'REJECT']),
    expectedRevision: z.number().int().min(0),
    expectedVersion: z.number().int().min(1),
    checklist: z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.boolean()])) as Record<(typeof CHECKLIST_KEYS)[number], z.ZodBoolean>).optional(),
    rejectReason: z.enum(['DUPLICATE', 'NOT_REALISTIC', 'INCORRECT', 'REAL_DATA']).optional(),
    duplicateDecision: z.enum(['ACCEPT_AS_DISTINCT', 'REWORK', 'REJECT_DUPLICATE']).optional(),
    comments: z.array(StageComment).max(50).default([]),
    notes: z.string().trim().max(4000).optional(),
    confirmedCoverage: z.object({ tags: z.record(z.string(), z.string()), edgeCase: z.string().trim().min(1).max(200) }).optional(),
  })
  .refine((d) => (d.stage === 'EXPERT_REVIEW' ? ['PASS', 'REWORK', 'REJECT'] : ['APPROVE', 'REWORK']).includes(d.decision), { message: 'This decision is not available at this stage', path: ['decision'] })
  .refine((d) => d.stage !== 'EXPERT_REVIEW' || !!d.checklist, { message: 'Answer every checklist item', path: ['checklist'] })
  .refine((d) => d.decision !== 'PASS' || Object.values(d.checklist ?? {}).every(Boolean), { message: 'Every checklist item must hold to pass to PM approval', path: ['checklist'] })
  .refine((d) => d.decision !== 'REJECT' || !!d.rejectReason, { message: 'Choose a reason for rejecting', path: ['rejectReason'] })
  .refine((d) => d.decision !== 'REWORK' || d.comments.length > 0, { message: 'Returning for rework needs at least one pinned comment', path: ['comments'] });
export type StageDecisionRequest = z.infer<typeof StageDecisionRequest>;

/** An Expert's correction: a new version of the whole output, with a required reason. */
export const ExpertEditRequest = z.object({
  expectedRevision: z.number().int().min(0),
  expectedVersion: z.number().int().min(1),
  output: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(5, 'Give the reason for the edit').max(2000),
  /** Material edits change what the task asks or how it is graded; the author must reconfirm before review continues. */
  material: z.boolean(),
  /** Explanations for any possible-real-data flags the edit raises. */
  flagExplanations: z.record(z.string(), z.string().trim().min(1).max(500)).default({}),
});
export type ExpertEditRequest = z.infer<typeof ExpertEditRequest>;

export interface JsonChange {
  path: string;
  before: unknown;
  after: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Leaf-level differences between two JSON values, as dotted paths (`a.b[2].c`). Bounded to `limit` changes. */
export function jsonDiff(before: unknown, after: unknown, limit = 200): JsonChange[] {
  const out: JsonChange[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (out.length >= limit) return;
    if (isObj(a) && isObj(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ path: path || '(root)', before: a ?? null, after: b ?? null });
  };
  walk(before, after, '');
  return out;
}
