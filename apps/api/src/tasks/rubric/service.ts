import {
  ACTOR_LABEL,
  MARKING_LABEL,
  type MandatoryMarking,
  type ResponsibleActor,
  coverage,
  derive,
  howChecked,
  RUBRIC_INTERNAL_ONLY,
  changedFromDefault,
  collectAtoms,
  seedCriteria,
  technicalSettings,
  templateRubric,
  withTemplateTechnical,
  type AnnotationDetails,
  type Derivation,
  type DeriveInput,
  type EditableDetail,
  type PolicyRuleRef,
  type RubricAdditionView,
  type RubricCriterionView,
  type RubricView,
  type SaveCriterionRequest,
  type SourceLink,
  type TaskSourceItem,
  type TemplateProfile,
  type TemplateRubric,
  type ViewLink,
} from '@praxis/shared';
import type { Prisma, RubricCriterionAnnotation, TaskInstance, Template } from '@prisma/client';
import type { Db, Tx } from '../../db';
import { jointParts } from '../../anvil/joint-template';
import { AppError } from '../../lib/errors';
import { sha256, stableStringify } from '../../lib/crypto';
import { latestRuleSet } from '../../policy/rule-sets';
import { policyVersion } from '../../policy/anvil-project-policy';
import { profileFor } from '../profile-output';
import { caseSelectorOf } from '../task-service';
import { authoringDefaultsFor } from './authoring-defaults';
import { RUBRIC_PROMPT_VERSION, type RubricAssistant, type WordingInput } from './assistant';

/**
 * Rubric editor and recommendations (docs/plan/PLAN-RUBRIC-RECOMMENDATIONS.md). Everything this module writes lives
 * in its own append-only tables. It never writes a task's output: the S7 values are saved by the ordinary autosave, and
 * the export, the approved record and their hashes are unaffected.
 */

export const hashOf = (v: unknown) => sha256(stableStringify(v ?? null));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

type TaskWithTemplate = Pick<TaskInstance, 'id' | 'clientId' | 'projectId' | 'revision' | 'output' | 'taskType'> & { project: { template: Template } };

export interface RubricContext {
  task: TaskWithTemplate;
  template: Template;
  profile: TemplateProfile;
  execution: Record<string, unknown> | null;
  rubric: TemplateRubric;
  output: Record<string, unknown>;
}

/** The rubric context of a task, or null when its template's form has no rubric field (nothing to show). */
export function rubricContext(task: TaskWithTemplate): RubricContext | null {
  const template = task.project.template;
  const profile = profileFor({ workflowName: template.workflowName, profileId: template.profileId });
  if (!profile || profile.storage !== 'sections') return null;
  const execution = jointParts(template)?.execution ?? null;
  const rubric = templateRubric(profile, execution, authoringDefaultsFor(execution));
  if (!rubric) return null;
  return { task, template, profile, execution, rubric, output: isObj(task.output) ? task.output : {} };
}

// ───────────────────────── Project policy library (S4 picker, D6) ─────────────────────────

export interface LibraryRule {
  ruleKey: string;
  ruleVersionId: string;
  title: string;
  requirement: string;
  required: boolean;
  quote: string | null;
  locator: Record<string, unknown> | null;
  /** Policy rule annotations (PR #81), when available. */
  marking: string | null;
  appliesWhen: string | null;
  actor: string | null;
}
export interface LibraryDocument {
  documentVersionId: string;
  title: string;
  jurisdiction: string | null;
  category: string | null;
  effectiveFrom: string | null;
  /** The S4 identity, as in the project policy manifest RL Gym receives (PR #81 mapping). */
  policyId: string;
  version: string;
  publicationRef: string;
  sha256: string;
  rules: LibraryRule[];
}

/**
 * Extra policy rule annotations by rule version. The published rule body already carries its annotation (marking,
 * applies-when, responsible actor), which is used first; this source is only a fallback for rules without one.
 */
export interface RuleAnnotationSource {
  annotations(tx: Db | Tx, ruleVersionIds: string[]): Promise<Map<string, { marking: string | null; appliesWhen: string | null; actor: string | null }>>;
}
export const noRuleAnnotations: RuleAnnotationSource = { annotations: async () => new Map() };

/** Published documents of the project's latest rule set and their applied rules. Drafts are never shown. */
export async function policyLibrary(tx: Db | Tx, clientId: string, projectId: string, notes: RuleAnnotationSource = noRuleAnnotations): Promise<{ setVersion: number | null; documents: LibraryDocument[] }> {
  const set = await latestRuleSet(tx, clientId, projectId);
  if (!set) return { setVersion: null, documents: [] };
  const content = set.content as { rules?: { ruleKey: string; ruleVersionId: string; body: { title: string; requirement: string; annotation?: { marking?: string; appliesWhen?: string | null; responsibleActor?: string } }; required?: boolean; sources?: { documentVersionId: string; quote?: string; locator?: Record<string, unknown> }[] }[] };
  const rules = content.rules ?? [];
  const dvIds = [...new Set(rules.flatMap((r) => (r.sources ?? []).map((s) => s.documentVersionId)))];
  const dvs = await tx.policyDocumentVersion.findMany({ where: { clientId, projectId, id: { in: dvIds } }, include: { document: true }, orderBy: { createdAt: 'asc' } });
  const ann = await notes.annotations(tx, rules.map((r) => r.ruleVersionId));
  const documents = dvs
    .filter((dv) => !dv.document.archivedAt)
    .map((dv) => ({
      documentVersionId: dv.id,
      title: dv.document.title,
      jurisdiction: dv.document.jurisdiction,
      category: dv.document.category,
      effectiveFrom: dv.document.effectiveFrom?.toISOString().slice(0, 10) ?? null,
      policyId: dv.documentId,
      version: policyVersion(set.version, dv.version),
      publicationRef: `project rule set v${set.version}`,
      sha256: dv.sha256,
      rules: rules
        .filter((r) => (r.sources ?? []).some((s) => s.documentVersionId === dv.id))
        .map((r) => {
          const src = r.sources!.find((s) => s.documentVersionId === dv.id)!;
          // Policy rule annotations (marking, applies-when, responsible actor) travel with the published rule body.
          const own = r.body.annotation;
          const a = own?.marking ? { marking: MARKING_LABEL[own.marking as MandatoryMarking] ?? null, appliesWhen: own.appliesWhen ?? null, actor: own.responsibleActor && own.responsibleActor !== 'unknown' ? (ACTOR_LABEL[own.responsibleActor as ResponsibleActor] ?? null) : null } : ann.get(r.ruleVersionId);
          const required = own?.marking ? own.marking === 'mandatory' : r.required !== false;
          return { ruleKey: r.ruleKey, ruleVersionId: r.ruleVersionId, title: r.body.title, requirement: r.body.requirement, required, quote: src.quote ?? null, locator: src.locator ?? null, marking: a?.marking ?? null, appliesWhen: a?.appliesWhen ?? null, actor: a?.actor ?? null };
        }),
    }));
  return { setVersion: set.version, documents };
}

// ───────────────────────── Sources used for this task ─────────────────────────

/** The S4 field that holds policy identities (by its item fields, not its section number), when the form has one. */
export function policyReferenceField(profile: TemplateProfile) {
  for (const s of profile.sections)
    for (const f of s.fields) if (f.type === 'repeated_array' && (f.itemFields ?? []).some((x) => /sha256/i.test(x.key))) return { section: s.key, field: f };
  return null;
}

function pickedDocumentVersions(ctx: RubricContext, docs: LibraryDocument[]): Set<string> {
  const pf = policyReferenceField(ctx.profile);
  const sections = isObj(ctx.output.sections) ? (ctx.output.sections as Record<string, Record<string, unknown>>) : {};
  const items = pf ? sections[pf.section]?.[pf.field.key] : undefined;
  const picked = new Set<string>();
  for (const it of Array.isArray(items) ? items.filter(isObj) : []) {
    const sha = Object.entries(it).find(([k]) => /sha256/i.test(k))?.[1];
    const d = docs.find((x) => x.sha256 === sha || x.policyId === it.ruleId);
    if (d) picked.add(d.documentVersionId);
  }
  // Forms that cite rules (the shared `policy_citation` field, e.g. Marketing; D21): a cited rule version ticks the
  // published document it comes from.
  for (const s of ctx.profile.sections)
    for (const f of s.fields) {
      if (f.type !== 'policy_citation') continue;
      const cited = sections[s.key]?.[f.key];
      for (const it of Array.isArray(cited) ? cited.filter(isObj) : [])
        for (const d of docs) if (d.rules.some((r) => r.ruleVersionId === it.ruleVersion)) picked.add(d.documentVersionId);
    }
  return picked;
}

function templateReference(ctx: RubricContext): TaskSourceItem {
  return { kind: 'TEMPLATE_REFERENCE', ref: `template:${ctx.template.id}`, label: `Template references · ${ctx.template.workflowName} v${ctx.template.version}`, detail: 'tool catalogue, output schema and the rubric evaluator map', ticked: true, origin: 'DEFAULT' };
}

const docItem = (d: LibraryDocument, ticked: boolean, origin: TaskSourceItem['origin']): TaskSourceItem => ({ kind: 'POLICY_DOCUMENT', ref: d.documentVersionId, label: `${d.title}${d.jurisdiction ? ` · ${d.jurisdiction}` : ''}`, detail: `version ${d.version} · ${d.rules.length} rules applied`, ticked, origin });

/** Default sources: what the task already uses (the documents picked in S4, else the project rule set's documents). */
export function defaultSources(ctx: RubricContext, docs: LibraryDocument[]): TaskSourceItem[] {
  const picked = pickedDocumentVersions(ctx, docs);
  const uses = picked.size ? docs.filter((d) => picked.has(d.documentVersionId)) : docs;
  const items = [...uses.map((d) => docItem(d, true, 'DEFAULT')), templateReference(ctx)];
  const fed = Array.isArray(ctx.execution?.federalPolicies) && ctx.execution!.federalPolicies.length;
  if (fed) items.push({ kind: 'TEMPLATE_REFERENCE', ref: `template:${ctx.template.id}:federal`, label: 'Federal policy references from the template', detail: `template v${ctx.template.version} · read-only`, ticked: false, origin: 'DEFAULT' });
  return items;
}

export async function taskSources(tx: Db | Tx, ctx: RubricContext, docs: LibraryDocument[]) {
  const row = await tx.rubricTaskSources.findFirst({ where: { taskInstanceId: ctx.task.id }, orderBy: { version: 'desc' } });
  const defaults = defaultSources(ctx, docs);
  let items = row ? (row.items as unknown as TaskSourceItem[]) : defaults.filter((d) => d.ticked);
  // A document picked in S4 later is ticked automatically (S4, Sources and S8 stay one list).
  const picked = pickedDocumentVersions(ctx, docs);
  for (const d of docs) if (picked.has(d.documentVersionId) && !items.some((i) => i.ref === d.documentVersionId)) items = [...items, docItem(d, true, 'DEFAULT')];
  const available = [...docs.filter((d) => !items.some((i) => i.ref === d.documentVersionId)).map((d) => docItem(d, false, 'ADDED')), ...defaults.filter((d) => d.kind === 'TEMPLATE_REFERENCE' && !items.some((i) => i.ref === d.ref))];
  return { version: row?.version ?? 0, items, available };
}

// ───────────────────────── Derivation ─────────────────────────

function deriveInput(ctx: RubricContext, docs: LibraryDocument[], sources: TaskSourceItem[]): DeriveInput {
  const ticked = new Set(sources.filter((s) => s.ticked).map((s) => s.ref));
  const policies: PolicyRuleRef[] = docs
    .filter((d) => ticked.has(d.documentVersionId))
    .flatMap((d) => d.rules.map((r) => ({ ruleKey: r.ruleKey, ruleVersionId: r.ruleVersionId, title: r.title, requirement: r.requirement, documentVersionId: d.documentVersionId, documentTitle: d.title, marking: r.marking, appliesWhen: r.appliesWhen, actor: r.actor, required: r.required, quote: r.quote, locator: r.locator })));
  const sel = caseSelectorOf(ctx.template.caseSelector);
  return { profile: ctx.profile, output: ctx.output, rubric: ctx.rubric, template: { id: ctx.template.id, version: ctx.template.version, caseSelector: sel }, task: { id: ctx.task.id, revision: ctx.task.revision }, policies, sources, hash: hashOf };
}

async function latestAnnotations(tx: Db | Tx, taskId: string) {
  const rows = await tx.rubricCriterionAnnotation.findMany({ where: { taskInstanceId: taskId }, orderBy: [{ criterionId: 'asc' }, { version: 'desc' }] });
  const latest = new Map<string, RubricCriterionAnnotation>();
  for (const r of rows) if (!latest.has(r.criterionId)) latest.set(r.criterionId, r);
  return latest;
}

function linkStates(input: DeriveInput, links: SourceLink[]): ViewLink[] {
  const atoms = new Map(collectAtoms(input).atoms.map((a) => [a.target, a]));
  return links.map((l) => {
    const a = atoms.get(l.target);
    if (!a) return { ...l, state: 'REMOVED' as const };
    const now = hashOf(a.value);
    return now === l.snapshot ? { ...l, state: 'OK' as const } : { ...l, state: 'CHANGED' as const, currentExcerpt: a.text.slice(0, 280) };
  });
}

/** Links follow the ticked sources. A target linked before keeps its snapshot (so a content change is still detected). */
function mergeLinks(old: SourceLink[], fresh: SourceLink[]): SourceLink[] {
  const prev = new Map(old.map((l) => [l.target, l]));
  return fresh.map((f) => {
    const p = prev.get(f.target);
    return p ? { ...f, snapshot: p.snapshot, excerpt: p.excerpt } : f;
  });
}

const originFor = (ctx: RubricContext, id: string) => {
  const c = ctx.rubric.criteria.find((x) => x.id === id);
  return c ? (c.defaults ? 'TEMPLATE_DEFAULT' : 'TEMPLATE') : 'CUSTOM';
};
const exportableFor = (ctx: RubricContext, id: string) => !ctx.rubric.fixedSet || !!ctx.rubric.criteria.find((x) => x.id === id)?.evaluator;

function rubricItems(ctx: RubricContext): Record<string, unknown>[] {
  const s = isObj(ctx.output.sections) ? (ctx.output.sections as Record<string, Record<string, unknown>>)[ctx.rubric.section] : undefined;
  const v = s?.[ctx.rubric.fieldKey];
  return (Array.isArray(v) ? v.filter(isObj) : []) as Record<string, unknown>[];
}

function needsFor(d: Derivation['criteria'][number] | undefined, links: SourceLink[]) {
  const out: string[] = [];
  if (d?.needs.includes('Policy rule') && !links.some((l) => l.kind === 'POLICY_RULE')) out.push('Policy rule');
  if (!links.length) out.push('Source');
  return out;
}

/** The whole view: criteria with their derivation, links and states, additions, sources, coverage. Read-only. */
export async function rubricView(tx: Db | Tx, ctx: RubricContext, opts: { aiEnabled: boolean; notes?: RuleAnnotationSource }): Promise<RubricView> {
  const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, opts.notes);
  const sources = await taskSources(tx, ctx, lib.documents);
  const input = deriveInput(ctx, lib.documents, sources.items);
  const derived = derive(input);
  const ann = await latestAnnotations(tx, ctx.task.id);
  const run = await tx.rubricRecommendationRun.findFirst({ where: { taskInstanceId: ctx.task.id, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' } });
  const runResult = (run?.result ?? null) as { criteria?: { id: string; details: AnnotationDetails }[] } | null;
  const items = rubricItems(ctx);
  const criteria: RubricCriterionView[] = [];
  for (const d of derived.criteria) {
    const a = ann.get(d.id);
    if (a?.status === 'REMOVED' && !items.some((i) => i.id === d.id)) continue;
    const item = items.find((i) => i.id === d.id) ?? { id: d.id };
    const details = (a?.details as unknown as AnnotationDetails | undefined) ?? d.details;
    const links = a ? linkStates(input, a.sources as unknown as SourceLink[]) : d.links.map((l) => ({ ...l, state: 'OK' as const }));
    const proposed: RubricCriterionView['proposed'] = {};
    const ranDetails = runResult?.criteria?.find((c) => c.id === d.id)?.details;
    for (const f of (a?.editedFields ?? []) as EditableDetail[]) if (ranDetails && stableStringify(ranDetails[f]) !== stableStringify(details[f])) proposed[f] = ranDetails[f];
    criteria.push({
      id: d.id,
      origin: (a?.origin as RubricCriterionView['origin']) ?? originFor(ctx, d.id),
      exportable: exportableFor(ctx, d.id),
      annotationVersion: a?.version ?? 0,
      details,
      editedFields: a?.editedFields ?? [],
      aiFields: a?.aiFields ?? [],
      links,
      needs: needsFor(d, links),
      sourceChanged: links.some((l) => l.state !== 'OK'),
      defaults: ctx.rubric.criteria.find((c) => c.id === d.id)?.defaults ?? null,
      changedFromDefault: changedFromDefault(ctx.rubric, item),
      technical: technicalSettings(ctx.rubric, item),
      howChecked: howChecked(ctx.rubric, d.id),
      proposed,
    });
  }
  const additions: RubricAdditionView[] = [];
  for (const x of derived.additions) {
    const a = ann.get(x.id);
    if (a && (a.status === 'DISMISSED' || a.status === 'REMOVED')) continue;
    additions.push({ id: x.id, name: x.name, status: a?.status === 'KEPT' ? 'KEPT' : 'SUGGESTED', internalOnly: ctx.rubric.fixedSet, ai: (a?.aiFields ?? []).length > 0, annotationVersion: a?.version ?? 0, details: (a?.details as unknown as AnnotationDetails) ?? x.details, links: a ? linkStates(input, a.sources as unknown as SourceLink[]) : x.links.map((l) => ({ ...l, state: 'OK' as const })) });
  }
  for (const [id, a] of ann) if (id.startsWith('x-') && a.status === 'KEPT' && !additions.some((x) => x.id === id)) additions.push({ id, name: (a.details as unknown as AnnotationDetails).skill ?? id, status: 'KEPT', internalOnly: ctx.rubric.fixedSet, ai: a.aiFields.length > 0, annotationVersion: a.version, details: a.details as unknown as AnnotationDetails, links: linkStates(input, a.sources as unknown as SourceLink[]) });
  const active = criteria.map((c) => ({ id: c.id, covers: c.details.covers, weighted: true })).concat(additions.filter((x) => x.status === 'KEPT').map((x) => ({ id: x.id, covers: x.details.covers, weighted: false })));
  const cov = coverage(derived.requirements, active);
  const seed = seedCriteria(ctx.rubric, items);
  const seedNeeded = seed.length !== items.length || seed.some((s, i) => stableStringify(s) !== stableStringify(items[i]));
  return {
    aiEnabled: opts.aiEnabled,
    template: { id: ctx.template.id, version: ctx.template.version, scale: ctx.rubric.scale, scoreKeys: ctx.rubric.scoreKeys, fixedSet: ctx.rubric.fixedSet, wholeTaskRule: ctx.rubric.wholeTaskRule, criterionFailureSupported: ctx.rubric.criterionFailureSupported, weightsFromTemplate: ctx.rubric.weightsFromTemplate },
    rubric: { section: ctx.rubric.section, fieldKey: ctx.rubric.fieldKey },
    seed: seedNeeded ? seed : null,
    criteria,
    additions,
    sources,
    coverage: { total: cov.total, covered: cov.covered, gaps: cov.gaps.map((g) => ({ key: g.key, label: g.label })), duplicates: cov.duplicates },
    unused: derived.unused,
    run: run ? { id: run.id, mode: run.mode, model: run.model, createdAt: run.createdAt.toISOString() } : null,
    history: (await tx.taskSubmission.findMany({ where: { taskInstanceId: ctx.task.id }, orderBy: { version: 'desc' }, select: { version: true, submittedAt: true } })).map((h) => ({ version: h.version, submittedAt: h.submittedAt.toISOString() })),
    internalOnly: RUBRIC_INTERNAL_ONLY,
  };
}

// ───────────────────────── Writes (each through a command: authorised, idempotent, audited) ─────────────────────────

type Audit = (a: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown }) => Promise<void>;

async function appendAnnotation(tx: Tx, ctx: RubricContext, prev: RubricCriterionAnnotation | undefined, data: { criterionId: string; origin: string; status: string; details: AnnotationDetails; sources: SourceLink[]; editedFields: string[]; aiFields: string[]; fromRunId?: string | null }, actorId: string) {
  return tx.rubricCriterionAnnotation.create({
    data: {
      clientId: ctx.task.clientId,
      taskInstanceId: ctx.task.id,
      criterionId: data.criterionId,
      version: (prev?.version ?? 0) + 1,
      origin: data.origin,
      status: data.status,
      exportable: data.criterionId.startsWith('x-') ? false : exportableFor(ctx, data.criterionId),
      fromRunId: data.fromRunId ?? prev?.fromRunId ?? null,
      details: data.details as unknown as Prisma.InputJsonValue,
      sources: data.sources as unknown as Prisma.InputJsonValue,
      editedFields: data.editedFields,
      aiFields: data.aiFields,
      createdById: actorId,
    },
  });
}

const sameJson = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/**
 * Brings every criterion's annotation in line with a derivation: links follow the sources (old snapshots kept), fields
 * the author never edited take the new suggestion, edited fields are kept (the view shows the difference as
 * "proposed"). A version is appended only when something changed.
 */
async function mergeDerivation(tx: Tx, ctx: RubricContext, derived: Derivation, actorId: string, o: { runId?: string; ai?: Map<string, Partial<Record<EditableDetail, string>>> } = {}) {
  const ann = await latestAnnotations(tx, ctx.task.id);
  let written = 0;
  for (const d of derived.criteria) {
    const a = ann.get(d.id);
    const ai = o.ai?.get(d.id) ?? {};
    const prevDetails = a?.details as unknown as AnnotationDetails | undefined;
    const edited = new Set(a?.editedFields ?? []);
    // Fields the author edited are kept; earlier AI wording is kept until a new AI run rewords it; the rest follow the
    // new derivation.
    const prevAi = new Set((a?.aiFields ?? []).filter((f) => !edited.has(f)));
    const details: AnnotationDetails = { ...d.details };
    for (const f of [...edited, ...prevAi]) if (prevDetails) (details as Record<string, unknown>)[f] = (prevDetails as Record<string, unknown>)[f];
    for (const [k, v] of Object.entries(ai)) if (!edited.has(k)) (details as Record<string, unknown>)[k] = v;
    const aiFields = [...new Set([...prevAi, ...Object.keys(ai).filter((k) => !edited.has(k))])];
    const sources = mergeLinks((a?.sources as unknown as SourceLink[]) ?? [], d.links);
    if (a && a.status !== 'REMOVED' && sameJson(prevDetails, details) && sameJson(a.sources, sources) && sameJson(a.aiFields, aiFields)) continue;
    if (a?.status === 'REMOVED') continue;
    await appendAnnotation(tx, ctx, a, { criterionId: d.id, origin: a?.origin ?? originFor(ctx, d.id), status: 'ACTIVE', details, sources, editedFields: [...edited], aiFields, fromRunId: o.runId ?? null }, actorId);
    written++;
  }
  for (const x of derived.additions) {
    const a = ann.get(x.id);
    if (a) continue;
    const ai = o.ai?.get(x.id) ?? {};
    await appendAnnotation(tx, ctx, undefined, { criterionId: x.id, origin: Object.keys(ai).length ? 'AI_RECOMMENDED' : 'RECOMMENDED', status: 'SUGGESTED', details: { ...x.details, ...ai } as AnnotationDetails, sources: x.links, editedFields: [], aiFields: Object.keys(ai), fromRunId: o.runId ?? null }, actorId);
    written++;
  }
  return written;
}

/** Refresh suggestions: a new derivation (reused when nothing changed), merged without overwriting author edits. */
export async function createRun(tx: Tx, ctx: RubricContext, input: { mode: 'DERIVED' | 'AI'; actorId: string; assistant: RubricAssistant | null; notes?: RuleAnnotationSource }, audit: Audit) {
  if (input.mode === 'AI' && !input.assistant) throw new AppError(409, 'RUBRIC_AI_OFF', 'AI suggestions are switched off for this environment. Suggestions from the task’s own content still work.');
  const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, input.notes);
  const sources = await taskSources(tx, ctx, lib.documents);
  const di = deriveInput(ctx, lib.documents, sources.items);
  const derived = derive(di);
  const digest = hashOf({ template: ctx.template.id, output: ctx.output, sources: sources.items, policies: di.policies, prompt: RUBRIC_PROMPT_VERSION });
  const reuse = await tx.rubricRecommendationRun.findFirst({ where: { taskInstanceId: ctx.task.id, inputDigest: digest, mode: input.mode, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' } });
  if (reuse) {
    const n = await mergeDerivation(tx, ctx, derived, input.actorId, { runId: reuse.id });
    await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.recommendations.reused', after: { runId: reuse.id, mode: input.mode, annotationsWritten: n } });
    return { runId: reuse.id, reused: true, annotationsWritten: n };
  }
  let ai: Map<string, Partial<Record<EditableDetail, string>>> | undefined;
  let scoring: Record<string, Record<string, string>> = {};
  if (input.mode === 'AI' && input.assistant) {
    const ann = await latestAnnotations(tx, ctx.task.id);
    const items = rubricItems(ctx);
    const req: WordingInput[] = [...derived.criteria, ...derived.additions].map((c) => {
      const edited = new Set(ann.get(c.id)?.editedFields ?? []);
      const item = items.find((i) => i.id === c.id);
      const fields: WordingInput['fields'] = [];
      if (!edited.has('assesses')) fields.push('assesses');
      if (!edited.has('evidenceRequired')) fields.push('evidenceRequired');
      // Scoring text is suggested only where the template and the author have none (shown with "Use suggestion").
      if (ctx.rubric.scale === 'five_two_zero') for (const k of ['passCondition', 'partialCredit', 'failCondition'] as const) if (!String(item?.[k] ?? '').trim()) fields.push(k);
      return { id: c.id, name: 'name' in c ? c.name : (c.details.skill ?? c.id), scale: ctx.rubric.scale, sources: c.links.map((l) => ({ label: l.label, excerpt: l.excerpt })), fields };
    });
    const words = await input.assistant.word(req.filter((r) => r.fields.length));
    ai = new Map(words.map((w) => [w.id, Object.fromEntries(Object.entries({ assesses: w.assesses, evidenceRequired: w.evidenceRequired }).filter(([, v]) => v !== undefined)) as Partial<Record<EditableDetail, string>>]));
    scoring = Object.fromEntries(words.map((w) => [w.id, Object.fromEntries(Object.entries({ passCondition: w.passCondition, partialCredit: w.partialCredit, failCondition: w.failCondition }).filter(([, v]) => v !== undefined)) as Record<string, string>]));
  }
  const result = { criteria: derived.criteria.map((c) => ({ id: c.id, details: { ...c.details, ...(ai?.get(c.id) ?? {}) }, links: c.links, needs: c.needs })), additions: derived.additions, requirements: derived.requirements, unused: derived.unused, roles: derived.roles, aiScoring: scoring };
  const run = await tx.rubricRecommendationRun.create({
    data: { clientId: ctx.task.clientId, taskInstanceId: ctx.task.id, mode: input.mode, model: input.mode === 'AI' ? (input.assistant?.modelVersion ?? null) : null, promptVersion: RUBRIC_PROMPT_VERSION, templateId: ctx.template.id, templateVersion: ctx.template.version, taskRevision: ctx.task.revision, inputDigest: digest, status: 'SUCCEEDED', result: result as unknown as Prisma.InputJsonValue, requestedById: input.actorId },
  });
  const n = await mergeDerivation(tx, ctx, derived, input.actorId, { runId: run.id, ai });
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.recommendations.generated', after: { runId: run.id, mode: input.mode, model: run.model, criteria: derived.criteria.length, additions: derived.additions.length, annotationsWritten: n } });
  return { runId: run.id, reused: false, annotationsWritten: n };
}

/** The latest run's AI scoring suggestions for one criterion (shown with "Use suggestion"; never written to output). */
export async function aiScoringSuggestions(tx: Db | Tx, taskId: string): Promise<Record<string, Record<string, string>>> {
  const run = await tx.rubricRecommendationRun.findFirst({ where: { taskInstanceId: taskId, status: 'SUCCEEDED', mode: 'AI' }, orderBy: { createdAt: 'desc' } });
  return ((run?.result as { aiScoring?: Record<string, Record<string, string>> } | null)?.aiScoring ?? {}) as Record<string, Record<string, string>>;
}

/** Author edits to a criterion's internal fields (what, when, whole-task condition, evidence). */
export async function saveCriterion(tx: Tx, ctx: RubricContext, criterionId: string, body: SaveCriterionRequest, actorId: string, audit: Audit, notes?: RuleAnnotationSource) {
  const ann = await latestAnnotations(tx, ctx.task.id);
  const a = ann.get(criterionId);
  if ((a?.version ?? 0) !== body.expectedVersion) throw new AppError(409, 'STALE_RUBRIC', 'This criterion changed in another window. Reload to continue.', { version: a?.version ?? 0 });
  let base = a?.details as unknown as AnnotationDetails | undefined;
  let sources = (a?.sources as unknown as SourceLink[] | undefined) ?? [];
  if (!a) {
    const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, notes);
    const src = await taskSources(tx, ctx, lib.documents);
    const d = derive(deriveInput(ctx, lib.documents, src.items));
    const found = d.criteria.find((c) => c.id === criterionId) ?? d.additions.find((x) => x.id === criterionId);
    if (!found) throw new AppError(404, 'NOT_FOUND', 'This criterion is not part of the task’s rubric.');
    base = found.details;
    sources = found.links;
  }
  if (body.wholeTaskFailure && body.wholeTaskFailure.kind === 'FAIL_OF_CRITERION' && !ctx.rubric.criterionFailureSupported) body = { ...body, wholeTaskFailure: { ...body.wholeTaskFailure, kind: 'OTHER_BEHAVIOUR' } };
  const next: AnnotationDetails = { ...base! };
  const edited = new Set(a?.editedFields ?? []);
  for (const k of ['assesses', 'applicability', 'wholeTaskFailure', 'evidenceRequired'] as const) {
    if (body[k] === undefined) continue;
    if (!sameJson(next[k], body[k])) {
      (next as Record<string, unknown>)[k] = body[k];
      edited.add(k);
    }
  }
  if (a && sameJson(next, base)) {
    await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.criterion.unchanged', after: { criterionId, version: a.version } });
    return { version: a.version };
  }
  const row = await appendAnnotation(tx, ctx, a, { criterionId, origin: a?.origin ?? (criterionId.startsWith('x-') ? 'RECOMMENDED' : originFor(ctx, criterionId)), status: a?.status ?? (criterionId.startsWith('x-') ? 'SUGGESTED' : 'ACTIVE'), details: next, sources, editedFields: [...edited], aiFields: (a?.aiFields ?? []).filter((f) => !edited.has(f)) }, actorId);
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.criterion.saved', before: a ? { version: a.version } : null, after: { criterionId, version: row.version, edited: [...edited] } });
  return { version: row.version };
}

/** "Reviewed, keep": the author has checked a changed source; the links take the current content as their snapshot. */
export async function keepCriterion(tx: Tx, ctx: RubricContext, criterionId: string, expectedVersion: number, actorId: string, audit: Audit, notes?: RuleAnnotationSource) {
  const ann = await latestAnnotations(tx, ctx.task.id);
  const a = ann.get(criterionId);
  if (!a || a.version !== expectedVersion) throw new AppError(409, 'STALE_RUBRIC', 'This criterion changed in another window. Reload to continue.', { version: a?.version ?? 0 });
  const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, notes);
  const src = await taskSources(tx, ctx, lib.documents);
  const input = deriveInput(ctx, lib.documents, src.items);
  const atoms = new Map(collectAtoms(input).atoms.map((x) => [x.target, x]));
  const sources = (a.sources as unknown as SourceLink[]).filter((l) => atoms.has(l.target)).map((l) => {
    const at = atoms.get(l.target)!;
    return { ...l, snapshot: hashOf(at.value), excerpt: at.text.replace(/\s+/g, ' ').trim().slice(0, 280), taskRevision: ctx.task.revision };
  });
  const row = await appendAnnotation(tx, ctx, a, { criterionId, origin: a.origin, status: a.status, details: a.details as unknown as AnnotationDetails, sources, editedFields: a.editedFields, aiFields: a.aiFields }, actorId);
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.criterion.source_reviewed', after: { criterionId, version: row.version } });
  return { version: row.version };
}

/** Keep a suggested addition as an internal note, or dismiss it (not offered again unless its source changes). */
export async function decideAddition(tx: Tx, ctx: RubricContext, id: string, decision: 'KEEP' | 'DISMISS', expectedVersion: number, actorId: string, audit: Audit, notes?: RuleAnnotationSource) {
  if (!id.startsWith('x-')) throw new AppError(422, 'NOT_AN_ADDITION', 'Only suggested additions can be kept or dismissed.');
  const ann = await latestAnnotations(tx, ctx.task.id);
  let a = ann.get(id);
  if ((a?.version ?? 0) !== expectedVersion) throw new AppError(409, 'STALE_RUBRIC', 'This suggestion changed in another window. Reload to continue.', { version: a?.version ?? 0 });
  let details = a?.details as unknown as AnnotationDetails | undefined;
  let sources = (a?.sources as unknown as SourceLink[] | undefined) ?? [];
  if (!a) {
    const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, notes);
    const src = await taskSources(tx, ctx, lib.documents);
    const x = derive(deriveInput(ctx, lib.documents, src.items)).additions.find((y) => y.id === id);
    if (!x) throw new AppError(404, 'NOT_FOUND', 'This suggestion is no longer offered.');
    details = x.details;
    sources = x.links;
    a = undefined;
  }
  const row = await appendAnnotation(tx, ctx, a, { criterionId: id, origin: a?.origin ?? 'RECOMMENDED', status: decision === 'KEEP' ? 'KEPT' : 'DISMISSED', details: details!, sources, editedFields: a?.editedFields ?? [], aiFields: a?.aiFields ?? [] }, actorId);
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: decision === 'KEEP' ? 'rubric.addition.kept' : 'rubric.addition.dismissed', after: { id, version: row.version } });
  return { version: row.version };
}

/** Tick, untick or add sources (only refs the view offered). Links of every criterion follow; edits are kept. */
export async function saveSources(tx: Tx, ctx: RubricContext, body: { expectedVersion: number; ticked: string[]; added: string[] }, actorId: string, audit: Audit, notes?: RuleAnnotationSource) {
  const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId, notes);
  const cur = await taskSources(tx, ctx, lib.documents);
  if (cur.version !== body.expectedVersion) throw new AppError(409, 'STALE_SOURCES', 'The sources changed in another window. Reload to continue.', { version: cur.version });
  const unknown = body.added.filter((r) => !cur.available.some((a) => a.ref === r));
  if (unknown.length) throw new AppError(422, 'UNKNOWN_SOURCE', 'Choose sources from the list. Sources cannot be typed.', { unknown });
  const all = [...cur.items, ...cur.available.filter((a) => body.added.includes(a.ref)).map((a) => ({ ...a, origin: 'ADDED' as const }))];
  const notListed = body.ticked.filter((r) => !all.some((a) => a.ref === r));
  if (notListed.length) throw new AppError(422, 'UNKNOWN_SOURCE', 'Choose sources from the list. Sources cannot be typed.', { unknown: notListed });
  const items = all.map((a) => ({ ...a, ticked: body.ticked.includes(a.ref) }));
  const row = await tx.rubricTaskSources.create({ data: { clientId: ctx.task.clientId, taskInstanceId: ctx.task.id, version: cur.version + 1, items: items as unknown as Prisma.InputJsonValue, createdById: actorId } });
  const derived = derive(deriveInput(ctx, lib.documents, items));
  const n = await mergeDerivation(tx, ctx, derived, actorId);
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.sources.saved', before: { version: cur.version }, after: { version: row.version, ticked: body.ticked.length, added: body.added, annotationsWritten: n } });
  return { version: row.version };
}

/**
 * Restore a criterion to a previous saved version (existing history): the S7 item as submitted in that
 * TaskSubmission (returned for the editor to apply through autosave) and the annotation as it stood then (appended).
 */
export async function restoreCriterion(tx: Tx, ctx: RubricContext, criterionId: string, submissionVersion: number, actorId: string, audit: Audit) {
  const sub = await tx.taskSubmission.findFirst({ where: { taskInstanceId: ctx.task.id, version: submissionVersion } });
  if (!sub) throw new AppError(404, 'NOT_FOUND', 'That saved version does not exist.');
  const out = isObj(sub.output) ? sub.output : {};
  const s = isObj(out.sections) ? (out.sections as Record<string, Record<string, unknown>>)[ctx.rubric.section] : undefined;
  const list = Array.isArray(s?.[ctx.rubric.fieldKey]) ? (s![ctx.rubric.fieldKey] as unknown[]).filter(isObj) : [];
  const item = list.find((i) => i.id === criterionId) ?? null;
  const then = await tx.rubricCriterionAnnotation.findFirst({ where: { taskInstanceId: ctx.task.id, criterionId, createdAt: { lte: sub.submittedAt } }, orderBy: { version: 'desc' } });
  const ann = await latestAnnotations(tx, ctx.task.id);
  const a = ann.get(criterionId);
  let version = a?.version ?? 0;
  if (then && a && then.id !== a.id) {
    const row = await appendAnnotation(tx, ctx, a, { criterionId, origin: then.origin, status: then.status, details: then.details as unknown as AnnotationDetails, sources: then.sources as unknown as SourceLink[], editedFields: then.editedFields, aiFields: then.aiFields }, actorId);
    version = row.version;
  }
  await audit({ entityType: 'TaskInstance', entityId: ctx.task.id, action: 'rubric.criterion.restored', after: { criterionId, submissionVersion, annotationVersion: version } });
  return { item: item ? withTemplateTechnical(ctx.rubric, item) : null, annotationVersion: version };
}

// ───────────────────────── Save normalisation and submit checks (flag on) ─────────────────────────

/** D9: on save, a mapped criterion's evaluator kind and version are set from the template (correct values unchanged). */
export function normaliseRubricOutput(task: TaskWithTemplate, output: Record<string, unknown>): Record<string, unknown> {
  const ctx = rubricContext({ ...task, output: output as Prisma.JsonValue });
  if (!ctx || !ctx.rubric.fixedSet) return output;
  const sections = isObj(output.sections) ? (output.sections as Record<string, Record<string, unknown>>) : null;
  const list = sections?.[ctx.rubric.section]?.[ctx.rubric.fieldKey];
  if (!Array.isArray(list)) return output;
  let changed = false;
  const next = list.map((x) => {
    if (!isObj(x)) return x;
    const y = withTemplateTechnical(ctx.rubric, x);
    if (y !== x) changed = true;
    return y;
  });
  if (!changed) return output;
  return { ...output, sections: { ...sections, [ctx.rubric.section]: { ...sections![ctx.rubric.section], [ctx.rubric.fieldKey]: next } } };
}

/** D8: every template criterion is present; D6: every S4 policy reference is a published document of the project. */
export async function rubricSubmitChecks(tx: Db | Tx, task: TaskWithTemplate) {
  const ctx = rubricContext(task);
  if (!ctx) return [];
  const checks: { id: string; section: string; ok: boolean; message: string; severity?: 'warning' }[] = [];
  if (ctx.rubric.fixedSet) {
    const have = new Set(rubricItems(ctx).map((i) => i.id));
    const missing = ctx.rubric.criteria.filter((c) => !have.has(c.id)).map((c) => c.id);
    checks.push({ id: 'rubric.template-criteria', section: ctx.rubric.section, ok: !missing.length, message: missing.length ? `Keep every criterion the template defines; missing: ${missing.join(', ')}` : 'Every criterion the template defines is in the rubric' });
  }
  const pf = policyReferenceField(ctx.profile);
  if (pf) {
    const lib = await policyLibrary(tx, ctx.task.clientId, ctx.task.projectId);
    const sections = isObj(ctx.output.sections) ? (ctx.output.sections as Record<string, Record<string, unknown>>) : {};
    const items = (Array.isArray(sections[pf.section]?.[pf.field.key]) ? (sections[pf.section]![pf.field.key] as unknown[]).filter(isObj) : []) as Record<string, unknown>[];
    const bad = items.filter((it) => {
      const sha = Object.entries(it).find(([k]) => /sha256/i.test(k))?.[1];
      return !lib.documents.some((d) => d.sha256 === sha && d.policyId === it.ruleId && d.version === it.ruleVersion);
    });
    // A warning, not a blocker: the picker already stops typing, and RL Gym has yet to confirm which identities its
    // v6/v7 grader expects (manifest vs template-supplied), so existing typed references and the QA smoke job still submit.
    checks.push({ id: 'policy.library-reference', section: pf.section, severity: 'warning', ok: !bad.length, message: bad.length ? `Pick policies from the project’s library; ${bad.length} reference${bad.length === 1 ? ' does' : 's do'} not match a published document version` : 'Every policy reference is a published document of this project' });
  }
  return checks;
}
