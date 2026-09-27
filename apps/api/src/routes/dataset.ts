import type { ApprovedTaskRecord, Prisma } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, Tx } from '../db';
import { appendRecord, baseOf, recordContent, recordHash } from '../dataset/approved-records';
import { verifyApprovedChain } from '../dataset/verify';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';

const IdParams = z.object({ id: z.string().uuid() });
/** Read-only access: Admins, and RL Gym with its API key. */
const READ = { roles: ['ADMIN'] as const, apiClient: 'RL_GYM' as const };
const clientOf = (req: { actor: { clientId: string } | null; apiClient: { clientId: string } | null }) => (req.actor ?? req.apiClient)!.clientId;

const ListQuery = z.object({
  projectId: z.string().uuid().optional(),
  workflow: z.string().max(200).optional(),
  /** Records after this sequence number (cursor). */
  after: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function toRecordDto(r: ApprovedTaskRecord) {
  return { ...r, seq: String(r.seq), nearestDuplicateScore: r.nearestDuplicateScore === null ? null : Number(r.nearestDuplicateScore), createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt.toISOString(), reviewDecisionAt: r.reviewDecisionAt.toISOString() };
}

async function findRecord(tx: Db | Tx, clientId: string, id: string) {
  const r = await tx.approvedTaskRecord.findFirst({ where: { id, clientId } });
  if (!r) throw notFound('Record not found');
  return r;
}

/** SPEC Approved Task Dataset: read-only listing, lineage and export; corrections append superseding records. */
export const datasetRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get('/dataset/records', { config: { access: READ }, schema: { tags: ['dataset'], querystring: ListQuery } }, async (req) => {
    const q = req.query;
    const rows = await db.approvedTaskRecord.findMany({
      where: { clientId: clientOf(req), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.workflow ? { workflow: q.workflow } : {}), ...(q.after !== undefined ? { seq: { gt: q.after } } : {}) },
      orderBy: { seq: 'asc' },
      take: q.limit,
    });
    return { items: rows.map(toRecordDto), next: rows.length === q.limit ? String(rows.at(-1)!.seq) : null };
  });

  app.get('/dataset/records/:id', { config: { access: READ }, schema: { tags: ['dataset'], params: IdParams } }, async (req) => toRecordDto(await findRecord(db, clientOf(req), req.params.id)));

  // From any record, the full lineage: input provider, worker, reviewer, project and template version.
  app.get('/dataset/records/:id/lineage', { config: { access: READ }, schema: { tags: ['dataset'], params: IdParams } }, async (req) => {
    const r = await findRecord(db, clientOf(req), req.params.id);
    const [project, template, reviewer, candidate, batch, uploader, apiClient, slot, jd, supersededBy] = await Promise.all([
      db.project.findUnique({ where: { id: r.projectId }, select: { id: true, name: true, taskMode: true } }),
      db.template.findUnique({ where: { id: r.templateId }, select: { id: true, version: true, workflowName: true, lineageId: true } }),
      db.user.findUnique({ where: { id: r.reviewerId }, select: { id: true, name: true } }),
      db.candidate.findUnique({ where: { id: r.candidateId }, select: { id: true, smeUserId: true } }),
      r.inputBatchId ? db.taskInputBatch.findUnique({ where: { id: r.inputBatchId } }) : null,
      r.uploadedById ? db.user.findUnique({ where: { id: r.uploadedById }, select: { id: true, name: true } }) : null,
      r.apiClientId ? db.apiClient.findUnique({ where: { id: r.apiClientId }, select: { id: true, name: true, kind: true } }) : null,
      r.slotId ? db.coverageSlot.findUnique({ where: { id: r.slotId }, select: { id: true, brief: true, isOpen: true } }) : null,
      r.jdSnapshotId ? db.jobDescriptionSnapshot.findUnique({ where: { id: r.jdSnapshotId }, select: { id: true, createdAt: true } }) : null,
      db.approvedTaskRecord.findMany({ where: { supersedesId: r.id }, select: { id: true, createdAt: true } }),
    ]);
    const prev = r.prevHash ? await db.approvedTaskRecord.findFirst({ where: { contentHash: r.prevHash }, select: { id: true, seq: true } }) : null;
    return {
      record: { id: r.id, seq: String(r.seq), schemaVersion: r.schemaVersion, createdAt: r.createdAt.toISOString(), contentHash: r.contentHash, prevHash: r.prevHash, previousRecordId: prev?.id ?? null, contentVerified: recordHash(recordContent(baseOf(r)), r.prevHash) === r.contentHash },
      task: { id: r.taskInstanceId, mode: r.taskMode, submittedAt: r.submittedAt.toISOString(), activeSeconds: r.activeSeconds },
      inputProvider:
        r.taskMode === 'AUTHORING'
          ? { kind: 'AUTHOR', candidateId: r.candidateId }
          : { kind: r.inputSource, batchId: r.inputBatchId, itemCount: batch?.itemCount ?? null, uploadedBy: uploader, apiClient },
      worker: { candidateId: r.candidateId, smeUserId: candidate?.smeUserId ?? null, identityRef: r.identityRef, projectAssignmentId: r.projectAssignmentId, qualificationSnapshot: r.qualificationSnapshot, authorTaskIndex: r.authorTaskIndex, workerTermsVersion: r.workerTermsVersion },
      reviewer: { id: r.reviewerId, name: reviewer?.name ?? null, decidedAt: r.reviewDecisionAt.toISOString(), notes: r.reviewNotes, reworkCount: r.reworkCount, duplicateDecision: r.duplicateDecision },
      diversity: { slot, coverageTags: r.coverageTags, isOpenSlot: r.isOpenSlot, nearestDuplicateId: r.nearestDuplicateId, nearestDuplicateScore: r.nearestDuplicateScore === null ? null : Number(r.nearestDuplicateScore) },
      project,
      template: template ? { ...template, version: r.templateVersion, domain: r.domain, workflow: r.workflow } : { id: r.templateId, version: r.templateVersion, domain: r.domain, workflow: r.workflow },
      jdSnapshot: jd,
      corrections: { supersedes: r.supersedesId, supersededBy: supersededBy.map((s) => s.id) },
    };
  });

  // Export: newline-delimited JSON in chain order; resume with ?after=<seq>.
  app.get('/dataset/export', { config: { access: READ }, schema: { tags: ['dataset'], querystring: ListQuery.extend({ limit: z.coerce.number().int().min(1).max(10_000).default(1000) }) } }, async (req, reply) => {
    const q = req.query;
    const rows = await db.approvedTaskRecord.findMany({
      where: { clientId: clientOf(req), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.workflow ? { workflow: q.workflow } : {}), ...(q.after !== undefined ? { seq: { gt: q.after } } : {}) },
      orderBy: { seq: 'asc' },
      take: q.limit,
    });
    return reply
      .header('content-type', 'application/x-ndjson')
      .header('x-next-after', rows.length === q.limit ? String(rows.at(-1)!.seq) : '')
      .send(rows.map((r) => JSON.stringify(toRecordDto(r))).join('\n') + (rows.length ? '\n' : ''));
  });

  // A correction never edits a record: it appends a new one that supersedes it, with the same lineage.
  app.post(
    '/dataset/records/:id/corrections',
    { config: { access: ['ADMIN'] }, schema: { tags: ['dataset'], params: IdParams, body: z.object({ reason: z.string().trim().min(1).max(2000), output: z.record(z.string(), z.unknown()).optional(), coverageTags: z.object({ tags: z.record(z.string(), z.string()), edgeCase: z.string().nullable() }).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const r = await findRecord(tx, actor.clientId, req.params.id);
        if (await tx.approvedTaskRecord.count({ where: { supersedesId: r.id } })) throw new AppError(409, 'ALREADY_SUPERSEDED', 'This record was already corrected; correct the latest version.');
        const base = baseOf(r);
        const next = await appendRecord(tx, {
          ...base,
          supersedesId: r.id,
          output: (req.body.output ?? r.output) as Prisma.JsonValue,
          coverageTags: (req.body.coverageTags ?? r.coverageTags) as Prisma.JsonValue,
          reviewerId: actor.userId,
          reviewDecisionAt: new Date(),
          reviewNotes: `Correction: ${req.body.reason}`,
        });
        await audit({ entityType: 'ApprovedTaskRecord', entityId: next.id, action: 'dataset.record_corrected', after: { supersedes: r.id, reason: req.body.reason } });
        return { status: 201, body: toRecordDto(next) };
      });
      return reply;
    },
  );

  // On-demand verification (the same check the nightly job runs).
  app.get('/dataset/verification', { config: { access: ['ADMIN'] }, schema: { tags: ['dataset'] } }, async () => {
    const report = await verifyApprovedChain(db);
    const lastRun = await db.auditEvent.findFirst({ where: { action: { in: ['dataset.chain_verified', 'dataset.chain_broken'] } }, orderBy: { createdAt: 'desc' } });
    return { ...report, ok: report.breaks.length === 0, lastNightly: lastRun ? { at: lastRun.createdAt.toISOString(), action: lastRun.action } : null };
  });
};
