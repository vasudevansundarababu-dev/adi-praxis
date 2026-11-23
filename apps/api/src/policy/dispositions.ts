import { ClauseCondition, conditionFacts, conditionLabel, conditionProblems, type FactCatalog } from '@praxis/shared';
import { z } from 'zod';
import { vertexCompleter, policyAiModel, type Completer } from './rule-assistant';

/**
 * E-002 §1.3 and §4.1.2 (owner decisions 23 Nov 2026): one suggested disposition per candidate rule against the project
 * scope and its fact catalog: Recommended (always in scope, or conditional with a structured condition), Needs review
 * (with one question) or Outside scope (with the cited mismatch). Suggestions never approve anything: the PM decides,
 * and manual review stays available when the AI fails. IDs, quotes and condition operators are checked on the server.
 */
export type DispositionKind = 'recommended' | 'needs_review' | 'outside_scope';
export interface DispositionInputRule {
  ruleKey: string;
  title: string;
  requirement: string;
  applicability: string | null;
  jurisdictions: string[];
  quotes: string[];
}
export interface Disposition {
  ruleKey: string;
  disposition: DispositionKind;
  mode?: 'always' | 'conditional';
  condition?: ClauseCondition;
  conditionText?: string;
  question?: string;
  mismatch?: { quote: string; reason: string };
  bindingGaps: string[];
}
export interface DispositionSuggester {
  readonly modelVersion: string;
  suggest(input: { scope: string; catalog: FactCatalog | null; rules: DispositionInputRule[] }): Promise<unknown[]>;
}
export class DispositionUnavailableError extends Error {}
/** Changes whenever SYSTEM below changes (quality runs record it for reproducibility). */
export const DISPOSITION_PROMPT_VERSION = 'dispositions/1';

/** Deterministic stand-in (tests, local): universal → always; a jurisdiction with a governing_state fact → conditional; anything else → one question. */
export class MockDispositionSuggester implements DispositionSuggester {
  readonly modelVersion = 'mock-dispositions-1';
  async suggest({ catalog, rules }: { scope: string; catalog: FactCatalog | null; rules: DispositionInputRule[] }) {
    const hasState = !!catalog?.facts.some((f) => f.id === 'governing_state');
    return rules.map((r) => {
      if (r.jurisdictions.length && hasState) {
        const states = r.jurisdictions.map((j) => j.replace(/^US-/, ''));
        return { ruleKey: r.ruleKey, disposition: 'recommended', mode: 'conditional', condition: states.length === 1 ? { fact: 'governing_state', op: 'eq', value: states[0] } : { fact: 'governing_state', op: 'in', value: states } };
      }
      if (r.applicability) return { ruleKey: r.ruleKey, disposition: 'needs_review', question: `Which facts decide when this applies: “${r.applicability}”?` };
      return { ruleKey: r.ruleKey, disposition: 'recommended', mode: 'always' };
    });
  }
}

const Raw = z.object({
  ruleKey: z.string(),
  disposition: z.enum(['recommended', 'needs_review', 'outside_scope']),
  mode: z.enum(['always', 'conditional']).optional(),
  condition: z.unknown().optional(),
  question: z.string().max(500).optional(),
  mismatch: z.object({ quote: z.string().max(2000), reason: z.string().max(500) }).optional(),
});

const SYSTEM = `You classify extracted policy rules for one project. For each rule give exactly one disposition:
- "recommended" with mode "always" (always in the project's scope) or mode "conditional" with a "condition" over the listed logical facts only: {"fact","op","value"} or {"all":[...]}, {"any":[...]}, {"not":...}; operators eq, ne, in, not_in, lt, lte, gt, gte, between, present, absent;
- "needs_review" with one short "question" for the project manager;
- "outside_scope" with "mismatch": an exact quote from the rule and the reason.
Never invent facts or quotes. You suggest only; a person decides. Return JSON only: {"items":[...]}.`;

export class ModelDispositionSuggester implements DispositionSuggester {
  constructor(readonly modelVersion: string, private readonly llm: Completer) {}
  async suggest(input: { scope: string; catalog: FactCatalog | null; rules: DispositionInputRule[] }) {
    const user = `<scope>${input.scope}</scope>\n<facts>${JSON.stringify(input.catalog?.facts ?? [])}</facts>\n<rules>${JSON.stringify(input.rules)}</rules>`;
    let text: string;
    try {
      text = await this.llm.complete(SYSTEM, user, 8000, { quick: true });
    } catch (err) {
      throw new DispositionUnavailableError(err instanceof Error ? err.message : 'Model call failed', { cause: err });
    }
    try {
      const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { items?: unknown[] };
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      throw new DispositionUnavailableError('The model did not return JSON.');
    }
  }
}

export function defaultDispositionSuggester(config: { assistantMode: string; VERTEX_PROJECT_ID: string; VERTEX_LOCATION: string; POLICY_AI_MODEL: string; AUTHORING_MODEL: string }): DispositionSuggester {
  if (config.assistantMode !== 'vertex') return new MockDispositionSuggester();
  const c = vertexCompleter(policyAiModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  return new ModelDispositionSuggester(c.model, c);
}

/**
 * Server-side checks: unknown rule keys are dropped; a condition must be valid against the project's facts (otherwise the
 * suggestion becomes Needs review, naming the problem); a mismatch quote must be one of the rule's own quotes; binding
 * gaps are the condition's facts the template does not supply.
 */
export function checkedDispositions(raw: unknown[], rules: DispositionInputRule[], catalog: FactCatalog | null, boundFacts: string[] | null): Disposition[] {
  const out: Disposition[] = [];
  for (const item of raw) {
    const r = Raw.safeParse(item);
    if (!r.success) continue;
    const rule = rules.find((x) => x.ruleKey === r.data.ruleKey);
    if (!rule || out.some((o) => o.ruleKey === rule.ruleKey)) continue;
    const d = r.data;
    if (d.disposition === 'recommended' && d.mode === 'conditional') {
      const cond = ClauseCondition.safeParse(d.condition ?? null);
      const problems = cond.success ? conditionProblems(cond.data, catalog) : ['the condition is not a valid predicate'];
      if (!cond.success || cond.data === null || problems.length) {
        out.push({ ruleKey: rule.ruleKey, disposition: 'needs_review', question: `The suggested condition can’t be used (${problems.join(' ')}). When does this rule apply?`, bindingGaps: [] });
        continue;
      }
      const facts = conditionFacts(cond.data);
      out.push({ ruleKey: rule.ruleKey, disposition: 'recommended', mode: 'conditional', condition: cond.data, conditionText: conditionLabel(cond.data, catalog), bindingGaps: boundFacts ? facts.filter((f) => !boundFacts.includes(f)) : facts });
    } else if (d.disposition === 'recommended') out.push({ ruleKey: rule.ruleKey, disposition: 'recommended', mode: 'always', condition: null, conditionText: conditionLabel(null), bindingGaps: [] });
    else if (d.disposition === 'needs_review') out.push({ ruleKey: rule.ruleKey, disposition: 'needs_review', question: d.question?.trim() || 'Does this rule apply to this project, and when?', bindingGaps: [] });
    else {
      const quoteOk = !!d.mismatch && rule.quotes.some((q) => q.includes(d.mismatch!.quote.trim()) && d.mismatch!.quote.trim().length > 0);
      out.push(quoteOk ? { ruleKey: rule.ruleKey, disposition: 'outside_scope', mismatch: d.mismatch!, bindingGaps: [] } : { ruleKey: rule.ruleKey, disposition: 'needs_review', question: 'The suggestion said this rule is outside the project’s scope but did not quote the rule. Is it in scope?', bindingGaps: [] });
    }
  }
  return out;
}
