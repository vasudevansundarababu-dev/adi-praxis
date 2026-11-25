import { conditionLabel, conditionProblems, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { conditionCatalog } from './fact-catalog';
import { currentVersions, reviewProblems } from './rules';

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026): the PM's review queue. Every rule whose latest version is a draft, with its
 * text and condition beside the source quotes, and the flags that call for a careful read. A rule with no flag may be
 * confirmed in a batch; a flagged one opens the rule page. The flags are recomputed by the server on every confirm.
 */
export interface QueueFlag {
  code: string;
  message: string;
}

type Current = Awaited<ReturnType<typeof currentVersions>>[number];
interface Context {
  catalog: FactCatalog | null;
  /** Rules with an approved version before their latest. */
  approvedBefore: Set<string>;
  coverage: Map<string, { status: string; gaps: unknown; environmentVersionId: string; checkedAt: Date }>;
  suggestions: Map<string, { source: string; content: unknown }[]>;
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
  if (missing.length) flags.push({ code: 'library_incomplete', message: `Missing for the policy library: ${missing.join(', ')}.` });
  if (lib.effectiveMode !== 'scenario_only' && !body.effective.from && !v.citations.some((c) => c.documentVersion.document.effectiveFrom)) flags.push({ code: 'no_effective_date', message: 'No date the rule is in force from: set it on the rule or on its document.' });
  if (ctx.approvedBefore.has(item.rule.id) && !lib.change) flags.push({ code: 'change_missing', message: 'This is a new version of an approved rule: say how it changes the version before it (contradicts, withdraws, tightens, narrows or clarifies).' });
  const cov = ctx.coverage.get(`${v.id}:${v.contentHash}`);
  if (cov && cov.status !== 'supported') {
    const gaps = (Array.isArray(cov.gaps) ? cov.gaps : []).filter(isObj).map((g) => String(g.message ?? g.ref ?? '')).filter(Boolean);
    flags.push({ code: `coverage_${cov.status}`, message: `Studio (${cov.environmentVersionId}): ${cov.status.replace(/_/g, ' ')}. ${gaps.join(' ')}`.trim() });
  }
  const sugg = ctx.suggestions.get(`${v.id}:${v.contentHash}`) ?? [];
  const disposition = sugg.find((s) => s.source === 'disposition' && isObj(s.content) && (s.content.disposition === 'needs_review' || s.content.disposition === 'outside_scope'));
  if (disposition && isObj(disposition.content)) flags.push({ code: String(disposition.content.disposition), message: String(disposition.content.question ?? (isObj(disposition.content.mismatch) ? disposition.content.mismatch.reason : '') ?? 'The suggestion asks for a careful read.') });
  const questions = [...sugg.filter((s) => s.source === 'enrichment' && isObj(s.content) && typeof s.content.question === 'string').map((s) => (s.content as { question: string }).question), ...(body.annotation?.openQuestions ?? [])];
  if (questions.length) flags.push({ code: 'open_question', message: questions.join(' ') });
  return flags;
}

async function context(tx: Db | Tx, projectId: string, items: Current[]): Promise<Context> {
  const ids = items.map((i) => i.version.id);
  const ruleIds = items.map((i) => i.rule.id);
  const [catalog, approved, coverage, suggestions] = await Promise.all([
    conditionCatalog(tx, projectId),
    tx.policyRuleVersion.findMany({ where: { ruleId: { in: ruleIds }, state: 'REVIEWED' }, select: { ruleId: true, id: true } }),
    tx.policyCoverageResult.findMany({ where: { ruleVersionId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    tx.policyRuleSuggestion.findMany({ where: { ruleVersionId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
  ]);
  const latestIds = new Set(ids);
  const cov = new Map<string, Context['coverage'] extends Map<string, infer V> ? V : never>();
  for (const c of coverage) cov.set(`${c.ruleVersionId}:${c.contentHash}`, { status: c.status, gaps: c.gaps, environmentVersionId: c.environmentVersionId, checkedAt: c.checkedAt });
  const sugg = new Map<string, { source: string; content: unknown }[]>();
  for (const s of suggestions) sugg.set(`${s.ruleVersionId}:${s.contentHash}`, [...(sugg.get(`${s.ruleVersionId}:${s.contentHash}`) ?? []), { source: s.source, content: s.content }]);
  return { catalog, approvedBefore: new Set(approved.filter((a) => !latestIds.has(a.id)).map((a) => a.ruleId)), coverage: cov, suggestions: sugg };
}

/** The drafts of a project in queue order: flagged first (most flags first), then by rule key. */
export async function reviewQueue(tx: Db | Tx, clientId: string, projectId: string) {
  const items = (await currentVersions(tx, clientId, projectId)).filter((r) => r.version.state === 'DRAFT' || r.version.state === 'NEEDS_DEFINITION');
  const ctx = await context(tx, projectId, items);
  const rows = items.map((item) => {
    const v = item.version;
    const body = PolicyRuleBody.parse(v.body);
    const cov = ctx.coverage.get(`${v.id}:${v.contentHash}`) ?? null;
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
      conditionText: body.condition === undefined ? 'Not set yet.' : conditionLabel(body.condition, ctx.catalog),
      library: body.library ?? null,
      quotes: v.citations.map((c) => ({ fieldPath: c.fieldPath, role: c.role, quote: c.quote, resolution: c.resolution, document: c.documentVersion.document.title, locator: c.locator })),
      coverage: cov ? { status: cov.status, gaps: cov.gaps, environmentVersionId: cov.environmentVersionId, checkedAt: cov.checkedAt.toISOString() } : null,
      flags: queueFlags(item, ctx),
    };
  });
  return rows.sort((a, b) => b.flags.length - a.flags.length || a.ruleKey.localeCompare(b.ruleKey));
}
