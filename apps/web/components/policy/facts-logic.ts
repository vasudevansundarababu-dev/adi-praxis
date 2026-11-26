/**
 * The Policy page's fact list (owner, 26 Nov 2026): pure helpers, kept out of 'use client' modules so the server page
 * and the client table can both use them. Search covers the variable and the description (and the label).
 */
export interface FactRow {
  id: string;
  label: string | null;
  description: string | null;
  type: string;
  allowedValues: (string | number | boolean)[];
  cardinality: 'one' | 'many';
  origin: string;
  sourceField: string | null;
  definedBy: { ruleId: string; ruleKey: string } | null;
  usedBy: number;
}
export interface FactsData {
  catalogId: string | null;
  version: number | null;
  items: FactRow[];
}

export const NO_DESCRIPTION = 'No description';

export function filterFacts<T extends Pick<FactRow, 'id' | 'label' | 'description'>>(rows: readonly T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...rows];
  return rows.filter((r) => r.id.toLowerCase().includes(s) || (r.description ?? '').toLowerCase().includes(s) || (r.label ?? '').toLowerCase().includes(s));
}

/** "enum: a, b, c", "boolean", "number" …; a multi-valued fact says so. */
export function typeText(r: Pick<FactRow, 'type' | 'allowedValues' | 'cardinality'>): string {
  const many = r.cardinality === 'many' ? ' (one or more)' : '';
  if (r.allowedValues.length) return `${r.type}${many}: ${r.allowedValues.map(String).join(', ')}`;
  return `${r.type}${many}`;
}

/** Where the fact comes from, in plain words. */
export function originText(r: Pick<FactRow, 'origin' | 'sourceField' | 'definedBy'>): string {
  if (r.origin === 'derived') return r.definedBy ? `Derived: defined by rule ${r.definedBy.ruleKey}` : 'Derived';
  if (r.origin === 'case_data') return r.sourceField ? `Case field ${r.sourceField}` : 'Case data (a field of each case)';
  return r.sourceField ? `${r.origin}: ${r.sourceField}` : r.origin;
}

/** The review queue filtered to the rules whose condition names the fact. */
export const queueForFact = (projectId: string, factId: string) => `/projects/${projectId}/policy?fact=${encodeURIComponent(factId)}#review-queue`;

/** Facts with no description in the catalog (the page shows "No description"; nothing is made up). */
export const undescribed = (rows: readonly Pick<FactRow, 'id' | 'description'>[]) => rows.filter((r) => !r.description).map((r) => r.id);
