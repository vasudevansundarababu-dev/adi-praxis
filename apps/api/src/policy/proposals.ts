import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PolicyProposal } from '@prisma/client';
import { policyIntakeFlags, type PolicyIntakeFlag, type PolicyProposalDecision, type PolicyProposalMeta } from '@praxis/shared';
import type { InternalActor } from '../auth/actor';
import { detectSensitive } from '../candidate/sensitive';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { AppError, forbidden, notFound } from '../lib/errors';
import type { writeAudit } from '../platform/audit';
import { readPolicyDocument, type ReadPolicyDocument } from './document-reader';
import { addDocumentVersion } from './documents';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'document';

/** Read failures that still keep the proposal (flagged UNREADABLE); anything else (oversize, unsupported, encrypted, too many pages) is refused. */
const KEEP_UNREADABLE = new Set(['UNREADABLE_FILE', 'NO_TEXT_FOUND']);

/**
 * An SME proposes a policy document for their project (Wave 3, chapter 07). The original bytes and their sha256 are
 * kept; Praxis's text reading is stored separately (redacted when real data is suspected). Intake flags are advice for
 * the reviewer, never a decision. Re-proposing the same file while it is pending returns the existing proposal.
 */
export async function proposePolicy(
  tx: Tx,
  deps: { storage: ObjectStorage; scanner: MalwareScanner; maxPages: number },
  input: { task: { id: string; projectId: string; clientId: string }; smeUserId: string; meta: PolicyProposalMeta; fileName: string; buf: Buffer },
  audit: Audit,
): Promise<{ proposal: PolicyProposal; created: boolean }> {
  if ((await deps.scanner.scan(input.buf)) !== 'CLEAN') throw new AppError(422, 'FILE_REJECTED', 'The file did not pass the malware scan.');
  let read: ReadPolicyDocument | null = null;
  try {
    read = await readPolicyDocument(input.buf, input.fileName, deps.maxPages);
  } catch (e) {
    if (!(e instanceof AppError) || !KEEP_UNREADABLE.has(e.code)) throw e;
  }
  const sha256 = createHash('sha256').update(input.buf).digest('hex');
  const existing = await tx.policyProposal.findFirst({ where: { smeUserId: input.smeUserId, projectId: input.task.projectId, sha256, status: 'PENDING' } });
  if (existing) {
    await audit({ entityType: 'PolicyProposal', entityId: existing.id, action: 'policy.proposal_reused', after: { sha256 } });
    return { proposal: existing, created: false };
  }
  const pending = await tx.policyProposal.count({ where: { smeUserId: input.smeUserId, projectId: input.task.projectId, status: 'PENDING' } });
  if (pending >= 10) throw new AppError(409, 'TOO_MANY_PENDING', 'You have 10 policy proposals waiting for review on this project. Wait for a decision before proposing more.');

  const sensitive = read ? detectSensitive(read.text) : { flagged: false, kinds: [] as string[], redacted: '' };
  const flags: PolicyIntakeFlag[] = policyIntakeFlags(read?.text ?? null, { sensitive: sensitive.flagged });
  const id = randomUUID();
  const base = `policy-proposals/${input.task.clientId}/${input.task.projectId}/${id}`;
  await deps.storage.put(`${base}/original`, input.buf, read?.mediaType ?? 'application/octet-stream');
  let textStorageKey: string | null = null;
  if (read) {
    textStorageKey = `${base}/text.json`;
    // Suspected real data: only the redacted reading is stored, so reviewers never see the values in Praxis's text view.
    const pages = sensitive.flagged ? read.pages.map((p) => detectSensitive(p).redacted) : read.pages;
    const text = sensitive.flagged ? sensitive.redacted : read.text;
    await deps.storage.put(textStorageKey, Buffer.from(JSON.stringify({ text, pages })), 'application/json');
  }
  const m = input.meta;
  const proposal = await tx.policyProposal.create({
    data: {
      id,
      clientId: input.task.clientId,
      projectId: input.task.projectId,
      taskInstanceId: input.task.id,
      smeUserId: input.smeUserId,
      title: m.title,
      category: m.category,
      issuer: m.issuer ?? null,
      versionLabel: m.versionLabel ?? null,
      language: m.language ?? null,
      jurisdiction: m.jurisdiction ?? null,
      effectiveFrom: m.effectiveFrom ? new Date(m.effectiveFrom) : null,
      effectiveTo: m.effectiveTo ? new Date(m.effectiveTo) : null,
      reason: m.reason,
      rightsDeclared: m.rightsDeclared,
      sha256,
      fileName: safeName(input.fileName),
      mediaType: read?.mediaType ?? 'application/octet-stream',
      format: read?.format ?? null,
      sizeBytes: input.buf.length,
      pageCount: read?.pageCount ?? 0,
      storageKey: `${base}/original`,
      textStorageKey,
      textChars: read?.text.length ?? 0,
      intakeFlags: flags as unknown as Prisma.InputJsonValue,
    },
  });
  await audit({
    entityType: 'PolicyProposal',
    entityId: proposal.id,
    action: 'policy.proposal_submitted',
    after: { projectId: proposal.projectId, taskId: input.task.id, category: proposal.category, sha256, sizeBytes: proposal.sizeBytes, flags: flags.map((f) => f.code), sensitiveKinds: sensitive.kinds },
  });
  return { proposal, created: true };
}

export interface ProposalAccess {
  project: { id: string; clientId: string; ownerId: string };
  role: 'EXPERT' | 'PM' | 'ADMIN';
}

/** Who reviews proposals: Validators assigned to the project (Expert), the owning PM and Admins. Others get 404. */
export async function proposalAccess(tx: Db | Tx, actor: InternalActor, projectId: string): Promise<ProposalAccess> {
  const project = await tx.project.findFirst({ where: { id: projectId, clientId: actor.clientId }, select: { id: true, clientId: true, ownerId: true } });
  if (!project) throw notFound('Project not found');
  if (actor.roles.includes('ADMIN')) return { project, role: 'ADMIN' };
  if (actor.roles.includes('PM') && project.ownerId === actor.userId) return { project, role: 'PM' };
  if (actor.roles.includes('REVIEWER') && (await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId, userId: actor.userId } } }))) return { project, role: 'EXPERT' };
  throw notFound('Project not found');
}

export async function loadProposal(tx: Db | Tx, projectId: string, id: string) {
  const p = await tx.policyProposal.findFirst({ where: { id, projectId } });
  if (!p) throw notFound('Policy proposal not found');
  return p;
}

/**
 * An Expert / PM / Admin decides a pending proposal. ACCEPT copies the original bytes into a new project document
 * version (origin SME_PROPOSAL) through the existing document service; its rules still need extraction, rule review
 * and PM/Admin publication before any task sees them. A decided proposal is frozen (database trigger).
 */
export async function decideProposal(
  tx: Tx,
  deps: { storage: ObjectStorage; scanner: MalwareScanner; maxPages: number },
  actor: InternalActor,
  input: { projectId: string; proposalId: string; body: PolicyProposalDecision },
  audit: Audit,
) {
  const a = await proposalAccess(tx, actor, input.projectId);
  await tx.$executeRaw`SELECT 1 FROM "PolicyProposal" WHERE id = ${input.proposalId}::uuid FOR UPDATE`;
  const p = await loadProposal(tx, input.projectId, input.proposalId);
  if (p.status !== 'PENDING') throw new AppError(409, 'ALREADY_DECIDED', `This proposal was already ${p.status.toLowerCase()}.`, { status: p.status });
  await assertNotProposer(tx, actor, p.smeUserId);
  const { decision, qualification, reason } = input.body;
  const flags = (p.intakeFlags as unknown as PolicyIntakeFlag[]) ?? [];
  if (decision === 'ACCEPT' && (!p.textStorageKey || flags.some((f) => f.code === 'SENSITIVE_DATA_SUSPECTED'))) {
    throw new AppError(422, 'CANNOT_ACCEPT', p.textStorageKey ? 'Possible real data was found in this document. Return it so the SME can upload a synthetic copy.' : 'Praxis could not read this file. Return it so the SME can upload a readable copy.');
  }
  let documentId: string | null = null;
  let documentVersionId: string | null = null;
  if (decision === 'ACCEPT') {
    const buf = await deps.storage.get(p.storageKey);
    const r = await addDocumentVersion(
      tx,
      deps,
      {
        clientId: p.clientId,
        projectId: p.projectId,
        actorId: actor.userId,
        meta: {
          title: p.title,
          category: p.category,
          language: p.language,
          jurisdiction: p.jurisdiction,
          effectiveFrom: p.effectiveFrom?.toISOString().slice(0, 10) ?? null,
          effectiveTo: p.effectiveTo?.toISOString().slice(0, 10) ?? null,
        },
        fileName: p.fileName,
        buf,
        origin: 'SME_PROPOSAL',
      },
      audit,
    );
    documentId = r.document.id;
    documentVersionId = r.version.id;
  }
  const status = decision === 'ACCEPT' ? 'ACCEPTED' : decision === 'RETURN' ? 'RETURNED' : 'REJECTED';
  const updated = await tx.policyProposal.update({
    where: { id: p.id },
    data: { status, qualification, decisionReason: reason, decidedById: actor.userId, decidedRole: a.role, decidedAt: new Date(), documentId, documentVersionId },
  });
  await audit({
    entityType: 'PolicyProposal',
    entityId: p.id,
    action: `policy.proposal_${status.toLowerCase()}`,
    before: { status: 'PENDING' },
    after: { status, qualification, reason, role: a.role, documentId, documentVersionId },
  });
  return updated;
}

/** An internal user who is also the proposing SME (same email) may not decide their own proposal. */
async function assertNotProposer(tx: Tx, actor: InternalActor, smeUserId: string) {
  const [sme, me] = await Promise.all([tx.smeUser.findUnique({ where: { id: smeUserId } }), tx.user.findUniqueOrThrow({ where: { id: actor.userId } })]);
  if (sme && (sme.contactEmail ?? '').toLowerCase() === me.email.toLowerCase()) throw forbidden('You cannot decide a policy proposal you made.');
}

/** What the SME sees: their own proposals with status and the reviewer's reason. Never other SMEs' proposals. */
export function smeProposalView(p: PolicyProposal) {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    fileName: p.fileName,
    sizeBytes: p.sizeBytes,
    sha256: p.sha256,
    status: p.status,
    flags: (p.intakeFlags as unknown as PolicyIntakeFlag[]).map((f) => ({ code: f.code, message: f.message })),
    decisionReason: p.status === 'PENDING' ? null : p.decisionReason,
    qualification: p.qualification,
    createdAt: p.createdAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
  };
}

export function reviewerProposalView(p: PolicyProposal, proposer: string | null) {
  return {
    ...smeProposalView(p),
    proposer,
    taskId: p.taskInstanceId,
    issuer: p.issuer,
    versionLabel: p.versionLabel,
    language: p.language,
    jurisdiction: p.jurisdiction,
    effectiveFrom: p.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: p.effectiveTo?.toISOString().slice(0, 10) ?? null,
    reason: p.reason,
    format: p.format,
    pageCount: p.pageCount,
    textChars: p.textChars,
    readable: !!p.textStorageKey,
    decidedRole: p.decidedRole,
    documentId: p.documentId,
    documentVersionId: p.documentVersionId,
    decisionReason: p.decisionReason,
  };
}
