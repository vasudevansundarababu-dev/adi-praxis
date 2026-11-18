import type { AuditEvent, Template } from '@prisma/client';
import { jointHashes, jointTemplateSpec } from '../anvil/joint-template';
import type { Db } from '../db';
import { projectNameFor } from './kyc-v8-successor';

/**
 * Read-only readback for the KYC v8 publication and approval records (DevOps writes them from this). Lists, for v7 and
 * v8 and the v8 successor tasks: published IDs, template and part hashes, audit event IDs, actor user IDs and roles,
 * timestamps, review receipts and the predecessor mapping. User IDs and roles only: never names or e-mail addresses.
 * Writes nothing.
 */

type Roles = (ids: (string | null | undefined)[]) => Promise<Map<string, string[]>>;

const event = (e: AuditEvent, roles: Map<string, string[]>) => ({ auditEventId: e.id, action: e.action, actorType: e.actorType, actorId: e.actorId, actorRoles: e.actorType === 'USER' && e.actorId ? (roles.get(e.actorId) ?? []) : [], at: e.createdAt.toISOString() });

function templateView(t: Template) {
  const joint = jointTemplateSpec(t);
  const h = joint ? jointHashes(joint) : null;
  return { templateVersionId: t.id, templateId: t.lineageId, version: t.version, status: t.status, publishedAt: t.publishedAt?.toISOString() ?? null, formId: t.profileId, template_sha256: h?.template_sha256 ?? null, part_hashes: h?.part_hashes ?? null };
}

/** The opaque review receipt reference the generic package carries for a record (same format as the export). */
export const receiptRefOf = (r: { id: string; contentHash: string }) => `praxis-approved-record:${r.id}:${r.contentHash.slice(0, 16)}`;

export async function kycV8Readback(db: Db, args: { v7TemplateId: string; v7ProjectId: string }) {
  const v7 = await db.template.findUnique({ where: { id: args.v7TemplateId } });
  const p7 = await db.project.findUnique({ where: { id: args.v7ProjectId } });
  if (!v7 || !p7) return { report: 'kyc-v8-readback', ok: false, reason: 'The v7 template version or project was not found.' };
  const v8 = await db.template.findFirst({ where: { lineageId: v7.lineageId, version: v7.version + 1 } });
  const p8 = v8 ? await db.project.findFirst({ where: { clientId: p7.clientId, name: projectNameFor(p7.name), templateId: v8.id } }) : null;

  const userIds = new Set<string>();
  const audits = async (entityType: string, ids: string[]) => {
    const rows = ids.length ? await db.auditEvent.findMany({ where: { entityType, entityId: { in: ids } }, orderBy: { createdAt: 'asc' } }) : [];
    for (const r of rows) if (r.actorType === 'USER' && r.actorId) userIds.add(r.actorId);
    return rows;
  };
  const rolesOf: Roles = async (ids) => {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const users = want.length ? await db.user.findMany({ where: { id: { in: want } }, select: { id: true, roles: true } }) : [];
    return new Map(users.map((u) => [u.id, u.roles as string[]]));
  };

  const v8Events = v8 ? await audits('Template', [v8.id]) : [];
  const ruleSets = p8 ? await db.projectRuleSet.findMany({ where: { projectId: p8.id }, orderBy: { version: 'asc' } }) : [];
  const docs = p8 ? await db.policyDocumentVersion.findMany({ where: { projectId: p8.id }, orderBy: { createdAt: 'asc' } }) : [];
  const tasks = p8 ? (await db.taskInstance.findMany({ where: { projectId: p8.id }, include: { reviews: { orderBy: { createdAt: 'asc' } }, submissions: { orderBy: { version: 'asc' } }, approvedRecords: { orderBy: { seq: 'asc' } } }, orderBy: { createdAt: 'asc' } })).filter((t) => (t.input as { successorOf?: unknown }).successorOf) : [];
  const taskEvents = await audits('TaskInstance', tasks.map((t) => t.id));
  const projectEvents = p8 ? await audits('Project', [p8.id]) : [];
  const setEvents = await audits('ProjectRuleSet', ruleSets.map((s) => s.id));
  const roles = await rolesOf([...userIds, ...ruleSets.map((s) => s.publishedById), ...tasks.flatMap((t) => [...t.reviews.map((r) => r.reviewerId), ...t.approvedRecords.map((r) => r.reviewerId)])]);

  return {
    report: 'kyc-v8-readback',
    ok: true,
    v7: templateView(v7),
    v8: v8 ? { ...templateView(v8), events: v8Events.map((e) => event(e, roles)) } : null,
    project: p8
      ? {
          projectId: p8.id,
          predecessorProjectId: p7.id,
          templateVersionId: p8.templateId,
          events: projectEvents.map((e) => event(e, roles)),
          policyDocuments: docs.map((d) => ({ documentId: d.documentId, documentVersionId: d.id, version: d.version, sha256: d.sha256, uploadedById: d.uploadedById, at: d.createdAt.toISOString() })),
          ruleSets: ruleSets.map((s) => ({ ruleSetId: s.id, version: s.version, digest: s.digest, publishedById: s.publishedById, publishedByRoles: roles.get(s.publishedById) ?? [], at: s.createdAt.toISOString(), events: setEvents.filter((e) => e.entityId === s.id).map((e) => event(e, roles)) })),
        }
      : null,
    successors: tasks.map((t) => {
      const so = (t.input as { successorOf: { predecessor: Record<string, unknown>; approvals: unknown; candidate: unknown; carriedSections: unknown; changedSections: unknown } }).successorOf;
      return {
        taskId: t.id,
        status: t.status,
        predecessor: so.predecessor,
        carriedSections: so.carriedSections,
        changedSections: so.changedSections,
        approvals: so.approvals,
        candidate: so.candidate,
        submissions: t.submissions.map((s) => ({ version: s.version, at: s.submittedAt.toISOString(), policySnapshotId: s.policySnapshotId })),
        reviews: t.reviews.map((r) => ({ reviewId: r.id, reviewerId: r.reviewerId, reviewerRoles: roles.get(r.reviewerId) ?? [], decision: r.decision, stage: r.stage, submissionVersion: r.submissionVersion, contentHash: r.contentHash, at: r.createdAt.toISOString() })),
        approvedRecords: t.approvedRecords.map((r) => ({ recordId: r.id, seq: r.seq.toString(), contentHash: r.contentHash, prevHash: r.prevHash, reviewerId: r.reviewerId, reviewerRoles: roles.get(r.reviewerId) ?? [], reviewDecisionAt: r.reviewDecisionAt.toISOString(), templateVersionId: r.templateId, templateVersion: r.templateVersion, receiptRef: receiptRefOf(r) })),
        events: taskEvents.filter((e) => e.entityId === t.id).map((e) => event(e, roles)),
      };
    }),
  };
}
