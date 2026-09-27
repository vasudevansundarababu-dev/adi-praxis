import { z } from 'zod';
import { CONTRIBUTION_ROLES, type OpportunityBrief, type OpportunityCriteria } from './candidate';

// ───────────────────────── Profile facts (FLOW2-SME section 4) ─────────────────────────

/**
 * Status of one fact. PROPOSED facts came from the assistant's extraction and must be confirmed by the candidate;
 * a blank is never a negative value (FLOW2 5.3), so UNKNOWN / DECLINED / SKIPPED are explicit, penalty-free states.
 */
export const FACT_STATUSES = ['PROPOSED', 'CONFIRMED', 'UNKNOWN', 'DECLINED', 'SKIPPED'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const FieldValue = z.union([z.string().max(4000), z.number(), z.array(z.string().max(200)).max(50)]);
export type FieldValue = z.infer<typeof FieldValue>;

export const ProfileField = z.object({
  value: FieldValue.nullable(),
  status: z.enum(FACT_STATUSES),
  approximate: z.boolean().default(false),
  /** Conversation turn ids (or "form") the value came from. */
  sources: z.array(z.string()).default([]),
  /** Set when an extraction disagreed with an already-confirmed value; never overwritten silently. */
  conflictWith: FieldValue.nullable().default(null),
  reused: z.boolean().default(false),
});
export type ProfileField = z.infer<typeof ProfileField>;

export const RESPONSIBILITIES = ['PERFORMED', 'SUPERVISED', 'REVIEWED', 'APPROVED', 'ADVISED'] as const;
const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const ProfileRole = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  employerType: z.string().trim().max(200).default(''),
  /** Optional; only when needed (FLOW2 section 4). */
  employerName: z.string().trim().max(200).nullable().default(null),
  start: YearMonth.nullable(),
  /** null = current. */
  end: YearMonth.nullable(),
  approximate: z.boolean().default(false),
  /** Whether this role counts towards the opportunity's specialty (e.g. KYC work, not all banking). */
  specialtyRelevant: z.boolean().default(true),
  responsibility: z.enum(RESPONSIBILITIES).nullable().default(null),
  status: z.enum(['PROPOSED', 'CONFIRMED']),
  sources: z.array(z.string()).default([]),
  reused: z.boolean().default(false),
});
export type ProfileRole = z.infer<typeof ProfileRole>;

export const CLAIM_TYPES = ['CERTIFICATION', 'LICENSE', 'ROLE', 'EMPLOYMENT', 'EDUCATION', 'OTHER'] as const;
export const ProfileClaim = z.object({
  id: z.string(),
  type: z.enum(CLAIM_TYPES),
  value: z.string().trim().min(1).max(300),
  issuer: z.string().trim().max(200).nullable().default(null),
  validFrom: YearMonth.nullable().default(null),
  expiresAt: YearMonth.nullable().default(null),
  status: z.enum(['PROPOSED', 'CONFIRMED']),
  /**
   * Candidates can only ever hold SELF_REPORTED claims. DOCUMENT_SUPPORTED / INDEPENDENTLY_VERIFIED are set by an
   * authorised reviewer (M4c), never by the candidate or the model (FLOW2 7.1, CF-16).
   */
  evidenceLevel: z.literal('SELF_REPORTED').default('SELF_REPORTED'),
  evidenceIds: z.array(z.string().uuid()).default([]),
  sources: z.array(z.string()).default([]),
});
export type ProfileClaim = z.infer<typeof ProfileClaim>;

export const ProfileData = z.object({
  fields: z.record(z.string(), ProfileField).default({}),
  roles: z.array(ProfileRole).default([]),
  claims: z.array(ProfileClaim).default([]),
});
export type ProfileData = z.infer<typeof ProfileData>;

/** Known profile fields. Criterion answers use the key `criterion:<id>`. */
export const FIELD_DEFS: Record<string, { label: string; kind: 'text' | 'list' | 'number' }> = {
  specialties: { label: 'Specialties', kind: 'list' },
  compliance_areas: { label: 'Compliance work performed', kind: 'list' },
  domain_years: { label: 'Years in the domain (self-reported)', kind: 'number' },
  specialty_years: { label: 'Years in the specialty (self-reported)', kind: 'number' },
  decision_authority: { label: 'Decision authority', kind: 'text' },
  jurisdictions: { label: 'Jurisdictions', kind: 'list' },
  customer_segments: { label: 'Customer and product types', kind: 'list' },
  work_example: { label: 'Typical case (generic)', kind: 'text' },
  escalation_boundaries: { label: 'Missing evidence and escalation', kind: 'text' },
  quality_checks: { label: 'How work is checked', kind: 'text' },
  tools_methods: { label: 'Tools and methods', kind: 'list' },
  contribution_roles: { label: 'Contribution roles', kind: 'list' },
  evidence_available: { label: 'Evidence available', kind: 'text' },
  hours_per_week: { label: 'Hours per week', kind: 'number' },
  start_availability: { label: 'Can start', kind: 'text' },
  conflicts: { label: 'Employer restrictions and conflicts', kind: 'text' },
};
export const isCriterionKey = (k: string) => /^criterion:[a-z0-9_-]{1,40}$/.test(k);
export const fieldLabel = (key: string, criteria: OpportunityCriteria = []) =>
  FIELD_DEFS[key]?.label ?? (isCriterionKey(key) ? `Requirement: ${criteria.find((c) => `criterion:${c.id}` === key)?.text ?? key}` : key);

// ───────────────────────── Question policy (FLOW2 5.1) ─────────────────────────

export const QuestionDef = z.object({
  id: z.string().regex(/^[a-z0-9_:-]{1,60}$/),
  section: z.string().max(60),
  text: z.string().trim().min(1).max(1000),
  /** Shown on "Why we ask". */
  why: z.string().trim().max(1000).default(''),
  /** Profile fields this question fills; 'roles' means the role timeline. */
  fields: z.array(z.string()).min(1),
  criterionIds: z.array(z.string()).default([]),
  answerType: z.enum(['text', 'roles', 'choice']).default('text'),
  options: z.array(z.string().max(200)).max(20).default([]),
  required: z.boolean().default(true),
  /** A reminder to use generic or synthetic descriptions only. */
  sensitive: z.boolean().default(false),
  evidenceExpected: z.string().max(500).default(''),
  safeExample: z.string().max(500).default(''),
});
export type QuestionDef = z.infer<typeof QuestionDef>;

export const QuestionPolicy = z.object({
  version: z.literal(1).default(1),
  source: z.enum(['default', 'owner']).default('default'),
  questions: z.array(QuestionDef).min(1).max(60),
});
export type QuestionPolicy = z.infer<typeof QuestionPolicy>;

/** At most one follow-up for an unresolved question before recording it as not known (FLOW2 C04; shortened 27 Sep 2026). */
export const MAX_CLARIFICATIONS = 1;

const BANKING = /bank|financ|complian|kyc|aml|sanction|fraud|payment|credit|risk/i;

/** Common jurisdictions offered as tap-to-choose answers; the SME can still type others. */
export const JURISDICTION_CHOICES = ['United Kingdom', 'European Union', 'United States', 'India', 'Singapore', 'United Arab Emirates', 'Hong Kong', 'Australia', 'Canada'];

/**
 * Default question policy: six short questions (owner decision, 27 Sep 2026), most answered by tapping choices. It
 * covers what a reviewer needs to judge suitability: what the SME worked on, their roles with dates (experience is
 * computed from these), level of responsibility, jurisdictions, how they meet the pool's published requirements (one
 * combined question), and one generic example case. Availability, conflicts and preferences are collected once, in
 * onboarding. It never asks about GitHub, papers, salary, age, nationality or other unrelated or sensitive topics
 * (CF-08, C04).
 */
export function defaultQuestionPolicy(brief: OpportunityBrief, criteria: OpportunityCriteria): QuestionPolicy {
  const banking = BANKING.test(`${brief.domain} ${brief.specialty} ${brief.title}`);
  const area = brief.specialty || brief.domain || 'this work';
  const q: QuestionDef[] = [];
  const add = (x: Partial<QuestionDef> & Pick<QuestionDef, 'id' | 'section' | 'text' | 'fields'>) => q.push(QuestionDef.parse(x));

  add(
    banking
      ? {
          id: 'focus',
          section: 'Your expertise',
          text: 'Which compliance processes have you personally worked on? Tap all that apply.',
          why: 'So we only ask about work that is relevant to you and to this opportunity.',
          fields: ['compliance_areas', 'specialties'],
          answerType: 'choice',
          options: ['KYC / onboarding', 'Enhanced due diligence', 'Transaction-monitoring investigation', 'Sanctions review', 'Compliance testing', 'Policy / control design', 'Audit', 'Regulatory reporting'],
        }
      : { id: 'focus', section: 'Your expertise', text: `Which parts of ${area} have you personally worked on?`, why: 'So we only ask about work that is relevant.', fields: ['specialties'] },
  );
  add({
    id: 'roles',
    section: 'Your roles',
    text: 'List the roles behind that experience, each with rough start and end years.',
    why: 'We work out your years of experience from these dates, without double-counting overlaps.',
    fields: ['roles'],
    answerType: 'roles',
    safeExample: 'e.g. "KYC Analyst, 2016 to 2019; Senior KYC Reviewer, 2019 to now"',
  });
  add({
    id: 'authority',
    section: 'Your responsibility',
    text: 'In your most relevant role, what did you do? Tap all that apply.',
    why: 'A job title alone does not show hands-on responsibility.',
    fields: ['decision_authority'],
    answerType: 'choice',
    options: ['Prepared cases', 'Reviewed others’ work', 'Approved outcomes', 'Advised the team'],
  });
  add({
    id: 'jurisdictions',
    section: 'Jurisdictions',
    text: 'Which jurisdictions did that work cover? Tap or type.',
    why: 'Experience in one jurisdiction does not automatically transfer to others.',
    fields: ['jurisdictions'],
    answerType: 'choice',
    options: JURISDICTION_CHOICES,
  });
  if (criteria.length) {
    const list = criteria.map((c) => `• ${c.text}${c.kind === 'REQUIRED' ? '' : ' (preferred)'}`).join('\n');
    add({
      id: 'requirements',
      section: 'This opportunity',
      text: `This pool looks for:\n${list}\nIn a sentence or two, how does your experience meet these?`,
      why: 'These are the published requirements for this pool; the reviewer checks your answer against them.',
      fields: criteria.map((c) => `criterion:${c.id}`),
      criterionIds: criteria.map((c) => c.id),
      required: criteria.some((c) => c.kind === 'REQUIRED'),
      evidenceExpected: criteria.map((c) => c.evidence).filter(Boolean).join(' '),
    });
  }
  add({
    id: 'work_example',
    section: 'An example',
    text: 'Briefly describe a typical case from start to finish, in general terms.',
    why: 'A short generic walkthrough shows how you work. Do not include names, account numbers or real documents.',
    fields: ['work_example'],
    sensitive: true,
  });
  return QuestionPolicy.parse({ version: 1, source: 'default', questions: q });
}

/**
 * Owner-edited policy reconciled with the criteria at publish time: questions for removed criteria are dropped and
 * every criterion keeps at least one question.
 */
export function reconcilePolicy(policy: QuestionPolicy | null, brief: OpportunityBrief, criteria: OpportunityCriteria): QuestionPolicy {
  const base = defaultQuestionPolicy(brief, criteria);
  if (!policy) return base;
  const ids = new Set(criteria.map((c) => c.id));
  const kept = policy.questions.filter((x) => x.criterionIds.length === 0 || x.criterionIds.some((c) => ids.has(c)));
  const missing = criteria.filter((c) => !kept.some((x) => x.criterionIds.includes(c.id)));
  if (missing.length) {
    const req = base.questions.find((x) => x.id === 'requirements')!;
    kept.push({ ...req, id: kept.some((x) => x.id === 'requirements') ? 'requirements-added' : 'requirements', fields: missing.map((c) => `criterion:${c.id}`), criterionIds: missing.map((c) => c.id) });
  }
  return QuestionPolicy.parse({ version: 1, source: 'owner', questions: kept });
}

// ───────────────────────── Deterministic controller (FLOW2 5.2) ─────────────────────────

const COVERED: FactStatus[] = ['PROPOSED', 'CONFIRMED', 'UNKNOWN', 'DECLINED', 'SKIPPED'];

export function questionCovered(q: QuestionDef, p: ProfileData): boolean {
  return q.fields.every((f) => {
    if (f === 'roles') return p.roles.length > 0 || COVERED.includes(p.fields.roles?.status ?? ('' as FactStatus));
    const v = p.fields[f];
    return !!v && COVERED.includes(v.status);
  });
}

/** The next question to ask, or null when every question is addressed (answered, unknown, declined or skipped). */
export function nextQuestion(policy: QuestionPolicy, p: ProfileData): QuestionDef | null {
  return policy.questions.find((q) => !questionCovered(q, p)) ?? null;
}

// ───────────────────────── Experience durations (FLOW2 4.2, CF-10) ─────────────────────────

const toMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return y! * 12 + (m! - 1);
};

export interface Duration {
  months: number;
  years: number;
  approximate: boolean;
  /** True when overlapping periods were merged rather than added. */
  overlapsMerged: boolean;
  basis: string[];
}

/**
 * Union of month intervals (inclusive), never their sum: overlapping roles do not double-count calendar time.
 * A role without a start date cannot be counted and is left out (shown to the candidate, never guessed).
 */
export function unionDuration(roles: Pick<ProfileRole, 'title' | 'start' | 'end' | 'approximate'>[], now = new Date()): Duration {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = roles
    .filter((r) => r.start)
    .map((r) => ({ a: toMonth(r.start!), b: r.end ? toMonth(r.end) : current, r }))
    .filter((s) => s.b >= s.a)
    .sort((x, y) => x.a - y.a);
  let months = 0;
  let overlapsMerged = false;
  let curA = -1;
  let curB = -2;
  for (const s of spans) {
    if (s.a <= curB) {
      overlapsMerged = true;
      curB = Math.max(curB, s.b);
    } else {
      if (curB >= curA && curA >= 0) months += curB - curA + 1;
      curA = s.a;
      curB = s.b;
    }
  }
  if (curA >= 0) months += curB - curA + 1;
  return {
    months,
    years: Math.round((months / 12) * 10) / 10,
    approximate: spans.some((s) => s.r.approximate),
    overlapsMerged,
    basis: spans.map((s) => `${s.r.title}: ${s.r.start} to ${s.r.end ?? 'now'}`),
  };
}

/** Domain (all confirmed roles) and specialty (confirmed, specialty-relevant roles) durations, kept separate. */
export function experienceDurations(p: ProfileData, now = new Date()) {
  const confirmed = p.roles.filter((r) => r.status === 'CONFIRMED');
  return {
    domain: unionDuration(confirmed, now),
    specialty: unionDuration(confirmed.filter((r) => r.specialtyRelevant), now),
    undated: confirmed.filter((r) => !r.start).map((r) => r.title),
  };
}

/** Neutral clarification items (not accusations): impossible date ranges. */
export function roleProblems(p: ProfileData): string[] {
  return p.roles
    .filter((r) => r.start && r.end && toMonth(r.end) < toMonth(r.start))
    .map((r) => `${r.title}: the end month is before the start month`);
}

// ───────────────────────── Readiness to submit (C05) ─────────────────────────

export interface Readiness {
  canSubmit: boolean;
  /** Proposed facts the candidate still has to confirm, edit or remove. */
  unconfirmed: string[];
  /** Required questions answered "unknown" / declined: allowed, but explained (CF-11, CF-12). */
  requiredGaps: string[];
  unanswered: string[];
  problems: string[];
}

export function readiness(policy: QuestionPolicy, p: ProfileData, criteria: OpportunityCriteria = []): Readiness {
  const unconfirmed = [
    ...Object.entries(p.fields)
      .filter(([, v]) => v.status === 'PROPOSED' || v.conflictWith !== null)
      .map(([k]) => fieldLabel(k, criteria)),
    ...p.roles.filter((r) => r.status === 'PROPOSED').map((r) => `Role: ${r.title}`),
    ...p.claims.filter((c) => c.status === 'PROPOSED').map((c) => `Credential: ${c.value}`),
  ];
  const unanswered = policy.questions.filter((q) => !questionCovered(q, p)).map((q) => q.text);
  const requiredGaps = policy.questions
    .filter((q) => q.required)
    .flatMap((q) => q.fields.filter((f) => f !== 'roles' && ['UNKNOWN', 'DECLINED'].includes(p.fields[f]?.status ?? '')))
    .map((f) => fieldLabel(f, criteria));
  const problems = roleProblems(p);
  return { canSubmit: unconfirmed.length === 0 && unanswered.length === 0 && problems.length === 0, unconfirmed, requiredGaps, unanswered, problems };
}

// ───────────────────────── API shapes ─────────────────────────

export const QUICK_REPLIES = ['DONT_KNOW', 'CANNOT_DISCLOSE', 'SKIP'] as const;

export const SendMessageRequest = z
  .object({
    clientMessageId: z.string().uuid(),
    questionId: z.string().max(60).nullable(),
    content: z.string().trim().max(4000).optional(),
    quickReply: z.enum(QUICK_REPLIES).optional(),
    expectedRevision: z.number().int().min(0),
  })
  .refine((m) => !!m.content !== !!m.quickReply, 'Send either a message or a quick reply');
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const FieldChange = z.object({
  fieldKey: z.string().max(60),
  action: z.enum(['CONFIRM', 'EDIT', 'UNKNOWN', 'DECLINE', 'SKIP', 'CLEAR']),
  value: FieldValue.optional(),
});
export const RoleChange = z.object({
  action: z.enum(['CONFIRM', 'EDIT', 'REMOVE', 'ADD']),
  id: z.string().optional(),
  role: ProfileRole.omit({ id: true, status: true, sources: true, reused: true }).partial({ approximate: true, specialtyRelevant: true, responsibility: true, employerType: true, employerName: true }).optional(),
});
export const ClaimChange = z.object({
  action: z.enum(['CONFIRM', 'EDIT', 'REMOVE', 'ADD']),
  id: z.string().optional(),
  claim: ProfileClaim.pick({ type: true, value: true, issuer: true, validFrom: true, expiresAt: true, evidenceIds: true }).partial({ issuer: true, validFrom: true, expiresAt: true, evidenceIds: true }).optional(),
});
export const CorrectionsRequest = z.object({
  enrollmentId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  fields: z.array(FieldChange).max(100).default([]),
  roles: z.array(RoleChange).max(50).default([]),
  claims: z.array(ClaimChange).max(50).default([]),
});
export type CorrectionsRequest = z.infer<typeof CorrectionsRequest>;

export const SubmitProfileRequest = z.object({
  expectedRevision: z.number().int().min(0),
  confirmAccuracy: z.literal(true),
  evidencePermission: z.literal(true),
  futureOpportunities: z.boolean().default(false),
});
