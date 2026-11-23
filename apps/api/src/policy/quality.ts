import { z } from 'zod';

/**
 * E-002 §4.1.4 (owner, 23 Nov 2026): the PM-only quality evaluation of extraction and suggestions. A reference set is the
 * PM's private labels for one document version: each expected obligation's exact quote and expected disposition.
 * The evaluation matches extracted rules to labels by quote, counts with raw numbers (precision and recall style), and
 * lists every discrepancy by type. It is reproducible: the run keeps the document hash, scope (fact catalog) version,
 * extraction config, prompt and model version, and the reference-set version.
 */
export const ReferenceLabel = z
  .object({
    id: z.string().trim().min(1).max(100),
    quote: z.string().trim().min(5).max(4000),
    disposition: z.enum(['recommended', 'needs_review', 'outside_scope']).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();
export const ReferenceSetBody = z.object({ documentVersionId: z.string().uuid(), labels: z.array(ReferenceLabel).min(1).max(500) }).strict();
export type ReferenceLabel = z.infer<typeof ReferenceLabel>;

export type DiscrepancyType = 'missed_obligation' | 'extra_rule' | 'merged_obligations' | 'disposition_mismatch' | 'no_suggestion';
export interface Discrepancy {
  type: DiscrepancyType;
  labelId?: string;
  ruleKey?: string;
  expected?: string;
  got?: string;
}
export interface EvaluatedRule {
  ruleKey: string;
  quotes: string[];
  disposition?: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const matches = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x.includes(y) || y.includes(x);
};
const ratio = (n: number, d: number) => ({ value: d ? Math.round((n / d) * 1000) / 1000 : null, numerator: n, denominator: d });

export function evaluateQuality(labels: ReferenceLabel[], rules: EvaluatedRule[]) {
  const discrepancies: Discrepancy[] = [];
  const ruleOf = new Map<string, EvaluatedRule[]>();
  for (const l of labels) ruleOf.set(l.id, rules.filter((r) => r.quotes.some((q) => matches(q, l.quote))));
  const matchedLabels = labels.filter((l) => ruleOf.get(l.id)!.length);
  const matchedRules = rules.filter((r) => labels.some((l) => r.quotes.some((q) => matches(q, l.quote))));
  for (const l of labels) if (!ruleOf.get(l.id)!.length) discrepancies.push({ type: 'missed_obligation', labelId: l.id, expected: l.quote });
  for (const r of rules) if (!matchedRules.includes(r)) discrepancies.push({ type: 'extra_rule', ruleKey: r.ruleKey, got: r.quotes[0] ?? '' });
  // One rule carrying two labelled obligations: siblings should keep distinct rules.
  for (const r of matchedRules) {
    const ls = labels.filter((l) => r.quotes.some((q) => matches(q, l.quote)));
    if (ls.length > 1) discrepancies.push({ type: 'merged_obligations', ruleKey: r.ruleKey, expected: ls.map((l) => l.id).join(', ') });
  }
  // Suggestions: the disposition of the matched rule against the label's expected disposition.
  let dispTotal = 0;
  let dispAgree = 0;
  for (const l of labels) {
    if (!l.disposition) continue;
    const r = ruleOf.get(l.id)![0];
    if (!r) continue;
    dispTotal += 1;
    if (!r.disposition) discrepancies.push({ type: 'no_suggestion', labelId: l.id, ruleKey: r.ruleKey, expected: l.disposition });
    else if (r.disposition === l.disposition) dispAgree += 1;
    else discrepancies.push({ type: 'disposition_mismatch', labelId: l.id, ruleKey: r.ruleKey, expected: l.disposition, got: r.disposition });
  }
  return {
    extraction: { precision: ratio(matchedRules.length, rules.length), recall: ratio(matchedLabels.length, labels.length), labels: labels.length, rules: rules.length },
    suggestions: { agreement: ratio(dispAgree, dispTotal) },
    discrepancies,
    counts: Object.fromEntries((['missed_obligation', 'extra_rule', 'merged_obligations', 'disposition_mismatch', 'no_suggestion'] as DiscrepancyType[]).map((t) => [t, discrepancies.filter((d) => d.type === t).length])),
  };
}
