import type { Config } from '../config';
import type { Db, Tx } from '../db';

/** Audit action recorded for every field proposal; its cost counts toward the client's daily budget. */
export const FIELD_PROPOSED = 'meta_compiler.field_proposed';

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** What the client has spent on Meta-Compiler model calls today (UTC): generation runs plus field proposals. */
export async function spentTodayUsd(tx: Db | Tx, clientId: string, now = new Date()): Promise<number> {
  const since = startOfUtcDay(now);
  const [runs, proposals] = await Promise.all([
    tx.compilerGenerationRun.aggregate({ where: { clientId, createdAt: { gte: since } }, _sum: { actualCostUsd: true } }),
    tx.$queryRaw<{ total: string | null }[]>`
      SELECT SUM((after->>'costUsd')::numeric)::text AS total FROM "AuditEvent"
      WHERE client_id = ${clientId}::uuid AND action = ${FIELD_PROPOSED} AND created_at >= ${since}`,
  ]);
  return Number(runs._sum.actualCostUsd ?? 0) + Number(proposals[0]?.total ?? 0);
}

/**
 * NFR-09, D5a, D6b: before a paid call the estimate must fit the per-run cap and what is left of the client's daily
 * budget. Returns the reason to stop, or null. Free calls (the mock) always pass.
 */
export function budgetProblem(cfg: Config['metaCompiler'], estimatedUsd: number, spentUsd: number): string | null {
  if (estimatedUsd <= 0) return null;
  if (cfg.costCapUsd === null || cfg.dailyBudgetUsd === null) return 'Paid generation is off: no cost cap is configured.';
  if (estimatedUsd > cfg.costCapUsd) return `Estimated cost $${estimatedUsd.toFixed(4)} is above the per-run cap of $${cfg.costCapUsd.toFixed(2)}.`;
  if (spentUsd + estimatedUsd > cfg.dailyBudgetUsd) return `The daily generation budget of $${cfg.dailyBudgetUsd.toFixed(2)} would be exceeded ($${spentUsd.toFixed(4)} already spent today).`;
  return null;
}

/** After a call: the actual cost must also fit the per-run cap, otherwise the run ends CAPPED and nothing is applied. */
export function actualOverCap(cfg: Config['metaCompiler'], actualUsd: number): string | null {
  if (actualUsd <= 0 || cfg.costCapUsd === null) return null;
  return actualUsd > cfg.costCapUsd ? `Actual cost $${actualUsd.toFixed(4)} exceeded the per-run cap of $${cfg.costCapUsd.toFixed(2)}; nothing was applied.` : null;
}
