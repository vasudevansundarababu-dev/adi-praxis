import { agentGraphProjection, agentProjection, type TemplateProfile, WorkflowGraph } from '@praxis/shared';
import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { jcs, jcsBytes, JcsError, jcsSha256, sha256Hex } from './jcs';
import { jointHashes, jointTemplateSpec, type JointTemplateSpec } from './joint-template';
import { writeZip } from './zip';

/**
 * Generic authored-task export package for Anvil (`praxis.authored-task-export.v1`; Anvil's generic export API and
 * four confirmations, 11 Nov 2026). Layout: `praxis-export.json`, `forms/<profile>.json` (the published
 * authoring.profile, exactly), `tasks/<task>/actor.json` (the public projection Anvil recomputes) and
 * `private/<task>/reference.json` (the complete authored record, grader-only). Every file is RFC 8785 JSON, hashed with
 * JCS SHA-256. Content is synthetic; the review provenance is an opaque reference, never personnel data.
 *
 * Large exports are split into parts of at most 200 tasks and below Anvil's 1 MiB compressed bound, with one batch ID,
 * a consistent part count and unique indexes. Identifiers are derived from the content, so the same tasks always give
 * the same package (and a changed task gives a new package version, never a conflicting one).
 */
export const GENERIC_EXPORT_SCHEMA = 'praxis.authored-task-export.v1' as const;
export const MAX_TASKS_PER_PART = 200;
/** Anvil's compressed bound is 1,048,576 bytes; parts stay under it with room for the manifest's final batch numbers. */
export const MAX_PART_BYTES = 1_040_000;
const PRIVATE_VISIBILITIES = new Set(['private_reference', 'private_rubric', 'evaluation_private']);

export interface PackageInput {
  record: ApprovedTaskRecord;
  template: Template;
}

/** Why a task could not be put in a package (Praxis-side; nothing was sent to Anvil for it). */
export interface PackageProblem {
  recordId: string;
  taskId: string;
  code: string;
  message: string;
}

export interface PackagePart {
  partIndex: number;
  partCount: number;
  packageId: string;
  /** Raw ZIP bytes and their SHA-256 (the retained-artifact hash). */
  zip: Buffer;
  zipSha256: string;
  /** Anvil's package identity: JCS SHA-256 of {manifest, files: path -> JCS SHA-256}. */
  packageSha256: string;
  manifest: Record<string, unknown>;
  /** Record IDs in this part, in manifest order; `taskIds[i]` is the manifest's tasks[i]. */
  recordIds: string[];
  taskIds: string[];
}

export interface BuiltPackages {
  batchId: string | null;
  parts: PackagePart[];
  problems: PackageProblem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The authored record as Anvil receives it: profile reference, title header, S1-S8 and the agent view of the graph. */
export function authoredRecord(output: unknown): { authored: Record<string, unknown> } | { problem: { code: string; message: string } } {
  if (!isObj(output) || !isObj(output.profile) || !isObj(output.sections)) return { problem: { code: 'GENERIC_TASK_NOT_PROFILE', message: 'This task was not authored on a sections form, so it has no generic export.' } };
  const p = output.profile as { id?: unknown; version?: unknown };
  const authored: Record<string, unknown> = { profile: { id: p.id, version: p.version }, sections: output.sections };
  const title = isObj(output.header) ? output.header.title : undefined;
  if (typeof title === 'string') authored.header = { title };
  if (output.workflowGraph !== undefined && output.workflowGraph !== null) {
    const g = WorkflowGraph.safeParse(output.workflowGraph);
    if (!g.success) return { problem: { code: 'GENERIC_GRAPH_INVALID', message: 'The task’s workflow does not pass the graph schema.' } };
    // Only the agent view leaves Praxis: Anvil copies the authored graph into actor.json, so private artifact
    // declarations and rubric links must never be in it.
    authored.workflowGraph = agentGraphProjection(g.data);
  }
  return { authored };
}

/** Anvil's public projection (actor.json), computed exactly as Anvil recomputes it from the published form. */
export function actorProjection(form: Record<string, unknown>, authored: Record<string, unknown>): Record<string, unknown> {
  type Field = { key: string; type: string; visibility?: string; itemFields?: Field[] };
  const publicFields = (defs: Field[], values: unknown): Record<string, unknown> => {
    if (!isObj(values)) throw new Error('Section object required');
    const out: Record<string, unknown> = {};
    for (const f of defs) {
      if (!(f.key in values) || PRIVATE_VISIBILITIES.has(f.visibility ?? '') || f.type === 'criterion') continue;
      let v = values[f.key];
      if (f.itemFields?.length && Array.isArray(v)) v = v.filter(isObj).map((item) => publicFields(f.itemFields!, item));
      out[f.key] = structuredClone(v);
    }
    return out;
  };
  const source = isObj(authored.sections) ? authored.sections : {};
  const sections: Record<string, unknown> = {};
  for (const s of (form.sections as { key: string; fields?: Field[] }[]) ?? []) {
    const v = publicFields(s.fields ?? [], source[s.key] ?? {});
    if (Object.keys(v).length) sections[s.key] = v;
  }
  const header = isObj(authored.header) ? authored.header : {};
  const s1 = isObj(source.S1) ? source.S1 : {};
  const result: Record<string, unknown> = { profile: { id: form.profileId, version: form.version }, title: 'title' in header ? header.title : 'title' in s1 ? s1.title : '', sections };
  if (authored.workflowGraph !== undefined && authored.workflowGraph !== null) result.workflowGraph = structuredClone(authored.workflowGraph);
  return result;
}

interface TaskFiles {
  input: PackageInput;
  spec: JointTemplateSpec;
  templateSha256: string;
  formPath: string;
  form: Record<string, unknown>;
  actor: Record<string, unknown>;
  privateRef: Record<string, unknown>;
  entry: Record<string, unknown>;
}

/** Opaque provenance of the human acceptance: the dataset record and its content hash. Never a person. */
const receiptRef = (r: ApprovedTaskRecord) => `praxis-approved-record:${r.id}:${r.contentHash.slice(0, 16)}`;

function taskFiles(input: PackageInput): TaskFiles | PackageProblem {
  const { record, template } = input;
  const base = { recordId: record.id, taskId: record.taskInstanceId };
  if (template.status !== 'PUBLISHED' && template.status !== 'RETIRED') return { ...base, code: 'GENERIC_TEMPLATE_NOT_PUBLISHED', message: 'The task’s template version is not published.' };
  const spec = jointTemplateSpec(template);
  if (!spec) return { ...base, code: 'GENERIC_TEMPLATE_NOT_JOINT', message: 'This template version has no Anvil execution part (it was not proposed by Anvil as praxis.anvil.template-spec.v1), so Anvil cannot take its tasks yet.' };
  const a = authoredRecord(record.output);
  if ('problem' in a) return { ...base, ...a.problem };
  const form = spec.authoring.profile;
  const ref = a.authored.profile as { id: unknown; version: unknown };
  if (ref.id !== form.profileId || ref.version !== form.version) return { ...base, code: 'GENERIC_FORM_MISMATCH', message: `The task was authored on form ${String(ref.id)} v${String(ref.version)}, not the template’s ${String(form.profileId)} v${String(form.version)}.` };
  try {
    const actor = actorProjection(form, a.authored);
    // Anvil copies whole items of structured fields into actor.json; Praxis hides private sub-fields (e.g. a policy
    // citation's rationale). A task is sent only when Anvil's public view equals Praxis's agent view, so nothing
    // private can reach an agent through the export.
    // The form is Praxis's own schema, so Praxis's allow-list projection applies to it directly.
    const praxisView = form.storage === 'canonical' ? null : agentProjection(form as unknown as TemplateProfile, record.output);
    if (!praxisView || jcs((praxisView as { sections?: unknown }).sections ?? {}) !== jcs(actor.sections)) return { ...base, code: 'GENERIC_PRIVATE_EXPOSURE', message: 'Anvil’s public view of this task would include fields Praxis keeps private (for example a policy citation’s rationale), so it is not sent. The published form must declare those sub-fields as private.' };
    const privateRef = { purpose: 'grader_only_reference_and_rubric', access: 'private_rubric', authored: a.authored };
    const formPath = `forms/${String(form.profileId)}.json`;
    const taskId = record.taskInstanceId;
    const { template_sha256 } = jointHashes(spec);
    const entry = {
      task_id: taskId,
      revision_id: record.id,
      template: { id: spec.template_id, version: spec.version, sha256: template_sha256 },
      form: { path: formPath, sha256: jcsSha256(form) },
      actor: { path: `tasks/${taskId}/actor.json`, sha256: jcsSha256(actor) },
      private_assets: [{ path: `private/${taskId}/reference.json`, sha256: jcsSha256(privateRef), purpose: 'grader_only_reference_and_rubric', access: 'private_rubric' }],
      agent_mode: template.agentMode,
      review: { status: 'approved', revision_id: record.id, receipt_ref: receiptRef(record) },
    };
    return { input, spec, templateSha256: template_sha256, formPath, form, actor, privateRef, entry };
  } catch (e) {
    if (e instanceof JcsError) return { ...base, code: 'GENERIC_NOT_CANONICAL', message: `The task cannot be written as RFC 8785 JSON: ${e.message}.` };
    return { ...base, code: 'GENERIC_PROJECTION_FAILED', message: 'The task’s sections do not fit its published form.' };
  }
}

function assemble(tasks: TaskFiles[], ids: { packageId: string; batchId: string; partIndex: number; partCount: number }) {
  const manifest = {
    schema_version: GENERIC_EXPORT_SCHEMA,
    package_id: ids.packageId,
    package_version: '1',
    batch: { id: ids.batchId, part_index: ids.partIndex, part_count: ids.partCount },
    content_classification: 'synthetic',
    tasks: tasks.map((t) => t.entry),
    execution: { location: 'anvil_only', paid_calls: false },
  };
  const files = new Map<string, unknown>([['praxis-export.json', manifest]]);
  for (const t of tasks) {
    files.set(t.formPath, t.form);
    files.set((t.entry.actor as { path: string }).path, t.actor);
    files.set((t.entry.private_assets as { path: string }[])[0]!.path, t.privateRef);
  }
  const paths = [...files.keys()].sort();
  const zip = writeZip(paths.map((p) => ({ path: p, bytes: jcsBytes(files.get(p)) })));
  const packageSha256 = jcsSha256({ manifest, files: Object.fromEntries(paths.map((p) => [p, jcsSha256(files.get(p))])) });
  return { manifest, zip, packageSha256 };
}

/**
 * Builds the export packages for approved records (one per task, in the given order). Tasks Praxis cannot package
 * are returned as problems and left out; a form path that two different forms would share is a problem too.
 */
export function buildGenericPackages(inputs: PackageInput[], scope: { projectId: string }): BuiltPackages {
  const problems: PackageProblem[] = [];
  const ready: TaskFiles[] = [];
  const forms = new Map<string, string>();
  for (const input of inputs) {
    const t = taskFiles(input);
    if ('code' in t) {
      problems.push(t);
      continue;
    }
    const formHash = jcsSha256(t.form);
    const known = forms.get(t.formPath);
    if (known && known !== formHash) {
      problems.push({ recordId: input.record.id, taskId: input.record.taskInstanceId, code: 'GENERIC_FORM_CONFLICT', message: `Two different forms are published as ${t.formPath}; export them separately.` });
      continue;
    }
    forms.set(t.formPath, formHash);
    ready.push(t);
  }
  if (!ready.length) return { batchId: null, parts: [], problems };

  // Content-derived batch identity: the same tasks (same revisions, templates and files) give the same IDs.
  const batchHash = jcsSha256({ project: scope.projectId, tasks: ready.map((t) => t.entry) }).slice(0, 24);
  const batchId = `praxis-${batchHash}`;
  const ids = (i: number, n: number) => ({ packageId: `praxis-${batchHash}-p${i}`, batchId, partIndex: i, partCount: n });

  // Greedy split by task count and compressed size (sized with a placeholder part count, then rebuilt).
  const groups: TaskFiles[][] = [];
  let current: TaskFiles[] = [];
  for (const t of ready) {
    const trial = [...current, t];
    if (trial.length > MAX_TASKS_PER_PART || assemble(trial, ids(9999, 9999)).zip.length > MAX_PART_BYTES) {
      if (!current.length) {
        problems.push({ recordId: t.input.record.id, taskId: t.input.record.taskInstanceId, code: 'GENERIC_TASK_TOO_LARGE', message: 'This one task is larger than Anvil’s 1 MiB package bound.' });
        continue;
      }
      groups.push(current);
      current = [t];
      if (assemble(current, ids(9999, 9999)).zip.length > MAX_PART_BYTES) {
        problems.push({ recordId: t.input.record.id, taskId: t.input.record.taskInstanceId, code: 'GENERIC_TASK_TOO_LARGE', message: 'This one task is larger than Anvil’s 1 MiB package bound.' });
        current = [];
      }
    } else current = trial;
  }
  if (current.length) groups.push(current);

  const parts = groups.map((g, i) => {
    const built = assemble(g, ids(i + 1, groups.length));
    return {
      partIndex: i + 1,
      partCount: groups.length,
      packageId: ids(i + 1, groups.length).packageId,
      zip: built.zip,
      zipSha256: sha256Hex(built.zip),
      packageSha256: built.packageSha256,
      manifest: built.manifest,
      recordIds: g.map((t) => t.input.record.id),
      taskIds: g.map((t) => t.input.record.taskInstanceId),
    };
  });
  return { batchId, parts, problems };
}

/** For tests and diagnostics: the canonical text of a value (never logged with private content). */
export const canonicalText = jcs;
