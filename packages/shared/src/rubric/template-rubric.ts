import type { CriterionDefault, SectionKey, TemplateProfile, TemplateProfileField } from '../template-profile/schema';
import { newItem } from '../template-profile/helpers';

/**
 * What the selected template version says about its rubric: the criterion field, its scale and points, the criterion
 * IDs it maps to evaluators (`execution.evaluators[]`), the template defaults (D8) and the technical grading settings
 * (D9). Read only from template data, never guessed: a missing mapping stays missing ("Evaluation setup needed").
 */

export interface EvaluatorRef {
  id: string;
  version: string;
  evidenceSource: string;
}

export interface ScoreKey {
  key: 'passCondition' | 'partialCredit' | 'level3' | 'level2' | 'level1' | 'failCondition';
  label: string;
  points: number;
  required: boolean;
}

export interface TemplateCriterion {
  id: string;
  /** Template default (D8), or null when the template version has none. */
  defaults: CriterionDefault | null;
  evaluator: EvaluatorRef | null;
}

export interface TemplateRubric {
  section: SectionKey;
  fieldKey: string;
  field: TemplateProfileField;
  scale: 'five_two_zero' | 'zero_to_four';
  scoreKeys: ScoreKey[];
  /** The template maps criterion IDs to evaluators: the set is fixed (RL Gym grades by ID). */
  fixedSet: boolean;
  criteria: TemplateCriterion[];
  /** Weights are structured template data (D8 defaults or groups), never parsed from help prose. */
  weightsFromTemplate: boolean;
  /** Whether "a Fail on this criterion fails the whole task" is what the template's configuration supports. */
  criterionFailureSupported: boolean;
  /** Plain-English rule shown under "Whole-task failure". */
  wholeTaskRule: string;
  outputSchema: { properties: string[]; enums: Record<string, string[]> };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function scoreKeysFor(scale: TemplateRubric['scale']): ScoreKey[] {
  return scale === 'zero_to_four'
    ? [
        { key: 'passCondition', label: 'Level 4', points: 4, required: true },
        { key: 'level3', label: 'Level 3', points: 3, required: false },
        { key: 'level2', label: 'Level 2', points: 2, required: true },
        { key: 'level1', label: 'Level 1', points: 1, required: false },
        { key: 'failCondition', label: 'Level 0', points: 0, required: true },
      ]
    : [
        { key: 'passCondition', label: 'Pass', points: 5, required: true },
        { key: 'partialCredit', label: 'Partial', points: 2, required: true },
        { key: 'failCondition', label: 'Fail', points: 0, required: true },
      ];
}

/** The rubric field of a profile: the contract's criteria reference, else the first criterion field. */
export function rubricField(profile: TemplateProfile): { section: SectionKey; field: TemplateProfileField } | null {
  const ref = profile.contract?.criteria;
  if (ref) {
    const [s, k] = ref.split('.') as [SectionKey, string];
    const f = profile.sections.find((x) => x.key === s)?.fields.find((x) => x.key === k);
    if (f?.type === 'criterion') return { section: s, field: f };
  }
  for (const s of profile.sections) for (const f of s.fields) if (f.type === 'criterion') return { section: s.key, field: f };
  return null;
}

/** Evaluator map of a template's execution part: criterion ID -> evaluator (same reading as the export). */
export function evaluatorsOf(execution: unknown): Map<string, EvaluatorRef> {
  const out = new Map<string, EvaluatorRef>();
  const list = isObj(execution) && Array.isArray(execution.evaluators) ? execution.evaluators : [];
  for (const e of list as { criterion_id?: unknown; capability?: { id?: unknown; version?: unknown }; evidence_source?: unknown }[])
    if (typeof e?.criterion_id === 'string' && typeof e.capability?.id === 'string' && typeof e.capability.version === 'string')
      out.set(e.criterion_id, { id: e.capability.id, version: e.capability.version, evidenceSource: typeof e.evidence_source === 'string' ? e.evidence_source : '' });
  return out;
}

/**
 * `authoringDefaults` (D8, non-integration): default criteria kept in Authoring for an evaluator, used only when the
 * template's own field carries none. They never change the template or the export.
 */
export function templateRubric(profile: TemplateProfile, execution: unknown, authoringDefaults: CriterionDefault[] = []): TemplateRubric | null {
  const rf = rubricField(profile);
  if (!rf) return null;
  const scale = rf.field.scale ?? 'five_two_zero';
  const map = evaluatorsOf(execution);
  const defaults = rf.field.criterionDefaults ?? (scale === 'five_two_zero' || authoringDefaults.every((d) => d.partialCredit === undefined) ? authoringDefaults.filter((d) => map.has(d.id)) : []);
  const ids = [...map.keys(), ...defaults.map((d) => d.id).filter((id) => !map.has(id))];
  const criteria = ids.map((id) => ({ id, defaults: defaults.find((d) => d.id === id) ?? null, evaluator: map.get(id) ?? null }));
  const schema = isObj(execution) && isObj(execution.output_schema) ? execution.output_schema : {};
  const props = isObj(schema.properties) ? schema.properties : {};
  const enums: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(props)) if (isObj(v) && Array.isArray(v.enum)) enums[k] = v.enum.map(String);
  const criterionFailureSupported = scale === 'five_two_zero';
  return {
    section: rf.section,
    fieldKey: rf.field.key,
    field: rf.field,
    scale,
    scoreKeys: scoreKeysFor(scale),
    fixedSet: map.size > 0,
    criteria,
    weightsFromTemplate: defaults.some((d) => d.weight !== undefined) || !!rf.field.groups?.length,
    criterionFailureSupported,
    wholeTaskRule: criterionFailureSupported
      ? 'In this template, when a whole-task failure criterion scores Fail (0), the whole task fails, whatever the other scores. A Partial doesn’t fail the task.'
      : 'In this template, a criterion’s level doesn’t fail the whole task by itself. Whole-task failures are the template’s own critical rules.',
    outputSchema: { properties: Object.keys(props), enums },
  };
}

/** Readable name from a criterion ID when the template gives none ("account_authority" -> "Account authority"). */
export const nameFromId = (id: string) => {
  const s = id.replace(/[_.-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * D8 seeding: the template's criteria listed in S7, in the template's order, with the template defaults filled in.
 * Existing items are kept exactly as they are (and stay first, in their order); only missing template criteria are
 * added. D9: mapped criteria carry the evaluator and version from the template.
 */
export function seedCriteria(tr: TemplateRubric, existing: unknown): Record<string, unknown>[] {
  const list = (Array.isArray(existing) ? existing.filter(isObj) : []) as Record<string, unknown>[];
  const have = new Set(list.map((x) => x.id));
  const out = list.map((x) => withTemplateTechnical(tr, x));
  for (const c of tr.criteria) {
    if (have.has(c.id)) continue;
    const item = newItem(tr.field, out);
    const d = c.defaults;
    item.id = c.id;
    item.name = d?.name ?? nameFromId(c.id);
    if ('weight' in item) item.weight = d?.weight ?? null;
    for (const k of tr.scoreKeys) if (k.key in item || d?.[k.key] !== undefined) item[k.key] = d?.[k.key] ?? '';
    if ('critical' in item) item.critical = d?.critical === true;
    if (d?.group !== undefined && 'group' in item) item.group = d.group;
    out.push(withTemplateTechnical(tr, item));
  }
  return out;
}

/** D9: a mapped criterion's evaluator kind and version always come from the template (read-only to the author). */
export function withTemplateTechnical(tr: TemplateRubric, item: Record<string, unknown>): Record<string, unknown> {
  const ev = typeof item.id === 'string' ? tr.criteria.find((c) => c.id === item.id)?.evaluator : null;
  if (!ev) return item;
  if (item.evaluatorKind === ev.id && item.evaluatorVersion === ev.version) return item;
  return { ...item, evaluatorKind: ev.id, evaluatorVersion: ev.version };
}

/** D8: the item fields that differ from the template default (the reviewer sees these as "Edited"). */
export function changedFromDefault(tr: TemplateRubric, item: Record<string, unknown>): string[] {
  const d = tr.criteria.find((c) => c.id === item.id)?.defaults;
  if (!d) return [];
  const keys = ['name', 'weight', 'critical', ...tr.scoreKeys.map((k) => k.key)] as const;
  return keys.filter((k) => {
    const dv = (d as unknown as Record<string, unknown>)[k];
    if (dv === undefined) return false;
    const v = item[k];
    return k === 'critical' ? (v === true) !== (dv === true) : String(v ?? '') !== String(dv);
  });
}

export interface TechnicalRow {
  label: string;
  value: string;
  /** "From template", "Not used" or "No mapping". */
  note: string;
}

const EVIDENCE_SOURCE_LABEL: Record<string, string> = { run_evidence: 'Recorded run', output: 'Final answer (output file)' };

/** Technical grading settings · From template (read-only, D9 + owner spec §6). Nothing here is ever guessed. */
export function technicalSettings(tr: TemplateRubric, item: Record<string, unknown>): TechnicalRow[] {
  const ev = typeof item.id === 'string' ? (tr.criteria.find((c) => c.id === item.id)?.evaluator ?? null) : null;
  const rows: TechnicalRow[] = [];
  if (!ev) {
    rows.push({ label: 'Evaluator', value: '—', note: 'No mapping' }, { label: 'Evaluator version', value: '—', note: 'No mapping' });
  } else {
    rows.push({ label: 'Evaluator', value: ev.id, note: 'From template' }, { label: 'Evaluator version', value: ev.version, note: 'From template' });
    rows.push({ label: 'Evidence source', value: EVIDENCE_SOURCE_LABEL[ev.evidenceSource] ?? (ev.evidenceSource || '—'), note: 'From template' });
  }
  const compares = ev?.evidenceSource === 'output';
  for (const [k, label] of [['outputField', 'Output field'], ['comparison', 'Comparison'], ['expectedValue', 'Expected value']] as const)
    rows.push(compares ? { label, value: String(item[k] ?? '') || '—', note: 'From template' } : { label, value: '—', note: 'Not used' });
  const d = tr.criteria.find((c) => c.id === item.id)?.defaults;
  if ('weight' in item || d?.weight !== undefined) rows.push({ label: 'Weight', value: item.weight == null ? '—' : String(item.weight), note: d?.weight !== undefined || tr.field.groups?.length ? 'From template' : 'Not set by the template' });
  rows.push({ label: 'Scale', value: tr.scoreKeys.map((k) => `${k.label} ${k.points}`).join(' · '), note: 'From template' });
  return rows;
}

/** "How it will be checked", from the template configuration. Never says "Ready": a mapping is not runtime readiness. */
export function howChecked(tr: TemplateRubric, criterionId: string): { text: string | null; setupNeeded: boolean } {
  const ev = tr.criteria.find((c) => c.id === criterionId)?.evaluator ?? null;
  if (!ev) return { text: null, setupNeeded: true };
  const how =
    ev.evidenceSource === 'run_evidence'
      ? 'RL Gym scores this from the recorded run (the tool calls, documents read, findings and recommendation)'
      : ev.evidenceSource === 'output'
        ? 'RL Gym compares the final answer’s output field with the expected value'
        : 'RL Gym scores this';
  return { text: `${how} with the template’s evaluator ${ev.id}, version ${ev.version}. This mapping comes from the template; whether the evaluator is installed and calibrated is confirmed in RL Gym, not here.`, setupNeeded: false };
}
