import { createServer } from 'node:http';
import { defaultCurriculum, defaultPayouts, defaultDrafter, defaultEmail, defaultEmbeddings, defaultEvaluator, defaultStorage } from './app';
import { sweepCertifications } from './cert/attempts';
import { refillBuffers } from './cert/items';
import { sectionsOf } from './cert/pipeline';
import { buildStatements, monthOf } from './pay/ledger';
import { buildPayRun, previousWeek, reconcile } from './pay/payruns';
import { defaultRlGym } from './rl/rl-gym';
import { loadConfig } from './config';
import { createDb } from './db';
import { redisConnection } from './lib/redis';
import { createDomainEventsQueue, createDomainEventsWorker, startOutboxPoller } from './outbox/dispatcher';
import { defaultHandlers } from './outbox/handlers';
import { defaultAdapters, policyExtractionHandler } from './policy/extraction/service';
import { resolveDeps } from './meta-compiler/deps';
import { defaultDrafterFactory } from './meta-compiler/drafter';
import { defaultJudge } from './meta-compiler/judge';
import { metaCompilerHandlers } from './meta-compiler/handlers';
import { BUNDLE_SWEEP_JOB, defaultBundleObjectStore, sweepBundles } from './meta-compiler/bundle-sweep';
import { defaultRunner } from './harbor/runner';
import { createMaintenanceWorker, scheduleMaintenance, scheduleRecurring } from './outbox/maintenance';
import { secretBox } from './lib/secrets';
import { processPartnerWebhooks } from './supply/webhooks';
import { remindAndExpireInvites } from './supply/submissions';

/** praxis-worker: publishes the outbox and runs domain-event handlers. */
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const connection = redisConnection(config.REDIS_URL);
const queue = createDomainEventsQueue(connection);
const cert = { gen: defaultCurriculum(config), box: secretBox(config), embeddings: defaultEmbeddings(config) };
const registry = defaultHandlers({ evaluator: defaultEvaluator(config), email: defaultEmail(config), config, rlGym: defaultRlGym(config), drafter: defaultDrafter(config), storage: defaultStorage(config), smeSupply: config.SME_SUPPLY_ENABLED, cert });
// Templates Meta-Compiler: generation, verification, per-task verification and judge jobs.
const storage = defaultStorage(config);
registry.register(policyExtractionHandler({ storage, adapters: defaultAdapters(config.policy) }));
for (const h of metaCompilerHandlers({ config, storage, drafters: defaultDrafterFactory(config), deps: resolveDeps(), runner: defaultRunner(config, storage), judge: defaultJudge(config) })) registry.register(h);
const worker = createDomainEventsWorker(db, registry, connection);
const log = (level: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ level, severity: level.toUpperCase(), message: msg, msg, service: 'praxis-worker', time: new Date().toISOString(), ...extra }));

worker.on('failed', (job, err) => log('warn', 'domain event handler failed', { jobId: job?.id, err: String(err) }));
// In GCP the nightly verification runs as a Cloud Run job from Cloud Scheduler (DATASET_VERIFY_CRON=off).
const maintenanceQueue = config.DATASET_VERIFY_CRON === 'off' ? null : await scheduleMaintenance(connection, config.DATASET_VERIFY_CRON);
// M10 SME supply jobs, only with the feature flag on: partner webhook delivery and invite reminders/expiry.
const supplyJobs: Record<string, () => Promise<unknown>> = config.SME_SUPPLY_ENABLED
  ? { 'partner-webhooks': () => processPartnerWebhooks(db, secretBox(config)), 'partner-invites': () => remindAndExpireInvites(db, defaultEmail(config), config.CANDIDATE_APP_URL),
      // M10b: keep each published blueprint's buffer of ready test forms full; expire certificates and stale attempts.
      'cert-forms': () => refillBuffers({ ...cert, db }, (v) => sectionsOf(db, v)),
      'cert-sweep': () => sweepCertifications(db, cert),
      // M10c: Monday pay-run drafts for the previous week, daily reconciliation of yesterday, monthly partner statements.
      'pay-run-build': async () => {
        if (new Date().getUTCDay() !== 1) return 0;
        const week = previousWeek();
        let made = 0;
        for (const c of await db.client.findMany({ select: { id: true } })) {
          if (await db.payRun.findUnique({ where: { clientId_periodStart: { clientId: c.id, periodStart: week.periodStart } } })) continue;
          await db.$transaction((tx) => buildPayRun(tx, c.id, week, { type: 'SYSTEM', id: 'pay-run-schedule' }));
          made++;
        }
        return made;
      },
      'payout-reconcile': () => reconcile(db, defaultPayouts(config), new Date(Date.now() - 86_400_000)),
      'partner-statements': async () => {
        const period = monthOf(new Date(Date.now() - new Date().getUTCDate() * 86_400_000));
        for (const c of await db.client.findMany({ select: { id: true } })) await buildStatements(db, c.id, period, { type: 'SYSTEM', id: 'statement-schedule' });
      },
    }
  : {};
const supplyQueue = config.SME_SUPPLY_ENABLED ? await scheduleRecurring(connection, [{ name: 'partner-webhooks', everyMs: 30_000 }, { name: 'partner-invites', everyMs: 3_600_000 }, { name: 'cert-forms', everyMs: 300_000 }, { name: 'cert-sweep', everyMs: 600_000 }, { name: 'pay-run-build', everyMs: 3_600_000 }, { name: 'payout-reconcile', everyMs: 86_400_000 }, { name: 'partner-statements', everyMs: 86_400_000 }]) : null;
// Meta-Compiler: daily sweep of unreferenced bundle objects older than 24 hours (D-22).
const sweepQueue = await scheduleRecurring(connection, [{ name: BUNDLE_SWEEP_JOB, everyMs: 86_400_000 }]);
async function sweepJob() {
  const r = await sweepBundles(db, defaultBundleObjectStore(config));
  log('info', 'bundle sweep', { scanned: r.scanned, deleted: r.deleted.length });
}
const maintenance = createMaintenanceWorker(db, connection, log, undefined, { ...supplyJobs, [BUNDLE_SWEEP_JOB]: sweepJob });
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
  await supplyQueue?.close();
  await sweepQueue.close();
  clearInterval(depthTimer);
  health?.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
