import type { OutboxEvent } from '@prisma/client';
import type { Queue, Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { redisConnection } from '../src/lib/redis';
import {
  createDomainEventsQueue,
  createDomainEventsWorker,
  dispatchOutboxBatch,
  processDomainEvent,
  type DomainEventJob,
} from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { TEST_REDIS_URL } from './env';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';

const connection = redisConnection(TEST_REDIS_URL);

// Generous: a loaded machine can delay BullMQ's blocking pick-up by several seconds.
async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Transactional outbox and worker', () => {
  let app: FastifyInstance;
  let cookie: string;
  let queue: Queue<DomainEventJob>;
  let worker: Worker<DomainEventJob> | undefined;
  let queueName: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    const { id: clientId } = await createClient();
    cookie = await login(app, (await createUser(clientId, ['ADMIN'])).email);
    // A fresh queue per test keeps jobs isolated.
    queueName = `test-events-${randomUUID()}`;
    queue = createDomainEventsQueue(connection, queueName);
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true });
    await queue.close();
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const createUserViaApi = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie, ...idem() },
      payload: { email: `${randomUUID()}@test.local`, name: 'New', roles: ['PM'], password: 'long-enough-password' },
    });

  it('a command writes its outbox event in the same transaction as the state change', async () => {
    const res = await createUserViaApi();
    expect(res.statusCode).toBe(201);
    const events = await db.outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'user.created',
      aggregateType: 'User',
      aggregateId: res.json().id,
      dispatchedAt: null,
    });
  });

  it('the dispatcher publishes each event once, even if dispatch runs again after a crash', async () => {
    await createUserViaApi();
    await createUserViaApi();

    // On failure, show exactly which outbox rows existed (diagnoses interference from other processes).
    const rows = async () => JSON.stringify(await db.outboxEvent.findMany({ select: { name: true, dispatchedAt: true, createdAt: true } }));
    expect(await dispatchOutboxBatch(db, queue), await rows()).toBe(2);
    expect(await dispatchOutboxBatch(db, queue), await rows()).toBe(0);
    expect(await db.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(0);

    // Simulate a crash after publishing but before the dispatched mark committed.
    await db.outboxEvent.updateMany({ data: { dispatchedAt: null } });
    expect(await dispatchOutboxBatch(db, queue), await rows()).toBe(2);
    expect(await queue.count(), JSON.stringify(await queue.getJobCounts())).toBe(2); // job id = event id, so no duplicate jobs
  });

  it('concurrent dispatchers never publish the same event twice', async () => {
    for (let i = 0; i < 5; i++) await createUserViaApi();
    const counts = await Promise.all([dispatchOutboxBatch(db, queue, 3), dispatchOutboxBatch(db, queue, 3)]);
    const again = await dispatchOutboxBatch(db, queue, 10);
    expect(counts[0]! + counts[1]! + again).toBe(5);
    expect(await queue.count()).toBe(5);
  });

  it('the worker delivers each event to its handler exactly once', async () => {
    const seen: string[] = [];
    const registry = new HandlerRegistry().register({
      name: 'test.record',
      event: 'user.created',
      handle: async (e: OutboxEvent) => {
        seen.push(e.id);
      },
    });
    worker = createDomainEventsWorker(db, registry, connection, queueName);

    await createUserViaApi();
    const [event] = await db.outboxEvent.findMany();
    await dispatchOutboxBatch(db, queue);
    await waitFor(async () => (await db.eventHandlerReceipt.count()) === 1);

    // Re-processing the same event (at-least-once redelivery) does not call the handler again.
    await processDomainEvent(db, registry, event!.id);
    expect(seen).toEqual([event!.id]);
  });

  it('a failing handler is retried until it succeeds; handlers that already succeeded are not re-run', async () => {
    let flakyCalls = 0;
    let steadyCalls = 0;
    const registry = new HandlerRegistry()
      .register({
        name: 'test.steady',
        event: 'user.created',
        handle: async () => {
          steadyCalls += 1;
        },
      })
      .register({
        name: 'test.flaky',
        event: 'user.created',
        handle: async () => {
          flakyCalls += 1;
          if (flakyCalls < 3) throw new Error(`transient failure ${flakyCalls}`);
        },
      });

    await createUserViaApi();
    const [event] = await db.outboxEvent.findMany();
    // Short backoff so the test runs quickly; production uses JOB_OPTIONS.
    await queue.add('user.created', { eventId: event!.id }, { jobId: event!.id, attempts: 5, backoff: { type: 'fixed', delay: 50 } });
    worker = createDomainEventsWorker(db, registry, connection, queueName);

    await waitFor(async () => (await db.eventHandlerReceipt.count()) === 2);
    expect(flakyCalls).toBe(3);
    expect(steadyCalls).toBe(1);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id: event!.id } });
    expect(row.attempts).toBe(2);
    expect(row.lastError).toContain('transient failure 2');
  });

  it('a handler failure rolls back that handler’s own writes', async () => {
    const registry = new HandlerRegistry().register({
      name: 'test.partial',
      event: 'user.created',
      handle: async (e, tx) => {
        await tx.user.update({ where: { id: e.aggregateId }, data: { name: 'half-done' } });
        throw new Error('fails after writing');
      },
    });
    const res = await createUserViaApi();
    const [event] = await db.outboxEvent.findMany();
    await expect(processDomainEvent(db, registry, event!.id)).rejects.toThrow('fails after writing');
    expect((await db.user.findUniqueOrThrow({ where: { id: res.json().id } })).name).toBe('New');
    expect(await db.eventHandlerReceipt.count()).toBe(0);
  });

  it('registering two handlers with the same name for one event is an error', () => {
    const h = { name: 'dup', event: 'user.created' as const, handle: async () => {} };
    expect(() => new HandlerRegistry().register(h).register(h)).toThrow(/Duplicate handler/);
  });
});
