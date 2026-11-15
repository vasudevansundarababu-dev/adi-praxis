import { MARKING_LABEL, RuleAnnotationInput, ruleApplicability, type AnnotationFlag, type ApplicabilityOutcome, type MandatoryMarking, type RuleAnnotation } from '@praxis/shared';

/** Annotation fields of a rules-table row (GET /policy/rules), unit-tested without a browser. */
export interface AnnotationSource {
  source: 'AI_SUGGESTION' | 'AUTHOR_EDIT';
  editedRole: string | null;
  at: string;
  model: string | null;
}
export interface PendingSuggestion {
  id: string;
  annotationVersion: number;
  model: string | null;
  createdAt: string;
  annotation: RuleAnnotation;
}
export interface AnnotatedRow {
  ruleKey: string;
  annotation?: RuleAnnotation | null;
  annotationSource?: AnnotationSource | null;
  pendingAiSuggestion?: PendingSuggestion | null;
  flags?: AnnotationFlag[];
  effective?: { from: string | null; to: string | null };
}

/** A new annotation with every detail unknown (nothing is invented), starting from the chosen marking. */
export const blankAnnotation = (marking: MandatoryMarking): RuleAnnotationInput => RuleAnnotationInput.parse({ marking, classification: marking === 'needs_clarification' ? 'unresolved' : marking === 'permitted_option' ? 'permission' : marking === 'required_reference' ? 'definition' : 'obligation' });

/** The annotation to save when only the marking changes (inline edit on the table). */
export function withMarking(a: RuleAnnotation | null | undefined, marking: MandatoryMarking): RuleAnnotationInput {
  if (!a) return blankAnnotation(marking);
  const { version: _v, ...rest } = a;
  return { ...rest, marking };
}

/** "AI suggestion" or "Edited by PM, v3": never presents an AI suggestion as a person's decision. */
export function sourceLabel(r: AnnotatedRow): string {
  if (!r.annotation) return 'Not annotated';
  const s = r.annotationSource;
  if (!s || s.source === 'AI_SUGGESTION') return `AI suggestion · v${r.annotation.version}`;
  return `Edited${s.editedRole ? ` by ${s.editedRole === 'ADMIN' ? 'Admin' : s.editedRole}` : ''} · v${r.annotation.version}`;
}

export type MarkingFilter = 'all' | MandatoryMarking | 'not_annotated' | 'flagged';
export const MARKING_FILTERS: Array<{ value: MarkingFilter; label: string }> = [
  { value: 'all', label: 'All markings' },
  ...(Object.entries(MARKING_LABEL) as Array<[MandatoryMarking, string]>).map(([value, label]) => ({ value, label })),
  { value: 'not_annotated', label: 'Not annotated' },
  { value: 'flagged', label: 'Has flags (missing details, conflicts, links)' },
];

export function byMarking<R extends AnnotatedRow>(rows: R[], f: MarkingFilter): R[] {
  if (f === 'all') return rows;
  if (f === 'not_annotated') return rows.filter((r) => !r.annotation);
  if (f === 'flagged') return rows.filter((r) => (r.flags ?? []).some((x) => x.code !== 'UNKNOWN_FIELD' || !r.annotation));
  return rows.filter((r) => r.annotation?.marking === f);
}

export const OUTCOME_LABEL: Record<ApplicabilityOutcome, string> = {
  applies: 'Applies',
  trigger_to_check: 'Applies if its trigger is met',
  out_of_scope: 'Out of scope',
  other_role: 'Another role’s duty',
  unknown: 'Applicability unknown',
};

/**
 * "Show rules for: <application type> / <state>" (spec §5, AC9). Uses the rule's own scope and the application's
 * attributes only — never the project name or an example state. Out-of-scope rules are hidden; unknown stays visible.
 */
export function forApplication<R extends AnnotatedRow>(rows: R[], c: { applicationType: string; governingState: string }): Array<R & { outcome: ApplicabilityOutcome }> {
  if (!c.applicationType && !c.governingState) return rows.map((r) => ({ ...r, outcome: ruleApplicability(r.annotation, { applicationType: null, governingState: null }) }));
  return rows
    .map((r) => ({ ...r, outcome: ruleApplicability(r.annotation, { applicationType: c.applicationType || null, governingState: c.governingState || null }, r.effective ?? null) }))
    .filter((r) => r.outcome !== 'out_of_scope');
}

/** Application types offered in the filter: those any rule names (the template's case-selector values in KYC v7). */
export function applicationTypeOptions(rows: AnnotatedRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.annotation?.applicationTypes.kind === 'listed' ? r.annotation.applicationTypes.items : [])))].sort();
}
