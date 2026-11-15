import type { Prisma } from '@prisma/client';
import { PolicyRuleBody, REVERSE_RELATION, annotationFlags, type AnnotationFlag } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, conflict } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { currentVersions, definitionProblems } from './rules';

type Current = Awaited<ReturnType<typeof currentVersions>>[number];

export interface Conflict {
  kind: 'same_rule_id_different_content' | 'same_source_different_visibility' | 'precedence_cycle' | 'unknown_precedence_target';
  message: string;
  ruleKeys: string[];
}

/** Conflict detection (PRD PR-R10, owner-confirmed examples) plus precedence cycles (PR-R03). */
export function detectConflicts(items: Current[]): Conflict[] {
  const out: Conflict[] = [];
  const active = items.filter((i) => i.version.state !== 'EXCLUDED');

  const bySource = new Map<string, Current[]>();
  for (const i of active) {
    if (!i.rule.sourceKey) continue;
    const list = bySource.get(i.rule.sourceKey) ?? [];
    list.push(i);
    bySource.set(i.rule.sourceKey, list);
  }
  for (const [key, list] of bySource) {
    const texts = new Set(list.map((i) => PolicyRuleBody.parse(i.version.body).requirement.trim().toLowerCase()));
    if (list.length > 1 && texts.size > 1) out.push({ kind: 'same_rule_id_different_content', message: `Rule ID ${key} appears in more than one source with different requirements.`, ruleKeys: list.map((i) => i.rule.ruleKey) });
  }

  const bySpan = new Map<string, Array<{ item: Current; visibility: string }>>();
  for (const i of active) {
    const visibility = PolicyRuleBody.parse(i.version.body).visibility;
    for (const c of i.version.citations) {
      const loc = c.locator as { section?: string | null; page?: number | null; lineStart?: number | null };
      const k = `${c.documentVersionId}|${loc.section ?? loc.page ?? loc.lineStart ?? c.quote.slice(0, 80)}`;
      const list = bySpan.get(k) ?? [];
      if (!list.some((x) => x.item.rule.id === i.rule.id)) list.push({ item: i, visibility });
      bySpan.set(k, list);
    }
  }
  for (const list of bySpan.values()) {
    if (new Set(list.map((x) => x.visibility)).size > 1) out.push({ kind: 'same_source_different_visibility', message: 'The same source section is agent-visible in one rule and evaluator-only in another.', ruleKeys: list.map((x) => x.item.rule.ruleKey) });
  }

  const keys = new Set(active.map((i) => i.rule.ruleKey));
  const edges = new Map<string, string[]>();
  for (const i of active) {
    for (const p of PolicyRuleBody.parse(i.version.body).precedence) {
      if (!keys.has(p.ruleKey)) {
        out.push({ kind: 'unknown_precedence_target', message: `${i.rule.ruleKey} refers to ${p.ruleKey}, which is not in this project.`, ruleKeys: [i.rule.ruleKey] });
        continue;
      }
      const [from, to] = p.relation === 'overridden_by' ? [p.ruleKey, i.rule.ruleKey] : [i.rule.ruleKey, p.ruleKey];
      edges.set(from, [...(edges.get(from) ?? []), to]);
    }
  }
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) ?? []) {
      if (state.get(m) === 1) out.push({ kind: 'precedence_cycle', message: `Precedence loop: ${[...stack.slice(stack.indexOf(m)), m].join(' → ')}.`, ruleKeys: stack.slice(stack.indexOf(m)) });
      else if (!state.get(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const k of edges.keys()) if (!state.get(k)) visit(k);
  return out;
}

export interface Preview {
  included: Array<{ ruleKey: string; ruleVersionId: string; version: number; title: string }>;
  excluded: Array<{ ruleKey: string; reason: string | null }>;
  /** Rules a PM or Admin has not applied to the project (PR-M08): left out, never blocking. */
  notApplied: Array<{ ruleKey: string; state: string; required: boolean; marking: string | null }>;
  /** Applied rules per mandatory marking (`not_annotated` for rules without an annotation). */
  markingCounts: Record<string, number>;
  /**
   * Non-blocking warnings on applied rules (plan §5, owner A4): not annotated, needs clarification, a link to a rule
   * that is not applied (unresolved dependency), a duplicate or overlap. They are exported as uncertainty.
   */
  annotationWarnings: Array<{ ruleKey: string; flags: AnnotationFlag[] }>;
  blocking: string[];
  conflicts: Conflict[];
  counts: Record<string, number>;
  digest: string | null;
  latest: { id: string; version: number; digest: string } | null;
}

function setContent(items: Current[]) {
  const rules = items
    .filter((i) => i.version.state === 'REVIEWED')
    .map((i) => ({
      ruleId: i.rule.id,
      ruleKey: i.rule.ruleKey,
      ruleVersionId: i.version.id,
      version: i.version.version,
      contentHash: i.version.contentHash,
      body: PolicyRuleBody.parse(i.version.body),
      // An unverified quote applied with the PM's confirmation (PR-M05) says so; verified sources keep their earlier shape.
      sources: i.version.citations.map((c) => ({ documentVersionId: c.documentVersionId, sha256: c.documentVersion.sha256, fieldPath: c.fieldPath, role: c.role, quote: c.quote, locator: c.locator, ...(c.resolution === 'RESOLVED' ? {} : { resolution: c.resolution }) })),
    }));
  return { inheritanceMode: 'ALL_TASKS', rules };
}

export const NOT_APPLIED = 'Not applied to this project';

/**
 * Publication preview (S1 R13, PR-M08). The set holds the applied (Reviewed) rules; Draft and Needs definition
 * versions are never included and, since 14 Nov 2026, do not block: they are listed as Not applied. A conflict blocks
 * when it involves an applied rule.
 */
export async function previewRuleSet(tx: Db | Tx, clientId: string, projectId: string): Promise<Preview> {
  const items = await currentVersions(tx, clientId, projectId);
  const counts = { DRAFT: 0, NEEDS_DEFINITION: 0, REVIEWED: 0, EXCLUDED: 0 } as Record<string, number>;
  for (const i of items) counts[i.version.state] = (counts[i.version.state] ?? 0) + 1;
  const blocking: string[] = [];
  const applied = new Set(items.filter((i) => i.version.state === 'REVIEWED').map((i) => i.rule.ruleKey));
  const conflicts = detectConflicts(items);
  for (const c of conflicts) if (c.ruleKeys.some((k) => applied.has(k))) blocking.push(c.message);
  const notApplied = items.filter((i) => i.version.state === 'DRAFT' || i.version.state === 'NEEDS_DEFINITION');
  // Anvil cannot accept a rule without its required fields: an applied rule that is still incomplete blocks (owner, 14 Nov 2026).
  for (const i of items) {
    if (i.version.state !== 'REVIEWED') continue;
    const gaps = definitionProblems(i.version.body);
    if (gaps.length) blocking.push(`${i.rule.ruleKey} is applied but incomplete: ${gaps.join(' ')} Define it (with AI or by hand) and tick it again.`);
  }
  const content = setContent(items);
  if (content.rules.length === 0) blocking.push('No rule is applied to the project yet.');
  const markingCounts: Record<string, number> = {};
  const annotationWarnings: Preview['annotationWarnings'] = [];
  for (const i of items.filter((x) => x.version.state === 'REVIEWED')) {
    const a = PolicyRuleBody.parse(i.version.body).annotation;
    markingCounts[a?.marking ?? 'not_annotated'] = (markingCounts[a?.marking ?? 'not_annotated'] ?? 0) + 1;
    const flags = annotationFlags(a, { known: applied, knownLabel: 'applied to the project' }).filter((f) => f.code !== 'UNKNOWN_FIELD' && f.code !== 'OPEN_QUESTION');
    if (flags.length) annotationWarnings.push({ ruleKey: i.rule.ruleKey, flags });
  }
  // A threshold definition that is not applied leaves the applied rules that use it with an unresolved dependency.
  for (const i of items.filter((x) => x.version.state !== 'REVIEWED' && x.version.state !== 'EXCLUDED')) {
    for (const l of PolicyRuleBody.parse(i.version.body).annotation?.links ?? []) {
      if (!applied.has(l.ruleKey) || REVERSE_RELATION[l.relation] !== 'uses_definition') continue;
      const dependant = items.find((x) => x.rule.ruleKey === l.ruleKey);
      if (dependant && PolicyRuleBody.parse(dependant.version.body).annotation?.links.some((b) => b.ruleKey === i.rule.ruleKey)) continue; // already flagged from its own link
      const w = annotationWarnings.find((x) => x.ruleKey === l.ruleKey) ?? annotationWarnings[annotationWarnings.push({ ruleKey: l.ruleKey, flags: [] }) - 1]!;
      w.flags.push({ code: 'UNRESOLVED_LINK', message: `Uses the definition in ${i.rule.ruleKey}, which is not applied to the project.` });
    }
  }
  const latest = await tx.projectRuleSet.findFirst({ where: { clientId, projectId }, orderBy: { version: 'desc' }, select: { id: true, version: true, digest: true } });
  return {
    included: content.rules.map((r) => ({ ruleKey: r.ruleKey, ruleVersionId: r.ruleVersionId, version: r.version, title: r.body.title })),
    excluded: [...items.filter((i) => i.version.state === 'EXCLUDED').map((i) => ({ ruleKey: i.rule.ruleKey, reason: i.version.excludeReason })), ...notApplied.map((i) => ({ ruleKey: i.rule.ruleKey, reason: NOT_APPLIED }))],
    notApplied: notApplied.map((i) => ({ ruleKey: i.rule.ruleKey, state: i.version.state, required: i.rule.required, marking: PolicyRuleBody.parse(i.version.body).annotation?.marking ?? null })),
    markingCounts,
    annotationWarnings,
    blocking,
    conflicts,
    counts,
    digest: content.rules.length ? sha256(stableStringify(content)) : null,
    latest,
  };
}

/**
 * Publishes an immutable Project rule set (S1 R14). The server recomputes everything; identical content returns the
 * existing set (idempotent); a stale expectedVersion (someone published in between) is rejected.
 */
export async function publishRuleSet(tx: Tx, input: { clientId: string; projectId: string; actorId: string; expectedLatestVersion: number | null }, audit: (a: AuditInput) => Promise<void>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'policy-ruleset:' + input.projectId}))`;
  const items = await currentVersions(tx, input.clientId, input.projectId);
  const preview = await previewRuleSet(tx, input.clientId, input.projectId);
  if (preview.blocking.length) throw new AppError(422, 'PUBLICATION_BLOCKED', `Publication is blocked: ${preview.blocking.join(' ')}`);
  const content = setContent(items);
  const digest = sha256(stableStringify(content));
  if (preview.latest?.digest === digest) return { set: await tx.projectRuleSet.findUniqueOrThrow({ where: { id: preview.latest.id } }), created: false };
  if ((preview.latest?.version ?? null) !== input.expectedLatestVersion) throw conflict('Someone published a new rule set since you opened this page. Reload to see it.');
  const version = (preview.latest?.version ?? 0) + 1;
  const set = await tx.projectRuleSet.create({
    data: {
      clientId: input.clientId,
      projectId: input.projectId,
      version,
      ruleVersionIds: content.rules.map((r) => r.ruleVersionId),
      excluded: preview.excluded as unknown as Prisma.InputJsonValue,
      content: content as unknown as Prisma.InputJsonValue,
      digest,
      publishedById: input.actorId,
    },
  });
  await audit({ entityType: 'ProjectRuleSet', entityId: set.id, action: 'policy.rule_set_published', after: { version, digest, rules: content.rules.length } });
  return { set, created: true };
}

export async function latestRuleSet(tx: Db | Tx, clientId: string, projectId: string) {
  return tx.projectRuleSet.findFirst({ where: { clientId, projectId }, orderBy: { version: 'desc' } });
}
