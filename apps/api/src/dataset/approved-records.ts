import type { ApprovedTaskRecord, Prisma } from '@prisma/client';
import type { Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import type { StoredChecks } from '../tasks/submission';

export const APPROVED_RECORD_SCHEMA_VERSION = 1;
/** One writer at a time extends the hash chain (transaction-scoped advisory lock). */
const CHAIN_LOCK = 7_310_001;

/** The fields covered by `content_hash`: input, output and lineage (SPEC: Approved Task Dataset). */
export function recordContent(r: Omit<ApprovedTaskRecord, 'id' | 'seq' | 'createdAt' | 'contentHash' | 'prevHash'>) {
  const { nearestDuplicateScore, ...rest } = r;
  return { ...rest, nearestDuplicateScore: nearestDuplicateScore === null ? null : Number(nearestDuplicateScore).toFixed(4), submittedAt: r.submittedAt.toISOString(), reviewDecisionAt: r.reviewDecisionAt.toISOString() };
}
export const recordHash = (content: unknown, prevHash: string | null) => sha256(stableStringify({ content, prevHash }));

/**
 * Writes the dataset record for an accepted task, in the caller's transaction (a task cannot be accepted without its
 * record). Carries the full lineage; `prev_hash` links to the previous record so any tampering breaks the chain.
 */
export async function writeApprovedRecord(tx: Tx, args: { taskId: string; reviewerId: string; reviewNotes: string | null; duplicateDecision: 'ACCEPT_AS_DISTINCT' | null; decidedAt: Date }) {
  const t = await tx.taskInstance.findUniqueOrThrow({
    where: { id: args.taskId },
    include: { project: { include: { template: { include: { domain: true } } } }, slot: true, inputBatch: true, assignedTo: true, projectAssignment: { include: { smeAssignment: true } } },
  });
  if (!t.assignedTo || !t.submittedAt || !t.output) throw new Error('Only a submitted, assigned task can be recorded');
  const smeUserId = t.assignedTo.smeUserId;
  const identity = await tx.identityAttempt.findFirst({ where: { smeUserId, status: 'VERIFIED' }, orderBy: { checkedAt: 'desc' } });
  const alternative = identity ? null : await tx.alternativeIdentityCheck.findFirst({ where: { smeUserId }, orderBy: { createdAt: 'desc' } });
  const enrollmentId = t.projectAssignment?.enrollmentId ?? t.projectAssignment?.smeAssignment?.enrollmentId ?? null;
  const acks = enrollmentId ? await tx.onboardingAcknowledgement.findMany({ where: { checklist: { enrollmentId }, termsHash: { not: null } } }) : [];
  const terms = acks.length ? await tx.termsDocument.findMany({ where: { sha256: { in: acks.map((a) => a.termsHash!) } } }) : [];
  const checks = t.checks as StoredChecks | null;
  const nearest = [...(checks?.similar ?? [])].sort((a, b) => Math.max(b.embeddingScore, b.structuredScore) - Math.max(a.embeddingScore, a.structuredScore))[0];
  const authorIndex = t.taskType === 'AUTHORING' ? (await tx.approvedTaskRecord.count({ where: { projectId: t.projectId, candidateId: t.assignedTo.id, supersedesId: null } })) + 1 : null;

  const base = {
    schemaVersion: APPROVED_RECORD_SCHEMA_VERSION,
    supersedesId: null,
    taskInstanceId: t.id,
    taskMode: t.taskType,
    input: t.input as Prisma.JsonValue,
    output: t.output as Prisma.JsonValue,
    activeSeconds: t.activeSeconds,
    submittedAt: t.submittedAt,
    slotId: t.slotId,
    coverageTags: (t.coverageTags ?? null) as Prisma.JsonValue,
    isOpenSlot: t.slot?.isOpen ?? false,
    nearestDuplicateId: nearest?.taskId ?? null,
    nearestDuplicateScore: nearest ? (Math.max(nearest.embeddingScore, nearest.structuredScore).toFixed(4) as unknown as Prisma.Decimal) : null,
    authorTaskIndex: authorIndex,
    inputSource: t.inputBatch?.source ?? null,
    inputBatchId: t.inputBatchId,
    uploadedById: t.inputBatch?.uploadedById ?? null,
    apiClientId: t.inputBatch?.apiClientId ?? null,
    candidateId: t.assignedTo.id,
    identityRef: identity ? `${identity.provider}:${identity.providerSessionId}` : alternative ? `alternative:${alternative.id}` : null,
    projectAssignmentId: t.projectAssignmentId,
    qualificationSnapshot: (t.projectAssignment?.smeAssignment?.qualificationSnapshot ?? null) as Prisma.JsonValue,
    reviewerId: args.reviewerId,
    reviewDecisionAt: args.decidedAt,
    reviewNotes: args.reviewNotes,
    reworkCount: t.reworkCount,
    duplicateDecision: args.duplicateDecision,
    clientId: t.clientId,
    projectId: t.projectId,
    templateId: t.project.templateId,
    templateVersion: t.project.templateVersion,
    domain: t.project.template.domain.name,
    workflow: t.project.template.workflowName,
    jdSnapshotId: t.project.jdSnapshotId,
    workerTermsVersion: terms.length ? terms.map((d) => `${d.key}:v${d.version}`).sort().join(',') : null,
  };

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
  const prev = await tx.approvedTaskRecord.findFirst({ orderBy: { seq: 'desc' }, select: { contentHash: true } });
  const prevHash = prev?.contentHash ?? null;
  const contentHash = recordHash(recordContent(base as never), prevHash);
  return tx.approvedTaskRecord.create({
    data: { ...base, input: base.input as Prisma.InputJsonValue, output: base.output as Prisma.InputJsonValue, coverageTags: (base.coverageTags ?? undefined) as Prisma.InputJsonValue | undefined, qualificationSnapshot: (base.qualificationSnapshot ?? undefined) as Prisma.InputJsonValue | undefined, prevHash, contentHash },
  });
}
