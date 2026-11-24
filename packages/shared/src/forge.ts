import { z } from 'zod';
import { TERMS_KEYS, type TermsKey } from './selection';
import { humaniseField, selectorValueDisplay } from './tasks';

/**
 * MVP1 (ADI Forge), approved by the owner on 15 Nov 2026 (docs/design/PROJECT-SCREEN-DESIGN.md).
 *
 * - Recruitment agencies supply people; a PM or Admin uploads them in Sourcing, per project and role.
 * - The PM or Admin assigns a person to a specific task, as SME (author) or Reviewer. Assigning is the selection.
 * - Everything here is behind the per-client setting `newFlow`; the earlier journey keeps working until it is on.
 */

export const SOURCED_ROLES = ['SME', 'REVIEWER'] as const;
export const SourcedRole = z.enum(SOURCED_ROLES);
export type SourcedRole = z.infer<typeof SourcedRole>;

export const CANDIDATE_SIGN_IN_MODES = ['OFFLINE', 'ONLINE'] as const;
export const CandidateSignInMode = z.enum(CANDIDATE_SIGN_IN_MODES);
export type CandidateSignInMode = z.infer<typeof CandidateSignInMode>;

/** Per-client platform settings an Admin changes at run time (stored in Client.settings). */
export const ForgeSettings = z.object({
  /** MVP1 flow: direct assignment to tasks, the candidate task list, Sourcing. Off keeps the earlier journey. */
  newFlow: z.boolean(),
  /** OFFLINE: email and name, no password (test environments only). ONLINE: email and password. */
  candidateSignIn: CandidateSignInMode,
});
export type ForgeSettings = z.infer<typeof ForgeSettings>;
export const ForgeSettingsUpdate = ForgeSettings.partial().strict();

export const normEmail = (email: string) => email.trim().toLowerCase();
const Email = z.string().trim().max(254).email();
const Name = z.string().trim().min(1).max(100);

/** One person from a recruiter, typed in on the New screen or read from one row of the assessment sheet. */
export const SourcedPersonInput = z.object({
  projectId: z.string().uuid(),
  role: SourcedRole,
  firstName: Name,
  lastName: Name,
  email: Email,
  linkedinUrl: z.string().trim().url().max(500).regex(/^https?:\/\//).optional().or(z.literal('').transform(() => undefined)),
  agency: z.string().trim().max(200).optional(),
  /** The recruiter's assessment as received: requirement verdicts, answers, why they fit. Accepted in good faith. */
  assessment: z.record(z.string().max(200), z.string().max(4000)).optional(),
});
export type SourcedPersonInput = z.infer<typeof SourcedPersonInput>;

export interface SourcedPersonDto {
  id: string;
  projectId: string;
  projectName: string;
  projectSkills: string[];
  role: SourcedRole;
  firstName: string;
  lastName: string;
  email: string;
  linkedinUrl: string | null;
  hasCv: boolean;
  hasAssessment: boolean;
  agency: string | null;
  submittedBy: string;
  createdAt: string;
  assigned: boolean;
}

/**
 * Assign a person to one task: as SME, an open task to author; as Reviewer, an authored task to review. The person is
 * a Sourcing profile on the project (sourcedPersonId), or someone from the platform pool (candidateId and role, D20),
 * for whom the project record is made on assign. Exactly one of the two is sent.
 */
export const DirectAssignRequest = z
  .object({
    sourcedPersonId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    role: SourcedRole.optional(),
    taskId: z.string().uuid(),
  })
  .refine((b) => (b.sourcedPersonId ? !b.candidateId : !!b.candidateId && !!b.role), {
    message: 'Send sourcedPersonId, or candidateId with role (SME or REVIEWER).',
  });
export type DirectAssignRequest = z.infer<typeof DirectAssignRequest>;

/** D19: the PM or Admin changes the project's Required workers (SME places). Never below its task count. */
export const RequiredWorkersRequest = z.object({ requiredWorkers: z.number().int().min(1).max(10000) });
export type RequiredWorkersRequest = z.infer<typeof RequiredWorkersRequest>;

export interface ProjectPersonDto {
  sourcedPersonId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: SourcedRole;
  status: 'ASSIGNED';
  tasks: { taskId: string; label: string; status: string }[];
}

/** Statuses as the SME sees them in the candidate app's task list. */
export const SME_TASK_STATUSES = ['New', 'In progress', 'In review', 'Rework', 'Accepted', 'Rejected'] as const;
export type SmeTaskStatus = (typeof SME_TASK_STATUSES)[number];
export function smeTaskStatus(status: string): SmeTaskStatus {
  switch (status) {
    case 'ASSIGNED':
    case 'CREATED':
      return 'New';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'SUBMITTED':
      return 'In review';
    case 'REWORK':
      return 'Rework';
    case 'ACCEPTED':
      return 'Accepted';
    default:
      return 'Rejected';
  }
}

// ── MVP1 step 2: task review on the project's Tasks tab, and by the external Reviewer in the candidate app ──

export const TASK_REJECT_REASONS = ['DUPLICATE', 'NOT_REALISTIC', 'INCORRECT', 'REAL_DATA'] as const;
export const TaskRejectReason = z.enum(TASK_REJECT_REASONS);
export type TaskRejectReason = z.infer<typeof TaskRejectReason>;

/** A comment for the author, placed under one section of the authored form (for example S1, S3-S4, W02). */
export const ForgeComment = z.object({
  section: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/),
  text: z.string().trim().min(1).max(2000),
});
export type ForgeComment = z.infer<typeof ForgeComment>;

const DuplicateDecision = z.enum(['ACCEPT_AS_DISTINCT', 'REWORK', 'REJECT_DUPLICATE']);
const ConfirmedCoverage = z.object({ tags: z.record(z.string(), z.string()), edgeCase: z.string().trim().min(1).max(200) });
const hasAuthorComment = (d: { comments: unknown[]; notes?: string }) => d.comments.length > 0 || !!d.notes;

/** The PM's or Admin's decision box on the task page. Rework and Reject need a comment for the author (owner, 15 Nov). */
export const ForgeDecisionRequest = z
  .object({
    decision: z.enum(['APPROVE', 'REWORK', 'REJECT']),
    expectedVersion: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
    comments: z.array(ForgeComment).max(50).default([]),
    notes: z.string().trim().max(4000).optional(),
    rejectReason: TaskRejectReason.optional(),
    checklist: z.record(z.string().max(40), z.boolean()).optional(),
    duplicateDecision: DuplicateDecision.optional(),
    confirmedCoverage: ConfirmedCoverage.optional(),
  })
  .refine((d) => d.decision === 'APPROVE' || hasAuthorComment(d), { message: 'Rework and Reject need a comment for the author', path: ['comments'] })
  .refine((d) => d.decision !== 'REJECT' || !!d.rejectReason, { message: 'Choose a reason for rejecting', path: ['rejectReason'] });
export type ForgeDecisionRequest = z.infer<typeof ForgeDecisionRequest>;

/** PM/Admin: send an approved task back to its author for a new revision (the approved record is kept). */
export const ForgeSendBackRequest = z.object({ notes: z.string().trim().min(10, 'Say what the author must fix.').max(4000), expectedRevision: z.number().int().min(0) }).strict();
export type ForgeSendBackRequest = z.infer<typeof ForgeSendBackRequest>;
/** Owner, 24 Nov 2026: a PM or Admin corrects one field of an approved task (a small fix, no SME); record kept. */
export const ForgeCorrectRequest = z
  .object({
    section: z.string().regex(/^S\d{1,2}$/),
    field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    value: z.unknown(),
    reason: z.string().trim().min(10, 'Say what you corrected and why.').max(2000),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type ForgeCorrectRequest = z.infer<typeof ForgeCorrectRequest>;

/** The external Reviewer's decision: pass to the PM or Admin, or send back to the author. A Reviewer never rejects. */
export const ReviewerDecisionRequest = z
  .object({
    decision: z.enum(['PASS', 'REWORK']),
    expectedVersion: z.number().int().min(1),
    expectedRevision: z.number().int().min(0),
    comments: z.array(ForgeComment).max(50).default([]),
    notes: z.string().trim().max(4000).optional(),
    checklist: z.record(z.string().max(40), z.boolean()).optional(),
    /** Needed only when the task was flagged as a likely duplicate. */
    duplicateDecision: DuplicateDecision.optional(),
    /** Needed only to pass a task on an open coverage slot. */
    confirmedCoverage: ConfirmedCoverage.optional(),
  })
  .refine((d) => d.decision !== 'REWORK' || d.comments.length > 0, { message: 'Sending back for rework needs at least one comment', path: ['comments'] });
export type ReviewerDecisionRequest = z.infer<typeof ReviewerDecisionRequest>;

export interface ForgePerson {
  name: string;
  email: string | null;
}

/**
 * What a task covers, for the Dashboard's "Coverage by <field>" (MVP1 step 9): read from the task's slot, not its brief.
 * `field` is the selector's display name ("Governing state", "Application type", a dimension label, "Edge case"; empty
 * for an open slot), `value` the stored value ("CA") and `label` what the table shows ("California (CA)", "Open slot").
 */
export interface ForgeTaskSelector {
  field: string;
  value: string;
  label: string;
}

/** The slot data a selector is read from (a task's `input.slot`). */
export interface SelectorSlot {
  tags?: Record<string, string> | null;
  edgeCase?: string | null;
  isOpen?: boolean | null;
  case?: { field: string; source: string; value: string; label?: string } | null;
}

/**
 * A task's selector from its slot. A case-selector slot gives the form field's label and the option's label (as the
 * slot brief shows them); a dimension slot its first tag in dimension order; an edge-case slot its edge case; an open
 * slot "Open slot". No slot: null.
 */
export function forgeSlotSelector(
  slot: SelectorSlot | null | undefined,
  labels: { fieldLabel?: (source: string) => string | undefined; optionLabel?: (source: string, value: string) => string | undefined; dimensions?: { key: string; label: string }[] } = {},
): ForgeTaskSelector | null {
  if (!slot) return null;
  if (slot.isOpen) return { field: '', value: '', label: 'Open slot' };
  if (slot.case) {
    // The label stored on the slot (15 Nov 2026) wins; older slots read it from the template's form.
    const option = slot.case.label ?? labels.optionLabel?.(slot.case.source, slot.case.value);
    return { field: labels.fieldLabel?.(slot.case.source) ?? humaniseField(slot.case.field), value: slot.case.value, label: selectorValueDisplay(slot.case.value, option) };
  }
  const dims = labels.dimensions ?? [];
  const order = (k: string) => dims.findIndex((d) => d.key === k) + 1 || 999;
  const first = Object.entries(slot.tags ?? {}).sort(([a], [b]) => order(a) - order(b))[0];
  if (first) return { field: dims.find((d) => d.key === first[0])?.label ?? first[0], value: first[1], label: first[1] };
  if (slot.edgeCase) return { field: 'Edge case', value: slot.edgeCase, label: slot.edgeCase };
  return null;
}

/** One row of the project's Tasks tab. */
export interface ForgeTaskRow {
  taskId: string;
  label: string;
  /** What the task covers, from its slot (MVP1 step 9). Absent in older responses: the console then reads the brief. */
  selector?: ForgeTaskSelector | null;
  slotLabel: string;
  status: string;
  smeStatus: SmeTaskStatus;
  author: ForgePerson | null;
  reviewer: ForgePerson | null;
  reviewStage: 'EXPERT_REVIEW' | 'PM_APPROVAL' | null;
  /** Last status change (ISO). */
  date: string;
  canDecide: boolean;
  waitingFor: 'REVIEWER' | 'PM' | null;
}

/** Statuses of a task as its external Reviewer sees it on the candidate app's Home. */
export const REVIEWER_TASK_STATUSES = ['To review', 'Sent back', 'Approved'] as const;
export type ReviewerTaskStatus = (typeof REVIEWER_TASK_STATUSES)[number];

// ── MVP1 step 3: the candidate app (sign-in, Before you start, Home task list) ──

/** What the candidate app needs before sign-in: the flow switch and the sign-in mode (public, no secrets). */
export interface PublicForgeSettings {
  newFlow: boolean;
  candidateSignIn: CandidateSignInMode;
}

/** Consent purposes recorded on the Before you start screen. Terms versions are their content hashes. */
export const termsConsentPurpose = (key: TermsKey) => `terms:${key}`;
export const SYNTHETIC_ONLY_PURPOSE = 'synthetic_data_only';
export const SYNTHETIC_ONLY_VERSION = '1';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Accept the current contributor terms (each by its content hash) and confirm synthetic data only. Both are required. */
export const ForgeTermsAcceptRequest = z
  .object({
    hashes: z.object(Object.fromEntries(TERMS_KEYS.map((k) => [k, Sha256])) as Record<TermsKey, typeof Sha256>).strict(),
    syntheticOnly: z.literal(true),
  })
  .strict();
export type ForgeTermsAcceptRequest = z.infer<typeof ForgeTermsAcceptRequest>;

export interface ForgeTermsDoc {
  key: TermsKey;
  title: string;
  body: string;
  version: number;
  sha256: string;
  placeholder: boolean;
}

export interface ForgeTermsView {
  /** One per terms key; null when that document has not been published. */
  terms: (ForgeTermsDoc | null)[];
  accepted: boolean;
}

/** One of the SME's own tasks on Home. */
export interface ForgeAuthorTask {
  taskId: string;
  label: string;
  projectName: string;
  status: SmeTaskStatus;
  /** Last status change (ISO). */
  date: string;
  /** Comments on the latest send-back (0 unless the task is in Rework). */
  reworkComments: number;
}

/** One task the person reviews, as GET /me/reviews lists it. */
export interface ForgeReviewTask {
  taskId: string;
  label: string;
  slotLabel: string;
  projectId: string;
  projectName: string;
  author: string | null;
  status: ReviewerTaskStatus;
  date: string;
}

export interface ForgeHomeDto {
  newFlow: boolean;
  termsAccepted: boolean;
  name: string | null;
  authorTasks: ForgeAuthorTask[];
  reviewTasks: ForgeReviewTask[];
}

// ── MVP1 step 5: Sourcing screens and Export to Recruiter ──

/** A project on the Sourcing → New dropdown: new or active, with the skills from its job description. */
export interface SourcingProjectDto {
  id: string;
  name: string;
  status: string;
  reviewRoute: 'SME_PM' | 'SME_EXPERT_PM';
  skills: string[];
}

export interface RecruiterRequirement {
  /** Skill, Experience, Education, or the demographic's label (for example Country / region). */
  kind: string;
  detail: string;
  level: 'Required' | 'Preferred';
  /** What the recruiter checks to say the requirement is met. */
  evidence: string;
}

/** The recruiter pack (one PDF with the assessment sheet inside), built from the project. Public text: ADI Forge only. */
export interface RecruiterPackDto {
  projectId: string;
  projectName: string;
  /** For example 15 Nov 2026. */
  date: string;
  fileName: string;
  role: { title: string; work: string; location: string; language: string; pay: string; effort: string; peopleNeeded: number | null };
  requirements: RecruiterRequirement[];
  cheatSheetIntro: string;
  cheatSheet: { section: string; title: string; explanation: string }[];
  questions: { n: number; text: string; required: boolean }[];
  sendBack: { item: string; detail: string }[];
  sheetColumns: string[];
}

/** One row of an imported assessment sheet: what would be (or was) created, or why not. */
export interface SourcingImportRow {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  ok: boolean;
  problems: string[];
}

export interface SourcingImportResult {
  projectId: string;
  role: SourcedRole;
  dryRun: boolean;
  rows: SourcingImportRow[];
  valid: number;
  created: number;
  skipped: number;
}

/** The New screen's form, checked in the browser before anything is sent (the API checks it again). */
export function sourcedPersonFormProblems(f: { projectId: string; firstName: string; lastName: string; email: string; linkedinUrl: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (!f.projectId) out.projectId = 'Choose a project.';
  if (!f.firstName.trim()) out.firstName = 'Enter the first name.';
  if (!f.lastName.trim()) out.lastName = 'Enter the last name.';
  if (!f.email.trim()) out.email = 'Enter the email (the Gmail address they will sign in with).';
  else if (!z.string().email().safeParse(f.email.trim()).success) out.email = 'Enter a valid email address.';
  if (f.linkedinUrl.trim() && !/^https?:\/\/\S+\.\S+/.test(f.linkedinUrl.trim())) out.linkedinUrl = 'Enter a full web address starting with https://';
  return out;
}

// ── MVP1 step 6: candidate sign-in modes (Online = email and password; set and reset by one-time link) ──

/** Same minimum as console passwords (NIST SP 800-63B: length over composition rules). */
export const CANDIDATE_PASSWORD_MIN = 12;
/** A set-your-password link (sent when a PM or Admin assigns a new person) lasts 72 hours; a reset link 1 hour. */
export const SET_PASSWORD_LINK_HOURS = 72;
export const RESET_PASSWORD_LINK_HOURS = 1;

const Password = z.string().min(1).max(200);
export const PasswordSignInRequest = z.object({ email: z.string().trim().max(254), password: Password, adultAttested: z.boolean().optional() });
export type PasswordSignInRequest = z.infer<typeof PasswordSignInRequest>;
export const PasswordSetRequest = z.object({ token: z.string().min(1).max(200), password: Password });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;
export const PasswordForgotRequest = z.object({ email: z.string().trim().max(254) });
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequest>;

/** Why a new candidate password is refused (null when it is fine). Mirrors the console rule: long enough, no email name. */
export function candidatePasswordProblem(password: string, emails: (string | null | undefined)[] = []): string | null {
  if (password.length < CANDIDATE_PASSWORD_MIN) return `Use at least ${CANDIDATE_PASSWORD_MIN} characters.`;
  if (password.length > 200) return 'Use at most 200 characters.';
  const lower = password.toLowerCase();
  for (const e of emails) {
    const local = e?.split('@')[0]?.trim().toLowerCase();
    if (local && local.length >= 3 && lower.includes(local)) return 'Do not use your email address in your password.';
  }
  return null;
}

/** D11 (owner, 15 Nov 2026): the open-slot edge-case field, the same label and help everywhere. */
export const EDGE_CASE_LABEL = 'Edge case this task tests';
export const EDGE_CASE_HELP =
  "In one line, name the unusual situation this task covers, the twist that makes it harder than a routine case. Your evidence (S2), steps (S5) and rubric (S7) must show it; the reviewer confirms it before approval. Example: 'Weekly report arrives late; the agent must hold, not guess.'";
