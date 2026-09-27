import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

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
