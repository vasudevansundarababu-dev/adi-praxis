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

/** The generic Praxis export contract Anvil advertises under /contracts (Anvil's answer Q1, 11 Nov 2026). */
export const GENERIC_EXPORT_CONTRACTS = ['praxis.authored-task-export.v1'];

/** Every string value in Anvil's /contracts reply. Support is an exact ID among them, never a similar name (Anvil Q3). */
function advertisedIds(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => advertisedIds(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => advertisedIds(x, out));
  return out;
}

/**
 * Connected to Anvil (ANVIL_EXPORT_BASE_URL set). Discovers Anvil's contracts first. Until Anvil advertises the generic
 * Praxis export contract, no package is sent: each task keeps Praxis's own pre-check issues and is marked "not
 * validated by Anvil" with the exact reason (unsupported contract, authentication, availability). A task is never
 * reported valid unless Anvil returned that verdict.
 */
export class AnvilGatedValidator implements AnvilTaskValidator {
  readonly name = 'anvil-discovery+praxis-precheck';
  readonly version = 'praxis-anvil-contract-2026-11-12';
  private readonly pre = new PraxisPrecheckValidator();
  constructor(private readonly client: import('./export-client').AnvilExportClient) {}

  async validate(items: ValidationItem[]): Promise<TaskValidationResult[]> {
    const local = await this.pre.validate(items);
    const c = await this.client.contracts();
    let reason: { code: string; message: string };
    if (c.kind !== 'business') {
      reason = { code: `ANVIL_${c.kind.toUpperCase()}`, message: `${c.message}${c.requestId ? ` (Anvil request ${c.requestId})` : ''}` };
    } else {
      const advertised = advertisedIds(c.data);
      const generic = GENERIC_EXPORT_CONTRACTS.find((id) => advertised.has(id));
      reason = generic
        ? { code: 'ANVIL_PACKAGE_FORMAT_PENDING', message: `Anvil advertises ${generic}; Praxis sends packages once the package format is agreed (contract question 1).` }
        : { code: 'ANVIL_CONTRACT_UNAVAILABLE', message: `Anvil does not yet support generic Praxis task export (receiver_contract_unavailable)${c.requestId ? `; Anvil request ${c.requestId}` : ''}.` };
    }
    return local.map((r) => ({ ...r, status: r.status === 'needs_fix' ? 'needs_fix' : 'not_validated', issues: [...r.issues, { code: reason.code, path: null, message: reason.message }] }));
  }
}
