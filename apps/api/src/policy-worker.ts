import { createServer } from 'node:http';
import { defaultStorage } from './app';
import { loadConfig } from './config';
import { createDb } from './db';
import { redisConnection } from './lib/redis';
import { createDomainEventsQueue, createDomainEventsWorker, startOutboxPoller } from './outbox/dispatcher';
import { HandlerRegistry } from './outbox/handlers';
import { POLICY_AI_ACTIONS } from './policy/ai-cap';
import { policyAnnotationHandler } from './policy/annotate-job';
import { defaultRuleEnricher, policyEnrichmentHandler } from './policy/enrich';
import { defaultAdapters, policyExtractionHandler } from './policy/extraction/service';
import { defaultRuleAssistant } from './policy/rule-assistant';
import { POLICY_EVENT_NAMES, POLICY_EVENTS_QUEUE } from './policy-worker-events';

/**
 * praxis-policy-worker (D-089, 26 Nov 2026): the Policy page's jobs only, for local use and for a deployment that runs
 * no full worker: AI Extract (policy.extraction_requested), the annotation pass that follows it
 * (policy.annotation_requested) and "Suggest library details (AI)" (policy.enrichment_requested), with the same
 * handlers and the same daily AI cap as the full worker.
 * - The poller takes only those events, onto its own queue, so no other event is dispatched or completed here.
 * - None of the full worker's maintenance runs: no bundle-deletion sweep, no dataset verification, no supply or pay jobs.
 * Start: `pnpm --filter @praxis/api worker:policy`. Stop: Ctrl-C (or SIGTERM).
 */
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const connection = redisConnection(config.REDIS_URL);
const queue = createDomainEventsQueue(connection, POLICY_EVENTS_QUEUE);
const storage = defaultStorage(config);
const registry = new HandlerRegistry()
  .register(policyExtractionHandler({ storage, adapters: defaultAdapters(config.policy) }))
  .register(policyAnnotationHandler({ storage, assistant: defaultRuleAssistant(config), dailyCap: config.POLICY_AI_DAILY_CALL_CAP, capActions: POLICY_AI_ACTIONS }))
  .register(policyEnrichmentHandler({ storage, enricher: defaultRuleEnricher(config), dailyCap: config.POLICY_AI_DAILY_CALL_CAP, capActions: POLICY_AI_ACTIONS }));
const log = (level: string, msg: string, extra: object = {}) => console.log(JSON.stringify({ level, severity: level.toUpperCase(), message: msg, msg, service: 'praxis-policy-worker', time: new Date().toISOString(), ...extra }));

const worker = createDomainEventsWorker(db, registry, connection, POLICY_EVENTS_QUEUE);
worker.on('completed', (job) => log('info', 'event done', { eventId: job.data.eventId, event: job.name }));
worker.on('failed', (job, err) => log('warn', 'policy event handler failed', { eventId: job?.data.eventId, event: job?.name, err: String(err) }));
const stopPoller = startOutboxPoller(db, queue, { names: POLICY_EVENT_NAMES, onError: (err) => log('error', 'outbox dispatch failed', { err: String(err) }) });
const health = process.env.WORKER_HEALTH_PORT ? createServer((req, res) => res.writeHead(req.url === '/healthz' ? 200 : 404, { 'content-type': 'application/json' }).end('{"status":"ok"}')).listen(Number(process.env.WORKER_HEALTH_PORT)) : null;
log('info', 'policy worker started', { events: POLICY_EVENT_NAMES, queue: POLICY_EVENTS_QUEUE, assistant: config.assistantMode });

async function shutdown() {
  stopPoller();
  await worker.close();
  health?.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
