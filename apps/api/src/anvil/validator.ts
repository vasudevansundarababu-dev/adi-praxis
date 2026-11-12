import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { buildGenericPackages, GENERIC_EXPORT_SCHEMA, type PackagePart, type PackageProblem } from './generic-package';
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
  validate(items: ValidationItem[], ctx?: ValidationContext): Promise<TaskValidationResult[]>;
  /** Validators connected to Anvil also deliver: validate and, on export, resolve. */
  run?(items: ValidationItem[], ctx: ValidationContext | undefined, opts: { resolve: boolean }): Promise<ValidationOutcome>;
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

/** The generic Praxis export contract (Anvil's answer Q1 and four confirmations, point 3). */
export const GENERIC_EXPORT_CONTRACTS = [GENERIC_EXPORT_SCHEMA];

/** Exact discovery (four confirmations, point 3): the ID is in `data.contracts` and `data.enabled` is true. */
export function genericSupport(data: Record<string, unknown>): 'enabled' | 'disabled' | 'absent' {
  const list = Array.isArray(data.contracts) ? data.contracts.map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { id?: unknown }).id : null)) : [];
  if (!list.includes(GENERIC_EXPORT_SCHEMA)) return 'absent';
  return data.enabled === true ? 'enabled' : 'disabled';
}

/** Per-part record kept with the run: identifiers and hashes, Anvil's statuses and request IDs. Never content. */
export interface AnvilPartRecord {
  partIndex: number;
  partCount: number;
  packageId: string;
  packageSha256: string;
  zipSha256: string;
  bytes: number;
  recordIds: string[];
  validate: { kind: string; httpStatus: number | null; status: string; valid: boolean | null; errorCount: number; requestId: string | null; anvilPackageSha256: string | null };
  resolve?: { kind: string; httpStatus: number | null; status: string; idempotencyKey: string; requestId: string | null };
}
export interface AnvilRunRecord {
  contract: string;
  support: 'enabled' | 'disabled' | 'absent' | 'unreachable';
  batchId: string | null;
  parts: AnvilPartRecord[];
  problems: PackageProblem[];
}
export interface ValidationContext {
  projectId: string;
  /** Template versions by Template row ID (the record's templateId). */
  templates: Map<string, Template>;
}
export interface ValidationOutcome {
  results: TaskValidationResult[];
  anvil?: AnvilRunRecord;
  /** ZIPs sent, for an export run to keep (part index -> bytes). */
  zips?: Map<number, Buffer>;
}

type Issue = TaskValidationResult['issues'][number];
const asIssue = (code: string, message: string, path: string | null = null): Issue => ({ code, path, message });

/** Which task an Anvil error belongs to (its file or manifest pointer); null = the whole package. */
function errorTask(err: { file?: unknown; pointer?: unknown }, part: PackagePart): number[] | null {
  const file = typeof err.file === 'string' ? err.file : '';
  const m = /^(?:tasks|private)\/([^/]+)\//.exec(file);
  if (m) {
    const i = part.taskIds.indexOf(m[1]!);
    return i >= 0 ? [i] : null;
  }
  if (file.startsWith('forms/')) {
    const idx = (part.manifest.tasks as { form: { path: string } }[]).flatMap((t, i) => (t.form.path === file ? [i] : []));
    return idx.length ? idx : null;
  }
  const p = typeof err.pointer === 'string' ? /^\/tasks\/(\d+)(\/|$)/.exec(err.pointer) : null;
  return p ? [Number(p[1])] : null;
}

/**
 * Connected to Anvil (ANVIL_EXPORT_BASE_URL set). Discovers Anvil's contracts first; only when Anvil lists the exact
 * generic contract and has it enabled does Praxis build the generic packages and send them to Anvil's validate (and,
 * on export, resolve). Anvil's verdict is reported per task: its PX errors are what the author fixes; its AV
 * requirements are Anvil's own work and never a task repair. A task is never reported valid unless Anvil said so.
 */
export class AnvilGatedValidator implements AnvilTaskValidator {
  readonly name = 'anvil-discovery+praxis-precheck';
  readonly version = 'praxis.authored-task-export.v1 (four confirmations, 11 Nov 2026)';
  private readonly pre = new PraxisPrecheckValidator();
  constructor(private readonly client: import('./export-client').AnvilExportClient) {}

  async validate(items: ValidationItem[], ctx?: ValidationContext): Promise<TaskValidationResult[]> {
    return (await this.run(items, ctx, { resolve: false })).results;
  }

  async run(items: ValidationItem[], ctx: ValidationContext | undefined, opts: { resolve: boolean }): Promise<ValidationOutcome> {
    const local = await this.pre.validate(items);
    const notValidated = (code: string, message: string) => ({ results: local.map((r) => ({ ...r, status: r.status === 'needs_fix' ? ('needs_fix' as const) : ('not_validated' as const), issues: [...r.issues, asIssue(code, message)] })) });
    const c = await this.client.contracts();
    if (c.kind !== 'business') return { ...notValidated(`ANVIL_${c.kind.toUpperCase()}`, `${c.message}${c.requestId ? ` (Anvil request ${c.requestId})` : ''}`), anvil: { contract: GENERIC_EXPORT_SCHEMA, support: 'unreachable', batchId: null, parts: [], problems: [] } };
    const support = genericSupport(c.data);
    if (support !== 'enabled') {
      const msg = support === 'disabled' ? `Anvil lists ${GENERIC_EXPORT_SCHEMA} but has it switched off${c.requestId ? `; Anvil request ${c.requestId}` : ''}.` : `Anvil does not yet support generic Praxis task export (receiver_contract_unavailable)${c.requestId ? `; Anvil request ${c.requestId}` : ''}.`;
      return { ...notValidated(support === 'disabled' ? 'ANVIL_CONTRACT_DISABLED' : 'ANVIL_CONTRACT_UNAVAILABLE', msg), anvil: { contract: GENERIC_EXPORT_SCHEMA, support, batchId: null, parts: [], problems: [] } };
    }
    if (!ctx) return notValidated('ANVIL_NO_CONTEXT', 'Praxis did not supply the template versions needed to build the package.');

    // From here Anvil's generic verdict is the result; the per-record Golden pre-check concerns another contract.
    const results = new Map<string, TaskValidationResult>(items.map((i) => [i.record.id, { recordId: i.record.id, taskId: i.taskId, title: i.title, status: 'not_validated', issues: [] }]));
    const inputs = items.flatMap((i) => {
      const template = ctx.templates.get(i.record.templateId);
      if (template) return [{ record: i.record, template }];
      const r = results.get(i.record.id)!;
      r.status = 'not_validated';
      r.issues.push(asIssue('GENERIC_TEMPLATE_MISSING', 'The task’s template version could not be loaded.'));
      return [];
    });
    const built = buildGenericPackages(inputs, { projectId: ctx.projectId });
    for (const p of built.problems) {
      const r = results.get(p.recordId)!;
      r.status = 'not_validated';
      r.issues.push(asIssue(p.code, p.message));
    }
    const record: AnvilRunRecord = { contract: GENERIC_EXPORT_SCHEMA, support, batchId: built.batchId, parts: [], problems: built.problems };
    const zips = new Map<number, Buffer>();
    for (const part of built.parts) {
      zips.set(part.partIndex, part.zip);
      const v = await this.client.validate(part.zip);
      const pr: AnvilPartRecord = {
        partIndex: part.partIndex,
        partCount: part.partCount,
        packageId: part.packageId,
        packageSha256: part.packageSha256,
        zipSha256: part.zipSha256,
        bytes: part.zip.length,
        recordIds: part.recordIds,
        validate: v.kind === 'business'
          ? { kind: v.kind, httpStatus: v.httpStatus, status: v.status, valid: v.valid, errorCount: Number(v.data.error_count ?? (Array.isArray(v.data.errors) ? v.data.errors.length : 0)), requestId: v.requestId, anvilPackageSha256: typeof v.data.package_sha256 === 'string' ? v.data.package_sha256 : null }
          : { kind: v.kind, httpStatus: v.httpStatus, status: v.code, valid: null, errorCount: 0, requestId: v.requestId, anvilPackageSha256: null },
      };
      record.parts.push(pr);
      const tasks = part.recordIds.map((id) => results.get(id)!);
      if (v.kind !== 'business') {
        for (const r of tasks) {
          r.status = 'not_validated';
          r.issues.push(asIssue(`ANVIL_${v.kind.toUpperCase()}`, `${v.message}${v.requestId ? ` (Anvil request ${v.requestId})` : ''}`));
        }
        continue;
      }
      // Anvil's errors: per task where the file or pointer says so, otherwise for the whole package.
      const errors = (Array.isArray(v.data.errors) ? v.data.errors : []) as { code?: string; file?: string; pointer?: string; message?: string; fix?: string }[];
      const perTask = new Map<number, Issue[]>();
      const whole: Issue[] = [];
      for (const e of errors) {
        const issue = asIssue(String(e.code ?? 'PX_UNKNOWN'), [e.message, e.fix].filter(Boolean).join(' Fix: '), [e.file, e.pointer].filter(Boolean).join('#') || null);
        const idx = errorTask(e, part);
        if (idx) for (const i of idx) perTask.set(i, [...(perTask.get(i) ?? []), issue]);
        else whole.push(issue);
      }
      const reqs = (Array.isArray(v.data.anvil_requirements) ? v.data.anvil_requirements : []) as { code?: string; task_id?: string }[];
      tasks.forEach((r, i) => {
        const own = [...whole, ...(perTask.get(i) ?? [])];
        const anvilWork = reqs.filter((q) => !q.task_id || q.task_id === part.taskIds[i]).map((q) => asIssue(String(q.code), 'Anvil’s own work (not a task repair); the source is checked separately.'));
        r.status = v.valid === true ? 'valid' : v.valid === false ? (own.length ? 'needs_fix' : 'valid') : 'not_validated';
        r.issues.push(...own, ...anvilWork);
        if (v.valid === null && !anvilWork.length) r.issues.push(asIssue('ANVIL_VALIDATION_BLOCKED', `Anvil could not validate this package (${v.status}).`));
      });
      // Resolve (export only): the same ZIP once Anvil found it valid; the key is the package hash, so a retry of the
      // same content is the same request, and a changed package is a new one. Resolution never starts a Run.
      if (opts.resolve && v.valid === true) {
        const key = `praxis-${part.packageSha256}`;
        const rs = await this.client.resolve(part.zip, key);
        pr.resolve = rs.kind === 'business' ? { kind: rs.kind, httpStatus: rs.httpStatus, status: rs.status, idempotencyKey: key, requestId: rs.requestId } : { kind: rs.kind, httpStatus: rs.httpStatus, status: rs.code, idempotencyKey: key, requestId: rs.requestId };
        const note = rs.kind === 'business' ? (rs.status === 'import_resolved' ? asIssue('ANVIL_RESOLVED', `Anvil took the package in (${rs.status}); no Run was started.`) : asIssue('ANVIL_RESOLVE_BLOCKED', `Anvil did not take the package in (${rs.status}); this is Anvil’s work, not a task repair.`)) : asIssue(`ANVIL_${rs.kind.toUpperCase()}`, `Resolve: ${rs.message}${rs.requestId ? ` (Anvil request ${rs.requestId})` : ''}`);
        for (const r of tasks) r.issues.push(note);
        if (rs.kind === 'business') for (const q of (Array.isArray(rs.data.anvil_requirements) ? rs.data.anvil_requirements : []) as { code?: string; task_id?: string }[]) for (const [i, r] of tasks.entries()) if (!q.task_id || q.task_id === part.taskIds[i]) r.issues.push(asIssue(String(q.code), 'Anvil’s own work before intake (not a task repair).'));
      }
    }
    return { results: items.map((i) => results.get(i.record.id)!), anvil: record, zips };
  }
}
