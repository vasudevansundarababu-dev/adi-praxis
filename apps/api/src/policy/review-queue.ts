import { conditionFacts, conditionLabel, conditionProblems, jurisdictionProblem, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { conditionCatalog, templateBoundFacts } from './fact-catalog';
import { currentVersions, definitionProblems, evidenceProblems, inheritedEffectiveFrom, reviewProblems } from './rules';

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026): the PM's review queue. Every rule whose latest version is a draft, with its
 * text and condition beside the source quotes, and the flags that call for a careful read. A rule with no flag may be
 * confirmed in a batch; a flagged one opens the rule page. The flags are recomputed by the server on every confirm.
 *
 * D-092 (owner, 26 Nov 2026): each row also says what to do next, in plain words, from its first open item in a fixed
 * order, with the field on the rule page to open; and the document, jurisdiction and status the table filters on.
 */
export interface QueueFlag {
  code: string;
  message: string;
}

/** What the PM does next on a rule, and the rule-page field that does it (null = nothing to open). */
export interface NextAction {
  code: string;
  label: string;
  focus: string | null;
}

/** The fixed order of next actions (D-092). The first that applies is the row's next action. */
export const NEXT_ACTIONS: readonly NextAction[] = [
  { code: 'set_condition', label: 'Set when it applies', focus: 'condition' },
  { code: 'fill_library', label: 'Fill in library details', focus: 'library' },
  { code: 'set_date', label: 'Set the in-force date', focus: 'effective' },
  { code: 'link_quote', label: 'Link to a source quote', focus: 'quote' },
  { code: 'check_quote', label: 'Check the quote', focus: 'quote' },
  { code: 'answer_question', label: 'Answer the open question', focus: 'question' },
  { code: 'complete_definition', label: 'Complete the rule’s definition', focus: 'definition' },
  { code: 'describe_change', label: 'Say how it changes the version before', focus: 'change' },
  { code: 'approve_definition_first', label: 'Approve the definition it depends on first', focus: 'condition' },
  { code: 'check_coverage', label: 'Check Studio’s coverage answer', focus: 'condition' },
  { code: 'ready', label: 'Ready to confirm', focus: null },
];
const action = (code: string) => NEXT_ACTIONS.find((a) => a.code === code)!;

type Current = Awaited<ReturnType<typeof currentVersions>>[number];
interface Context {
  catalog: FactCatalog | null;
  /** Rules with an approved version before their latest. */
  approvedBefore: Set<string>;
  coverage: Map<string, { status: string; gaps: unknown; environmentVersionId: string; checkedAt: Date }>;
  suggestions: Map<string, { source: string; content: unknown }[]>;
  /** Derived facts some approved (Reviewed) rule version defines. */
  approvedDefinitions: Set<string>;
  /** Derived facts some rule defines, approved or not. */
  derivedIds: Set<string>;
  /**
   * D-094: whether the annotation pass's open questions count. A policy-library project (KYC Judgment) uses only what
   * the library (C1) and the run use, so its annotation questions are kept but never block confirm; other projects
   * keep them as before.
   */
  annotationQuestions: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const LIBRARY_PARTS = ['kind', 'issuer', 'jurisdiction', 'subject', 'scope'] as const;

/** The flags of one draft (empty = it may be confirmed in a batch). */
export function queueFlags(item: Current, ctx: Context): QueueFlag[] {
  const v = item.version;
  const body = PolicyRuleBody.parse(v.body);
  const flags: QueueFlag[] = [];
  const ready = reviewProblems(v);
  if (ready.length) flags.push({ code: 'not_ready', message: ready.join(' ') });
  if (body.condition === undefined) flags.push({ code: 'condition_not_set', message: 'Set when the rule applies (a condition), or that it always applies within its process.' });
  else if (body.condition !== null) {
    const problems = conditionProblems(body.condition, ctx.catalog);
    if (problems.length) flags.push({ code: 'condition_invalid', message: problems.join(' ') });
    // The condition must come from the source: a resolved quote for when the rule applies.
    if (!v.citations.some((c) => c.resolution === 'RESOLVED' && (c.fieldPath.startsWith('applicability') || c.fieldPath.startsWith('condition')))) flags.push({ code: 'condition_not_quoted', message: 'No quote from the source says when this rule applies. Link the condition to the source text.' });
  }
  const lib = body.library ?? {};
  const missing = LIBRARY_PARTS.filter((k) => lib[k] === undefined);
  // D-090: a stored jurisdiction must be a real ISO 3166 code, not only look like one.
  const badJurisdiction = lib.jurisdiction !== undefined ? jurisdictionProblem(lib.jurisdiction) : null;
  if (missing.length || badJurisdiction) flags.push({ code: 'library_incomplete', message: [missing.length ? `Missing for the policy library: ${missing.join(', ')}.` : '', badJurisdiction ?? ''].filter(Boolean).join(' ') });
  if (lib.effectiveMode !== 'scenario_only' && !body.effective.from && !inheritedEffectiveFrom(v.citations)) flags.push({ code: 'no_effective_date', message: 'No date the rule is in force from: set it on the rule or on its document.' });
  if (ctx.approvedBefore.has(item.rule.id) && !lib.change) flags.push({ code: 'change_missing', message: 'This is a new version of an approved rule: say how it changes the version before it (contradicts, withdraws, tightens, narrows or clarifies).' });
  // A condition naming a derived fact (such as us_person) needs that fact's definition approved first.
  const unapproved = body.condition ? conditionFacts(body.condition).filter((f) => ctx.derivedIds.has(f) && !ctx.approvedDefinitions.has(f)) : [];
  if (unapproved.length) flags.push({ code: 'definition_not_approved', message: `This rule depends on ${unapproved.join(', ')}, whose definition rule is not approved yet. Approve the definition first.` });
  const cov = ctx.coverage.get(`${v.id}:${v.contentHash}`);
  if (cov && cov.status !== 'supported') {
    const gaps = (Array.isArray(cov.gaps) ? cov.gaps : []).filter(isObj).map((g) => String(g.message ?? g.ref ?? '')).filter(Boolean);
    flags.push({ code: `coverage_${cov.status}`, message: `Studio (${cov.environmentVersionId}): ${cov.status.replace(/_/g, ' ')}. ${gaps.join(' ')}`.trim() });
  }
  const sugg = ctx.suggestions.get(`${v.id}:${v.contentHash}`) ?? [];
  const disposition = sugg.find((s) => s.source === 'disposition' && isObj(s.content) && (s.content.disposition === 'needs_review' || s.content.disposition === 'outside_scope'));
  if (disposition && isObj(disposition.content)) flags.push({ code: String(disposition.content.disposition), message: String(disposition.content.question ?? (isObj(disposition.content.mismatch) ? disposition.content.mismatch.reason : '') ?? 'The suggestion asks for a careful read.') });
  const questions = [...sugg.filter((s) => s.source === 'enrichment' && isObj(s.content) && typeof s.content.question === 'string').map((s) => (s.content as { question: string }).question), ...(ctx.annotationQuestions ? (body.annotation?.openQuestions ?? []) : [])];
  if (questions.length) flags.push({ code: 'open_question', message: questions.join(' ') });
  return flags;
}

/**
 * The next action of a rule (D-092): the first open item in NEXT_ACTIONS order, worked out from the same checks as the
 * flags, so a row with no flags always reads "Ready to confirm".
 */
export function nextAction(item: Current, flags: QueueFlag[]): NextAction {
  if (!flags.length) return action('ready');
  const v = item.version;
  const body = PolicyRuleBody.parse(v.body);
  const has = (code: string) => flags.some((f) => f.code === code || f.code.startsWith(code));
  const definition = definitionProblems(body, { inheritedFrom: inheritedEffectiveFrom(v.citations) });
  const evidence = evidenceProblems(v);
  const dateMissing = has('no_effective_date') || definition.some((p) => p.startsWith('Set the effective scope'));
  const quoteMissing = evidence.length > 0 || has('condition_not_quoted');
  const mismatched = v.citations.some((c) => c.resolution !== 'RESOLVED');
  const steps: [string, boolean][] = [
    ['set_condition', has('condition_not_set') || has('condition_invalid')],
    ['fill_library', has('library_incomplete')],
    ['set_date', dateMissing],
    ['link_quote', quoteMissing && !mismatched],
    ['check_quote', quoteMissing && mismatched],
    ['answer_question', has('open_question') || has('needs_review') || has('outside_scope')],
    ['complete_definition', definition.some((p) => !p.startsWith('Set the effective scope'))],
    ['describe_change', has('change_missing')],
    ['approve_definition_first', has('definition_not_approved')],
    ['check_coverage', has('coverage_')],
  ];
  const first = steps.find(([, on]) => on);
  return first ? action(first[0]) : action('check_coverage');
}

/** Derived facts the project's approved (Reviewed) rule versions define, and every derived fact any rule defines. */
async function definitions(tx: Db | Tx, projectId: string) {
  const versions = await tx.policyRuleVersion.findMany({ where: { rule: { projectId } }, select: { body: true, state: true } });
  const approved = new Set<string>();
  const all = new Set<string>();
  for (const v of versions) {
    const id = PolicyRuleBody.safeParse(v.body).data?.library?.defines?.id;
    if (!id) continue;
    all.add(id);
    if (v.state === 'REVIEWED') approved.add(id);
  }
  return { approved, all };
}

/**
 * The rule that should define "US person" (D-092): one whose key names the US-person definition, else a definition rule
 * whose text says what a US person is. Only named for the PM; nothing is approved here.
 */
async function usPersonCandidate(tx: Db | Tx, projectId: string) {
  const rules = await tx.policyRule.findMany({ where: { projectId }, orderBy: { ruleKey: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { body: true, state: true } } } });
  const live = rules.filter((r) => r.versions[0] && r.versions[0].state !== 'EXCLUDED');
  const byKey = live.find((r) => /US-PERSON-DEFINITION/.test(r.ruleKey));
  const byText = live.find((r) => {
    const b = PolicyRuleBody.safeParse(r.versions[0]!.body).data;
    return b?.requirementType === 'definition' && /\bU\.?\s?S\.? persons?\b/i.test(b.requirement) && /citizen/i.test(b.requirement);
  });
  const r = byKey ?? byText;
  return r ? { ruleId: r.id, ruleKey: r.ruleKey } : null;
}

/**
 * Flags about the library as a whole. Owner, 25 Nov 2026 (Option A): "US person" is derived from citizenship alone, and
 * the PM's approved definition rule must say so; until an approved rule defines `us_person`, the project is flagged
 * (when its catalog has citizenship, or a rule names us_person). D-092: the flag names the rule to approve.
 */
export async function projectFlags(tx: Db | Tx, projectId: string): Promise<(QueueFlag & { rule?: { ruleId: string; ruleKey: string } | null })[]> {
  const [catalog, defs, conds] = await Promise.all([
    conditionCatalog(tx, projectId),
    definitions(tx, projectId),
    tx.policyRuleVersion.findMany({ where: { rule: { projectId } }, select: { body: true } }),
  ]);
  const named = conds.some((v) => { const c = PolicyRuleBody.safeParse(v.body).data?.condition; return !!c && conditionFacts(c).includes('us_person'); });
  const relevant = !!catalog?.facts.some((f) => f.id === 'citizenship') || named;
  if (!relevant || defs.approved.has('us_person')) return [];
  const rule = await usPersonCandidate(tx, projectId);
  const base = 'No approved rule defines “US person”. Under the CIP rule a U.S. person is a U.S. citizen (residency does not count)';
  return [{ code: 'us_person_undefined', rule, message: rule ? `${base}: approve ${rule.ruleKey}, with “This rule defines a fact” set to us_person (true when citizenship is US).` : `${base}: approve the rule that says so, with its \`defines\` set to us_person from citizenship.` }];
}

async function context(tx: Db | Tx, projectId: string, items: Current[]): Promise<Context> {
  const ids = items.map((i) => i.version.id);
  const ruleIds = items.map((i) => i.rule.id);
  const [catalog, approved, coverage, suggestions, defs, project] = await Promise.all([
    conditionCatalog(tx, projectId),
    tx.policyRuleVersion.findMany({ where: { ruleId: { in: ruleIds }, state: 'REVIEWED' }, select: { ruleId: true, id: true } }),
    tx.policyCoverageResult.findMany({ where: { ruleVersionId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    tx.policyRuleSuggestion.findMany({ where: { ruleVersionId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    definitions(tx, projectId),
    tx.project.findUnique({ where: { id: projectId }, select: { template: { select: { anvilSpec: true } } } }),
  ]);
  // The same test as approvalRoute (D-091): the template binds the environment's facts.
  const libraryProject = (templateBoundFacts(project?.template?.anvilSpec ?? null)?.facts.length ?? 0) > 0;
  const latestIds = new Set(ids);
  const cov = new Map<string, Context['coverage'] extends Map<string, infer V> ? V : never>();
  for (const c of coverage) cov.set(`${c.ruleVersionId}:${c.contentHash}`, { status: c.status, gaps: c.gaps, environmentVersionId: c.environmentVersionId, checkedAt: c.checkedAt });
  const sugg = new Map<string, { source: string; content: unknown }[]>();
  for (const s of suggestions) sugg.set(`${s.ruleVersionId}:${s.contentHash}`, [...(sugg.get(`${s.ruleVersionId}:${s.contentHash}`) ?? []), { source: s.source, content: s.content }]);
  return { approvedDefinitions: defs.approved, derivedIds: defs.all, catalog, approvedBefore: new Set(approved.filter((a) => !latestIds.has(a.id)).map((a) => a.ruleId)), coverage: cov, suggestions: sugg, annotationQuestions: !libraryProject };
}

/** The flags of one rule's current version, whatever its state (the approval gate, D-091). */
export async function ruleQueueFlags(tx: Db | Tx, clientId: string, projectId: string, ruleId: string): Promise<QueueFlag[]> {
  const item = (await currentVersions(tx, clientId, projectId)).find((r) => r.rule.id === ruleId);
  if (!item) return [];
  return queueFlags(item, await context(tx, projectId, [item]));
}

/** The drafts of a project in queue order: flagged first (most flags first), then by rule key. */
export async function reviewQueue(tx: Db | Tx, clientId: string, projectId: string) {
  const items = (await currentVersions(tx, clientId, projectId)).filter((r) => r.version.state === 'DRAFT' || r.version.state === 'NEEDS_DEFINITION');
  const ctx = await context(tx, projectId, items);
  const rows = items.map((item) => {
    const v = item.version;
    const body = PolicyRuleBody.parse(v.body);
    const cov = ctx.coverage.get(`${v.id}:${v.contentHash}`) ?? null;
    const flags = queueFlags(item, ctx);
    const docs = [...new Map(v.citations.map((c) => [c.documentVersion.documentId, { id: c.documentVersion.documentId, title: c.documentVersion.document.title }])).values()];
    const source = v.citations.find((c) => c.fieldPath.startsWith('requirement')) ?? v.citations[0];
    return {
      ruleId: item.rule.id,
      ruleKey: item.rule.ruleKey,
      versionId: v.id,
      version: v.version,
      state: v.state,
      contentHash: v.contentHash,
      title: body.title,
      requirement: body.requirement,
      condition: body.condition ?? null,
      conditionSet: body.condition !== undefined,
      /** The facts the condition names (the queue's fact filter, from the Policy page's fact list). */
      facts: body.condition ? conditionFacts(body.condition) : [],
      conditionText: body.condition === undefined ? 'Not set yet.' : conditionLabel(body.condition, ctx.catalog),
      library: body.library ?? null,
      documents: docs,
      /** The rule's own jurisdiction, else its document's (what the table filters on). */
      jurisdiction: body.library?.jurisdiction ?? source?.documentVersion.document.jurisdiction ?? null,
      quotes: v.citations.map((c) => ({ fieldPath: c.fieldPath, role: c.role, quote: c.quote, resolution: c.resolution, document: c.documentVersion.document.title, locator: c.locator })),
      coverage: cov ? { status: cov.status, gaps: cov.gaps, environmentVersionId: cov.environmentVersionId, checkedAt: cov.checkedAt.toISOString() } : null,
      flags,
      nextAction: nextAction(item, flags),
    };
  });
  return rows.sort((a, b) => b.flags.length - a.flags.length || a.ruleKey.localeCompare(b.ruleKey));
}

/** Rule counts for the page's setup checklist: every rule, the approved ones and the excluded ones. */
export async function ruleCounts(tx: Db | Tx, clientId: string, projectId: string) {
  const items = await currentVersions(tx, clientId, projectId);
  return { rules: items.filter((i) => i.version.state !== 'EXCLUDED').length, approved: items.filter((i) => i.version.state === 'REVIEWED').length, excluded: items.filter((i) => i.version.state === 'EXCLUDED').length };
}
