import { createServer } from 'node:http';
import { defaultDrafter, defaultEmail, defaultEvaluator, defaultStorage } from './app';
import { defaultRlGym } from './rl/rl-gym';
import { loadConfig } from './config';
import { createDb } from './db';
import { redisConnection } from './lib/redis';
import { createDomainEventsQueue, createDomainEventsWorker, startOutboxPoller } from './outbox/dispatcher';
import { defaultHandlers } from './outbox/handlers';
import { createMaintenanceWorker, scheduleMaintenance } from './outbox/maintenance';

/** praxis-worker: publishes the outbox and runs domain-event handlers. */
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const connection = redisConnection(config.REDIS_URL);
const queue = createDomainEventsQueue(connection);
const worker = createDomainEventsWorker(db, defaultHandlers({ evaluator: defaultEvaluator(config), email: defaultEmail(config), config, rlGym: defaultRlGym(config), drafter: defaultDrafter(config), storage: defaultStorage(config) }), connection);
const log = (level: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ level, severity: level.toUpperCase(), message: msg, msg, service: 'praxis-worker', time: new Date().toISOString(), ...extra }));

worker.on('failed', (job, err) => log('warn', 'domain event handler failed', { jobId: job?.id, err: String(err) }));
// In GCP the nightly verification runs as a Cloud Run job from Cloud Scheduler (DATASET_VERIFY_CRON=off).
const maintenanceQueue = config.DATASET_VERIFY_CRON === 'off' ? null : await scheduleMaintenance(connection, config.DATASET_VERIFY_CRON);
const maintenance = createMaintenanceWorker(db, connection, log);
maintenance.on('failed', (job, err) => log('error', 'maintenance job failed', { job: job?.name, err: String(err), alert: true }));
// Queue depth every minute: the backlog alert (M8) is a log-based metric on these entries.
const depthTimer = setInterval(async () => {
  const [counts, backlog] = await Promise.all([queue.getJobCounts('waiting', 'delayed', 'failed', 'active'), db.outboxEvent.count({ where: { dispatchedAt: null } }).catch(() => -1)]);
  log('info', 'queue depth', { metric: 'queue_depth', ...counts, outboxBacklog: backlog });
}, 60_000);
const stopPoller = startOutboxPoller(db, queue, { onError: (err) => log('error', 'outbox dispatch failed', { err: String(err) }) });
// Cloud Run services must answer HTTP: a health endpoint on WORKER_HEALTH_PORT (not exposed outside the VPC).
const health = process.env.WORKER_HEALTH_PORT
  ? createServer((req, res) => res.writeHead(req.url === '/healthz' ? 200 : 404, { 'content-type': 'application/json' }).end('{"status":"ok"}')).listen(Number(process.env.WORKER_HEALTH_PORT))
  : null;
log('info', 'worker started');

async function shutdown() {
  stopPoller();
  await worker.close();
  await maintenance.close();
  await maintenanceQueue?.close();
  clearInterval(depthTimer);
  health?.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
