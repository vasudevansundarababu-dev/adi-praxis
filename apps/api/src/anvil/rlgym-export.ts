import { policyClausesFor } from './clause-export';
import type { ApprovedTaskRecord, Template } from '@prisma/client';
import type { Db, Tx } from '../db';
import { anvilReadiness } from '../routes/anvil-templates';
import { jcsSha256 } from './jcs';
import { storeTaskPackage } from './task-package-store';

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
}
export interface NotSent {
  recordId: string;
  taskId: string;
  title: string;
  code: string;
  message: string;
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
  opts: { exported: boolean; held?: Map<string, string>; batches?: Map<string, string> },
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
    tasks.push({ recordId: r.id, taskId: r.taskInstanceId, title, revision: stored.revision, packageSha256: stored.packageSha256, correctsRevision, smeBatchId, complexity, archetype, edgeCase });
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
