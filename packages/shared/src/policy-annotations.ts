import { z } from 'zod';

/**
 * Policy rule annotations (docs/prd/PRD-POLICY-RULE-ANNOTATIONS.md, docs/plan/PLAN-POLICY-RULE-ANNOTATIONS.md §3).
 * An annotation says what a rule means (classification), how a workflow must treat it (mandatory marking), when it
 * applies and why. The AI only suggests one; a PM or Admin decides by ticking "Apply to project". Every field that the
 * policy does not settle stays explicitly unknown: nothing here may be filled in by guessing.
 */

export const RULE_CLASSIFICATIONS = ['obligation', 'prohibition', 'permission', 'definition', 'applicability_precedence', 'unresolved'] as const;
export type RuleClassification = (typeof RULE_CLASSIFICATIONS)[number];

export const MANDATORY_MARKINGS = ['mandatory', 'mandatory_when_applicable', 'permitted_option', 'required_reference', 'other_responsibility', 'needs_clarification'] as const;
export type MandatoryMarking = (typeof MANDATORY_MARKINGS)[number];

export const RESPONSIBLE_ACTORS = ['agent', 'human_officer', 'bank_operations', 'task_author', 'customer', 'other', 'unknown'] as const;
export type ResponsibleActor = (typeof RESPONSIBLE_ACTORS)[number];

/**
 * Relations between rules. Declared on one rule; the reverse direction is computed when read (Rules page, preview,
 * export), so linking never edits — and never un-applies — another rule.
 */
export const RULE_LINK_RELATIONS = ['companion_of', 'uses_definition', 'defines_threshold_for', 'exception_to', 'references', 'duplicate_of', 'overlaps'] as const;
export type RuleLinkRelation = (typeof RULE_LINK_RELATIONS)[number];
export const REVERSE_RELATION: Record<RuleLinkRelation, string> = {
  companion_of: 'companion_of',
  uses_definition: 'defines_threshold_for',
  defines_threshold_for: 'uses_definition',
  exception_to: 'has_exception',
  references: 'referenced_by',
  duplicate_of: 'duplicate_of',
  overlaps: 'overlaps',
};

export const COMPOUND_ROLES = ['primary', 'companion', 'condition', 'exception', 'component'] as const;

export const MARKING_LABEL: Record<MandatoryMarking, string> = {
  mandatory: 'Mandatory',
  mandatory_when_applicable: 'Mandatory when applicable',
  permitted_option: 'Permitted option',
  required_reference: 'Required reference',
  other_responsibility: 'Other responsibility/scope',
  needs_clarification: 'Needs clarification',
};
export const CLASSIFICATION_LABEL: Record<RuleClassification, string> = {
  obligation: 'Obligation',
  prohibition: 'Prohibition',
  permission: 'Permission',
  definition: 'Definition',
  applicability_precedence: 'Applicability/precedence',
  unresolved: 'Unresolved',
};
export const ACTOR_LABEL: Record<ResponsibleActor, string> = {
  agent: 'Agent',
  human_officer: 'Human officer',
  bank_operations: 'Bank operations / infrastructure',
  task_author: 'Task author',
  customer: 'Customer',
  other: 'Other',
  unknown: 'Unknown',
};

const text = z.string().trim().max(4000);
const short = z.string().trim().max(500);
const items = z.array(z.string().trim().min(1).max(200)).max(50);

/** all = the policy says it applies to every value; listed = only these; unknown = the policy does not say. */
export const ScopeList = z.object({ kind: z.enum(['all', 'listed', 'unknown']).default('unknown'), items: items.default([]) });
export type ScopeList = z.infer<typeof ScopeList>;

export const Deadline = z.object({
  kind: z.enum(['none', 'unknown', 'stated']).default('unknown'),
  text: text.nullable().default(null),
  /** The event the deadline is measured from, e.g. "account opening". Null = not stated. */
  measuredFrom: short.nullable().default(null),
});

export const EvidenceStatus = z.object({
  /** stated = the policy says what evidence shows compliance; partly_stated / unknown = it does not fully. */
  status: z.enum(['stated', 'partly_stated', 'unknown']).default('unknown'),
  missing: items.default([]),
});

export const RuleLink = z.object({ ruleKey: z.string().trim().min(1).max(80), relation: z.enum(RULE_LINK_RELATIONS), note: short.nullable().default(null) });
export type RuleLink = z.infer<typeof RuleLink>;

export const Compound = z.object({
  /** Shared by every component extracted from the same statement. */
  groupKey: z.string().trim().min(1).max(80),
  /** The original statement, word for word from the source (checked against the document). */
  originalStatement: text.min(1),
  role: z.enum(COMPOUND_ROLES),
});

/** The editable annotation of one rule version (stored in PolicyRuleBody.annotation). */
export const RuleAnnotation = z.object({
  /** Annotation version (per rule), matching PolicyRuleAnnotationRevision.annotationVersion. Set by the server. */
  version: z.number().int().min(1).default(1),
  classification: z.enum(RULE_CLASSIFICATIONS).default('unresolved'),
  marking: z.enum(MANDATORY_MARKINGS).default('needs_clarification'),
  /** When the rule applies, in plain words. Null = unknown. "Always, within the workflow scope" is an explicit value. */
  appliesWhen: text.nullable().default(null),
  /** Why the marking was chosen, in plain English. */
  why: text.nullable().default(null),
  responsibleActor: z.enum(RESPONSIBLE_ACTORS).default('unknown'),
  actorNote: short.nullable().default(null),
  applicationTypes: ScopeList.default({}),
  jurisdictions: ScopeList.default({}),
  workflowStage: short.nullable().default(null),
  deadline: Deadline.default({}),
  evidence: EvidenceStatus.default({}),
  links: z.array(RuleLink).max(30).default([]),
  compound: Compound.nullable().default(null),
  openQuestions: items.default([]),
});
export type RuleAnnotation = z.infer<typeof RuleAnnotation>;

/** What the AI (or an author) proposes; the server assigns the version. */
export const RuleAnnotationInput = RuleAnnotation.omit({ version: true });
export type RuleAnnotationInput = z.infer<typeof RuleAnnotationInput>;

/** The old requirementType kept in step with the classification, for readers that predate annotations. */
export const REQUIREMENT_TYPE_OF: Record<RuleClassification, 'obligation' | 'prohibition' | 'permission' | 'definition' | 'unknown'> = {
  obligation: 'obligation',
  prohibition: 'prohibition',
  permission: 'permission',
  definition: 'definition',
  applicability_precedence: 'definition',
  unresolved: 'unknown',
};

/** Annotation content without its version, for "did anything change?" checks. */
export const annotationContent = (a: RuleAnnotation | RuleAnnotationInput) => {
  const { version: _v, ...rest } = a as RuleAnnotation;
  return rest;
};

/** An applied rule may publish while unresolved only when it is openly marked "needs clarification" (owner, A5). */
export const isOpenClarification = (a: RuleAnnotation | undefined | null) => !!a && a.marking === 'needs_clarification' && a.classification === 'unresolved';

// ───────────────────────── Flags (AC8) ─────────────────────────

export interface AnnotationFlag {
  code: 'NOT_ANNOTATED' | 'UNKNOWN_FIELD' | 'NEEDS_CLARIFICATION' | 'UNRESOLVED_LINK' | 'DUPLICATE' | 'CONFLICT' | 'OPEN_QUESTION';
  message: string;
}

/**
 * Missing details and open issues of one annotation, shown on the Rules page and in the publish preview. `known` is the
 * set of rule keys the links may point to (e.g. the applied rules); a link outside it is an unresolved dependency.
 */
export function annotationFlags(a: RuleAnnotation | undefined | null, opts: { known?: Set<string>; knownLabel?: string } = {}): AnnotationFlag[] {
  if (!a) return [{ code: 'NOT_ANNOTATED', message: 'Not annotated yet: no mandatory marking, applicability or explanation.' }];
  const out: AnnotationFlag[] = [];
  const unknown: string[] = [];
  if (a.classification === 'unresolved') unknown.push('classification');
  if (a.appliesWhen === null) unknown.push('when it applies');
  if (!a.why) unknown.push('why');
  if (a.responsibleActor === 'unknown') unknown.push('responsible actor');
  if (a.applicationTypes.kind === 'unknown') unknown.push('application types');
  if (a.jurisdictions.kind === 'unknown') unknown.push('jurisdictions');
  if (a.deadline.kind === 'unknown') unknown.push('deadline');
  if (a.evidence.status !== 'stated') unknown.push(a.evidence.missing.length ? `evidence (${a.evidence.missing.join('; ')})` : 'evidence');
  if (unknown.length) out.push({ code: 'UNKNOWN_FIELD', message: `Unknown: ${unknown.join(', ')}.` });
  if (a.marking === 'needs_clarification') out.push({ code: 'NEEDS_CLARIFICATION', message: 'Needs clarification before it can be applied reliably.' });
  for (const q of a.openQuestions) out.push({ code: 'OPEN_QUESTION', message: q });
  for (const l of a.links) {
    if (l.relation === 'duplicate_of' || l.relation === 'overlaps') out.push({ code: 'DUPLICATE', message: `${l.relation === 'duplicate_of' ? 'Duplicates' : 'Overlaps'} ${l.ruleKey}: apply one deliberately, so it is not counted twice.` });
    if (opts.known && !opts.known.has(l.ruleKey)) out.push({ code: 'UNRESOLVED_LINK', message: `Depends on ${l.ruleKey}, which is not ${opts.knownLabel ?? 'in this project'}.` });
  }
  return out;
}

// ───────────────────────── Applicability per application (spec §5, AC9) ─────────────────────────

export const APPLICABILITY_OUTCOMES = ['applies', 'trigger_to_check', 'out_of_scope', 'other_role', 'unknown'] as const;
export type ApplicabilityOutcome = (typeof APPLICABILITY_OUTCOMES)[number];

export interface CaseFacts {
  /** The application's type, e.g. adult_joint. Null = not known. */
  applicationType: string | null;
  /** The governing state as `CA` or `US-CA`. Null = not known. */
  governingState: string | null;
  /** YYYY-MM-DD; when given, the rule's effective dates are checked. */
  asOfDate?: string | null;
}

const FEDERAL = new Set(['US', 'USA', 'US-FED', 'FEDERAL', 'UNITED STATES']);
const norm = (s: string) => s.trim().toUpperCase().replace(/_/g, '-');
const stateCode = (s: string) => {
  const n = norm(s);
  return n.startsWith('US-') ? n : `US-${n}`;
};

/**
 * Whether a rule applies to one application, from the application's own attributes only. The project name and any
 * example state are never inputs. Federal (`US`) rules match every US state; state rules match only their state.
 * Unknown scope is never turned into "out of scope" (or a pass): it stays `unknown`.
 */
export function ruleApplicability(a: RuleAnnotation | undefined | null, c: CaseFacts, effective?: { from: string | null; to: string | null } | null): ApplicabilityOutcome {
  if (!a) return 'unknown';
  if (effective && c.asOfDate) {
    if (effective.from && c.asOfDate < effective.from) return 'out_of_scope';
    if (effective.to && c.asOfDate > effective.to) return 'out_of_scope';
  }
  let unknown = false;
  const t = a.applicationTypes;
  if (t.kind === 'unknown') unknown = true;
  else if (t.kind === 'listed') {
    if (!c.applicationType) unknown = true;
    else if (!t.items.some((i) => norm(i) === norm(c.applicationType!))) return 'out_of_scope';
  }
  const j = a.jurisdictions;
  if (j.kind === 'unknown') unknown = true;
  else if (j.kind === 'listed') {
    const federal = j.items.some((i) => FEDERAL.has(norm(i)));
    if (!federal) {
      if (!c.governingState) unknown = true;
      else if (!j.items.some((i) => stateCode(i) === stateCode(c.governingState!))) return 'out_of_scope';
    }
  }
  if (unknown || a.marking === 'needs_clarification') return 'unknown';
  if (a.marking === 'other_responsibility') return 'other_role';
  if (a.marking === 'mandatory_when_applicable' || a.marking === 'permitted_option') return 'trigger_to_check';
  return 'applies';
}

// ───────────────────────── Readable text (export, UI) ─────────────────────────

const listText = (s: ScopeList, what: string) => (s.kind === 'all' ? `all ${what}` : s.kind === 'listed' ? s.items.join(', ') || `no ${what}` : `${what} not stated`);

/** One plain-English paragraph built from the structured fields (no model call). */
export function annotationText(a: RuleAnnotation | undefined | null): string {
  if (!a) return 'Not annotated: the mandatory marking, applicability and explanation have not been set. Treat applicability as unknown.';
  const parts = [
    `${CLASSIFICATION_LABEL[a.classification]}; marked ${MARKING_LABEL[a.marking]}.`,
    `Applies when: ${a.appliesWhen ?? 'unknown'}.`,
    `Responsible: ${ACTOR_LABEL[a.responsibleActor]}${a.actorNote ? ` (${a.actorNote})` : ''}.`,
    `Application types: ${listText(a.applicationTypes, 'application types')}. Jurisdictions: ${listText(a.jurisdictions, 'jurisdictions')}.`,
    a.workflowStage ? `Workflow stage: ${a.workflowStage}.` : '',
    a.deadline.kind === 'stated' ? `Deadline: ${a.deadline.text ?? 'stated'}${a.deadline.measuredFrom ? `, measured from ${a.deadline.measuredFrom}` : ''}.` : a.deadline.kind === 'none' ? 'No deadline.' : 'Deadline unknown.',
    a.why ? `Why: ${a.why}` : 'Why: not given.',
    a.openQuestions.length ? `Open questions: ${a.openQuestions.join(' ')}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}
