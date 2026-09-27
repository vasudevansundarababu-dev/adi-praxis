import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { APPEND_ONLY_TABLES, grantAppRole } from '../src/jobs/grant-app-role';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import { db } from './helpers';

const ROLE = 'praxis_app_m8test';
const PASSWORD = 'app-role-test-password';

describe('M8 runtime database role (SPEC Security)', () => {
  let app: PrismaClient | undefined;
  afterAll(async () => {
    await app?.$disconnect();
    await db.$disconnect();
  });

  it('the app’s database user cannot update or delete append-only rows, but can do its normal work', async () => {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN NOSUPERUSER PASSWORD '${PASSWORD}'; END IF; END $$`);
    await grantAppRole(db, ROLE);
    const url = new URL(TEST_DATABASE_URL);
    url.username = ROLE;
    url.password = PASSWORD;
    app = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    // Privileges are checked before any row is touched, so even a no-op statement is refused.
    for (const t of APPEND_ONLY_TABLES) {
      await expect(app.$executeRawUnsafe(`UPDATE "${t}" SET id = id WHERE false`), t).rejects.toThrow(/permission denied/);
      await expect(app.$executeRawUnsafe(`DELETE FROM "${t}" WHERE false`), t).rejects.toThrow(/permission denied/);
      await expect(app.$queryRawUnsafe(`SELECT count(*) FROM "${t}"`)).resolves.toBeTruthy();
    }
    await expect(app.$executeRawUnsafe(`INSERT INTO "AuditEvent" SELECT * FROM "AuditEvent" WHERE false`)).resolves.toBe(0);
    await expect(app.$executeRawUnsafe(`UPDATE "User" SET name = name WHERE false`)).resolves.toBe(0);
    await expect(app.$executeRawUnsafe('CREATE TABLE app_should_not_create (x int)')).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE false')).rejects.toThrow(/permission denied/);
  });

  it('staging requires production builds but accepts Stripe test mode; production requires live identity', () => {
    const base = { DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL };
    expect(loadConfig({ ...base, NODE_ENV: 'test' })).toMatchObject({ appEnv: 'local', requireLiveIdentity: false });
    const live = { ...base, NODE_ENV: 'production', GOOGLE_OAUTH_CLIENT_ID: 'g', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_IDENTITY_WEBHOOK_SECRET: 'whsec_x', VERTEX_PROJECT_ID: 'p', SMTP_HOST: 'smtp.example.test' };
    expect(loadConfig({ ...live, APP_ENV: 'staging' })).toMatchObject({ appEnv: 'staging', requireLiveIdentity: false });
    expect(loadConfig(live)).toMatchObject({ appEnv: 'production', requireLiveIdentity: true });
    expect(() => loadConfig({ ...live, RL_GYM_WEBHOOK_URL: 'https://rl.example.test/hook', RL_GYM_WEBHOOK_SECRET: 'short' })).toThrow(/32 characters/);
  });
});
