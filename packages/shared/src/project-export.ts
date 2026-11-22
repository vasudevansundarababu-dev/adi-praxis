import { z } from 'zod';

/**
 * Project export to the new RL Gym (docs/design/FORGE-RLGYM-V2-DESIGN.md part 2; AUTHORING-SNAPSHOT §3.2 a). The PM
 * who owns the project, or an Admin, presses Export for benchmark (or Re-export) on the project page. ADI Forge sends
 * the project's current approved tasks to the RL Gym as one `rlgym.project-export.v1`; the RL Gym fetches each task's
 * package from ADI Forge by hash and answers with a receipt. Exports are only ever started by a person (owner, 22 Nov
 * 2026). The old per-task validate/resolve path to the decommissioned RL Gym is gone.
 */

export const RLGYM_EXPORT_SCHEMA = 'rlgym.project-export.v1' as const;

/** One task as sent in the export (no package content: the RL Gym fetches it by `package_sha256`). */
export const ExportTaskDto = z.object({
  recordId: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string(),
  revision: z.number().int(),
  packageSha256: z.string(),
  correctsRevision: z.number().int().nullable(),
});
export type ExportTaskDto = z.infer<typeof ExportTaskDto>;

/** An approved task ADI Forge did not send, and why (it cannot be packaged, or it has no case). */
export const NotSentDto = z.object({ recordId: z.string().uuid(), taskId: z.string().uuid(), title: z.string(), code: z.string(), message: z.string() });
export type NotSentDto = z.infer<typeof NotSentDto>;

/** The RL Gym's receipt, as it returned it (counts and blocked tasks). */
export const RlGymReceiptDto = z.object({
  new: z.number().int(),
  superseding: z.number().int(),
  unchanged: z.number().int(),
  blocked: z.array(z.object({ taskId: z.string(), reason: z.string() })),
  replayed: z.boolean(),
  receiptSha256: z.string().nullable(),
});
export type RlGymReceiptDto = z.infer<typeof RlGymReceiptDto>;

export const EXPORT_OUTCOMES = ['received', 'rejected', 'unavailable'] as const;

/** One press of Export / Re-export, kept append-only with what was sent and what the RL Gym answered. */
export const ProjectExportRunDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  exportId: z.string(),
  exportSha256: z.string(),
  reason: z.string(),
  tasks: z.array(ExportTaskDto),
  notSent: z.array(NotSentDto),
  /** received: the RL Gym took it (see receipt). rejected: it answered with an error. unavailable: no answer. */
  outcome: z.enum(EXPORT_OUTCOMES),
  httpStatus: z.number().int().nullable(),
  requestId: z.string().nullable(),
  receipt: RlGymReceiptDto.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedById: z.string().uuid(),
  createdAt: z.string(),
});
export type ProjectExportRunDto = z.infer<typeof ProjectExportRunDto>;

/** GET /projects/:id/export: whether the PM can export now, the approved tasks and the last exports. */
export const ProjectExportStateDto = z.object({
  canExport: z.boolean(),
  reason: z.string().nullable(),
  /** False while ADI Forge has no RL Gym address or key (QA today: the RL Gym is not deployed). */
  connected: z.boolean(),
  /** The RL Gym's identity of the project's template version, from its qualification record; null when not qualified. */
  rlgymTemplate: z.object({ id: z.string(), version: z.number().int(), specSha256: z.string() }).nullable(),
  /** True when an export has already reached the RL Gym (the next press is a re-export). */
  exported: z.boolean(),
  tasks: z.array(z.object({ recordId: z.string().uuid(), taskId: z.string().uuid(), title: z.string(), approvedAt: z.string(), revision: z.number().int(), inRlGym: z.boolean() })),
  runs: z.array(ProjectExportRunDto),
});
export type ProjectExportStateDto = z.infer<typeof ProjectExportStateDto>;

export interface ExportEligibilityInput {
  status: string;
  approvedTasks: number;
  connected: boolean;
  qualified: boolean;
}

/**
 * Export needs: a live project (not a draft or cancelled), at least one approved task (the approved tasks so far are
 * sent; re-export sends corrections), the RL Gym connected, and the template version qualified by the RL Gym.
 */
export function exportEligibility(i: ExportEligibilityInput): { canExport: boolean; reason: string | null } {
  if (i.status === 'DRAFT') return { canExport: false, reason: 'The project is still a draft.' };
  if (i.status === 'CANCELLED') return { canExport: false, reason: 'The project is cancelled.' };
  if (!i.connected) return { canExport: false, reason: 'RL Gym isn’t connected yet.' };
  if (!i.qualified) return { canExport: false, reason: 'RL Gym hasn’t qualified this template version yet.' };
  if (i.approvedTasks < 1) return { canExport: false, reason: 'Export needs at least one approved task.' };
  return { canExport: true, reason: null };
}
