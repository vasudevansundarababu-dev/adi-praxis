import { z } from 'zod';

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
