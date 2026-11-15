import { z } from 'zod';
import { TERMS_KEYS, type TermsKey } from './selection';

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

/** Assign a sourced person to one task: as SME, an open task to author; as Reviewer, an authored task to review. */
export const DirectAssignRequest = z.object({
  sourcedPersonId: z.string().uuid(),
  taskId: z.string().uuid(),
});
export type DirectAssignRequest = z.infer<typeof DirectAssignRequest>;

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

/** One row of the project's Tasks tab. */
export interface ForgeTaskRow {
  taskId: string;
  label: string;
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
