import { conditionFacts, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { definedFacts, projectFactCatalog, type DefinedFact } from './fact-catalog';

/**
 * The Policy page's fact list (owner, 26 Nov 2026), read-only: every fact a condition may name, from the project's fact
 * catalog and the derived facts its rules define, with what it means, its type and values, where it comes from, and how
 * many rules' conditions use it. A missing description stays missing (the page says "No description"); nothing is made up.
 */
export interface FactRow {
  id: string;
  label: string | null;
  description: string | null;
  type: string;
  allowedValues: (string | number | boolean)[];
  cardinality: 'one' | 'many';
  /** `case_data`: a field of the case; `derived`: defined by a rule of this library. */
  origin: 'case_data' | 'derived' | string;
  /** The catalog's own source field (when it names one), as plain text. */
  sourceField: string | null;
  /** For a derived fact: the rule that defines it. */
  definedBy: { ruleId: string; ruleKey: string } | null;
  /** Rules (not excluded) whose condition names this fact. */
  usedBy: number;
}

const sourceText = (s: Record<string, unknown> | undefined): string | null => {
  if (!s) return null;
  for (const k of ['field', 'path', 'case_field', 'name']) if (typeof s[k] === 'string' && s[k]) return s[k] as string;
  return null;
};

/** The rows, catalog facts first in catalog order, then derived facts by id. Pure (tested). */
export function factRows(catalog: FactCatalog | null, defined: Pick<DefinedFact, 'fact' | 'ruleId' | 'ruleKey'>[], conditions: unknown[]): FactRow[] {
  const used = new Map<string, number>();
  for (const c of conditions) {
    if (c === undefined || c === null) continue;
    for (const f of conditionFacts(c as never)) used.set(f, (used.get(f) ?? 0) + 1);
  }
  const rows: FactRow[] = (catalog?.facts ?? []).map((f) => ({
    id: f.id,
    label: f.label ?? null,
    description: f.description?.trim() || null,
    type: f.type,
    allowedValues: f.allowed_values ?? [],
    cardinality: f.cardinality ?? 'one',
    origin: f.availability,
    sourceField: sourceText(f.source),
    definedBy: null,
    usedBy: used.get(f.id) ?? 0,
  }));
  const ids = new Set(rows.map((r) => r.id));
  for (const d of [...defined].sort((a, b) => a.fact.id.localeCompare(b.fact.id))) {
    if (ids.has(d.fact.id)) continue;
    ids.add(d.fact.id);
    rows.push({ id: d.fact.id, label: null, description: d.fact.description?.trim() || null, type: d.fact.type, allowedValues: d.fact.allowed_values ?? [], cardinality: 'one', origin: 'derived', sourceField: null, definedBy: { ruleId: d.ruleId, ruleKey: d.ruleKey }, usedBy: used.get(d.fact.id) ?? 0 });
  }
  return rows;
}

/** The project's fact list: catalog, derived facts and each rule's latest (not excluded) condition. */
export async function projectFactRows(tx: Db | Tx, projectId: string) {
  const [catalog, defined, rules] = await Promise.all([
    projectFactCatalog(tx, projectId),
    definedFacts(tx, projectId),
    tx.policyRule.findMany({ where: { projectId }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { body: true, state: true } } } }),
  ]);
  const conditions = rules.flatMap((r) => {
    const v = r.versions[0];
    if (!v || v.state === 'EXCLUDED') return [];
    return [PolicyRuleBody.parse(v.body).condition];
  });
  return { catalogId: catalog?.catalog_id ?? null, version: catalog?.version ?? null, items: factRows(catalog, defined, conditions) };
}
