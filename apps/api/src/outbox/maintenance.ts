import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Db } from '../db';
import { runChainVerification } from '../dataset/verify';

export const MAINTENANCE_QUEUE = 'praxis-maintenance';
export const VERIFY_CHAINS = 'verify-chains';

/** Registers the nightly jobs (idempotent: the scheduler id is fixed). */
export async function scheduleMaintenance(connection: ConnectionOptions, cron: string, name = MAINTENANCE_QUEUE) {
  const queue = new Queue(name, { connection });
  await queue.upsertJobScheduler(VERIFY_CHAINS, { pattern: cron, tz: 'UTC' }, { name: VERIFY_CHAINS });
  return queue;
}

/** Extra recurring jobs (M10 SME supply registers its own when enabled): name → every N milliseconds. */
export async function scheduleRecurring(connection: ConnectionOptions, jobs: { name: string; everyMs: number }[], name = MAINTENANCE_QUEUE) {
  const queue = new Queue(name, { connection });
  for (const j of jobs) await queue.upsertJobScheduler(j.name, { every: j.everyMs }, { name: j.name });
  return queue;
}

export function createMaintenanceWorker(db: Db, connection: ConnectionOptions, log: (level: string, msg: string, extra?: object) => void, name = MAINTENANCE_QUEUE, extra: Record<string, () => Promise<unknown>> = {}) {
  return new Worker(
    name,
    async (job) => {
      if (job.name === VERIFY_CHAINS) await runChainVerification(db, log);
      else if (extra[job.name]) await extra[job.name]!();
    },
    { connection, concurrency: 1 },
  );
}
