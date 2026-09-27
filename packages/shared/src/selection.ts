import { z } from 'zod';
import { CONTRIBUTION_ROLES, type OpportunityCriteria } from './candidate';

// ───────────────────────── Suitability recommendation (FLOW2 8.1) ─────────────────────────

export const CRITERION_RESULTS = ['MET', 'PARTIALLY_MET', 'NOT_MET', 'UNKNOWN'] as const;
export type CriterionResult = (typeof CRITERION_RESULTS)[number];

export const CriterionFinding = z.object({
  criterionId: z.string(),
  result: z.enum(CRITERION_RESULTS),
  /** Ids of the profile facts, roles, claims or evidence the finding relies on. */
  citations: z.array(z.string()).max(30),
  rationale: z.string().max(1000),
});
export type CriterionFinding = z.infer<typeof CriterionFinding>;

export const AssessmentOutput = z.object({
  findings: z.array(CriterionFinding).max(50),
  unresolvedQuestions: z.array(z.string().max(500)).max(10),
  proposedContributionRoles: z.array(z.enum(CONTRIBUTION_ROLES)).max(5),
  limitations: z.string().max(2000),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutput>;

export type Recommendation = 'FIT_RECOMMENDED' | 'NOT_FIT_RECOMMENDED' | 'NEEDS_INFORMATION';

/**
 * Validates model output against the pinned criteria and the ids it was given (CF-20): every criterion exactly once,
 * no invented criteria, no citations to things that do not exist. Problems make the assessment a recoverable ERROR.
 */
export function assessmentProblems(out: AssessmentOutput, criteria: OpportunityCriteria, citableIds: Set<string>): string[] {
  const problems: string[] = [];
  const known = new Set(criteria.map((c) => c.id));
  const seen = new Set<string>();
  for (const f of out.findings) {
    if (!known.has(f.criterionId)) problems.push(`Unknown criterion "${f.criterionId}"`);
    if (seen.has(f.criterionId)) problems.push(`Criterion "${f.criterionId}" assessed twice`);
    seen.add(f.criterionId);
    for (const c of f.citations) if (!citableIds.has(c)) problems.push(`Criterion "${f.criterionId}" cites unknown evidence "${c}"`);
    if ((f.result === 'MET' || f.result === 'NOT_MET') && f.citations.length === 0) problems.push(`Criterion "${f.criterionId}" is ${f.result} without citations`);
  }
  for (const c of criteria) if (!seen.has(c.id)) problems.push(`Criterion "${c.id}" was not assessed`);
  return problems;
}

/**
 * The recommendation follows from the findings by rule, never from free model judgement (FLOW2 8.1):
 * - NOT_FIT only when a REQUIRED criterion is NOT_MET on supported information (a preferred gap never is);
 * - NEEDS_INFORMATION when a required criterion is UNKNOWN or only partly met;
 * - FIT otherwise. None of these is a decision: a human reviewer decides.
 */
export function recommendationFrom(findings: CriterionFinding[], criteria: OpportunityCriteria): Recommendation {
  const required = new Set(criteria.filter((c) => c.kind === 'REQUIRED').map((c) => c.id));
  const req = findings.filter((f) => required.has(f.criterionId));
  if (req.some((f) => f.result === 'NOT_MET' && f.citations.length > 0)) return 'NOT_FIT_RECOMMENDED';
  if (req.some((f) => f.result !== 'MET')) return 'NEEDS_INFORMATION';
  return 'FIT_RECOMMENDED';
}

// ───────────────────────── Human selection (FLOW2 8.2) ─────────────────────────

export const SELECTION_OUTCOMES = ['SELECTED', 'NOT_SELECTED', 'NEEDS_INFORMATION'] as const;

export const QualificationScopeInput = z.object({
  domain: z.string().trim().min(1).max(200),
  specialty: z.string().trim().max(200).nullable().default(null),
  jurisdictions: z.array(z.string().trim().max(100)).max(50).default([]),
  languages: z.array(z.string().trim().max(20)).max(20).default([]),
  contributionRoles: z.array(z.enum(CONTRIBUTION_ROLES)).min(1).max(5),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});
export type QualificationScopeInput = z.infer<typeof QualificationScopeInput>;

export const SelectionDecisionRequest = z
  .object({
    outcome: z.enum(SELECTION_OUTCOMES),
    /** Task-related reasons, optionally tied to criteria. */
    reasons: z.array(z.object({ criterionId: z.string().nullable().default(null), text: z.string().trim().min(1).max(1000) })).min(1).max(20),
    /** What the candidate sees: respectful, task-specific, correctable (C06). */
    candidateMessage: z.string().trim().min(1).max(2000),
    /** Required when SELECTED. */
    scope: QualificationScopeInput.optional(),
    /** The single most useful clarification, when NEEDS_INFORMATION. */
    informationRequest: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.outcome !== 'SELECTED' || !!d.scope, { message: 'A selection needs an approved scope', path: ['scope'] })
  .refine((d) => d.outcome !== 'NEEDS_INFORMATION' || !!d.informationRequest, { message: 'Say what information is needed', path: ['informationRequest'] });
export type SelectionDecisionRequest = z.infer<typeof SelectionDecisionRequest>;

export const CLAIM_REVIEW_LEVELS = ['DOCUMENT_SUPPORTED', 'INDEPENDENTLY_VERIFIED', 'INCONCLUSIVE', 'CONTRADICTED', 'EXPIRED'] as const;
export const ClaimReviewRequest = z.object({
  evidenceLevel: z.enum(CLAIM_REVIEW_LEVELS),
  method: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(1000).optional(),
});

// ───────────────────────── Onboarding checklist (FLOW2 C07) ─────────────────────────

export const TERMS_KEYS = ['contributor', 'confidentiality_ip', 'data_use'] as const;
export type TermsKey = (typeof TERMS_KEYS)[number];

export const ONBOARDING_VERSION = 'v1';
export interface OnboardingItemDef {
  key: string;
  title: string;
  description: string;
  kind: 'confirm' | 'terms' | 'conflicts' | 'guidance' | 'preferences';
  termsKey?: TermsKey;
}

/** The v1 checklist. Payment/tax onboarding is a separate, later dependency and is not collected here. */
export const ONBOARDING_ITEMS: OnboardingItemDef[] = [
  { key: 'confirm_scope', kind: 'confirm', title: 'Confirm your approved scope', description: 'Check the domain, jurisdictions, task roles and any limitations you were approved for.' },
  { key: 'terms:contributor', kind: 'terms', termsKey: 'contributor', title: 'Contributor terms', description: 'Read and accept the current contributor terms.' },
  { key: 'terms:confidentiality_ip', kind: 'terms', termsKey: 'confidentiality_ip', title: 'Confidentiality and IP', description: 'Read and accept the confidentiality and intellectual property terms.' },
  { key: 'terms:data_use', kind: 'terms', termsKey: 'data_use', title: 'Data use', description: 'Read and accept how your contributions and data are used.' },
  { key: 'conflicts', kind: 'conflicts', title: 'Conflicts and authorisation', description: 'Declare relevant employer or customer conflicts and confirm you may contribute original or permitted material.' },
  { key: 'guidance', kind: 'guidance', title: 'Task guidance', description: 'Read how tasks are structured: states and actions, dependencies, failure and recovery cases, rubrics and evidence. Use only synthetic data.' },
  { key: 'preferences', kind: 'preferences', title: 'Work preferences', description: 'Confirm your country of work, task languages, time zone, availability and notifications. Used only to match you with suitable tasks.' },
];

export const ConflictsAnswer = z.object({
  hasConflicts: z.boolean(),
  details: z.string().trim().max(2000).optional(),
  authorizedToContribute: z.literal(true),
});
export const PreferencesAnswer = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  languages: z.array(z.object({ language: z.string().regex(/^[a-z]{2}$/), level: z.string().max(10) })).min(1).max(10),
  timezone: z.string().min(1).max(60),
  hoursPerWeek: z.number().int().min(1).max(60),
  emailNotifications: z.boolean(),
});
export const AcknowledgeRequest = z.object({
  enrollmentId: z.string().uuid(),
  itemKey: z.string().max(60),
  termsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  data: z.unknown().optional(),
});

// ───────────────────────── Separation of duties (FLOW2 C08, CF-27) ─────────────────────────

/**
 * Whether `approverId` may approve work authored by `authorId`. Nobody approves their own work, and a declared
 * conflict between the two blocks it too. Used by task review (M5).
 */
export function mayApprove(args: { authorId: string; approverId: string; conflicts?: { a: string; b: string }[] }): boolean {
  if (args.authorId === args.approverId) return false;
  return !(args.conflicts ?? []).some((c) => (c.a === args.authorId && c.b === args.approverId) || (c.b === args.authorId && c.a === args.approverId));
}

// ───────────────────────── Assignments (FLOW2 C08) ─────────────────────────

export const ASSIGNMENT_PROPOSAL_DAYS = 7;
export const DeclineRequest = z.object({ reason: z.string().trim().max(1000).optional() });
