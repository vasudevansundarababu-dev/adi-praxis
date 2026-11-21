import type { AnvilRunDto, TaskValidationResult } from '@praxis/shared';

/**
 * Multi-select validation in the project's task table (owner, 21 Nov 2026). Only approved tasks (those with a current
 * approved record in the export state) can be selected, and only while the project can be validated. Validate sends the
 * selected tasks in one call; Export always covers every approved task and ignores the selection.
 */

export interface ApprovedTaskRef {
  recordId: string;
  taskId: string;
}

/** The approved record of each task that can be selected for validation, by task id. Empty when validation is closed. */
export function selectableRecords(state: { canValidate: boolean; tasks: ApprovedTaskRef[] } | null): Map<string, string> {
  if (!state?.canValidate) return new Map();
  return new Map(state.tasks.map((t) => [t.taskId, t.recordId]));
}

/** Select-all: every selectable record among `recordIds` when any of them is unselected, otherwise none of them. */
export function toggleAll(selected: ReadonlySet<string>, recordIds: string[]): Set<string> {
  const next = new Set(selected);
  const all = recordIds.length > 0 && recordIds.every((id) => next.has(id));
  for (const id of recordIds) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Header checkbox state for the visible selectable records. */
export function selectAllState(selected: ReadonlySet<string>, recordIds: string[]): 'all' | 'some' | 'none' {
  const n = recordIds.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === recordIds.length ? 'all' : 'some';
}

/** The body of POST /projects/:id/validate for the selection, in the order the tasks are listed. */
export const validateBody = (selected: ReadonlySet<string>, order: ApprovedTaskRef[]) => ({ recordIds: order.map((t) => t.recordId).filter((id) => selected.has(id)) });

/** The body of POST /projects/:id/exports: always every approved task, whatever is selected. */
export const exportBody = () => ({});

const REQUEST = /\s*\(?;?\s*RL Gym request ([^\s);,]*[^\s);,.])\)?/;

/** One validator issue split for display: its code, RL Gym's request id and location when it gave them, and the rest. */
export function issueParts(i: TaskValidationResult['issues'][number]): { code: string; message: string; requestId: string | null; location: string | null } {
  const m = REQUEST.exec(i.message);
  const message = (m ? i.message.replace(m[0], '') : i.message).replace(/\s*;\s*$/, '').trim();
  return { code: i.code, message, requestId: m?.[1] ?? null, location: i.path };
}

export const RESULT_LABEL: Record<TaskValidationResult['status'], string> = { valid: 'valid', needs_fix: 'needs fixing', not_validated: 'not validated' };

/** The RL Gym package part a task was sent in, for its status and request id; null when RL Gym was not asked. */
export const partOf = (anvil: AnvilRunDto | null | undefined, recordId: string) => anvil?.parts.find((p) => p.recordIds.includes(recordId)) ?? null;
