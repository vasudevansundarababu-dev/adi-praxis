import { z } from 'zod';
import { edgeCasesOf, type EdgeCase, type FamilyFocus } from './benchmark';

/**
 * E-001 §6b (owner, 24 Nov 2026): edge cases are grouped into families, each with variants. SMEs (practising bankers)
 * own them: they create families, write the expected outcome for every variant and choose which variants count. A task
 * focuses on a family and takes every variant that counts, including variants added later, with no re-authoring.
 *
 * Defaults while the owner's answers are open (marked so the owner may change them):
 * - a. a second SME or SME Reviewer checks each outcome before it is generated;
 * - b. an outcome is a decision, a rationale and the evidence to cite;
 * - c. outcome batches count as SME time (reporting only);
 * - d. a task sets which variants count; a run can only narrow them;
 * - e. SMEs can add variants too.
 *
 * Studio's catalog (edge-case-catalog.v2) is the source when it answers; until then each of the template's S4 edge
 * cases is its own family with one variant, so nothing changes for existing tasks.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ID = /^[a-z0-9][a-z0-9_.:-]{0,99}$/;
const TAG = /^[a-z][a-z0-9_]{0,63}$/;
/** The pseudonym of a person who wrote or checked an outcome: an SME, or the owner acting as Admin for an SME. */
export const PERSON = /^(sme|admin)-[0-9a-f]{8}$/;

export const VARIANT_STATES = ['proposed', 'waiting_outcome', 'outcome_written', 'needs_recipe', 'needs_environment_change', 'leaks_answer', 'generating', 'available', 'retired'] as const;

/** A variant state in plain words (Studio's catalog states). */
export const VARIANT_STATE_LABEL: Record<VariantState, string> = { proposed: 'proposed', waiting_outcome: 'waiting for an SME outcome', outcome_written: 'outcome written, cases not generated yet', needs_recipe: 'waiting for recipe (environment author or RL Engineer)', needs_environment_change: 'needs a change to the benchmark environment', leaks_answer: 'its recipe would leak the answer: being fixed', generating: 'cases being generated', available: 'available', retired: 'retired' };
export type VariantState = (typeof VARIANT_STATES)[number];

export interface EdgeVariant {
  variantId: string;
  /** The case tag the RL Gym matches on. */
  tag: string;
  name: string;
  description: string;
  /** A boundary case, in words (an applicant exactly 18 today, a document expiring today). */
  boundary: string | null;
  proposedBy: 'sme' | 'rl_engineer' | 'template';
  state: VariantState;
  /** Whether an outcome is on record (the outcome itself is private to SMEs, PMs and the RL Engineer). */
  hasOutcome: boolean;
  /** True when no person has confirmed the outcome yet (waiting, or carried over by a migration). */
  needsConfirmation: boolean;
  /** The outcome on record, for the people who confirm it (never shown to the agent). */
  outcome: { decision: string | null; fields: Record<string, string>; rationale: string; evidence: string[]; writtenBy: string } | null;
  /** An outcome Studio proposes for a person to confirm or change (a fixture's current reference answer). */
  proposedOutcome: { decision: string | null; fields: Record<string, string>; rationale: string; evidence: string[]; writtenBy: string } | null;
  /** variant, boundary or fixture. A fixture is a verification control: never sampled into a task. */
  kind: string;
  casesAvailable: number | null;
}

/** A reference field an outcome sets (from the environment's reference answers), in plain words. */
export interface OutcomeField {
  name: string;
  label: string;
  help: string;
  required: boolean;
  allowedValues: string[] | null;
  /** Free-text fields: values seen in the cases, offered as hints (any text is accepted). */
  suggestedValues: string[];
}

export interface EdgeFamily {
  familyId: string;
  name: string;
  description: string;
  archetype: string | null;
  complexity: string | null;
  products: string[];
  variants: EdgeVariant[];
  /** Where the family came from: Studio's catalog, or the template's S4 list (one family per edge case). */
  source: 'catalog' | 'template';
}

/** The families of a template: from Studio's edge-case-catalog.v2 when given, else one family per S4 edge case. */
export function familiesOf(catalog: unknown, s4EdgeCases: unknown): EdgeFamily[] {
  if (isObj(catalog) && catalog.schema === 'edge-case-catalog.v2' && Array.isArray(catalog.families)) {
    return catalog.families.filter(isObj).flatMap((f) => {
      const familyId = str(f.family_id);
      if (!ID.test(familyId)) return [];
      const variants = (Array.isArray(f.variants) ? f.variants : []).filter(isObj).flatMap((v): EdgeVariant[] => {
        const variantId = str(v.variant_id);
        const tag = str(v.tag);
        if (!ID.test(variantId) || !TAG.test(tag)) return [];
        const state = (VARIANT_STATES as readonly string[]).includes(str(v.state)) ? (str(v.state) as VariantState) : 'proposed';
        const read = (o: Record<string, unknown> | null) => {
          if (!o) return null;
          // A proposed outcome may carry its fields flat (recommendation, request_type, ...) or as {decision, fields}.
          const flat = !isObj(o.fields) && !('decision' in o);
          const fields = isObj(o.fields) ? o.fields : flat ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'recommendation')) : {};
          return { decision: str(o.decision) || str(o.recommendation) || null, fields: Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, String(x ?? '')])), rationale: str(o.rationale), evidence: Array.isArray(o.evidence) ? o.evidence.map(String) : [], writtenBy: str(o.written_by) };
        };
        const outcome = read(isObj(v.outcome) ? v.outcome : null);
        const proposedOutcome = read(isObj(v.proposed_outcome) ? v.proposed_outcome : null);
        const writtenBy = outcome?.writtenBy ?? '';
        // A person confirmed it when it was written by an SME or an Admin pseudonym; a migrated outcome still needs one.
        const needsConfirmation = state !== 'retired' && (!outcome || !PERSON.test(writtenBy));
        return [{ variantId, tag, name: str(v.name) || tag, description: str(v.description), boundary: str(v.boundary) || null, proposedBy: v.proposed_by === 'rl_engineer' ? 'rl_engineer' : 'sme', state, hasOutcome: !!outcome, needsConfirmation, outcome, proposedOutcome, kind: str(v.kind) || 'variant', casesAvailable: Number.isInteger(v.cases_available) ? (v.cases_available as number) : null }];
      });
      return [{ familyId, name: str(f.name) || familyId, description: str(f.description), archetype: str(f.archetype) || null, complexity: str(f.complexity) || null, products: Array.isArray(f.products) ? f.products.map(String) : [], variants, source: 'catalog' as const }];
    });
  }
  return edgeCasesOf(s4EdgeCases).map((e: EdgeCase) => ({
    familyId: e.tag,
    name: e.name || e.tag,
    description: [e.context, e.twist].filter(Boolean).join(' '),
    archetype: e.archetype,
    complexity: e.complexity,
    products: e.products,
    variants: [{ variantId: e.tag, tag: e.tag, name: e.name || e.tag, description: e.twist || e.context, boundary: null, proposedBy: 'template', state: 'available', hasOutcome: true, needsConfirmation: false, outcome: null, proposedOutcome: null, kind: 'variant', casesAvailable: null }],
    source: 'template',
  }));
}

/** The outcome fields of a catalog (edge-case-catalog.v2 outcome_fields), in plain words. */
export function outcomeFieldsOf(catalog: unknown): OutcomeField[] {
  if (!isObj(catalog) || !Array.isArray(catalog.outcome_fields)) return [];
  return catalog.outcome_fields.filter(isObj).flatMap((f) => (str(f.name) ? [{ name: str(f.name), label: str(f.label) || str(f.name), help: str(f.help), required: f.required === true, allowedValues: Array.isArray(f.allowed_values) && f.allowed_values.length ? f.allowed_values.map(String) : null, suggestedValues: Array.isArray(f.suggested_values) ? f.suggested_values.map(String) : [] }] : []));
}

/** The family a stored single edge case belongs to, read at display time (never written back to the task). */
export const familyOfTag = (families: EdgeFamily[], tag: string | null) => (tag ? (families.find((f) => f.variants.some((v) => v.tag === tag)) ?? null) : null);

/** A variant a task or run may count: it has an SME outcome and is not retired. */
export const variantUsable = (v: EdgeVariant) => v.kind !== 'fixture' && v.hasOutcome && !['retired', 'proposed', 'waiting_outcome', 'needs_recipe', 'needs_environment_change', 'leaks_answer'].includes(v.state);

/** The variant tags a focus covers today (what the export sends the RL Gym), or problems with the focus. */
export function focusTags(focus: FamilyFocus, families: EdgeFamily[]): { tags: string[]; problems: string[] } {
  const f = families.find((x) => x.familyId === focus.familyId);
  if (!f) return { tags: [], problems: [`Edge-case family "${focus.familyId}" is not in this template's catalog.`] };
  const chosen = focus.variants === 'all' ? f.variants : f.variants.filter((v) => (focus.variants as string[]).includes(v.variantId));
  const problems: string[] = [];
  if (focus.variants !== 'all') for (const id of focus.variants) if (!f.variants.some((v) => v.variantId === id)) problems.push(`Variant "${id}" is not in the family "${f.name}".`);
  const usable = chosen.filter(variantUsable);
  if (!usable.length) problems.push(`No variant of "${f.name}" that counts has an SME outcome yet, so the task cannot focus on it.`);
  return { tags: [...new Set(usable.map((v) => v.tag))], problems };
}

/** A run narrows a task's variants (default d: a run can only narrow, never add). */
export function narrowForRun(taskTags: string[], runTags: string[] | null): string[] {
  if (!runTags) return taskTags;
  return taskTags.filter((t) => runTags.includes(t));
}

