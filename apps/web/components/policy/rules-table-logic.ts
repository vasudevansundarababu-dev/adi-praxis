/** Rules table (PRD 5.6): pure selection rules, unit-tested without a browser. */

export interface TableRule {
  ruleId: string;
  ruleKey: string;
  title: string;
  required: boolean;
  state: 'DRAFT' | 'NEEDS_DEFINITION' | 'REVIEWED' | 'EXCLUDED';
  applied: boolean;
  documentIds: string[];
  definitionProblems: string[];
  evidenceProblems: string[];
}

export interface Suggestion {
  ruleKey: string;
  match: boolean;
  reason: string;
}

/** Rules whose evidence comes from the chosen document (PR-M01). */
export function rulesForDocument<R extends TableRule>(rules: R[], documentId: string | null): R[] {
  return documentId ? rules.filter((r) => r.documentIds.includes(documentId)) : rules;
}

/**
 * PR-M02: with no prompt run, every rule of the document; with one, the suggested rules (or all of them, suggested
 * first, when the PM asks to see everything). Applied rules always stay visible so a PM can see and untick them.
 */
export function visibleRules<R extends TableRule>(rules: R[], suggestions: Map<string, Suggestion> | null, showAll: boolean): R[] {
  if (!suggestions) return rules;
  const matched = (r: R) => !!suggestions.get(r.ruleKey)?.match;
  if (showAll) return [...rules].sort((a, b) => Number(matched(b)) - Number(matched(a)));
  return rules.filter((r) => matched(r) || r.applied);
}

/** What ticking a rule needs first (PR-M05, PR-M06): an AI definition when fields are missing, a confirmation when evidence is unverified. */
export function applySteps(r: Pick<TableRule, 'definitionProblems' | 'evidenceProblems'>): { define: boolean; confirmEvidence: boolean } {
  return { define: r.definitionProblems.length > 0, confirmEvidence: r.evidenceProblems.length > 0 };
}

export const STATE_LABEL: Record<TableRule['state'], string> = { DRAFT: 'Draft', NEEDS_DEFINITION: 'Needs definition', REVIEWED: 'Applied', EXCLUDED: 'Excluded' };

/** Owner, 23 Nov 2026: search rules by name. Every word must appear in the rule's name or key (any order, any case). */
export function byName<R extends Pick<TableRule, 'title' | 'ruleKey'>>(rules: R[], query: string): R[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rules;
  return rules.filter((r) => {
    const hay = `${r.title} ${r.ruleKey}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
