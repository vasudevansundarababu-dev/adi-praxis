import {
  CUSTOM_FIELD_STAGES,
  CustomField,
  HarborBlueprint,
  sectionProblems,
  slugify,
  type BlueprintSection,
} from '@praxis/shared';

/** Pure editing helpers for the Meta-Compiler (Screen 2). Kept out of the components so they are unit-tested. */

export type CustomFieldStage = (typeof CUSTOM_FIELD_STAGES)[number];

export const SECTION_TITLES: Record<BlueprintSection, string> = {
  catalog: 'Catalog & Staffing',
  stage_1: 'Domain, Persona & Horizon',
  stage_2: 'Data & Oracle Bifurcation',
  stage_3: 'Mock Env & MCP Simulators',
  stage_4: 'Guardrails & Invariants',
  stage_5: 'Rubric Topology & Weights',
};

export const sectionNumber = (s: BlueprintSection) => (s === 'catalog' ? 0 : Number(s.slice(-1)));

/** Immutable edit: clone, mutate the draft, re-parse so defaults and shape stay valid. */
export function edit(bp: HarborBlueprint, mutate: (draft: HarborBlueprint) => void): HarborBlueprint {
  const draft = structuredClone(bp);
  mutate(draft);
  draft.harbor_contract.network_internal = true;
  return draft;
}

export const parseList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Integers summing to `total`, proportional to `weights` (largest remainder; even split when all are 0). */
export function distribute(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const raw = sum === 0 ? weights.map(() => total / weights.length) : weights.map((w) => (Math.max(0, w) * total) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest-- <= 0) break;
    out[i]! += 1;
  }
  return out;
}

/** Coupled sliders locked to 100% (S2-06): moving one rebalances the others proportionally. */
export function coupleWeights(weights: number[], index: number, value: number): number[] {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  if (weights.length === 1) return [100];
  const others = weights.filter((_, i) => i !== index);
  const rebalanced = distribute(others, 100 - v);
  return weights.map((_, i) => (i === index ? v : rebalanced[i < index ? i : i - 1]!));
}

export const stageForSection = (s: BlueprintSection): CustomFieldStage => (s === 'catalog' ? 'stage_1' : s);

export function allFieldIds(bp: HarborBlueprint): string[] {
  return CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s].map((f) => f.field_id));
}

export const customFieldCount = (bp: HarborBlueprint) => allFieldIds(bp).length;

/** A field_id from the label that no other field uses (S2-08 auto-slug). */
export function uniqueFieldId(bp: HarborBlueprint, label: string, ignore?: string): string {
  const taken = new Set(allFieldIds(bp).filter((id) => id !== ignore));
  const base = slugify(label || 'field').slice(0, 58);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function upsertField(bp: HarborBlueprint, stage: CustomFieldStage, field: CustomField, originalId?: string): HarborBlueprint {
  return edit(bp, (d) => {
    if (originalId !== undefined) for (const s of CUSTOM_FIELD_STAGES) d.custom_fields_by_stage[s] = d.custom_fields_by_stage[s].filter((f) => f.field_id !== originalId);
    d.custom_fields_by_stage[stage].push(field);
  });
}

export function deleteField(bp: HarborBlueprint, fieldId: string): HarborBlueprint {
  return edit(bp, (d) => {
    for (const s of CUSTOM_FIELD_STAGES) d.custom_fields_by_stage[s] = d.custom_fields_by_stage[s].filter((f) => f.field_id !== fieldId);
  });
}

/** Problems for one field, judged exactly like the server (schema + sectionProblems on the would-be blueprint). */
export function fieldProblems(bp: HarborBlueprint, stage: CustomFieldStage, field: CustomField, originalId?: string): string[] {
  const parsed = CustomField.safeParse(field);
  if (!parsed.success) return parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  const next = upsertField(bp, stage, parsed.data, originalId);
  return sectionProblems(next)[stage].filter((p) => p.includes(`"${field.field_id}"`));
}

/** Preset insertion (S2-14): the preset's field into the active stage, renamed if its id is taken. */
export function insertPreset(bp: HarborBlueprint, section: BlueprintSection, preset: CustomField): HarborBlueprint {
  const field = { ...structuredClone(preset), field_id: allFieldIds(bp).includes(preset.field_id) ? uniqueFieldId(bp, preset.field_id) : preset.field_id };
  return upsertField(bp, stageForSection(section), field);
}

export function emptyField(): CustomField {
  return { field_id: '', label: '', input_type: 'text_input', options: [], default_value: null, inject_into: [], verifier_assertion: '' };
}

/** Typed default from the dialog's raw input (S2-08: default must match the type). */
export function coerceDefault(type: CustomField['input_type'], raw: string | string[] | boolean): CustomField['default_value'] {
  switch (type) {
    case 'number_input':
    case 'currency_slider': {
      if (typeof raw !== 'string' || raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean_toggle':
      return raw === true || raw === 'true';
    case 'multi_select':
      return Array.isArray(raw) ? raw : [];
    default:
      return typeof raw === 'string' ? (type === 'single_select' && raw === '' ? null : raw) : null;
  }
}

export const isBlueprintEqual = (a: HarborBlueprint, b: HarborBlueprint) => JSON.stringify(a) === JSON.stringify(b);

export const parseBlueprint = (v: unknown) => HarborBlueprint.safeParse(v);
