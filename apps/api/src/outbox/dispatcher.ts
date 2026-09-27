import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Db } from '../db';
import type { HandlerRegistry } from './handlers';

export const DOMAIN_EVENTS_QUEUE = 'domain-events';

export interface DomainEventJob {
  eventId: string;
}

export const JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};

/**
 * Moves undispatched outbox rows onto the queue. Rows are locked with SKIP LOCKED so several dispatchers can run;
 * the BullMQ job id is the event id, so a re-dispatch after a crash never creates a second job.
 */
export async function dispatchOutboxBatch(db: Db, queue: Queue<DomainEventJob>, batchSize = 100): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM "OutboxEvent"
      WHERE dispatched_at IS NULL AND available_at <= now()
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return 0;

    await queue.addBulk(
      rows.map((r) => ({ name: r.name, data: { eventId: r.id }, opts: { ...JOB_OPTIONS, jobId: r.id } })),
    );
    await tx.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { dispatchedAt: new Date() },
    });
    return rows.length;
  });
}

/**
 * Runs every handler registered for the event. Each handler's work and its receipt commit together, so a handler
 * that already succeeded is skipped on retry and a failing handler is retried by BullMQ with backoff.
 */
export async function processDomainEvent(db: Db, registry: HandlerRegistry, eventId: string) {
  const event = await db.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error(`Outbox event ${eventId} not found`);

  for (const handler of registry.for(event.name)) {
    try {
      if (handler.run) {
        const done = await db.eventHandlerReceipt.findUnique({ where: { eventId_handler: { eventId, handler: handler.name } } });
        if (done) continue;
        await handler.run(event, db);
        await db.eventHandlerReceipt.createMany({ data: [{ eventId, handler: handler.name }], skipDuplicates: true });
        continue;
      }
      await db.$transaction(async (tx) => {
        const done = await tx.eventHandlerReceipt.findUnique({
          where: { eventId_handler: { eventId, handler: handler.name } },
        });
        if (done) return;
        await handler.handle!(event, tx);
        await tx.eventHandlerReceipt.create({ data: { eventId, handler: handler.name } });
      });
    } catch (err) {
      await db.outboxEvent.update({
        where: { id: eventId },
        data: { attempts: { increment: 1 }, lastError: `${handler.name}: ${String(err).slice(0, 1000)}` },
      });
      throw err;
    }
  }
}

export function createDomainEventsQueue(connection: ConnectionOptions, name = DOMAIN_EVENTS_QUEUE) {
  return new Queue<DomainEventJob>(name, { connection });
}

export function createDomainEventsWorker(
  db: Db,
  registry: HandlerRegistry,
  connection: ConnectionOptions,
  name = DOMAIN_EVENTS_QUEUE,
) {
  return new Worker<DomainEventJob>(
    name,
    async (job: Job<DomainEventJob>) => processDomainEvent(db, registry, job.data.eventId),
    { connection, concurrency: 10 },
  );
}

/** Polls the outbox until stopped. Returns a stop function. */
export function startOutboxPoller(
  db: Db,
  queue: Queue<DomainEventJob>,
  opts: { intervalMs?: number; onError?: (err: unknown) => void } = {},
) {
  const interval = opts.intervalMs ?? 500;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      // Drain in batches, then wait for the next tick.
      while (!stopped && (await dispatchOutboxBatch(db, queue)) > 0);
    } catch (err) {
      opts.onError?.(err);
    }
    if (!stopped) timer = setTimeout(tick, interval);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
