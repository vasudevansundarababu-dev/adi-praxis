import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

// Local dev: make sure the evidence bucket exists in the Cloud Storage emulator.
if (config.GCS_EMULATOR_HOST) {
  const { GcsStorage } = await import('./candidate/storage');
  await new GcsStorage(config.EVIDENCE_BUCKET, { apiEndpoint: config.GCS_EMULATOR_HOST, projectId: config.GCS_PROJECT_ID }).ensureBucket().catch((err) => console.warn('Could not create the evidence bucket in the emulator:', String(err)));
}

const app = await buildApp({
  config,
  db,
  logger: true,
  pingRedis: async () => (await redis.ping()) === 'PONG',
});

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });

async function shutdown() {
  await app.close();
  await db.$disconnect();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
