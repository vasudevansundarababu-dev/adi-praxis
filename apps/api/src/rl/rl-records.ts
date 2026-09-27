import type { Prisma, RLReviewRecord } from '@prisma/client';
import type { Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';

export const RL_RECORD_SCHEMA_VERSION = 1;
const RL_CHAIN_LOCK = 7_310_002;

type RlBase = Omit<RLReviewRecord, 'id' | 'seq' | 'createdAt' | 'contentHash' | 'prevHash'>;

export function rlRecordContent(r: RlBase) {
  return { ...r, reviewStartedAt: r.reviewStartedAt?.toISOString() ?? null, reviewSubmittedAt: r.reviewSubmittedAt.toISOString() };
}
export const rlRecordHash = (content: unknown, prevHash: string | null) => sha256(stableStringify({ content, prevHash }));
export function rlBaseOf(r: RLReviewRecord): RlBase {
  const { id: _i, seq: _s, createdAt: _c, contentHash: _h, prevHash: _p, ...rest } = r;
  return rest;
}

/** Appends a verdict to the append-only RL review chain (same rules as the Approved Task Dataset). */
export async function appendRlRecord(tx: Tx, base: RlBase) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RL_CHAIN_LOCK})`;
  const prev = await tx.rLReviewRecord.findFirst({ orderBy: { seq: 'desc' }, select: { contentHash: true } });
  const prevHash = prev?.contentHash ?? null;
  const contentHash = rlRecordHash(rlRecordContent(base), prevHash);
  return tx.rLReviewRecord.create({ data: { ...base, metricVerdicts: base.metricVerdicts as Prisma.InputJsonValue, comments: base.comments as Prisma.InputJsonValue, prevHash, contentHash } });
}

export function rlResultPayload(r: RLReviewRecord) {
  return {
    id: r.id,
    seq: String(r.seq),
    rl_run_id: r.rlRunId,
    rl_task_id: r.rlTaskId,
    source_record_ids: r.sourceRecordIds,
    verdict: r.verdict,
    metric_verdicts: r.metricVerdicts,
    comments: r.comments,
    reason_codes: r.reasonCodes,
    rubric_id: r.rubricId,
    reviewer_id: r.reviewerId,
    review_started_at: r.reviewStartedAt?.toISOString() ?? null,
    review_submitted_at: r.reviewSubmittedAt.toISOString(),
    supersedes_id: r.supersedesId,
    content_hash: r.contentHash,
    prev_hash: r.prevHash,
  };
}
