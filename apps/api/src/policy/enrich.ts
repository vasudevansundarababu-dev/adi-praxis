import { ClauseCondition, conditionProblems, ISO_JURISDICTION, LIBRARY_CHANNELS, LIBRARY_CUSTOMER_TYPES, LIBRARY_ISSUERS, LIBRARY_PROCESSES, LIBRARY_PRODUCT_LINES, LIBRARY_RULE_KINDS, LIBRARY_SUBJECTS, PolicyRuleBody, RuleLibraryMeta, type FactCatalog } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import type { EventHandler } from '../outbox/handlers';
import { aiRunsToday } from './annotate-job';
import { loadVersionText } from './documents';
import { conditionCatalog } from './fact-catalog';
import { policyAiModel, vertexCompleter, type Completer } from './rule-assistant';
import { currentVersions, editRule } from './rules';
import { adoptedBody, storeSuggestion } from './suggestions';

/**
 * KYC Judgment v1 A2 (owner, 25 Nov 2026: AI Extract is supervised; it is for productivity and the PM reviews and corrects
 * every rule). An enrichment pass over the project's existing rules, never a re-extraction: for each draft it suggests
 * C1's library parts (kind, issuer, ISO jurisdiction, subject, scope) and a condition over the fact catalog.
 * - An approved (Reviewed) or excluded rule is never touched.
 * - Every answer is checked on the server and stored as a suggestion against the exact rule version.
 * - A draft no person has edited (extraction's, or this pass's own) is pre-filled with the valid parts, like the
 *   annotation pass; a person's draft is only offered them. Nothing is ever approved: the PM's tick is the approval.
 * The model is called outside any transaction.
 */
export const ENRICHMENT_PROMPT_VERSION = 'enrichment/1';
export const ENRICHMENT_ACTIONS = { requested: 'policy.rule_enrichment_requested', suggested: 'policy.rule_enrichment_suggested', failed: 'policy.rule_enrichment_failed', skipped: 'policy.rule_enrichment_skipped' } as const;

const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
const STATE_NAMES: Record<string, string> = { california: 'CA', 'new york': 'NY', texas: 'TX', florida: 'FL', illinois: 'IL' };

/**
 * A free-text jurisdiction from extraction to its ISO code (C1: `US`, `US-CA`; a bare `CA` in extraction means the US
 * state, since these are US banking policies). Anything it cannot place is null, never guessed.
 */
export function normaliseJurisdiction(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const u = t.toUpperCase();
  if (['US', 'USA', 'US-FEDERAL', 'FEDERAL', 'UNITED STATES', 'U.S.'].includes(u)) return 'US';
  const st = u.startsWith('US-') ? u.slice(3) : u;
  if (US_STATES.includes(st)) return `US-${st}`;
  const named = STATE_NAMES[t.toLowerCase()];
  return named ? `US-${named}` : null;
}

export interface EnrichRule {
  ruleKey: string;
  title: string;
  requirement: string;
  quotes: string[];
  conditionText: string | null;
  /** The extraction's free-text jurisdictions. */
  jurisdictions: string[];
}
export interface RuleEnricher {
  readonly modelVersion: string;
  enrich(input: { catalog: FactCatalog | null; rules: EnrichRule[] }): Promise<unknown[]>;
}

/** Deterministic stand-in (tests, local): the extraction's jurisdiction, account opening, party subject, no condition. */
export class MockRuleEnricher implements RuleEnricher {
  readonly modelVersion = 'mock-enrichment-1';
  async enrich({ rules }: { catalog: FactCatalog | null; rules: EnrichRule[] }) {
    return rules.map((r) => ({ ruleKey: r.ruleKey, library: { subject: 'party', scope: { process: 'account_opening' } }, jurisdictions: r.jurisdictions, question: r.conditionText ? `Which facts decide when this applies: “${r.conditionText}”?` : undefined }));
  }
}

const SYSTEM = `You prepare extracted bank policy rules for a PM's review. For each rule return:
- "library": {"kind": one of ${LIBRARY_RULE_KINDS.join(', ')}; "issuer": one of ${LIBRARY_ISSUERS.join(', ')}; "subject": "party" when the rule is about each applicant or party, "case" when it is about the application as a whole; "scope": {"process": one of ${LIBRARY_PROCESSES.join(', ')}, "customer_types": any of ${LIBRARY_CUSTOMER_TYPES.join(', ')}, "product_lines": any of ${LIBRARY_PRODUCT_LINES.join(', ')}, "channels": any of ${LIBRARY_CHANNELS.join(', ')}}};
- "jurisdictions": the jurisdictions the rule states (for example "US", "US-CA");
- "condition": when the rule applies, as a predicate over the listed facts only: {"fact","op","value"} or {"all":[...]}, {"any":[...]}, {"not":...}; operators eq, ne, in, not_in, lt, lte, gt, gte, between, present, absent; null when it always applies within its process;
- "question": one short question for the PM when you cannot decide.
A rule from another process (reporting, record keeping, beneficial ownership, lending) still gets a condition on the "process" fact. Never invent facts. You suggest only; a person decides. Return JSON only: {"items":[{"ruleKey":...}]}.`;

/** The model enricher on Vertex (the policy assistant's model setting). */
export class ModelRuleEnricher implements RuleEnricher {
  constructor(readonly modelVersion: string, private readonly llm: Completer) {}
  async enrich(input: { catalog: FactCatalog | null; rules: EnrichRule[] }) {
    const user = `<facts>${JSON.stringify(input.catalog?.facts.map((f) => ({ id: f.id, type: f.type, allowed_values: f.allowed_values, cardinality: f.cardinality, description: f.description })) ?? [])}</facts>\n<rules>${JSON.stringify(input.rules)}</rules>`;
    const text = await this.llm.complete(SYSTEM, user, 16000, { quick: true });
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { items?: unknown };
    if (!Array.isArray(json.items)) throw new Error('The model did not return items.');
    return json.items;
  }
}

export function defaultRuleEnricher(config: { assistantMode: string; VERTEX_PROJECT_ID: string; VERTEX_LOCATION: string; POLICY_AI_MODEL: string; AUTHORING_MODEL: string }): RuleEnricher {
  if (config.assistantMode !== 'vertex') return new MockRuleEnricher();
  const c = vertexCompleter(policyAiModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  return new ModelRuleEnricher(c.model, c);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const META = RuleLibraryMeta.shape;

export interface CheckedEnrichment {
  ruleKey: string;
  content: { library?: Record<string, unknown>; condition?: ClauseCondition; question?: string };
  problems: string[];
}

/**
 * Server checks on the model's answer: unknown rule keys are dropped; each library part must use C1's vocabulary
 * (otherwise it is dropped and named as a problem); the jurisdiction comes from the extraction's own values first
 * (deterministic), then from the model's, and must be one ISO code; a condition must pass the catalog (plus derived
 * facts), otherwise it is dropped and the PM gets a question.
 */
export function checkedEnrichment(raw: unknown[], rules: EnrichRule[], catalog: FactCatalog | null): CheckedEnrichment[] {
  const out: CheckedEnrichment[] = [];
  for (const item of raw) {
    if (!isObj(item) || typeof item.ruleKey !== 'string') continue;
    const rule = rules.find((r) => r.ruleKey === item.ruleKey);
    if (!rule || out.some((o) => o.ruleKey === rule.ruleKey)) continue;
    const problems: string[] = [];
    const library: Record<string, unknown> = {};
    const given = isObj(item.library) ? item.library : {};
    for (const key of ['kind', 'issuer', 'subject', 'scope'] as const) {
      if (given[key] === undefined) continue;
      const r = META[key].safeParse(given[key]);
      if (r.success && r.data !== undefined) library[key] = r.data;
      else problems.push(`${key}: ${JSON.stringify(given[key])} is not one of the library's values.`);
    }
    // Jurisdiction: the extraction's values decide when they name one code; the model only fills a gap.
    const fromRule = [...new Set(rule.jurisdictions.map(normaliseJurisdiction).filter((j): j is string => !!j))];
    const fromModel = [...new Set([...(Array.isArray(item.jurisdictions) ? item.jurisdictions : []), ...(typeof given.jurisdiction === 'string' ? [given.jurisdiction] : [])].map((j) => (typeof j === 'string' && ISO_JURISDICTION.test(j) ? j : normaliseJurisdiction(String(j)))).filter((j): j is string => !!j))];
    const pick = fromRule.length === 1 ? fromRule[0] : fromRule.length > 1 ? fromModel.find((j) => fromRule.includes(j)) : fromModel.length === 1 ? fromModel[0] : undefined;
    if (pick) library.jurisdiction = pick;
    else if (fromRule.length > 1 || fromModel.length > 1) problems.push(`jurisdiction: several apply (${[...fromRule, ...fromModel].join(', ')}); choose one.`);
    const content: CheckedEnrichment['content'] = {};
    if (Object.keys(library).length) content.library = library;
    let question = typeof item.question === 'string' && item.question.trim() ? item.question.trim().slice(0, 500) : undefined;
    if (item.condition !== undefined) {
      const cond = ClauseCondition.safeParse(item.condition);
      const cp = cond.success ? conditionProblems(cond.data, catalog) : ['condition: not a valid predicate.'];
      if (cond.success && !cp.length) content.condition = cond.data;
      else {
        problems.push(...cp);
        question = `The suggested condition can’t be used (${cp.join(' ')}). When does this rule apply?`;
      }
    }
    if (question) content.question = question;
    out.push({ ruleKey: rule.ruleKey, content, problems });
  }
  return out;
}

export interface EnrichRequest {
  clientId: string;
  projectId: string;
  runId: string;
  requestedById: string;
  requestedRoles: string[];
  /** Only the rules citing this document; absent = every rule of the project. */
  documentId?: string;
}
type EnrichResult = { status: 'done' | 'skipped' | 'failed'; prefilled: number; offered: number; skippedApproved: number; stale: number };
const CHUNK = 25;

/** The drafts a run covers (all, or those citing one document), as sent to the model. Shared by the run and its estimate. */
export async function enrichmentInputs(db: Db, clientId: string, projectId: string, documentId?: string) {
  const current = (await currentVersions(db, clientId, projectId)).filter((r) => !documentId || r.version.citations.some((c) => c.documentVersion.documentId === documentId));
  const skippedApproved = current.filter((r) => r.version.state === 'REVIEWED').length;
  const items = current.filter((r) => r.version.state === 'DRAFT' || r.version.state === 'NEEDS_DEFINITION');
  const catalog = await conditionCatalog(db, projectId);
  const rules: EnrichRule[] = items.map((r) => {
    const b = PolicyRuleBody.parse(r.version.body);
    const quotes = [...r.version.citations].sort((x, y) => (x.fieldPath === 'requirement' ? -1 : y.fieldPath === 'requirement' ? 1 : 0)).map((c) => c.quote);
    return { ruleKey: r.rule.ruleKey, title: b.title, requirement: b.requirement, quotes, conditionText: b.applicability.conditionText, jurisdictions: b.applicability.jurisdictions };
  });
  return { skippedApproved, items, catalog, rules };
}

/** Output tokens allowed per rule in the estimate (library parts, jurisdictions, a condition and a question). */
const OUTPUT_TOKENS_PER_RULE = 300;

/**
 * D-092: what a run would send, before it runs: one model call per CHUNK rules, each carrying the instructions, the fact
 * list and that chunk's rules. Tokens are counted as characters / 4 (rounded up); the estimate never calls the model.
 */
export function enrichmentCalls(input: { catalog: FactCatalog | null; rules: EnrichRule[] }) {
  const facts = JSON.stringify(input.catalog?.facts.map((f) => ({ id: f.id, type: f.type, allowed_values: f.allowed_values, cardinality: f.cardinality, description: f.description })) ?? []);
  const calls = [];
  for (let i = 0; i < input.rules.length; i += CHUNK) {
    const chunk = input.rules.slice(i, i + CHUNK);
    const chars = SYSTEM.length + facts.length + JSON.stringify(chunk).length + 32;
    calls.push({ rules: chunk.length, inputTokens: Math.ceil(chars / 4), outputTokens: chunk.length * OUTPUT_TOKENS_PER_RULE });
  }
  return calls;
}

/** A draft no person has edited: extraction's own, or this pass's. */
const untouched = (editedById: string) => editedById.startsWith('extraction:') || editedById.startsWith('enrichment:');

export async function enrichProject(db: Db, deps: { storage: ObjectStorage; enricher: RuleEnricher; dailyCap: number; capActions: string[] }, req: EnrichRequest): Promise<EnrichResult> {
  const audit = (action: string, after: Record<string, unknown>) => db.auditEvent.create({ data: { clientId: req.clientId, actorType: 'USER', actorId: req.requestedById, entityType: 'Project', entityId: req.projectId, action, after: { runId: req.runId, ...(req.documentId ? { documentId: req.documentId } : {}), ...after } } });
  const none = (status: EnrichResult['status']): EnrichResult => ({ status, prefilled: 0, offered: 0, skippedApproved: 0, stale: 0 });
  // Idempotent per run: a redelivered event for a finished run does nothing.
  const done = await db.auditEvent.findFirst({ where: { clientId: req.clientId, entityType: 'Project', entityId: req.projectId, action: { in: [ENRICHMENT_ACTIONS.suggested, ENRICHMENT_ACTIONS.skipped, ENRICHMENT_ACTIONS.failed] }, after: { path: ['runId'], equals: req.runId } }, select: { id: true } });
  if (done) return none('done');
  if ((await aiRunsToday(db, req.clientId, deps.capActions)) >= deps.dailyCap) {
    await audit(ENRICHMENT_ACTIONS.skipped, { reason: 'MODEL_DAILY_CAP' });
    return none('skipped');
  }

  const { skippedApproved, items, catalog, rules } = await enrichmentInputs(db, req.clientId, req.projectId, req.documentId);
  let raw: unknown[] = [];
  try {
    for (let i = 0; i < rules.length; i += CHUNK) raw.push(...(await deps.enricher.enrich({ catalog, rules: rules.slice(i, i + CHUNK) })));
  } catch (e) {
    await audit(ENRICHMENT_ACTIONS.failed, { model: deps.enricher.modelVersion, error: (e instanceof Error ? e.message : 'Enrichment failed.').slice(0, 300) });
    return { ...none('failed'), skippedApproved };
  }
  const checked = checkedEnrichment(raw, rules, catalog);
  raw = [];

  const result: EnrichResult = { status: 'done', prefilled: 0, offered: 0, skippedApproved, stale: 0 };
  const actorId = `enrichment:${req.runId}`;
  for (const c of checked) {
    const item = items.find((r) => r.rule.ruleKey === c.ruleKey)!;
    const outcome = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PolicyRule" WHERE id = ${item.rule.id}::uuid FOR UPDATE`;
      const latest = await tx.policyRuleVersion.findFirstOrThrow({ where: { ruleId: item.rule.id }, orderBy: { version: 'desc' } });
      // The rule changed while the model was answering: its answer was for other content.
      if (latest.id !== item.version.id || latest.contentHash !== item.version.contentHash) return 'stale' as const;
      await storeSuggestion(tx, { clientId: req.clientId, projectId: req.projectId, ruleId: item.rule.id, ruleVersionId: latest.id, contentHash: latest.contentHash, source: 'enrichment', model: deps.enricher.modelVersion, promptVersion: ENRICHMENT_PROMPT_VERSION, content: c.content, problems: c.problems, createdById: req.requestedById });
      // Only the parts that passed the checks; a condition the model did not give (or that failed) is never set.
      const adoptable: Record<string, unknown> = {};
      if (c.content.condition !== undefined) adoptable.condition = c.content.condition;
      if (c.content.library) adoptable.library = c.content.library;
      const { body, parts } = adoptedBody(PolicyRuleBody.parse(latest.body), adoptable);
      if (!untouched(latest.editedById) || !parts.length) return 'offered' as const;
      await editRule(tx, { loadText: (v) => loadVersionText(deps.storage, v) }, { clientId: req.clientId, projectId: req.projectId, ruleId: item.rule.id, actorId, expectedContentHash: latest.contentHash, body }, async (a) => {
        await tx.auditEvent.create({ data: { clientId: req.clientId, actorType: 'SYSTEM', actorId: 'policy-enrichment', entityType: a.entityType, entityId: a.entityId, action: a.action, before: (a.before ?? undefined) as never, after: { ...((a.after as object) ?? {}), runId: req.runId, parts } as never } });
      });
      return 'prefilled' as const;
    });
    result[outcome === 'stale' ? 'stale' : outcome]++;
  }
  await audit(ENRICHMENT_ACTIONS.suggested, { model: deps.enricher.modelVersion, promptVersion: ENRICHMENT_PROMPT_VERSION, rules: rules.length, prefilled: result.prefilled, offered: result.offered, skippedApproved, stale: result.stale });
  return result;
}

/** Worker handler for `policy.enrichment_requested` (a PM or Admin request). */
export function policyEnrichmentHandler(deps: { storage: ObjectStorage; enricher: RuleEnricher; dailyCap: number; capActions: string[] }): EventHandler {
  return {
    name: 'policy.enrich',
    event: 'policy.enrichment_requested',
    run: async (e, db) => {
      const p = e.payload as Omit<EnrichRequest, 'runId'>;
      await enrichProject(db, deps, { ...p, runId: e.aggregateId });
    },
  };
}
