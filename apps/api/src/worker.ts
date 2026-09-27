import { defaultEmail, defaultEvaluator } from './app';
import { loadConfig } from './config';
import { createDb } from './db';
import { redisConnection } from './lib/redis';
import { createDomainEventsQueue, createDomainEventsWorker, startOutboxPoller } from './outbox/dispatcher';
import { defaultHandlers } from './outbox/handlers';

/** praxis-worker: publishes the outbox and runs domain-event handlers. */
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const connection = redisConnection(config.REDIS_URL);
const queue = createDomainEventsQueue(connection);
const worker = createDomainEventsWorker(db, defaultHandlers({ evaluator: defaultEvaluator(config), email: defaultEmail(config), config }), connection);
const log = (level: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ level, msg, service: 'praxis-worker', time: new Date().toISOString(), ...extra }));

worker.on('failed', (job, err) => log('warn', 'domain event handler failed', { jobId: job?.id, err: String(err) }));
const stopPoller = startOutboxPoller(db, queue, { onError: (err) => log('error', 'outbox dispatch failed', { err: String(err) }) });
log('info', 'worker started');

async function shutdown() {
  stopPoller();
  await worker.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
