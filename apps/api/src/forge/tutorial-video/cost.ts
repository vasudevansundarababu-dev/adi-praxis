import { Prisma } from '@prisma/client';
import type { TutorialConfig } from '../../config';
import type { Db, Tx } from '../../db';
import { CLIP_SECONDS, CLIPS_PER_CHAPTER } from './stitch';

/** One retry per clip is allowed, so the reservation covers every clip twice. */
const CLIP_ATTEMPTS = 2;

export const clipCost = (cfg: TutorialConfig) => CLIP_SECONDS * cfg.veoPricePerSecond;
/** Script and narration allowance per chapter, split evenly between the two calls. */
export const textCost = (cfg: TutorialConfig) => cfg.textPricePerChapter / 2;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** What a video should cost, and the worst case reserved before it starts (D2 plan section 5). */
export function estimateUsd(cfg: TutorialConfig, chapters: number): { expected: number; worstCase: number } {
  const clips = CLIPS_PER_CHAPTER * clipCost(cfg);
  return { expected: round4(chapters * (clips + cfg.textPricePerChapter)), worstCase: round4(chapters * (clips * CLIP_ATTEMPTS + cfg.textPricePerChapter)) };
}

/** Serialises every cap decision in the environment (request and per call). */
export async function lockSpend(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tutorial-video-spend'))`;
}

const startOfUtcDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Today's (UTC) committed spend for the whole environment: a run that is still open counts its reservation (or its
 * actual cost, if higher); a finished run counts what it actually cost.
 */
export async function spentTodayUsd(tx: Db | Tx, now = new Date()): Promise<number> {
  const rows = await tx.$queryRaw<{ total: Prisma.Decimal | null }[]>`
    SELECT COALESCE(SUM(CASE WHEN released THEN actual ELSE GREATEST(reserved, actual) END), 0) AS total FROM (
      SELECT run_id,
             COALESCE(SUM(amount_usd) FILTER (WHERE kind = 'reserve'), 0) AS reserved,
             COALESCE(SUM(amount_usd) FILTER (WHERE kind = 'actual'), 0) AS actual,
             BOOL_OR(kind = 'release') AS released
      FROM "TutorialSpend"
      WHERE run_id IN (SELECT run_id FROM "TutorialSpend" WHERE kind = 'reserve' AND created_at >= ${startOfUtcDay(now)})
      GROUP BY run_id
    ) runs`;
  return Number(rows[0]?.total ?? 0);
}

/** Why a new run of this size can't start, or null. Caps that are not set are not enforced (mock pipeline only). */
export function capProblem(cfg: TutorialConfig, worstCase: number, spentToday: number): string | null {
  if (cfg.costCapUsd !== null && worstCase > cfg.costCapUsd) return `The worst-case cost of $${worstCase.toFixed(2)} is above the per-video cap of $${cfg.costCapUsd.toFixed(2)}.`;
  if (cfg.dailyCapUsd !== null && spentToday + worstCase > cfg.dailyCapUsd) return `Today's tutorial budget of $${cfg.dailyCapUsd.toFixed(2)} would be exceeded ($${spentToday.toFixed(2)} already committed today).`;
  return null;
}

export async function recordSpend(tx: Db | Tx, run: { id: string; clientId: string }, kind: 'reserve' | 'actual' | 'release', provider: string, amountUsd: number) {
  await tx.tutorialSpend.create({ data: { clientId: run.clientId, runId: run.id, kind, provider, amountUsd: new Prisma.Decimal(round4(amountUsd)) } });
}
