import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { redisConnection } from '../src/lib/redis';
import { createMaintenanceWorker, scheduleMaintenance, VERIFY_CHAINS } from '../src/outbox/maintenance';
import { TEST_REDIS_URL } from './env';
import { createClient, db, resetDb } from './helpers';

describe('M6 nightly dataset verification job', () => {
  beforeEach(resetDb);
  afterAll(() => db.$disconnect());

  it('is scheduled nightly and, when run by the worker, records the verification in the audit log', async () => {
    await createClient();
    const connection = redisConnection(TEST_REDIS_URL);
    const name = `test-maintenance-${randomUUID()}`;
    const queue = await scheduleMaintenance(connection, '0 3 * * *', name);
    const logs: string[] = [];
    const worker = createMaintenanceWorker(db, connection, (level, msg) => logs.push(`${level}:${msg}`), name);
    try {
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toEqual([expect.objectContaining({ key: VERIFY_CHAINS, pattern: '0 3 * * *', tz: 'UTC' })]);
      // Scheduling twice keeps one scheduler.
      await scheduleMaintenance(connection, '0 3 * * *', name).then((q) => q.close());
      expect(await queue.getJobSchedulersCount()).toBe(1);
      await queue.add(VERIFY_CHAINS, {});
      for (let i = 0; i < 100 && !(await db.auditEvent.count({ where: { action: 'dataset.chain_verified' } })); i++) await new Promise((r) => setTimeout(r, 100));
      expect(await db.auditEvent.count({ where: { action: 'dataset.chain_verified', actorType: 'SYSTEM' } })).toBe(1);
      expect(logs).toContain('info:dataset hash chain verified');
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 30_000);
});
