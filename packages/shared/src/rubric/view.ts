import type { CriterionDefault } from '../template-profile/schema';
import type { AnnotationDetails, EditableDetail, SourceLink, TaskSourceItem } from './schema';
import type { ScoreKey, TechnicalRow } from './template-rubric';

/** What `GET /me/tasks/:id/rubric` (and the read-only console and Reviewer views) return. */

export type LinkState = 'OK' | 'CHANGED' | 'REMOVED';
export type ViewLink = SourceLink & { state: LinkState; currentExcerpt?: string };
export type CriterionOrigin = 'TEMPLATE' | 'TEMPLATE_DEFAULT' | 'RECOMMENDED' | 'AI_RECOMMENDED' | 'CUSTOM';

export interface RubricCriterionView {
  id: string;
  origin: CriterionOrigin;
  /** In the template's evaluator map (or the template has none): it reaches RL Gym through the existing S7 fields. */
  exportable: boolean;
  annotationVersion: number;
  details: AnnotationDetails;
  editedFields: string[];
  /** Detail fields whose value is an unedited AI suggestion (labelled "AI suggestion"). */
  aiFields: string[];
  links: ViewLink[];
  needs: string[];
  sourceChanged: boolean;
  defaults: CriterionDefault | null;
  changedFromDefault: string[];
  technical: TechnicalRow[];
  howChecked: { text: string | null; setupNeeded: boolean };
  /** Regeneration found a different suggestion for a field the author edited: shown, never applied. */
  proposed: Partial<Record<EditableDetail, unknown>>;
}

export interface RubricAdditionView {
  id: string;
  name: string;
  status: 'SUGGESTED' | 'KEPT';
  internalOnly: boolean;
  ai: boolean;
  annotationVersion: number;
  details: AnnotationDetails;
  links: ViewLink[];
}

export interface RubricView {
  aiEnabled: boolean;
  template: { id: string; version: number; scale: 'five_two_zero' | 'zero_to_four'; scoreKeys: ScoreKey[]; fixedSet: boolean; wholeTaskRule: string; criterionFailureSupported: boolean; weightsFromTemplate: boolean; /** D-029: the S7 weight total from the live template; null = no fixed total. */ weightTotal?: number | null; weightTotalSource?: 'template_field' | 'template_criteria' | 'none' };
  rubric: { section: string; fieldKey: string };
  /** D8: the S7 criteria with the template's missing criteria added (null when nothing is missing). */
  seed: Record<string, unknown>[] | null;
  criteria: RubricCriterionView[];
  additions: RubricAdditionView[];
  sources: { version: number; items: TaskSourceItem[]; available: TaskSourceItem[] };
  coverage: { total: number; covered: number; gaps: { key: string; label: string }[]; duplicates: { requirement: string; criteria: string[] }[] };
  unused: { section: string; field: string; label: string; reason: string }[];
  run: { id: string; mode: string; model: string | null; createdAt: string } | null;
  /** Saved (submitted) versions of the task, for Restore (existing history). */
  history: { version: number; submittedAt: string }[];
  internalOnly: readonly string[];
}

export type ToFinishKind = 'SOURCE_NEEDED' | 'SOURCE_CHANGED' | 'APPLICABILITY_UNSET' | 'SCORE_MISSING' | 'WHOLE_TASK_CONDITION' | 'EVALUATION_SETUP' | 'COVERAGE_GAP' | 'DUPLICATE_WEIGHT';
export interface ToFinish {
  kind: ToFinishKind;
  criterionId: string | null;
  message: string;
}

const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/**
 * The "still to finish" list (owner spec §7): missing source links, undefined applicability, missing scoring text,
 * incomplete whole-task failure conditions and missing technical mappings, plus coverage gaps and duplicate weighting.
 * Saving never waits for these; submit keeps its own existing checks.
 */
export function rubricToFinish(view: RubricView, items: Record<string, unknown>[]): ToFinish[] {
  const out: ToFinish[] = [];
  for (const c of view.criteria) {
    const item = items.find((i) => i.id === c.id) ?? {};
    for (const n of c.needs) out.push({ kind: 'SOURCE_NEEDED', criterionId: c.id, message: `Source link needed (${n.toLowerCase()}): tick or add one under Sources used for this task` });
    if (c.sourceChanged) out.push({ kind: 'SOURCE_CHANGED', criterionId: c.id, message: 'Source changed — check rubric' });
    if (c.details.applicability.kind === 'UNSET' || c.details.applicability.kind === 'UNKNOWN') out.push({ kind: 'APPLICABILITY_UNSET', criterionId: c.id, message: 'When does this apply? is not set' });
    if (c.details.applicability.kind === 'REQUIRED_WHEN' && !text(c.details.applicability.condition)) out.push({ kind: 'APPLICABILITY_UNSET', criterionId: c.id, message: 'The condition for when this applies is empty' });
    const missing = view.template.scoreKeys.filter((k) => k.required && !text(item[k.key])).map((k) => k.label);
    if (missing.length) out.push({ kind: 'SCORE_MISSING', criterionId: c.id, message: `${missing.join(', ')} description missing` });
    if (item.critical === true && !text(c.details.wholeTaskFailure?.condition)) out.push({ kind: 'WHOLE_TASK_CONDITION', criterionId: c.id, message: 'Whole-task failure condition is empty' });
    if (item.critical === true && (c.details.wholeTaskFailure?.kind === 'OTHER_BEHAVIOUR' || !view.template.criterionFailureSupported)) out.push({ kind: 'EVALUATION_SETUP', criterionId: c.id, message: 'Whole-task failure needs evaluation setup' });
    if (c.howChecked.setupNeeded && view.template.fixedSet) out.push({ kind: 'EVALUATION_SETUP', criterionId: c.id, message: 'No technical mapping in the template (evaluation setup needed)' });
  }
  for (const a of view.additions) {
    if (a.details.applicability.kind === 'UNSET') out.push({ kind: 'APPLICABILITY_UNSET', criterionId: a.id, message: `Suggested addition “${a.name}”: applicability not set` });
    out.push({ kind: 'EVALUATION_SETUP', criterionId: a.id, message: `Suggested addition “${a.name}”: no technical mapping (evaluation setup needed)` });
  }
  for (const g of view.coverage.gaps) out.push({ kind: 'COVERAGE_GAP', criterionId: null, message: `Not covered by any criterion: ${g.label}` });
  for (const d of view.coverage.duplicates) out.push({ kind: 'DUPLICATE_WEIGHT', criterionId: null, message: `${d.requirement} is weighted by ${d.criteria.join(' and ')}: check for duplicate scoring` });
  return out;
}

/**
 * Display-time wording for template text (D5 / legal rule): users never see the internal names. Template data stays
 * exactly as received (it is hashed); only what is shown changes. Used where RUBRIC_RECOMMENDATIONS_ENABLED is on.
 */
export function publicText(s: string): string {
  return s.replace(/\bADI-Labs\b/g, 'ADI Forge').replace(/\bAnvil\b/g, 'RL Gym').replace(/\bPraxis\b/g, 'ADI Forge');
}
