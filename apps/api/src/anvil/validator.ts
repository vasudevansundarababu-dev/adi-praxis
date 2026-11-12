import type { ApprovedTaskRecord } from '@prisma/client';
import type { TaskValidationResult } from '@praxis/shared';
import { AppError } from '../lib/errors';
import { hasExecutableContract, praxisExport } from '../dataset/praxis-export';

/** One task sent for validation: the approved record and, when it has an executable contract, its Anvil export envelope. */
export interface ValidationItem {
  record: ApprovedTaskRecord;
  taskId: string;
  title: string;
  /** `praxis.anvil.export.v1` envelope, or null when the record has no executable contract. */
  envelope: Record<string, unknown> | null;
  /** Why the envelope is missing or blocked (Praxis export errors and compile blockers). */
  exportProblems: { code: string; path: string | null; message: string }[];
}

/**
 * Anvil's task validation (owner, 12 Nov 2026: "Praxis will call Anvil with API then it validates the task and provide
 * which tasks needs to be fixed"). Anvil's validate API is an external system and is not published yet, so its wire
 * format is not invented here: the Anvil adapter is added against the contract Anvil documents. Until then Praxis runs
 * `PraxisPrecheckValidator`, labelled as such everywhere it is shown.
 */
export interface AnvilTaskValidator {
  /** `anvil` for Anvil itself; anything else is not Anvil's verdict. */
  readonly name: string;
  readonly version: string;
  validate(items: ValidationItem[]): Promise<TaskValidationResult[]>;
}

/** Praxis's own export checks: the same checks the per-record Anvil export runs. Not Anvil's validation. */
export class PraxisPrecheckValidator implements AnvilTaskValidator {
  readonly name = 'praxis-precheck';
  readonly version = 'praxis.anvil.export.v1 checks';
  async validate(items: ValidationItem[]): Promise<TaskValidationResult[]> {
    return items.map((i) => ({
      recordId: i.record.id,
      taskId: i.taskId,
      title: i.title,
      status: i.envelope && !i.exportProblems.length ? 'valid' : 'needs_fix',
      issues: i.exportProblems,
    }));
  }
}

/** Builds the validation item for one record: the export envelope, or the reasons it cannot be built. */
export function validationItem(record: ApprovedTaskRecord, title: string, compileBlockers: { code: string; path: string; message: string }[]): ValidationItem {
  const base = { record, taskId: record.taskInstanceId, title };
  if (!hasExecutableContract(record)) {
    const problems = compileBlockers.length
      ? compileBlockers.map((b) => ({ code: b.code, path: b.path, message: b.message }))
      : [{ code: 'NO_EXECUTABLE_CONTRACT', path: null, message: 'This task has no executable Anvil contract.' }];
    return { ...base, envelope: null, exportProblems: problems };
  }
  try {
    return { ...base, envelope: praxisExport(record).envelope as unknown as Record<string, unknown>, exportProblems: [] };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const details = (e.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
    return { ...base, envelope: null, exportProblems: details.length ? details.map((d) => ({ code: e.code, path: d.path, message: d.message })) : [{ code: e.code, path: null, message: e.message }] };
  }
}
