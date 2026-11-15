import { z } from 'zod';

/**
 * Project export with Anvil validation (owner, 12 Nov 2026). PMs who own the project and Admins export a project's
 * approved tasks from the project page. Praxis asks Anvil to validate the exported tasks and shows which ones need to be
 * fixed. Anvil's validate API is an external system (not yet published): Praxis calls it through `AnvilTaskValidator`
 * and, until it is connected, runs its own export pre-check, clearly labelled as such. A validation result is advice
 * for the PM; it never changes a task, a review decision or the Approved Task Dataset.
 */

export const VALIDATION_STATUSES = ['valid', 'needs_fix', 'not_validated'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const TaskValidationResult = z.object({
  recordId: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string(),
  status: z.enum(VALIDATION_STATUSES),
  /** What to fix, in the validator's words. */
  issues: z.array(z.object({ code: z.string(), path: z.string().nullable(), message: z.string() })),
});
export type TaskValidationResult = z.infer<typeof TaskValidationResult>;

export const ValidationRunDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: z.enum(['VALIDATE', 'EXPORT']),
  /** `anvil` when Anvil validated; `praxis-precheck` while Anvil's validate API is not connected. */
  validator: z.string(),
  validatorVersion: z.string(),
  results: z.array(TaskValidationResult),
  counts: z.object({ valid: z.number().int(), needsFix: z.number().int(), notValidated: z.number().int() }),
  requestedById: z.string().uuid(),
  createdAt: z.string(),
  /** EXPORT only: the exported file (newline-delimited JSON) can be downloaded again. */
  downloadPath: z.string().nullable(),
});
export type ValidationRunDto = z.infer<typeof ValidationRunDto>;

export const ValidateRequest = z.object({ recordIds: z.array(z.string().uuid()).min(1).max(1) }).strict();

export interface ExportEligibilityInput {
  status: string;
  approvedTasks: number;
  distinctTarget: number | null;
  endDate: string | null;
  today: string;
  /**
   * MVP1 new flow (owner, 15 Nov 2026; contract §6): export opens only when every task of the project is approved.
   * `totalTasks` is the project's task count (one per coverage slot); `approvedTasks` counts the slots with a current
   * approved task. Marked complete and the end date no longer open export. Omitted: the earlier rule applies.
   */
  allTasks?: { totalTasks: number; approvedTasks: number };
}

/** The reason export is closed in the new flow, e.g. "Export opens when all 5 tasks are approved (1 of 5 now)." */
export function allTasksReason(totalTasks: number, approvedTasks: number): string {
  if (totalTasks < 1) return 'Export opens when the project has tasks and all of them are approved.';
  return `Export opens when ${totalTasks === 1 ? 'the task is' : `all ${totalTasks} tasks are`} approved (${approvedTasks} of ${totalTasks} now).`;
}

/**
 * Validate needs at least one approved task. In the new flow (`allTasks`), export needs every task approved. Otherwise
 * export needs the project to be complete: the required number of
 * distinct approved tasks is reached, the project is marked complete, or its end date has come.
 */
export function exportEligibility(i: ExportEligibilityInput): { canValidate: boolean; canExport: boolean; reason: string | null } {
  if (i.status === 'DRAFT' || i.status === 'CANCELLED') return { canValidate: false, canExport: false, reason: i.status === 'DRAFT' ? 'The project is still a draft.' : 'The project is cancelled.' };
  if (i.allTasks) {
    const { totalTasks, approvedTasks } = i.allTasks;
    const canValidate = i.approvedTasks >= 1;
    if (totalTasks >= 1 && approvedTasks >= totalTasks && canValidate) return { canValidate, canExport: true, reason: null };
    return { canValidate, canExport: false, reason: allTasksReason(totalTasks, approvedTasks) };
  }
  if (i.approvedTasks < 1) return { canValidate: false, canExport: false, reason: 'Export needs at least one approved task.' };
  const targetMet = !!i.distinctTarget && i.approvedTasks >= i.distinctTarget;
  const ended = !!i.endDate && i.today >= i.endDate;
  if (i.status === 'COMPLETED' || targetMet || ended) return { canValidate: true, canExport: true, reason: null };
  return { canValidate: true, canExport: false, reason: `Export opens when the project is complete: ${i.approvedTasks} of ${i.distinctTarget ?? '?'} required tasks approved${i.endDate ? `, or on ${i.endDate}` : ''}. You can validate one task now.` };
}
