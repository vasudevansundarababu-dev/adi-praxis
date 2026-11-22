import { RLGYM_EXPORT_SCHEMA, type ExportTaskDto, type NotSentDto } from '@praxis/shared';
import type { ApprovedTaskRecord, Template } from '@prisma/client';
import type { Db, Tx } from '../db';
import { anvilReadiness } from '../routes/anvil-templates';
import { jcsSha256 } from './jcs';
import { storeTaskPackage } from './task-package-store';

/**
 * The `rlgym.project-export.v1` body for a project's current approved tasks (docs/design/FORGE-RLGYM-V2-DESIGN.md
 * part 2; AUTHORING-SNAPSHOT §3.2 a). The package content is not in the body: the RL Gym fetches each package from
 * ADI Forge by `package_sha256` (part 1). `export_sha256` is the SHA-256 of the canonical body without that field;
 * the body holds only strings, integers and arrays of them, so it equals the RL Gym's own hash of the body.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
export const titleOf = (r: ApprovedTaskRecord) => String((r.output as { header?: { title?: unknown } } | null)?.header?.title ?? '') || `Task ${r.taskInstanceId.slice(0, 8)}`;

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
 * form field it fills (KYC: `S1.applicationType` → `application_type`), the slot's other coverage values, and its edge
 * case. Null when the task has neither a case nor coverage values.
 */
export function caseSelectorOf(record: ApprovedTaskRecord): Record<string, unknown> | null {
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
  out.edge_cases = typeof slot.edgeCase === 'string' && slot.edgeCase ? [slot.edgeCase] : [];
  return out;
}

export interface BuiltExport {
  body: Record<string, unknown>;
  exportSha256: string;
  exportId: string;
  reason: string;
  tasks: ExportTaskDto[];
  notSent: NotSentDto[];
}

/**
 * Builds the export and makes sure every sent task's package is stored (and committed by the caller) before the RL Gym
 * is called, since the RL Gym fetches them during the call. The export ID is derived from the content, so pressing
 * Export again with nothing changed sends the same export and the RL Gym replays its receipt.
 */
export async function buildRlGymExport(
  tx: Db | Tx,
  p: { id: string; name: string; template: Template },
  records: ApprovedTaskRecord[],
  ref: { id: string; version: number; specSha256: string },
  opts: { exported: boolean; corrections?: Map<string, string>; held?: Set<string> },
): Promise<BuiltExport> {
  const tasks: ExportTaskDto[] = [];
  const notSent: NotSentDto[] = [];
  const wire: Record<string, unknown>[] = [];
  for (const r of records) {
    const title = titleOf(r);
    if (opts.held?.has(r.taskInstanceId)) {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: 'WAITING_FOR_NEW_CASE_KIND', message: 'Waiting for a new kind of case: a need about this task is open or with Studio. The PM resolves it to export the task.' });
      continue;
    }
    const selector = caseSelectorOf(r);
    if (!selector) {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: 'CASE_SELECTOR_MISSING', message: 'The task has no case (no slot case or coverage values), so RL Gym cannot match it to a case.' });
      continue;
    }
    const stored = await storeTaskPackage(tx, r);
    if (stored.status === 'problem') {
      notSent.push({ recordId: r.id, taskId: r.taskInstanceId, title, code: stored.problem.code, message: stored.problem.message });
      continue;
    }
    const correctsRevision = stored.revision > 1 ? stored.revision - 1 : null;
    tasks.push({ recordId: r.id, taskId: r.taskInstanceId, title, revision: stored.revision, packageSha256: stored.packageSha256, correctsRevision });
    wire.push({
      schema: 'praxis.authored-task-export.v1',
      task_id: r.taskInstanceId,
      revision: stored.revision,
      title,
      ...(correctsRevision ? { corrects_revision: correctsRevision } : {}),
      // The SME review batch whose "task needs correction" led to this revision (part 3), when there was one.
      ...(correctsRevision && opts.corrections?.get(r.taskInstanceId) ? { sme_batch_id: opts.corrections.get(r.taskInstanceId) } : {}),
      package_sha256: stored.packageSha256,
      package_ref: `forge://packages/${stored.packageSha256}`,
      case_selector: selector,
    });
  }
  const template = { id: ref.id, version: ref.version, spec_sha256: ref.specSha256, forge_template_id: p.template.lineageId, forge_version: p.template.version };
  const project_config = { mode: p.template.agentMode === 'MULTI' ? 'multi_agent' : 'single_agent' };
  const reason = opts.exported ? `re-export of ${p.name}` : `first export of ${p.name}`;
  // The ID covers everything the body carries, so one export ID never stands for two different bodies (the RL Gym
  // refuses that as an idempotency conflict).
  const exportId = `exp-${jcsSha256({ project: p.id, name: p.name, template, project_config, reason, tasks: wire }).slice(0, 16)}`;
  const body: Record<string, unknown> = { schema: RLGYM_EXPORT_SCHEMA, project_id: p.id, project_name: p.name, template, project_config, export_id: exportId, reason, tasks: wire };
  const exportSha256 = jcsSha256(body);
  body.export_sha256 = exportSha256;
  return { body, exportSha256, exportId, reason, tasks, notSent };
}
