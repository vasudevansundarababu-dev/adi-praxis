import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { jcsSha256 } from '../anvil/jcs';
import { actorProjection, buildGenericPackages, GENERIC_EXPORT_SCHEMA, taskAssetHashes, type PackageProblem } from '../anvil/generic-package';
import { jointTemplateSpec } from '../anvil/joint-template';
import { TOOL_UNDECLARED, undeclaredTools } from '../anvil/tool-binding';
import type { Db } from '../db';

/**
 * TS-17: the offline export of approved tasks in RL Gym's real import format (`praxis.authored-task-export.v1`), built
 * by the same `buildGenericPackages` path the online export uses: root `praxis-export.json`, the declared form, actor
 * and private files, exact template and record references, and `execution {location: anvil_only, paid_calls: false}`.
 * Nothing is sent to RL Gym; the ZIPs go to a directory or to object storage for someone to hand over. Read-only: it
 * changes no task, record or template. Each part is checked against RL Gym's archive bounds, its own manifest and the
 * portable conformance checks (declared tools, actor/private separation) before anything is written. A corrected task
 * (tool-binding correction, APR-13) also gets a change record next to the ZIP.
 */

/** RL Gym's generic archive bounds (four confirmations; KYC v8 review, 18 Nov 2026). */
export const ARCHIVE_BOUNDS = { compressedBytes: 1_048_576, expandedBytes: 30 * 1_048_576, fileBytes: 10 * 1_048_576, entries: 1200 } as const;

interface Entry {
  path: string;
  method: number;
  compressed: number;
  size: number;
  flags: number;
  bytes: Buffer | null;
}

/** Reads every central-directory entry (and its data, for STORE/DEFLATE) without trusting the sizes for allocation. */
function entries(zip: Buffer): Entry[] | string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) return 'not a ZIP archive (no end of central directory)';
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) return 'bad central directory';
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const path = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    let bytes: Buffer | null = null;
    if ((method === 0 || method === 8) && size <= ARCHIVE_BOUNDS.fileBytes && localAt + 30 <= zip.length) {
      const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
      const raw = zip.subarray(dataAt, dataAt + compressed);
      try {
        bytes = method === 8 ? inflateRawSync(raw, { maxOutputLength: ARCHIVE_BOUNDS.fileBytes }) : Buffer.from(raw);
      } catch {
        bytes = null;
      }
    }
    out.push({ path, method, compressed, size, flags, bytes });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
/** A safe relative path: no absolute path, drive, backslash, empty, dot or dot-dot segment, or directory entry. */
export const safeArchivePath = (p: string) => !!p && !p.startsWith('/') && !p.endsWith('/') && !p.includes('\\') && p.split('/').every((s) => SAFE_SEGMENT.test(s) && s !== '.' && s !== '..');

/** Every way a ZIP breaks RL Gym's archive bounds (empty when it conforms). */
export function archiveProblems(zip: Buffer): string[] {
  const problems: string[] = [];
  if (zip.length > ARCHIVE_BOUNDS.compressedBytes) problems.push(`compressed size ${zip.length} exceeds ${ARCHIVE_BOUNDS.compressedBytes} bytes`);
  const list = entries(zip);
  if (typeof list === 'string') return [...problems, list];
  if (list.length > ARCHIVE_BOUNDS.entries) problems.push(`${list.length} entries exceed ${ARCHIVE_BOUNDS.entries}`);
  const seen = new Set<string>();
  let expanded = 0;
  for (const e of list) {
    if (!safeArchivePath(e.path)) problems.push(`unsafe path "${e.path}"`);
    const key = e.path.toLowerCase();
    if (seen.has(key)) problems.push(`duplicate path "${e.path}"`);
    seen.add(key);
    if (e.method !== 0 && e.method !== 8) problems.push(`"${e.path}" uses compression method ${e.method} (only STORE or DEFLATE)`);
    if (e.flags & 0x1) problems.push(`"${e.path}" is encrypted`);
    if (e.size > ARCHIVE_BOUNDS.fileBytes) problems.push(`"${e.path}" is ${e.size} bytes, over ${ARCHIVE_BOUNDS.fileBytes}`);
    if (e.bytes && e.bytes.length !== e.size) problems.push(`"${e.path}" expands to ${e.bytes.length} bytes, not the declared ${e.size}`);
    expanded += e.size;
  }
  if (expanded > ARCHIVE_BOUNDS.expandedBytes) problems.push(`expanded size ${expanded} exceeds ${ARCHIVE_BOUNDS.expandedBytes} bytes`);
  return problems;
}

/**
 * Self-check of one package against its own manifest: root `praxis-export.json`, every declared form, actor and private
 * file present with the declared JCS SHA-256, nothing undeclared, and the execution block RL Gym requires.
 */
export function packageProblems(zip: Buffer): string[] {
  const list = entries(zip);
  if (typeof list === 'string') return [list];
  const files = new Map(list.map((e) => [e.path, e.bytes]));
  const rootBytes = files.get('praxis-export.json');
  if (!rootBytes) return ['no root praxis-export.json'];
  const problems: string[] = [];
  const manifest = JSON.parse(rootBytes.toString('utf8')) as { schema_version?: string; execution?: unknown; tasks?: { form: { path: string; sha256: string }; actor: { path: string; sha256: string }; private_assets: { path: string; sha256: string }[]; template?: { id?: string; version?: number; sha256?: string }; revision_id?: string }[] };
  if (manifest.schema_version !== GENERIC_EXPORT_SCHEMA) problems.push(`schema_version is ${String(manifest.schema_version)}`);
  if (JSON.stringify(manifest.execution) !== JSON.stringify({ location: 'anvil_only', paid_calls: false })) problems.push('execution must be {location: anvil_only, paid_calls: false}');
  const declared = new Set(['praxis-export.json']);
  for (const t of manifest.tasks ?? []) {
    if (!t.template?.id || !t.template.version || !t.template.sha256 || !t.revision_id) problems.push('a task entry lacks its exact template or revision reference');
    for (const ref of [t.form, t.actor, ...t.private_assets]) {
      declared.add(ref.path);
      const b = files.get(ref.path);
      if (!b) problems.push(`declared file ${ref.path} is missing`);
      else if (jcsSha256(JSON.parse(b.toString('utf8'))) !== ref.sha256) problems.push(`${ref.path} does not match its declared sha256`);
    }
  }
  for (const p of files.keys()) if (!declared.has(p)) problems.push(`undeclared file ${p}`);
  return problems;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const PRIVATE_VISIBILITIES = new Set(['private_reference', 'private_rubric', 'evaluation_private']);
type FormField = { key: string; type: string; visibility?: string; itemFields?: FormField[] };

/** Every value in actor.json that is not a public field of the form (a private or criterion field, or one the form lacks). */
export function actorPrivateFields(form: Record<string, unknown>, actor: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (defs: FormField[], values: unknown, at: string) => {
    if (!isObj(values)) return;
    for (const [k, v] of Object.entries(values)) {
      const f = defs.find((d) => d.key === k);
      if (!f) out.push(`${at}/${k} is not a field of the form`);
      else if (PRIVATE_VISIBILITIES.has(f.visibility ?? '') || f.type === 'criterion') out.push(`${at}/${k} is a private field`);
      else if (f.itemFields?.length && Array.isArray(v)) v.forEach((item, i) => walk(f.itemFields!, item, `${at}/${k}/${i}`));
    }
  };
  const sections = (form.sections as { key: string; fields?: FormField[] }[] | undefined) ?? [];
  for (const [key, values] of Object.entries(isObj(actor.sections) ? actor.sections : {})) {
    const s = sections.find((x) => x.key === key);
    if (!s) out.push(`/sections/${key} is not a section of the form`);
    else walk(s.fields ?? [], values, `/sections/${key}`);
  }
  return out;
}

/**
 * The portable conformance checks RL Gym runs at intake, on the package's own bytes (KYC v8 tool-binding request,
 * 20 Nov 2026): each task's procedure tools are declared by its template (APR-13d), actor.json is exactly the public
 * projection of the private reference with no private field in it, and private assets stay under `private/`.
 * (Declared asset hashes are `packageProblems`.)
 */
export function conformanceProblems(zip: Buffer, executionOf: (template: { id?: string; version?: number }) => unknown): string[] {
  const list = entries(zip);
  if (typeof list === 'string') return [list];
  const files = new Map(list.map((e) => [e.path, e.bytes]));
  const read = (p: string) => {
    const b = files.get(p);
    return b ? (JSON.parse(b.toString('utf8')) as Record<string, unknown>) : null;
  };
  const manifest = read('praxis-export.json');
  if (!manifest) return ['no root praxis-export.json'];
  const problems: string[] = [];
  for (const t of (manifest.tasks as { task_id: string; template: { id?: string; version?: number }; form: { path: string }; actor: { path: string }; private_assets: { path: string }[] }[]) ?? []) {
    const form = read(t.form.path);
    const actor = read(t.actor.path);
    const refs = t.private_assets.map((a) => ({ path: a.path, body: read(a.path) }));
    if (!form || !actor || !refs.length || refs.some((r) => !r.body)) {
      problems.push(`task ${t.task_id}: a declared file is missing`);
      continue;
    }
    for (const r of refs) if (!r.path.startsWith('private/')) problems.push(`task ${t.task_id}: private asset ${r.path} is outside private/`);
    if (!t.actor.path.startsWith('tasks/')) problems.push(`task ${t.task_id}: actor.json ${t.actor.path} is outside tasks/`);
    const authored = refs[0]!.body!.authored as Record<string, unknown> | undefined;
    if (!isObj(authored)) {
      problems.push(`task ${t.task_id}: the private reference has no authored record`);
      continue;
    }
    for (const u of undeclaredTools(executionOf(t.template), authored.sections)) problems.push(`task ${t.task_id}: ${TOOL_UNDECLARED} /authored${u.pointer} "${String(u.value)}" is not one of the template's execution.tools IDs`);
    for (const f of actorPrivateFields(form, actor)) problems.push(`task ${t.task_id}: actor.json ${f}`);
    if (jcsSha256(actor) !== jcsSha256(actorProjection(form, authored))) problems.push(`task ${t.task_id}: actor.json is not the public projection of its private reference`);
  }
  return problems;
}

export const CHANGE_RECORD_SCHEMA = 'adi-forge.tool-binding-change-record.v1';

interface Lineage {
  schema?: string;
  predecessor: { recordId: string; contentHash: string; actorSha256: string | null; referenceSha256: string | null };
  template: Record<string, unknown>;
  changes: { pointer: string; old: string; new: string; justification: string; approval: string; capabilityGap?: string }[];
  approvals: Record<string, unknown>[];
  capabilityGaps: Record<string, unknown>[];
  request?: Record<string, unknown>;
}

/**
 * One change record per corrected task in a package (a task whose approved record carries a tool-binding correction):
 * predecessor and successor record IDs and content hashes, each pointer with its old and new value and justification,
 * the approvals and capability gaps, and the asset hashes before and after. Null when the part has no corrected task.
 */
async function changeRecord(db: Db, part: { packageId: string; zipSha256: string; packageSha256: string; manifest: Record<string, unknown>; recordIds: string[] }, records: Map<string, ApprovedTaskRecord>, templates: Map<string, Template>) {
  const problems: string[] = [];
  const tasks: Record<string, unknown>[] = [];
  let request: Record<string, unknown> | null = null;
  const entries = part.manifest.tasks as { task_id: string; revision_id: string; actor: { sha256: string }; private_assets: { sha256: string }[]; review: { receipt_ref: string } }[];
  for (const [i, recordId] of part.recordIds.entries()) {
    const r = records.get(recordId)!;
    const l = (r.input as { toolBindingCorrection?: Lineage } | null)?.toolBindingCorrection;
    if (!l) continue;
    request ??= l.request ?? null;
    const e = entries[i]!;
    const pred = await db.approvedTaskRecord.findUnique({ where: { id: l.predecessor.recordId } });
    if (!pred || pred.taskInstanceId !== r.taskInstanceId || pred.contentHash !== l.predecessor.contentHash || pred.seq >= r.seq) {
      problems.push(`task ${r.taskInstanceId}: its predecessor record ${l.predecessor.recordId} does not match the correction's lineage`);
      continue;
    }
    const before = taskAssetHashes({ record: pred, template: templates.get(pred.templateId)! }, { checkTools: false });
    const predecessorHashes = 'code' in before ? { actor_sha256: l.predecessor.actorSha256, reference_sha256: l.predecessor.referenceSha256 } : { actor_sha256: before.actor, reference_sha256: before.reference };
    tasks.push({
      task_id: r.taskInstanceId,
      predecessor: { record_id: pred.id, content_hash: pred.contentHash, ...predecessorHashes },
      successor: { record_id: r.id, content_hash: r.contentHash, actor_sha256: e.actor.sha256, reference_sha256: e.private_assets[0]!.sha256, receipt_ref: e.review.receipt_ref },
      template: l.template,
      changes: l.changes.map((c) => ({ pointer: c.pointer, old: c.old, new: c.new, justification: c.justification, approval: c.approval, ...(c.capabilityGap ? { capability_gap: c.capabilityGap } : {}) })),
      approvals: l.approvals,
      capability_gaps: l.capabilityGaps,
    });
  }
  if (!tasks.length && !problems.length) return null;
  return { problems, body: { schema: CHANGE_RECORD_SCHEMA, package_id: part.packageId, zip_sha256: part.zipSha256, package_sha256: part.packageSha256, request, tasks } };
}

/** The project's approved tasks as they stand (the same rule as the project export): the latest record of each accepted task. */
async function currentRecords(db: Db, projectId: string) {
  const rows = await db.approvedTaskRecord.findMany({ where: { projectId }, orderBy: { seq: 'asc' } });
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  const accepted = new Set((await db.taskInstance.findMany({ where: { projectId, id: { in: [...new Set(rows.map((r) => r.taskInstanceId))] }, status: 'ACCEPTED' }, select: { id: true } })).map((t) => t.id));
  const latest = new Map<string, string>();
  for (const r of rows) if (!superseded.has(r.id)) latest.set(r.taskInstanceId, r.id);
  return rows.filter((r) => !superseded.has(r.id) && accepted.has(r.taskInstanceId) && latest.get(r.taskInstanceId) === r.id);
}

export interface OfflineExportReport {
  outcome: 'written' | 'would_write' | 'nothing_to_export' | 'refused';
  reason?: string;
  projectId: string;
  batchId: string | null;
  parts: { packageId: string; partIndex: number; partCount: number; file: string; zipSha256: string; packageSha256: string; compressedBytes: number; entries: number; recordIds: string[]; taskIds: string[]; templates: { id: string; version: number; sha256: string }[] }[];
  problems: PackageProblem[];
  archiveProblems: { packageId: string; problems: string[] }[];
  changeRecords: { packageId: string; file: string; sha256: string; taskIds: string[] }[];
}

/**
 * Builds the package(s) for a project's current approved records on published (or retired) template versions, checks
 * each against the archive bounds and its own manifest, and hands each conforming ZIP to `write` (when `apply`).
 */
export async function offlineExport(db: Db, args: { projectId: string; apply: boolean; write: (file: string, zip: Buffer) => Promise<string> }): Promise<OfflineExportReport> {
  const base: OfflineExportReport = { outcome: 'refused', projectId: args.projectId, batchId: null, parts: [], problems: [], archiveProblems: [], changeRecords: [] };
  const project = await db.project.findUnique({ where: { id: args.projectId } });
  if (!project) return { ...base, reason: 'Project not found.' };
  const records = await currentRecords(db, project.id);
  const templates = new Map<string, Template>((await db.template.findMany({ where: { id: { in: [...new Set(records.map((r) => r.templateId))] } } })).map((t) => [t.id, t]));
  const inputs = records.flatMap((record: ApprovedTaskRecord) => (templates.has(record.templateId) ? [{ record, template: templates.get(record.templateId)! }] : []));
  const built = buildGenericPackages(inputs, { projectId: project.id });
  const report: OfflineExportReport = { ...base, batchId: built.batchId, problems: built.problems };
  // A task that names an undeclared tool or would expose private fields is never silently left out of an export.
  const blocking = built.problems.filter((p) => p.code === TOOL_UNDECLARED || p.code === 'GENERIC_PRIVATE_EXPOSURE');
  if (blocking.length) return { ...report, outcome: 'refused', reason: `${blocking.length} approved task${blocking.length === 1 ? ' fails' : 's fail'} the conformance checks (${[...new Set(blocking.map((p) => p.code))].join(', ')}); nothing was written.` };
  if (!built.parts.length) return { ...report, outcome: 'nothing_to_export', reason: records.length ? 'No approved task could be packaged; see problems.' : 'The project has no approved tasks.' };
  const byLineage = new Map([...templates.values()].map((t) => [`${t.lineageId}@${t.version}`, jointTemplateSpec(t)?.execution]));
  const byRecord = new Map(records.map((r) => [r.id, r]));
  const changes: { packageId: string; body: Record<string, unknown> }[] = [];
  for (const part of built.parts) {
    const problems = [...archiveProblems(part.zip), ...packageProblems(part.zip), ...conformanceProblems(part.zip, (t) => byLineage.get(`${t.id}@${t.version}`))];
    const cr = await changeRecord(db, part, byRecord, templates);
    if (cr) {
      problems.push(...cr.problems);
      changes.push({ packageId: part.packageId, body: cr.body });
    }
    if (problems.length) report.archiveProblems.push({ packageId: part.packageId, problems });
  }
  if (report.archiveProblems.length) return { ...report, outcome: 'refused', reason: 'A package breaks the archive bounds, its own manifest or the conformance checks; nothing was written.' };
  for (const c of changes) {
    const name = `${c.packageId}.change-record.json`;
    const bytes = Buffer.from(`${JSON.stringify(c.body, null, 2)}\n`, 'utf8');
    const file = args.apply ? await args.write(name, bytes) : name;
    report.changeRecords.push({ packageId: c.packageId, file, sha256: createHash('sha256').update(bytes).digest('hex'), taskIds: (c.body.tasks as { task_id: string }[]).map((t) => t.task_id) });
  }
  for (const part of built.parts) {
    const name = `${part.packageId}.zip`;
    const file = args.apply ? await args.write(name, part.zip) : name;
    const tasks = (part.manifest.tasks as { template: { id: string; version: number; sha256: string } }[]).map((t) => t.template);
    const uniq = [...new Map(tasks.map((t) => [`${t.id}@${t.version}`, t])).values()];
    report.parts.push({ packageId: part.packageId, partIndex: part.partIndex, partCount: part.partCount, file, zipSha256: part.zipSha256, packageSha256: part.packageSha256, compressedBytes: part.zip.length, entries: (entries(part.zip) as Entry[]).length, recordIds: part.recordIds, taskIds: part.taskIds, templates: uniq });
  }
  return { ...report, outcome: args.apply ? 'written' : 'would_write' };
}
