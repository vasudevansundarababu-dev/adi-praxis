import { Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAILURE_REASON_CODES, seed } from '../prisma/seed';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import { db, resetDb } from './helpers';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

describe('M0 infra: docker-compose services, migrations and seed', () => {
  beforeAll(resetDb);
  afterAll(() => db.$disconnect());

  it('docker compose reports Postgres, Redis, Mailpit and the GCS emulator running and healthy', () => {
    const out = execFileSync('docker', ['compose', 'ps', '--format', 'json'], { cwd: repoRoot }).toString();
    const services = out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { Service: string; State: string; Health: string });
    for (const name of ['postgres', 'redis', 'mailpit', 'gcs']) {
      const svc = services.find((s) => s.Service === name);
      expect(svc, `${name} is running`).toBeDefined();
      expect(svc!.State).toBe('running');
      expect(svc!.Health).toBe('healthy');
    }
  });

  it('Redis answers PING', async () => {
    const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true });
    await redis.connect();
    expect(await redis.ping()).toBe('PONG');
    redis.disconnect();
  });

  it('Mailpit and the GCS emulator answer over HTTP', async () => {
    const mailpit = await fetch(`http://localhost:${process.env.PRAXIS_MAILPIT_UI_PORT ?? 8035}/readyz`);
    expect(mailpit.status).toBe(200);
    const gcs = await fetch(`http://localhost:${process.env.PRAXIS_GCS_PORT ?? 4443}/storage/v1/b`);
    expect(gcs.status).toBe(200);
  });

  it('all migrations are applied with none pending', () => {
    const out = execFileSync('npx', ['prisma', 'migrate', 'status'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    }).toString();
    expect(out).toContain('Database schema is up to date');
  });

  it('the pgvector extension is installed', async () => {
    const rows = await db.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('every Prisma model has a table, and every table carries client_id', async () => {
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = new Set(tables.map((t) => t.table_name));
    for (const model of Object.values(Prisma.ModelName)) {
      expect(names.has(model), `table for ${model}`).toBe(true);
    }

    // Tenancy: every business table has client_id. Pure join/receipt tables are exempt.
    const exempt = new Set(['_prisma_migrations', 'EventHandlerReceipt', '_CredentialClaimToEvidenceArtifact']);
    const withClient = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'client_id'`;
    const hasClient = new Set(withClient.map((c) => c.table_name));
    const missing = [...names].filter((t) => !exempt.has(t) && t !== 'Client' && !hasClient.has(t));
    expect(missing).toEqual([]);
  });

  it('the seed creates the client, first Admin and failure reason codes, and is safe to re-run', async () => {
    const env = { SEED_CLIENT_NAME: 'Seed Test', SEED_ADMIN_EMAIL: 'Admin@Seed.Test', SEED_ADMIN_PASSWORD: 'seed-password-123' };
    const first = await seed(db, env);
    const second = await seed(db, env);

    expect(second.client.id).toBe(first.client.id);
    expect(second.admin.id).toBe(first.admin.id);
    expect(first.admin.email).toBe('admin@seed.test');
    expect(first.admin.roles).toEqual(['ADMIN']);
    expect(await db.client.count({ where: { name: 'Seed Test' } })).toBe(1);
    expect(await db.user.count({ where: { email: 'admin@seed.test' } })).toBe(1);
    expect(await db.failureReasonCode.count({ where: { clientId: first.client.id } })).toBe(FAILURE_REASON_CODES.length);
  });

  it('the seed refuses to run without admin credentials', async () => {
    await expect(seed(db, { SEED_ADMIN_EMAIL: '', SEED_ADMIN_PASSWORD: '' })).rejects.toThrow(/SEED_ADMIN_EMAIL/);
  });
});
