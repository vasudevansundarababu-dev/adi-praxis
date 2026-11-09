import type { Prisma } from '@prisma/client';
import { POLICY_SIDECAR_VERSION, PolicyRuleBody, ProjectRuleSetContent, TaskChangeInput } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { latestRuleSet } from './rule-sets';

type RuleSetRule = ReturnType<typeof ProjectRuleSetContent.parse>['rules'][number];

/** Rubric reference used in snapshots: the task's project template version (rubrics stay unchanged, S1 §9). */
async function rubricVersion(tx: Db | Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { templateId: true, templateVersion: true } });
  return `template:${p.templateId}@${p.templateVersion}`;
}

/** Validates a task change against the inherited rule (S1 X01–X06). */
export async function validateChange(tx: Db | Tx, clientId: string, projectId: string, input: TaskChangeInput) {
  const set = await latestRuleSet(tx, clientId, projectId);
  if (!set) throw new AppError(409, 'NO_RULE_SET', 'This project has no published rule set, so there is nothing to change.');
  const rule = ProjectRuleSetContent.parse(set.content).rules.find((r) => r.ruleVersionId === input.ruleVersionId);
  if (!rule) throw new AppError(422, 'RULE_NOT_INHERITED', 'That rule version is not in the project rule set this task inherits.');
  if (!input.reason.trim()) throw new AppError(422, 'REASON_REQUIRED', 'Give a reason for this change.');
  if (input.type === 'EXEMPTION') {
    if (rule.body.exceptions.kind !== 'listed' || rule.body.exceptions.items.length === 0) throw new AppError(422, 'EXEMPTION_NOT_ALLOWED', 'This rule defines no exception, so an exemption is not allowed. Use a clarification or a stricter constraint instead.');
    if (input.exceptionIndex === null || !rule.body.exceptions.items[input.exceptionIndex]) throw new AppError(422, 'EXCEPTION_REQUIRED', 'Choose which exception in the source allows this exemption.');
  }
  if (input.type === 'EXEMPTION' || input.type === 'STRICTER') {
    if (!input.sourceCitationId) throw new AppError(422, 'SOURCE_REQUIRED', 'Point to the policy source that supports this change.');
    const cit = await tx.policyCitation.findFirst({ where: { id: input.sourceCitationId, clientId }, include: { documentVersion: true } });
    if (!cit || cit.documentVersion.projectId !== projectId) throw new AppError(422, 'SOURCE_REQUIRED', 'The source reference must be a citation from this project\'s policy documents.');
    if (input.type === 'EXEMPTION' && (cit.ruleVersionId !== input.ruleVersionId || cit.role !== 'exception')) throw new AppError(422, 'EXEMPTION_NOT_SUPPORTED', 'An exemption must cite the exception text of the same rule.');
  }
  return rule;
}

export async function addChange(tx: Tx, input: { clientId: string; projectId: string; taskId: string; actorId: string; change: TaskChangeInput }, audit: (a: AuditInput) => Promise<void>) {
  await validateChange(tx, input.clientId, input.projectId, input.change);
  const c = input.change;
  const row = await tx.taskPolicyChange.create({
    data: { clientId: input.clientId, taskInstanceId: input.taskId, ruleVersionId: c.ruleVersionId, type: c.type, scope: c.scope as Prisma.InputJsonValue, requirement: c.requirement, reason: c.reason, sourceCitationId: c.sourceCitationId, exceptionIndex: c.exceptionIndex, createdById: input.actorId },
  });
  await audit({ entityType: 'TaskPolicyChange', entityId: row.id, action: 'policy.task_change_added', after: { taskId: input.taskId, type: c.type, ruleVersionId: c.ruleVersionId } });
  return row;
}

export async function removeChange(tx: Tx, input: { clientId: string; taskId: string; changeId: string }, audit: (a: AuditInput) => Promise<void>) {
  const row = await tx.taskPolicyChange.findFirst({ where: { id: input.changeId, taskInstanceId: input.taskId, clientId: input.clientId, deletedAt: null } });
  if (!row) throw notFound('Change not found');
  await tx.taskPolicyChange.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  await audit({ entityType: 'TaskPolicyChange', entityId: row.id, action: 'policy.task_change_removed', before: { type: row.type } });
}

/** Conditional applicability shown on the task (S1 T04): universal rules always apply; others when their condition is met. */
export function applicabilityLabel(body: PolicyRuleBody) {
  const a = body.applicability;
  if (a.universal) return 'Always applies';
  const parts = [a.actions.length ? `when the agent ${a.actions.join(' / ')}` : '', a.channels.length ? `on ${a.channels.join(', ')}` : '', a.locales.length ? `for ${a.locales.join(', ')}` : '', a.conditionText ?? ''].filter(Boolean);
  return parts.length ? `Applies ${parts.join('; ')}. Otherwise: Not applicable.` : 'Applies as written';
}

/** The task's effective policy: the latest published project set plus its active changes (S1 T09). */
export async function effectivePolicy(tx: Db | Tx, clientId: string, task: { id: string; projectId: string }) {
  const set = await latestRuleSet(tx, clientId, task.projectId);
  if (!set) return null;
  const content = ProjectRuleSetContent.parse(set.content);
  const changes = await tx.taskPolicyChange.findMany({ where: { taskInstanceId: task.id, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const rubric = await rubricVersion(tx, task.projectId);
  const rules = content.rules.map((r: RuleSetRule) => ({
    rule_id: r.ruleId,
    rule_key: r.ruleKey,
    rule_version_id: r.ruleVersionId,
    version: r.version,
    content_hash: r.contentHash,
    title: r.body.title,
    requirement: r.body.requirement,
    requirement_type: r.body.requirementType,
    visibility: r.body.visibility,
    applicability: r.body.applicability,
    applicability_label: applicabilityLabel(r.body),
    prerequisites: r.body.prerequisites,
    precedence: r.body.precedence,
    exceptions: r.body.exceptions,
    effective: r.body.effective,
    evidence_needs: r.body.evidenceNeeds,
    verification_hint: r.body.verificationHint,
    sources: r.sources.map((s) => ({ document_version_id: s.documentVersionId, sha256: s.sha256, field: s.fieldPath, role: s.role, quote: s.quote, locator: s.locator })),
  }));
  const taskChanges = changes.map((c) => ({ id: c.id, rule_version_id: c.ruleVersionId, type: c.type, requirement: c.requirement, scope: c.scope, reason: c.reason, source_citation_id: c.sourceCitationId, exception_index: c.exceptionIndex }));
  const body = { project_rule_set: { id: set.id, version: set.version, digest: set.digest }, rules, task_changes: taskChanges, rubric_version: rubric };
  return { set, body, digest: sha256(stableStringify(body)) };
}

/**
 * Freezes the current effective policy for a task (S1 T10). Identical content returns the latest snapshot
 * (idempotent). Returns null when the project has no rule set (legacy task: nothing changes).
 */
export async function snapshotTask(tx: Tx, input: { clientId: string; task: { id: string; projectId: string }; actorId: string }) {
  const eff = await effectivePolicy(tx, input.clientId, input.task);
  if (!eff) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'policy-snapshot:' + input.task.id}))`;
  const latest = await tx.taskPolicySnapshot.findFirst({ where: { taskInstanceId: input.task.id }, orderBy: { version: 'desc' } });
  if (latest?.digest === eff.digest) return { snapshot: latest, created: false };
  const snapshot = await tx.taskPolicySnapshot.create({
    data: { clientId: input.clientId, taskInstanceId: input.task.id, version: (latest?.version ?? 0) + 1, ruleSetId: eff.set.id, content: eff.body as unknown as Prisma.InputJsonValue, rubricVersion: eff.body.rubric_version, digest: eff.digest, publishedById: input.actorId },
  });
  await tx.auditEvent.create({ data: { clientId: input.clientId, actorType: 'SYSTEM', actorId: input.actorId, entityType: 'TaskPolicySnapshot', entityId: snapshot.id, action: 'policy.task_snapshot_published', after: { taskId: input.task.id, version: snapshot.version, digest: eff.digest, ruleSetVersion: eff.set.version } } });
  return { snapshot, created: true };
}

/** Policy sidecar for exports (contracts/praxis/policy-snapshot.schema.json, status proposed). */
export function sidecar(s: { id: string; taskInstanceId: string; version: number; content: unknown; digest: string; createdAt: Date }, opts: { agentVisibleOnly?: boolean } = {}) {
  const c = s.content as { project_rule_set: unknown; rules: Array<{ visibility: string }>; task_changes: unknown[]; rubric_version: string };
  return {
    schema_version: POLICY_SIDECAR_VERSION,
    snapshot_id: s.id,
    task_id: s.taskInstanceId,
    snapshot_version: s.version,
    published_at: s.createdAt.toISOString(),
    project_rule_set: c.project_rule_set,
    rules: opts.agentVisibleOnly ? c.rules.filter((r) => r.visibility === 'agent_visible') : c.rules,
    task_changes: c.task_changes,
    rubric_version: c.rubric_version,
    digest: s.digest,
  };
}
