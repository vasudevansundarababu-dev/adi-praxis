import { z } from 'zod';

// ───────────────────────── SME opportunity (FLOW2-SME C03) ─────────────────────────

export const CONTRIBUTION_ROLES = ['TASK_AUTHOR', 'ANNOTATOR', 'REVIEWER', 'RUBRIC_DESIGNER', 'SCENARIO_VALIDATOR'] as const;
export type ContributionRole = (typeof CONTRIBUTION_ROLES)[number];
export const CONTRIBUTION_ROLE_LABELS: Record<ContributionRole, string> = {
  TASK_AUTHOR: 'Task author',
  ANNOTATOR: 'Annotator',
  REVIEWER: 'Reviewer',
  RUBRIC_DESIGNER: 'Rubric / evaluation designer',
  SCENARIO_VALIDATOR: 'Scenario validator',
};

const text = (max: number) => z.string().trim().max(max);

/** The candidate-facing brief. Everything a candidate reads before committing to the conversation. */
export const OpportunityBrief = z.object({
  title: text(200),
  summary: text(4000),
  domain: text(200),
  specialty: text(200),
  jurisdictions: z.array(text(100)).max(50).default([]),
  languages: z.array(text(50)).max(20).default([]),
  contributionRoles: z.array(z.enum(CONTRIBUTION_ROLES)).max(5).default([]),
  exampleOutputs: text(4000).default(''),
  whyLongHorizon: text(4000).default(''),
  timeCommitment: text(1000).default(''),
  complexity: text(1000).default(''),
  confidentiality: text(4000).default(''),
  onboardingSteps: text(4000).default(''),
  /** Only shown when set by the owner. Never invented. */
  compensation: text(1000).nullable().default(null),
  whatWeWillAsk: text(4000).default(''),
  doNotDisclose: text(4000).default(''),
  /** Confirmed text from an imported JD document, if any. */
  fullDescription: text(50_000).default(''),
});
export type OpportunityBrief = z.infer<typeof OpportunityBrief>;

/** Eligibility criteria are configuration approved by a human owner; the model never invents them (FLOW2 5.1). */
export const OpportunityCriterion = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/, 'Use a short id: lowercase letters, digits, - or _'),
  text: text(1000).min(1),
  kind: z.enum(['REQUIRED', 'PREFERRED']),
  evidence: text(1000).default(''),
  equivalence: text(1000).default(''),
});
export const OpportunityCriteria = z
  .array(OpportunityCriterion)
  .max(50)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `Duplicate criterion id "${c.id}"` });
      seen.add(c.id);
    });
  });
export type OpportunityCriteria = z.infer<typeof OpportunityCriteria>;

/** questionPolicy: omit to keep the current one, null to go back to the generated default. */
export const SaveOpportunityDraftRequest = z.object({ brief: OpportunityBrief, criteria: OpportunityCriteria, questionPolicy: z.unknown().optional() });

/** What must be filled before an owner can publish (FLOW2 C03: requirements readable before commitment). */
export function opportunityPublishProblems(brief: OpportunityBrief, criteria: OpportunityCriteria): string[] {
  const p: string[] = [];
  if (!brief.title) p.push('Title is required');
  if (!brief.summary) p.push('Summary is required');
  if (!brief.domain || !brief.specialty) p.push('Domain and specialty are required');
  if (brief.contributionRoles.length === 0) p.push('Choose at least one contribution role');
  if (!brief.whatWeWillAsk) p.push('"What we will ask" is required');
  if (!brief.doNotDisclose) p.push('"What not to disclose" is required');
  if (criteria.length === 0) p.push('Add at least one eligibility criterion');
  return p;
}

export const PublicOpportunityDto = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']),
  brief: OpportunityBrief,
  criteria: OpportunityCriteria,
  publishedAt: z.string().nullable(),
});
export type PublicOpportunityDto = z.infer<typeof PublicOpportunityDto>;

// ───────────────────────── Campaigns (SPEC FLOW 2 sourcing) ─────────────────────────

export const CAMPAIGN_CHANNELS = ['LINKEDIN_MANUAL', 'LINKEDIN_APPLY_CONNECT'] as const;
export const CampaignDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  channel: z.enum(CAMPAIGN_CHANNELS),
  status: z.enum(['DRAFT', 'LIVE', 'PAUSED', 'CLOSED']),
  postText: z.string().nullable(),
  applyUrl: z.string().nullable(),
  instructions: z.string(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  metrics: z.object({
    clicks: z.number().int(),
    applies: z.number().int(),
    kycCompleted: z.number().int(),
    approved: z.number().int(),
    assigned: z.number().int(),
  }),
});
export type CampaignDto = z.infer<typeof CampaignDto>;

// ───────────────────────── Candidate account (FLOW2-SME C01/C02) ─────────────────────────

export const IDENTITY_STATUSES = [
  'NOT_STARTED',
  'REQUIRES_INPUT',
  'PROCESSING',
  'VERIFIED',
  'CANCELED',
  'MANUAL_REVIEW_REQUIRED',
  'ALTERNATIVE_VERIFIED',
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
export const identityEligible = (s: IdentityStatus) => s === 'VERIFIED' || s === 'ALTERNATIVE_VERIFIED';

export const CandidateNextStep = z.enum(['VERIFY_IDENTITY', 'CHOOSE_OPPORTUNITY', 'CONTINUE_PROFILE']);

export const CandidateMeDto = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  accountStatus: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  identityStatus: z.enum(IDENTITY_STATUSES),
  /** Scoped badge text, e.g. "Identity verified" or "Identity verified (alternative process)". */
  identityLabel: z.string(),
  identityProblem: z.string().nullable(),
  nextStep: CandidateNextStep,
  enrollments: z.array(
    z.object({ id: z.string().uuid(), opportunityId: z.string().uuid(), title: z.string(), status: z.string() }),
  ),
});
export type CandidateMeDto = z.infer<typeof CandidateMeDto>;

export const GoogleSignInRequest = z.object({
  credential: z.string().min(10).max(10_000),
  /** Required on first sign-in: the candidate confirms they are 18 or over. */
  adultAttested: z.boolean().optional(),
});

export const IDENTITY_HELP_REASONS = ['UNSUPPORTED_DOCUMENT', 'UNSUPPORTED_COUNTRY', 'CONSENT', 'TECHNICAL', 'OTHER'] as const;

/**
 * Same-origin return path after sign-in (FLOW2 CF-03). Only a local absolute path is allowed: no scheme,
 * no protocol-relative "//", no backslash tricks. Anything else falls back to the default.
 */
export function safeReturnPath(raw: string | null | undefined, fallback = '/home'): string {
  if (!raw || raw.length > 500) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\\]/.test(decoded)) return fallback;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(decoded)) return fallback;
  return raw;
}
