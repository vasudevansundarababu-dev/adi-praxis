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

export function createMaintenanceWorker(db: Db, connection: ConnectionOptions, log: (level: string, msg: string, extra?: object) => void, name = MAINTENANCE_QUEUE) {
  return new Worker(
    name,
    async (job) => {
      if (job.name === VERIFY_CHAINS) await runChainVerification(db, log);
    },
    { connection, concurrency: 1 },
  );
}
