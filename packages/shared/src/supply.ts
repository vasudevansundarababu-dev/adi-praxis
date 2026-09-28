import { z } from 'zod';
import type { InternalRole } from './roles';

/**
 * M10 SME supply (docs/SME-SUPPLY.md): tiers, labels, partner scopes and webhook events, requisition and submission
 * inputs, and the rules-based requirement screen (which only ever recommends; a person confirms "not met").
 */

// ── Labels (owner decision 28 Sep 2026) ──

/** Internal roles as shown in the UI. The enum keeps REVIEWER; the label is "Validator" everywhere. */
export const ROLE_LABELS: Record<InternalRole, string> = { ADMIN: 'Admin', PM: 'PM', REVIEWER: 'Validator', FINANCE: 'Finance' };
export const roleLabel = (r: string) => (ROLE_LABELS as Record<string, string>)[r] ?? r.charAt(0) + r.slice(1).toLowerCase();

export const SME_TIERS = ['EXPERT', 'REVIEWER_SME', 'ANNOTATOR'] as const;
export type SmeTier = (typeof SME_TIERS)[number];
export const TIER_LABELS: Record<SmeTier, string> = { EXPERT: 'Expert', REVIEWER_SME: 'Reviewer', ANNOTATOR: 'Annotator' };

export const LAUNCH_DOMAINS = ['banking', 'healthcare', 'marketing'] as const;

// ── Partner API ──

export const PARTNER_SCOPES = ['requisitions:read', 'candidates:write', 'candidates:read', 'statements:read'] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const PARTNER_WEBHOOK_EVENTS = [
  'requisition.opened',
  'requisition.updated',
  'requisition.closed',
  'candidate.received',
  'candidate.duplicate',
  'candidate.invited',
  'candidate.identity_verified',
  'candidate.selected',
  'candidate.not_selected',
  'candidate.training_completed',
  'candidate.test_passed',
  'candidate.test_failed',
  'candidate.certified',
  'candidate.activated',
  'candidate.withdrawn',
  'candidate.expired',
  'sme.tier_changed',
  'sme.suspended',
  'sme.offboarded',
  'statement.issued',
] as const;
export type PartnerWebhookEvent = (typeof PARTNER_WEBHOOK_EVENTS)[number];

/** Candidate progress a sandbox partner can simulate (no real candidate is involved). */
export const SANDBOX_SIMULATIONS = ['identity_verified', 'selected', 'not_selected', 'training_completed', 'test_passed', 'test_failed', 'certified', 'activated'] as const;

// ── Requisitions ──

export const REQUISITION_STATES = ['DRAFT', 'OPEN', 'PAUSED', 'FILLED', 'CLOSED'] as const;
export type RequisitionState = (typeof REQUISITION_STATES)[number];
/** Allowed transitions (section 4): DRAFT → OPEN → PAUSED ⇄ OPEN → FILLED → CLOSED; any open state may close. */
export const REQUISITION_TRANSITIONS: Record<RequisitionState, RequisitionState[]> = {
  DRAFT: ['OPEN', 'CLOSED'],
  OPEN: ['PAUSED', 'FILLED', 'CLOSED'],
  PAUSED: ['OPEN', 'CLOSED'],
  FILLED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export const MinimumRequirements = z.object({
  minYears: z.number().int().min(0).max(50).default(0),
  qualifications: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  licenceRequired: z.boolean().default(false),
  notes: z.string().trim().max(2000).default(''),
});
export type MinimumRequirements = z.infer<typeof MinimumRequirements>;

export const RequisitionInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().max(4000).default(''),
  domain: z.string().trim().min(2).max(60),
  tier: z.enum(SME_TIERS),
  headcount: z.number().int().min(1).max(10_000),
  startDate: z.string().date().nullable().default(null),
  durationWeeks: z.number().int().min(1).max(260).nullable().default(null),
  hoursPerWeek: z.number().int().min(1).max(60).nullable().default(null),
  location: z.string().trim().max(200).nullable().default(null),
  jurisdictions: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  languages: z.array(z.string().trim().min(2).max(20)).max(20).default([]),
  minimumRequirements: MinimumRequirements.default({}),
  allowedPartnerIds: z.array(z.string().uuid()).max(100).default([]),
  directChannel: z.boolean().default(false),
  submissionDeadline: z.string().datetime().nullable().default(null),
  maxPerPartner: z.number().int().min(1).max(10_000).nullable().default(null),
  /** M10c: DIRECT = Praxis pays the SME (payee set-up on the checklist); VIA_PARTNER = the partner pays its people. */
  payRoute: z.enum(['DIRECT', 'VIA_PARTNER']).default('DIRECT'),
});
export type RequisitionInput = z.infer<typeof RequisitionInput>;

// ── Candidate submission (section 5) ──

export const EmploymentEntry = z.object({
  employer: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().default(null),
});

export const CandidateSubmissionInput = z.object({
  partnerRef: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().length(2).toUpperCase(),
  experienceSummary: z.string().trim().min(10).max(4000),
  experienceYears: z.number().min(0).max(60),
  employmentHistory: z.array(EmploymentEntry).max(30).default([]),
  qualifications: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  languages: z.array(z.string().trim().min(2).max(20)).max(20).default([]),
  /** The partner confirms it trained the candidate on the partner-facing guidelines summary. */
  partnerTrainingAttestation: z.literal(true),
  /** The candidate agreed to be put forward and contacted by ADI Praxis. */
  candidateConsent: z.literal(true),
});
export type CandidateSubmissionInput = z.infer<typeof CandidateSubmissionInput>;

export const normaliseEmail = (e: string) => {
  const [local = '', domain = ''] = e.trim().toLowerCase().split('@');
  // Gmail ignores dots and "+tags" in the local part; treat them as the same mailbox.
  const l = /^(gmail|googlemail)\.com$/.test(domain) ? local.replace(/\+.*$/, '').replace(/\./g, '') : local.replace(/\+.*$/, '');
  return `${l}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`;
};

/** Digits only, with the country code; Indian numbers without it get +91 (launch market). */
export function normalisePhone(p: string | undefined | null, country?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (!d.startsWith('+')) {
    d = d.replace(/^0+/, '');
    if (country === 'IN' && d.length === 10) d = `91${d}`;
    else if (country === 'US' && d.length === 10) d = `1${d}`;
    else if (country === 'GB' && d.length === 10) d = `44${d}`;
  }
  d = d.replace(/^\+/, '');
  return d.length >= 8 ? d : null;
}

// ── Requirement screen: a recommendation only (section 6) ──

export type ScreenResult = { state: 'MEETS' | 'DOES_NOT_MEET_RECOMMENDED' | 'UNCLEAR'; reasons: string[] };

export function screenRequirements(req: MinimumRequirements & { languages?: string[] }, c: Pick<CandidateSubmissionInput, 'experienceYears' | 'qualifications' | 'languages' | 'experienceSummary'>): ScreenResult {
  const reasons: string[] = [];
  let unclear = false;
  if (c.experienceYears < req.minYears) reasons.push(`Reported ${c.experienceYears} years of experience; the requisition asks for ${req.minYears}+.`);
  const have = c.qualifications.map((q) => q.toLowerCase());
  for (const q of req.qualifications) {
    if (!have.some((h) => h.includes(q.toLowerCase()) || q.toLowerCase().includes(h))) {
      if (c.experienceSummary.toLowerCase().includes(q.toLowerCase())) unclear = true;
      reasons.push(`Qualification "${q}" not listed.`);
    }
  }
  const langs = (req.languages ?? []).map((l) => l.toLowerCase());
  const missing = langs.filter((l) => !c.languages.map((x) => x.toLowerCase()).includes(l));
  if (missing.length) reasons.push(`Languages not listed: ${missing.join(', ')}.`);
  if (req.licenceRequired) {
    unclear = true;
    reasons.push('A professional licence is required; it is checked by a Validator before Expert certification.');
  }
  const hard = reasons.filter((r) => !r.startsWith('A professional licence'));
  if (!hard.length) return { state: unclear ? 'UNCLEAR' : 'MEETS', reasons };
  return { state: unclear && hard.every((r) => r.startsWith('Qualification')) ? 'UNCLEAR' : 'DOES_NOT_MEET_RECOMMENDED', reasons };
}

/** Days a partner owns a candidate after the first valid submission, and the cool-off after it ends (owner, 28 Sep). */
export const OWNERSHIP_DAYS = 365;
export const COOL_OFF_DAYS = 90;
export const INVITE_VALID_DAYS = 7;
export const INVITE_REMINDER_DAYS = 3;
