import { conditionFacts, conditionProblems, jurisdictionProblem, LIBRARY_CHANNELS, LIBRARY_CUSTOMER_TYPES, LIBRARY_ISSUERS, LIBRARY_PROCESSES, LIBRARY_PRODUCT_LINES, LIBRARY_RULE_KINDS, LIBRARY_SUBJECTS, type FactCatalog, type PolicyRuleBody } from '@praxis/shared';
import { ClaudeVertexContentDrafter, GeminiVertexContentDrafter } from '../meta-compiler/drafter';
import { modelPrice } from './ai-pricing';
import { normaliseJurisdiction } from './enrich';

/**
 * Owner and Jose, 27 Nov 2026: "We can answer the question in a text box. Use AI to decipher the answer and fill the
 * fields." The reviewer types the answer to an open question; "Fill from my answer" makes one model call that turns it
 * into proposed field changes. Every proposal is checked here against the library's values and the fact catalog
 * (a fact the catalog doesn't have is never proposed); nothing is saved: the reviewer accepts each change, which is an
 * ordinary rule edit, so every existing check (the condition's source quote, approval in the review queue) still applies.
 */
export const ANSWER_PROMPT_VERSION = 'answer-fill/1';

/** The fields a proposal may change: the library details, the condition ("always applies" included) and the date. */
export const ANSWER_FIELDS = ['kind', 'issuer', 'jurisdiction', 'subject', 'process', 'customer_types', 'product_lines', 'channels', 'condition', 'effective_from'] as const;
export type AnswerField = (typeof ANSWER_FIELDS)[number];

export interface ProposedChange {
  field: AnswerField;
  /** The value now, in plain words ("not set" when empty). */
  before: string;
  /** The proposed value, in plain words. */
  after: string;
  /** The value to save (library vocabulary, an ISO code, a condition, null for "always applies", or a date). */
  value: unknown;
  /** Why, in the model's words (short). */
  reason: string;
}

export interface AnswerFillInput {
  question: string;
  answer: string;
  rule: { ruleKey: string; title: string; requirement: string; library: PolicyRuleBody['library'] | null; condition: unknown; effectiveFrom: string | null };
  catalog: FactCatalog | null;
}
export interface AnswerFillOutput {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}
export interface AnswerFiller {
  readonly model: string;
  fill(input: AnswerFillInput): Promise<AnswerFillOutput>;
}

/**
 * Deterministic stand-in (tests, local, and whenever the switch is off): it reads a few plain patterns from the answer
 * and says it cannot map anything else. It is never shown in a live deployment (the route refuses "Fill from my
 * answer" while the AI answer switch is off).
 */
export class StubAnswerFiller implements AnswerFiller {
  readonly model = 'stub-answer-fill-1';
  async fill({ answer }: AnswerFillInput): Promise<AnswerFillOutput> {
    const t = answer.toLowerCase();
    const changes: Record<string, unknown>[] = [];
    if (/\balways applies\b|\bapplies always\b|\balways\b/.test(t)) changes.push({ field: 'condition', value: null, reason: 'The answer says it always applies.' });
    const code = /\b(US-[A-Z]{2}|US)\b/.exec(answer)?.[1];
    if (code) changes.push({ field: 'jurisdiction', value: code, reason: `The answer names ${code}.` });
    if (t.includes('account opening')) changes.push({ field: 'process', value: 'account_opening', reason: 'The answer names account opening.' });
    const ch = (['branch', 'remote'] as const).filter((c) => t.includes(c));
    if (ch.length) changes.push({ field: 'channels', value: ch, reason: 'The answer names the channels.' });
    return { raw: changes.length ? { changes } : { changes: [], cannot: 'I couldn’t tell which field your answer is about.' }, inputTokens: 0, outputTokens: 0 };
  }
}

const SYSTEM = `A bank policy reviewer answered an open question about one rule. Turn the answer into changes to the rule's fields.
Fields you may change, with their allowed values:
- "kind": one of ${LIBRARY_RULE_KINDS.join(', ')}
- "issuer": one of ${LIBRARY_ISSUERS.join(', ')}
- "jurisdiction": one ISO code such as "US" or "US-CA"
- "subject": one of ${LIBRARY_SUBJECTS.join(', ')} ("party" = about one person, "case" = about the whole application)
- "process": one of ${LIBRARY_PROCESSES.join(', ')}
- "customer_types": any of ${LIBRARY_CUSTOMER_TYPES.join(', ')}
- "product_lines": any of ${LIBRARY_PRODUCT_LINES.join(', ')}
- "channels": any of ${LIBRARY_CHANNELS.join(', ')}
- "condition": when the rule applies, as a predicate over the listed facts ONLY: {"fact","op","value"} or {"all":[...]}, {"any":[...]}, {"not":...}; operators eq, ne, in, not_in, lt, lte, gt, gte, between, present, absent. null means it always applies within its process.
- "effective_from": the date it is in force from, YYYY-MM-DD.
Change only what the answer says. Never invent a fact that is not in the list. Never write or change a source quote. If part of the answer cannot be mapped to a field, say so in "cannot" in one short plain sentence for the reviewer (for example "I couldn't tell which channel you meant").
Return JSON only: {"changes":[{"field":...,"value":...,"reason":"short"}],"cannot":null or "sentence"}.`;

/** One model call on Vertex (the policy assistant's model), with its token usage for the cost. */
export class VertexAnswerFiller implements AnswerFiller {
  readonly model: string;
  private readonly call: (system: string, user: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  constructor(setting: string, opts: { projectId: string; location: string }) {
    const [prefix, ...rest] = setting.split(':');
    if (rest.length && prefix === 'gemini') {
      const g = new GeminiVertexContentDrafter(rest.join(':'), { projectId: opts.projectId, location: opts.location });
      this.model = `gemini:${rest.join(':')}`;
      this.call = (system, user) => g.complete({ purpose: 'propose_field', system, user, maxOutputTokens: 4000, thinkingLevel: 'low', timeoutMs: 25_000 });
    } else {
      const id = rest.length && prefix === 'claude' ? rest.join(':') : setting;
      const c = new ClaudeVertexContentDrafter(id, { projectId: opts.projectId, region: opts.location });
      this.model = id;
      this.call = (system, user) => c.complete({ purpose: 'propose_field', system, user, maxOutputTokens: 4000, timeoutMs: 25_000 });
    }
  }
  async fill(input: AnswerFillInput): Promise<AnswerFillOutput> {
    const facts = input.catalog?.facts.map((f) => ({ id: f.id, type: f.type, allowed_values: f.allowed_values, description: f.description })) ?? [];
    const user = `<facts>${JSON.stringify(facts)}</facts>\n<rule>${JSON.stringify(input.rule)}</rule>\n<question>${input.question}</question>\n<answer>${input.answer}</answer>`;
    const r = await this.call(SYSTEM, user);
    let raw: unknown;
    try {
      raw = JSON.parse(r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      raw = { changes: [], cannot: 'The AI’s answer could not be read. Try again, or fill the fields by hand.' };
    }
    return { raw, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
  }
}

/** The cost of one call in USD (list price by model family, or POLICY_AI_PRICE_USD_PER_MTOK). */
export function answerCostUsd(model: string, inputTokens: number, outputTokens: number, override = ''): number {
  const p = modelPrice(model, override);
  return Math.round(((inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000) * 1_000_000) / 1_000_000;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const words = (v: unknown) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? 'not set' : Array.isArray(v) ? v.map((x) => String(x).replace(/_/g, ' ')).join(', ') : String(v).replace(/_/g, ' '));

/** The checked proposal: only valid changes to fields the answer is about, each with before → after in plain words. */
export function checkedProposal(raw: unknown, body: Pick<PolicyRuleBody, 'library' | 'condition' | 'effective'>, catalog: FactCatalog | null, conditionText: (c: unknown) => string): { changes: ProposedChange[]; message: string | null } {
  const lib = body.library ?? {};
  const scope = lib.scope ?? ({} as NonNullable<typeof lib.scope>);
  const out: ProposedChange[] = [];
  const dropped: string[] = [];
  const items = isObj(raw) && Array.isArray(raw.changes) ? raw.changes : [];
  const cannot = isObj(raw) && typeof raw.cannot === 'string' && raw.cannot.trim() ? raw.cannot.trim().slice(0, 300) : null;
  const one = <T extends readonly string[]>(v: unknown, allowed: T) => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : null);
  const many = <T extends readonly string[]>(v: unknown, allowed: T) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && (allowed as readonly string[]).includes(x)) ? [...new Set(v as string[])] : null);
  for (const item of items) {
    if (!isObj(item) || typeof item.field !== 'string' || !(ANSWER_FIELDS as readonly string[]).includes(item.field) || out.some((o) => o.field === item.field)) continue;
    const field = item.field as AnswerField;
    const reason = typeof item.reason === 'string' ? item.reason.slice(0, 200) : '';
    const push = (before: unknown, value: unknown, after = words(value)) => {
      if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return;
      out.push({ field, before: words(before), after, value, reason });
    };
    if (field === 'kind') { const v = one(item.value, LIBRARY_RULE_KINDS); v ? push(lib.kind, v) : dropped.push('the kind'); }
    else if (field === 'issuer') { const v = one(item.value, LIBRARY_ISSUERS); v ? push(lib.issuer, v) : dropped.push('the issuer'); }
    else if (field === 'subject') { const v = one(item.value, LIBRARY_SUBJECTS); v ? push(lib.subject, v) : dropped.push('who it is evaluated for'); }
    else if (field === 'process') { const v = one(item.value, LIBRARY_PROCESSES); v ? push(scope.process, v) : dropped.push('the process'); }
    else if (field === 'customer_types') { const v = many(item.value, LIBRARY_CUSTOMER_TYPES); v ? push(scope.customer_types, v) : dropped.push('the customer types'); }
    else if (field === 'product_lines') { const v = many(item.value, LIBRARY_PRODUCT_LINES); v ? push(scope.product_lines, v) : dropped.push('the product lines'); }
    else if (field === 'channels') { const v = many(item.value, LIBRARY_CHANNELS); v ? push(scope.channels, v) : dropped.push('the channel'); }
    else if (field === 'jurisdiction') {
      const v = typeof item.value === 'string' ? normaliseJurisdiction(item.value) : null;
      v && !jurisdictionProblem(v) ? push(lib.jurisdiction, v) : dropped.push('the jurisdiction');
    } else if (field === 'effective_from') {
      const v = typeof item.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.value) && !Number.isNaN(Date.parse(item.value)) ? item.value : null;
      v ? push(body.effective?.from ?? null, v) : dropped.push('the in-force date');
    } else if (field === 'condition') {
      // "Not set" (undefined) and "always applies" (null) differ: only an existing "always applies" is no change.
      if (item.value === null) {
        if (body.condition !== null) out.push({ field, before: body.condition === undefined ? 'not set' : conditionText(body.condition), after: 'always applies within its process', value: null, reason });
      }
      else {
        // A fact the catalog doesn't have is never proposed: the condition must pass the same check as a saved one.
        const problems = conditionProblems(item.value as never, catalog);
        if (problems.length) dropped.push(`when it applies (${conditionFacts(item.value as never).filter((f) => !catalog?.facts.some((c) => c.id === f)).join(', ') || 'not a valid condition'})`);
        else out.push({ field, before: body.condition === undefined ? 'not set' : body.condition === null ? 'always applies within its process' : conditionText(body.condition), after: conditionText(item.value), value: item.value, reason });
      }
    }
  }
  // Customer types, product lines and channels belong to the scope, which needs a process (C1): without one, say so.
  const hasProcess = !!scope.process || out.some((c) => c.field === 'process');
  const needsProcess = out.filter((c) => c.field === 'customer_types' || c.field === 'product_lines' || c.field === 'channels');
  if (!hasProcess && needsProcess.length) {
    for (const c of needsProcess) out.splice(out.indexOf(c), 1);
    const named = needsProcess.map((c) => (c.field === 'customer_types' ? 'the customer types' : c.field === 'product_lines' ? 'the product lines' : 'the channels')).join(' and ');
    return finish(cannot, dropped, out, `I can set ${named} once the rule has a Process: choose the Process in Library details (for example account opening), then fill from your answer again.`);
  }
  return finish(cannot, dropped, out, null);
}

function finish(cannot: string | null, dropped: string[], out: ProposedChange[], extra: string | null): { changes: ProposedChange[]; message: string | null } {
  const parts = [cannot, extra, dropped.length ? `I couldn’t map ${dropped.join(', ')} from your answer to an allowed value; fill ${dropped.length > 1 ? 'them' : 'it'} by hand.` : null].filter(Boolean);
  const message = parts.length ? parts.join(' ') : out.length ? null : 'Your answer doesn’t change any field I can fill. Your answer is saved.';
  return { changes: out, message };
}

/** The rule body with the accepted changes applied (the client sends it as an ordinary rule edit). */
export function applyChanges(body: PolicyRuleBody, changes: Pick<ProposedChange, 'field' | 'value'>[]): PolicyRuleBody {
  const library = { ...(body.library ?? {}) } as Record<string, unknown>;
  const scope = { ...((library.scope as Record<string, unknown>) ?? {}) };
  let condition: unknown = body.condition;
  let effective = body.effective;
  for (const c of changes) {
    if (c.field === 'process' || c.field === 'customer_types' || c.field === 'product_lines' || c.field === 'channels') scope[c.field] = c.value;
    else if (c.field === 'condition') condition = c.value;
    else if (c.field === 'effective_from') effective = { ...effective, from: c.value as string };
    else library[c.field] = c.value;
  }
  if (Object.keys(scope).length) library.scope = scope;
  return { ...body, library: library as PolicyRuleBody['library'], condition: condition as PolicyRuleBody['condition'], effective };
}

/** The start of today in the owner's time zone (US Central), for the daily budget. */
export function startOfBudgetDay(now = new Date()): Date {
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const offset = now.getTime() - central.getTime();
  central.setHours(0, 0, 0, 0);
  return new Date(central.getTime() + offset);
}
