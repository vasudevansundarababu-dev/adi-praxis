/**
 * D-094 (owner, 26 Nov 2026: "If its from old page and it has nothing to do with current re design or Run we should not
 * confuse this"): pure helpers for the KYC Judgment rule page. Kept out of 'use client' modules so the server page and
 * the tests can use them.
 */
export interface LibraryRuleView {
  conditionSet: boolean;
  conditionText: string | null;
  conditionFacts: string[];
  inForce: { from: string; source: 'rule' | 'document' } | null;
}

export const LIBRARY_STATE: Record<string, string> = { DRAFT: 'Draft', NEEDS_DEFINITION: 'Draft (needs definition)', REVIEWED: 'Approved', EXCLUDED: 'Excluded' };

/** The quotes that back the requirement text, and the rest (when it applies, exceptions, date), in that order. */
export function quoteGroups<T extends { fieldPath: string }>(citations: readonly T[]) {
  const req = citations.filter((c) => c.fieldPath === 'requirement' || c.fieldPath.startsWith('requirement.'));
  return { requirement: req, other: citations.filter((c) => !req.includes(c)) };
}

/** "In force from 2026-01-01 (the document's date)" and the like. */
export function inForceText(v: LibraryRuleView['inForce']): string {
  if (!v) return 'No in-force date yet: set it on the document (every rule from it inherits it) or on this rule.';
  return `In force from ${v.from} (${v.source === 'rule' ? 'this rule’s own date' : 'its document’s date'}).`;
}

/** Whether a rule can be excluded here (drafts only: an approved version is never changed) or brought back. */
export const canExclude = (state: string) => state === 'DRAFT' || state === 'NEEDS_DEFINITION';
export const canRestore = (state: string) => state === 'EXCLUDED';
