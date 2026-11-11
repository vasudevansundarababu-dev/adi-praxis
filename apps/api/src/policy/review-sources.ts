import type { Db, Tx } from '../db';
import { chatOf } from '../tasks/conversation/service';
import { effectivePolicy } from './task-policy';

type Source = { document_version_id: string; sha256: string; field: string; role: string; quote: string; locator: Record<string, unknown> | null };
type Rule = { rule_version_id: string; rule_key: string; version: number; title: string; requirement: string; visibility: string; applicability_label?: string; effective?: { from: string | null; to: string | null } | null; sources: Source[] };
type Change = { id: string; rule_version_id: string; type: string; requirement: string; reason?: string | null };

/**
 * Policy sources on the review page (Wave 3; handover chapter 08 "Reviewer screen shows ... policy sources"). The
 * reviewer sees the policy the task was submitted against: its frozen snapshot when there is one, otherwise the
 * project's current published rule set. Every rule (evaluator-only included, labelled) comes with its quoted source,
 * document, version, hash and page/line, the task's own changes, and the steps the SME linked to each rule. If the
 * project's rules changed since the snapshot, the reviewer is told.
 */
export async function reviewPolicySources(db: Db | Tx, t: { id: string; clientId: string; projectId: string; drafting: unknown }) {
  const [snap, current] = await Promise.all([
    db.taskPolicySnapshot.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } }),
    effectivePolicy(db, t.clientId, t),
  ]);
  const body = (snap?.content ?? current?.body ?? null) as { project_rule_set: { id: string; version: number; digest: string }; rules: Rule[]; task_changes: Change[] } | null;
  if (!body) return { configured: false as const, basis: null, rules: [], taskChanges: [], changedSinceSnapshot: false };
  const versionIds = [...new Set(body.rules.flatMap((r) => r.sources.map((s) => s.document_version_id)))];
  const versions = await db.policyDocumentVersion.findMany({ where: { id: { in: versionIds } }, include: { document: { select: { title: true, category: true } } } });
  const doc = new Map(versions.map((v) => [v.id, v]));
  const links = (chatOf(t as unknown as Parameters<typeof chatOf>[0]).policyLinks ?? []) as Array<{ ruleVersionId: string; stepId: string; reason?: string }>;
  const today = new Date().toISOString().slice(0, 10);
  return {
    configured: true as const,
    basis: snap ? { kind: 'SNAPSHOT' as const, version: snap.version, digest: snap.digest, at: snap.createdAt.toISOString(), ruleSetVersion: body.project_rule_set.version } : { kind: 'CURRENT_RULE_SET' as const, version: null, digest: current!.digest, at: null, ruleSetVersion: body.project_rule_set.version },
    changedSinceSnapshot: !!snap && !!current && current.body.project_rule_set.id !== body.project_rule_set.id,
    rules: body.rules.map((r) => ({
      ruleVersionId: r.rule_version_id,
      ruleKey: r.rule_key,
      version: r.version,
      title: r.title,
      requirement: r.requirement,
      visibility: r.visibility,
      applicability: r.applicability_label ?? null,
      inForce: (!r.effective?.from || r.effective.from <= today) && (!r.effective?.to || today <= r.effective.to),
      linkedSteps: links.filter((l) => l.ruleVersionId === r.rule_version_id).map((l) => l.stepId),
      sources: r.sources.map((s) => {
        const v = doc.get(s.document_version_id);
        return { document: v?.document.title ?? 'Unknown document', category: v?.document.category ?? null, documentVersion: v?.version ?? null, fileName: v?.fileName ?? null, origin: v?.origin ?? null, sha256: s.sha256, role: s.role, quote: s.quote, locator: s.locator };
      }),
    })),
    taskChanges: body.task_changes.map((c) => ({ id: c.id, ruleVersionId: c.rule_version_id, type: c.type, requirement: c.requirement, reason: c.reason ?? null })),
  };
}
