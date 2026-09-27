import { z } from 'zod';

/** FLOW 2 match score weights (SPEC). Max score = 100 + 10 bonus. */
export const MATCH_WEIGHTS = { skills: 50, experience: 20, language: 15, availability: 15, preferredBonus: 10 } as const;
/** Denominators when the project sets no minimum (decided 26 Sep 2026). */
export const DEFAULT_EXPERIENCE_YEARS = 10;
export const DEFAULT_HOURS_PER_WEEK = 20;

export const MatchBreakdown = z.object({
  skills: z.number(),
  experience: z.number(),
  language: z.number(),
  availability: z.number(),
  preferredBonus: z.number(),
  preferredMet: z.array(z.string()),
  preferredMissed: z.array(z.string()),
});
export type MatchBreakdown = z.infer<typeof MatchBreakdown>;

export const MatchItemDto = z.object({
  candidateId: z.string().uuid(),
  name: z.string(),
  rank: z.number().int(),
  score: z.number(),
  breakdown: MatchBreakdown,
  skills: z.array(z.string()),
  country: z.string().nullable(),
  city: z.string().nullable(),
  languages: z.array(z.object({ language: z.string(), level: z.string() })),
  hoursPerWeek: z.number().int().nullable(),
  timezone: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  status: z.enum(['AVAILABLE', 'ASSIGNED']),
  assignmentId: z.string().uuid().nullable(),
});
export type MatchItemDto = z.infer<typeof MatchItemDto>;

export const MatchesResponse = z.object({
  projectId: z.string().uuid(),
  projectName: z.string(),
  status: z.string(),
  requiredWorkers: z.number().int().nullable(),
  assigned: z.number().int(),
  shortfall: z.number().int(),
  matchedAt: z.string().nullable(),
  items: z.array(MatchItemDto),
});
export type MatchesResponse = z.infer<typeof MatchesResponse>;

export const AssignRequest = z.union([
  z.object({ candidateIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ topN: z.number().int().min(1).max(500) }),
]);
export type AssignRequest = z.infer<typeof AssignRequest>;

export const RejectRequest = z.object({ candidateId: z.string().uuid(), reason: z.string().trim().max(500).optional() });
