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
  issues: z.array(
    z.object({
      code: z.string(),
      path: z.string().nullable(),
      message: z.string(),
      /** E-007 phase 2: ADI Forge's own task checks also say the section, who can fix it and whether trying again helps. */
      section: z.string().optional(),
      owner: z.enum(['author', 'pm', 'template', 'authoring', 'rlgym']).optional(),
      retryHelps: z.boolean().optional(),
      severity: z.enum(['blocking', 'warning']).optional(),
    }),
  ),
});

/** Who fixes a problem, in words for the PM. */
export const ISSUE_OWNER_LABEL = { author: 'the author', pm: 'the PM', template: 'the template (Studio)', authoring: 'ADI Forge support', rlgym: 'RL Gym' } as const;
export type TaskValidationResult = z.infer<typeof TaskValidationResult>;

/**
 * What RL Gym answered for a run (owner, 21 Nov 2026), as stored with the run: the contract check, then per package
 * part its validate (and, on export, resolve) answer with RL Gym's status and request id. Never carries tokens, storage
 * keys or idempotency keys. Null when RL Gym was not asked (its validate API is not connected).
 */
export const AnvilPartDto = z.object({
  partIndex: z.number().int(),
  partCount: z.number().int(),
  packageId: z.string(),
  packageSha256: z.string(),
  zipSha256: z.string(),
  bytes: z.number().int(),
  recordIds: z.array(z.string()),
  validate: z.object({ kind: z.string(), httpStatus: z.number().int().nullable(), status: z.string(), valid: z.boolean().nullable(), errorCount: z.number().int(), requestId: z.string().nullable(), anvilPackageSha256: z.string().nullable() }),
  resolve: z.object({ kind: z.string(), httpStatus: z.number().int().nullable(), status: z.string(), requestId: z.string().nullable() }).nullable(),
});
export type AnvilPartDto = z.infer<typeof AnvilPartDto>;
export const AnvilRunDto = z.object({
  contract: z.string(),
  support: z.enum(['enabled', 'disabled', 'absent', 'unreachable']),
  batchId: z.string().nullable(),
  parts: z.array(AnvilPartDto),
  /** Tasks ADI Forge could not package, so did not send. */
  problems: z.array(z.object({ recordId: z.string(), taskId: z.string(), code: z.string(), message: z.string() })),
});
export type AnvilRunDto = z.infer<typeof AnvilRunDto>;

/** The stored RL Gym record of a run as its DTO: only the listed fields, so storage keys and tokens never leave. */
export function anvilRunDto(raw: unknown): AnvilRunDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const parts = (Array.isArray(r.parts) ? r.parts : []) as Record<string, unknown>[];
  const pick = <T extends Record<string, unknown>>(o: unknown, keys: string[]) => (o && typeof o === 'object' ? Object.fromEntries(keys.map((k) => [k, (o as T)[k] ?? null])) : null);
  const parsed = AnvilRunDto.safeParse({
    contract: r.contract,
    support: r.support,
    batchId: r.batchId ?? null,
    parts: parts.map((p) => ({
      ...pick(p, ['partIndex', 'partCount', 'packageId', 'packageSha256', 'zipSha256', 'bytes', 'recordIds']),
      validate: pick(p.validate, ['kind', 'httpStatus', 'status', 'valid', 'errorCount', 'requestId', 'anvilPackageSha256']),
      resolve: pick(p.resolve, ['kind', 'httpStatus', 'status', 'requestId']),
    })),
    problems: ((Array.isArray(r.problems) ? r.problems : []) as unknown[]).map((x) => pick(x, ['recordId', 'taskId', 'code', 'message'])),
  });
  return parsed.success ? parsed.data : null;
}

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
  /** RL Gym's answer for this run (contract support, per-part status and request id); null when RL Gym was not asked. */
  anvil: AnvilRunDto.nullable(),
});
export type ValidationRunDto = z.infer<typeof ValidationRunDto>;

/** GET /projects/:id/export: what can be done now, the approved tasks and the last runs. */
export const ProjectExportStateDto = z.object({
  canValidate: z.boolean(),
  canExport: z.boolean(),
  reason: z.string().nullable(),
  validator: z.object({ name: z.string(), version: z.string(), isAnvil: z.boolean() }),
  tasks: z.array(z.object({ recordId: z.string().uuid(), taskId: z.string().uuid(), title: z.string(), approvedAt: z.string() })),
  runs: z.array(ValidationRunDto),
});

/** The approved tasks to validate in one call: one or many (owner, 21 Nov 2026: multi-select in the task table). */
export const MAX_VALIDATE_TASKS = 500;
export const ValidateRequest = z.object({ recordIds: z.array(z.string().uuid()).min(1).max(MAX_VALIDATE_TASKS).refine((ids) => new Set(ids).size === ids.length, 'List each task once.') }).strict();

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
