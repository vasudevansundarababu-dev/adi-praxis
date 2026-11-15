import type { Prisma } from '@prisma/client';
import { PolicyRuleBody, REQUIREMENT_TYPE_OF, RuleAnnotation, RuleAnnotationInput, annotationContent } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { stableStringify } from '../lib/crypto';

/**
 * Rule annotations (docs/prd/PRD-POLICY-RULE-ANNOTATIONS.md, plan §3). The current annotation lives in the rule
 * version body, so the existing versioning, stale-edit checks and "Apply to project" cover it. Every save is also
 * written to the append-only PolicyRuleAnnotationRevision table, which keeps the AI's original suggestion apart from
 * author edits.
 */

export interface AnnotationSave {
  source: 'AI_SUGGESTION' | 'AUTHOR_EDIT';
  editedById: string;
  editedRole?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  basedOnRevisionId?: string | null;
}

/** The role stored with an edit: Admin or PM (never a name). */
export const editorRole = (roles: string[]) => (roles.includes('ADMIN') ? 'ADMIN' : roles.includes('PM') ? 'PM' : (roles[0] ?? null));

export async function nextAnnotationVersion(tx: Tx | Db, ruleId: string) {
  const last = await tx.policyRuleAnnotationRevision.findFirst({ where: { ruleId }, orderBy: { annotationVersion: 'desc' }, select: { annotationVersion: true } });
  return (last?.annotationVersion ?? 0) + 1;
}

const same = (a: RuleAnnotation | RuleAnnotationInput, b: RuleAnnotation | RuleAnnotationInput) => stableStringify(annotationContent(a)) === stableStringify(annotationContent(b));

/**
 * Prepares a body for saving: a changed annotation gets the next annotation version; an unchanged one keeps the current
 * version; a body without one keeps the current annotation. The old requirementType follows the classification.
 */
export async function prepareAnnotation(tx: Tx, ruleId: string, current: RuleAnnotation | undefined, incoming: PolicyRuleBody): Promise<{ body: PolicyRuleBody; changed: boolean }> {
  const wanted = incoming.annotation ?? current;
  if (!wanted) return { body: incoming, changed: false };
  const changed = !current || !same(wanted, current);
  const version = changed ? await nextAnnotationVersion(tx, ruleId) : current!.version;
  const annotation = RuleAnnotation.parse({ ...wanted, version });
  return { body: { ...incoming, annotation, requirementType: REQUIREMENT_TYPE_OF[annotation.classification] }, changed };
}

export async function recordRevision(tx: Tx, input: { clientId: string; ruleId: string; ruleVersionId: string; annotation: RuleAnnotation; adopted: boolean; save: AnnotationSave }) {
  const s = input.save;
  return tx.policyRuleAnnotationRevision.create({
    data: {
      clientId: input.clientId,
      ruleId: input.ruleId,
      ruleVersionId: input.ruleVersionId,
      annotationVersion: input.annotation.version,
      source: s.source,
      annotation: input.annotation as unknown as Prisma.InputJsonValue,
      adopted: input.adopted,
      model: s.model ?? null,
      promptVersion: s.promptVersion ?? null,
      editedById: s.editedById,
      editedRole: s.editedRole ?? null,
      basedOnRevisionId: s.basedOnRevisionId ?? null,
    },
  });
}

export type RevisionRow = Awaited<ReturnType<typeof revisionsForRules>>[number];

export async function revisionsForRules(db: Db | Tx, clientId: string, ruleIds: string[]) {
  if (!ruleIds.length) return [];
  return db.policyRuleAnnotationRevision.findMany({ where: { clientId, ruleId: { in: ruleIds } }, orderBy: [{ ruleId: 'asc' }, { annotationVersion: 'asc' }] });
}

/** Per rule: the revision behind the current annotation and the newest AI suggestion that was offered, not adopted. */
export function annotationState(body: PolicyRuleBody, revisions: RevisionRow[]) {
  const current = body.annotation ? (revisions.find((r) => r.annotationVersion === body.annotation!.version) ?? null) : null;
  const pending = [...revisions].reverse().find((r) => r.source === 'AI_SUGGESTION' && !r.adopted && r.annotationVersion > (body.annotation?.version ?? 0)) ?? null;
  return { current, pending };
}

export const revisionDto = (r: RevisionRow) => ({
  id: r.id,
  annotationVersion: r.annotationVersion,
  source: r.source,
  adopted: r.adopted,
  model: r.model,
  editedById: r.editedById,
  editedRole: r.editedRole,
  basedOnRevisionId: r.basedOnRevisionId,
  ruleVersionId: r.ruleVersionId,
  createdAt: r.createdAt,
  annotation: RuleAnnotation.parse(r.annotation),
});
