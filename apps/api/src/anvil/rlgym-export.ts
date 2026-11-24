import { policyClausesFor } from './clause-export';
import type { ApprovedTaskRecord, Template } from '@prisma/client';
import type { Db, Tx } from '../db';
import { anvilReadiness } from '../routes/anvil-templates';
import { jcsSha256 } from './jcs';
import { storeTaskPackage } from './task-package-store';
import { OWNER_LABEL, TASK_CHECKER, TASK_CHECKER_VERSION, type TaskCheckReport, type TaskProblem } from '../tasks/task-integrity';

/**
 * The `rlgym.project-export.v1` body for a project's current approved tasks (AUTHORING-SNAPSHOT 3.2 a; AUTHORING-SPEC
 * 1.6). The package content is not in the body: the RL Gym fetches each package from Authoring by `package_sha256`.
 * `export_sha256` is the SHA-256 of the canonical body without that field. The body holds only strings, integers and
 * arrays of them, so RFC 8785 equals the RL Gym's sorted-key compact JSON and both hashes agree.
 */
export const RLGYM_EXPORT_SCHEMA = 'rlgym.project-export.v1' as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
/**
 * The RL Gym's project ID for an Authoring project. The RL Gym accepts only `prj_[a-z0-9]{4,40}` (its database check),
 * and Authoring's IDs are UUIDs, so the export sends `prj_` + the UUID's 32 hex digits. Reversible: the RL Gym's calls
 * back (run reviews) name the same ID, and `projectIdFromRlGym` turns it into the UUID again.
 */
export const rlgymProjectId = (uuid: string) => `prj_${uuid.toLowerCase().replace(/-/g, '')}`;
export function projectIdFromRlGym(id: string): string | null {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id.toLowerCase();
  const m = /^prj_([0-9a-f]{32})$/.exec(id);
  return m ? m[1]!.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') : null;
}

export const titleOf = (r: ApprovedTaskRecord) => String((r.output as { header?: { title?: unknown } } | null)?.header?.title ?? '') || `Task ${r.taskInstanceId.slice(0, 8)}`;

export interface ExportTask {
  recordId: string;
  taskId: string;
  title: string;
  revision: number;
  packageSha256: string;
  correctsRevision: number | null;
  smeBatchId: string | null;
  complexity: string | null;
  archetype: string | null;
  edgeCase: string | null;
  /** E-007 phase 2: digests for the receipt (the record's content hash, the frozen snapshot, the check report). */
  contentHash?: string;
  snapshotSha256?: string | null;
  checkReportSha256?: string | null;
  /** Approved before the stronger checks: sent, with its warnings, never blocked. */
  checksGap?: boolean;
  warnings?: string[];
}
export interface NotSent {
  recordId: string;
  taskId: string;
  title: string;
  code: string;
  message: string;
  /** E-007 phase 2: the failing checks, with section, field, who fixes them and whether trying again helps. */
  problems?: TaskProblem[];
}

/** The RL Gym's identity of a template version: from its standing qualification receipt, or null when not qualified. */
export async function rlgymTemplateRef(db: Db | Tx, t: Template): Promise<{ id: string; version: number; specSha256: string } | null> {
  const r = await anvilReadiness(db, t);
  if (r.qualification !== 'qualified' || !r.receiptId) return null;
  const q = await db.templateQualification.findFirst({ where: { templateId: t.id, receiptId: r.receiptId, status: 'QUALIFIED' }, orderBy: { createdAt: 'desc' } });
  const receipt = isObj(q?.receipt) ? q!.receipt : {};
  const id = receipt.rlgym_template_id;
  const version = receipt.rlgym_template_version;
  const spec = receipt.spec_sha256;
  if (typeof id !== 'string' || !Number.isInteger(version) || typeof spec !== 'string') return null;
  return { id, version: version as number, specSha256: spec };
}

/**
 * The task's case, as the RL Gym matches tasks to cases: the slot's selector value under the snake-cased name of the
 * form field it fills (KYC: `S1.applicationType` → `application_type`), the slot's other coverage values, and its
 * edge cases (the slot's, plus the edge case the SME focused the task on). Null when the task has no case at all.
 */
export function caseSelectorOf(record: ApprovedTaskRecord, focus: string | null = null): Record<string, unknown> | null {
  const slot = isObj(record.input) && isObj(record.input.slot) ? record.input.slot : {};
  const out: Record<string, unknown> = {};
  if (isObj(slot.tags)) for (const [k, v] of Object.entries(slot.tags)) if (typeof v === 'string' && v) out[snake(k)] = v;
  if (isObj(slot.case) && typeof slot.case.value === 'string') {
    const source = typeof slot.case.source === 'string' ? slot.case.source.split('.').pop() : undefined;
    const field = typeof slot.case.field === 'string' ? slot.case.field : undefined;
    if (field) delete out[snake(field)];
    out[snake(source || field || 'case')] = slot.case.value;
  }
  if (!Object.keys(out).length) return null;
  const edges = [...(typeof slot.edgeCase === 'string' && slot.edgeCase ? [slot.edgeCase] : []), ...(focus ? [focus] : [])];
  out.edge_cases = [...new Set(edges)];
  return out;
}

export interface BuiltExport {
  body: Record<string, unknown>;
  exportSha256: string;
  exportId: string;
  reason: string;
  tasks: ExportTask[];
  notSent: NotSent[];
}

/**
 * Builds the export and makes sure every sent task's package is stored (and committed by the caller) before the RL Gym
 * is called, since the RL Gym fetches them during the call. The export ID is derived from the content, so pressing
 * Export again with nothing changed sends the same export and the RL Gym replays its receipt.
 * `held` maps a task to the Studio item it waits for (a sent `new_case_kind` need): such tasks are not sent.
 * `batches` maps a task to the SME review batch whose `task_correction` reopened it (sent with revisions above 1).
 */
export async function buildRlGymExport(
  tx: Db | Tx,
  p: { id: string; name: string; template: Template },
  records: ApprovedTaskRecord[],
  ref: { id: string; version: number; specSha256: string },
  opts: { exported: boolean; held?: Map<string, string>; batches?: Map<string, string>; reports?: Map<string, TaskCheckReport> },
): Promise<BuiltExport> {
  const tasks: ExportTask[] = [];
  const notSent: NotSent[] = [];
  const wire: Record<string, unknown>[] = [];
  for (const r of records) {
    const title = titleOf(r);
    const waiting = opts.held?.get(r.taskInstanceId);
    if (waiting) {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: 'WAITING_FOR_NEW_CASE_KIND', message: `Waiting for new case kind ${waiting}. Move the project to the template version that has it.` });
      continue;
    }
    // E-007 phase 2: a task whose frozen snapshot fails a blocking check is not sent; the PM sees why and who fixes it.
    const report = opts.reports?.get(r.id);
    const failing = report?.problems.filter((x) => x.severity === 'blocking') ?? [];
    if (failing.length) {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: 'CHECKS_FAILED', message: failing.map((x) => `${x.section}: ${x.message} (to fix: ${OWNER_LABEL[x.owner]})`).join(' · '), problems: failing });
      continue;
    }
    const stored = await storeTaskPackage(tx, r);
    if (stored.status === 'problem') {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: stored.problem.code, message: stored.problem.message });
      continue;
    }
    const pkg = await tx.authoredTaskPackage.findUnique({ where: { recordId: r.id }, select: { content: true } });
    const priv = (pkg ? ((JSON.parse(pkg.content) as { private?: Record<string, unknown> }).private ?? {}) : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const complexity = str(priv.complexity);
    const archetype = str(priv.archetype);
    const edgeCase = str(priv.edge_case);
    const selector = caseSelectorOf(r, edgeCase);
    if (!selector) {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: 'CASE_SELECTOR_MISSING', message: 'The task has no case (no slot case or coverage values), so RL Gym cannot match it to a case.' });
      continue;
    }
    const policyClauses = await policyClausesFor(tx, r);
    const correctsRevision = stored.revision > 1 ? stored.revision - 1 : null;
    const smeBatchId = correctsRevision ? (opts.batches?.get(r.taskInstanceId) ?? null) : null;
    tasks.push({ recordId: r.id, taskId: r.taskInstanceId, title, revision: stored.revision, packageSha256: stored.packageSha256, correctsRevision, smeBatchId, complexity, archetype, edgeCase, contentHash: r.contentHash, snapshotSha256: report?.snapshotSha256 ?? null, checkReportSha256: report ? jcsSha256(report) : null, ...(report?.gap ? { checksGap: true, warnings: report.problems.map((x) => x.code) } : {}) });
    wire.push({
      schema: 'praxis.authored-task-export.v1',
      task_id: r.taskInstanceId,
      revision: stored.revision,
      title,
      ...(correctsRevision ? { corrects_revision: correctsRevision, ...(smeBatchId ? { sme_batch_id: smeBatchId } : {}) } : {}),
      package_sha256: stored.packageSha256,
      package_ref: `forge://packages/${stored.packageSha256}`,
      case_selector: selector,
      // AUTHORING-SPEC 1.6: slice tags and the optional edge case the task focuses on.
      ...(complexity ? { complexity } : {}),
      ...(archetype ? { archetype } : {}),
      ...(edgeCase ? { edge_case: edgeCase } : {}),
      // E-002 (Studio ef06119): the approved clause versions selected in S4, pinned as approved. Only when there are any.
      ...(policyClauses.length ? { policy_clauses: policyClauses.map((c) => c.entry) } : {}),
    });
  }
  const template = { id: ref.id, version: ref.version, spec_sha256: ref.specSha256, forge_template_id: p.template.lineageId, forge_version: p.template.version };
  const project_config = { mode: p.template.agentMode === 'MULTI' ? 'multi_agent' : 'single_agent' };
  const reason = opts.exported ? `re-export of ${p.name}` : `first export of ${p.name}`;
  // The ID covers everything the body carries, so one export ID never stands for two different bodies (the RL Gym
  // refuses that as an idempotency conflict).
  const projectId = rlgymProjectId(p.id);
  const exportId = `exp-${jcsSha256({ project: projectId, name: p.name, template, project_config, reason, tasks: wire }).slice(0, 16)}`;
  const body: Record<string, unknown> = { schema: RLGYM_EXPORT_SCHEMA, project_id: projectId, project_name: p.name, template, project_config, export_id: exportId, reason, tasks: wire };
  const exportSha256 = jcsSha256(body);
  body.export_sha256 = exportSha256;
  return { body, exportSha256, exportId, reason, tasks, notSent };
}

export const EXPORT_RECEIPT_SCHEMA = 'praxis.export-receipt.v1' as const;

/**
 * E-007 phase 2: the receipt ADI Forge issues with an Export for benchmark, kept with the run (not sent; the RL Gym
 * keeps its own receipt). It binds the export's digest to every task sent: its approved record and content hash, its
 * package, the frozen snapshot the checks ran on and the check report. `receipt_sha256` is the JCS SHA-256 of the rest.
 * Unsigned for now: signing with a key registry is phase 7.
 */
export function exportReceipt(built: BuiltExport, issuedAt: Date): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schema: EXPORT_RECEIPT_SCHEMA,
    issuer: 'adi-forge-authoring',
    export_id: built.exportId,
    export_sha256: built.exportSha256,
    project_id: built.body.project_id,
    template: built.body.template,
    checker: { id: TASK_CHECKER, version: TASK_CHECKER_VERSION },
    issued_at: issuedAt.toISOString(),
    tasks: built.tasks.map((t) => ({ task_id: t.taskId, revision: t.revision, record_id: t.recordId, record_content_hash: t.contentHash ?? null, package_sha256: t.packageSha256, snapshot_sha256: t.snapshotSha256 ?? null, check_report_sha256: t.checkReportSha256 ?? null, checks: t.checksGap ? 'approved_before_stronger_checks' : 'pass', ...(t.warnings?.length ? { warnings: t.warnings } : {}) })),
    not_sent: built.notSent.map((n) => ({ task_id: n.taskId, record_id: n.recordId, code: n.code, checks: (n.problems ?? []).map((p) => p.code) })),
    signature: null,
  };
  return { ...body, receipt_sha256: jcsSha256(body) };
}

export type RlGymTaskAnswer = 'accepted' | 'duplicate' | 'rejected' | 'not_answered';

/**
 * The RL Gym's answer for each task of an export, in Authoring's words. Its receipt gives counts, not a list, so a
 * task is a duplicate when the same revision was received in an earlier export, rejected when the RL Gym blocked it
 * (or refused the whole export), and accepted otherwise. A replayed receipt means the whole export was a duplicate.
 */
export function rlgymTaskAnswers(run: { outcome: string; tasks: unknown; receipt: unknown; createdAt: Date }, earlier: { outcome: string; tasks: unknown; createdAt: Date }[]): Record<string, RlGymTaskAnswer> {
  const tasks = (Array.isArray(run.tasks) ? run.tasks : []) as { taskId: string; revision: number }[];
  const out: Record<string, RlGymTaskAnswer> = {};
  if (run.outcome === 'rejected') { for (const t of tasks) out[t.taskId] = 'rejected'; return out; }
  if (run.outcome !== 'received') { for (const t of tasks) out[t.taskId] = 'not_answered'; return out; }
  const receipt = (run.receipt ?? {}) as { blocked?: { taskId: string }[]; replayed?: boolean };
  const blocked = new Set((receipt.blocked ?? []).map((b) => b.taskId));
  const before = new Set(earlier.filter((e) => e.outcome === 'received' && e.createdAt < run.createdAt).flatMap((e) => ((Array.isArray(e.tasks) ? e.tasks : []) as { taskId: string; revision: number }[]).map((t) => `${t.taskId}#${t.revision}`)));
  for (const t of tasks) out[t.taskId] = blocked.has(t.taskId) ? 'rejected' : receipt.replayed || before.has(`${t.taskId}#${t.revision}`) ? 'duplicate' : 'accepted';
  return out;
}
