import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { hashPassword } from '../src/auth/password';
import { seed } from '../prisma/seed';

/**
 * Prepares the isolated end-to-end database: creates it if needed, applies migrations, empties it and seeds an Admin,
 * a PM and the template catalog. Never touches the dev or unit-test databases.
 */
const base = process.env.E2E_DATABASE_ADMIN_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis';
const url = process.env.E2E_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_e2e';
const name = new URL(url).pathname.slice(1);

const admin = new PrismaClient({ datasources: { db: { url: base } } });
const exists = await admin.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
await admin.$disconnect();

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });

const db = new PrismaClient({ datasources: { db: { url } } });
const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
await db.$transaction([db.$executeRawUnsafe(`SET LOCAL praxis.allow_truncate = 'on'`), db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`)]);
const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@e2e.local', SEED_ADMIN_PASSWORD: 'e2e-admin-password' });
await db.user.create({ data: { clientId: client.id, email: 'pm@e2e.local', name: 'Pat Morgan', roles: ['PM'], passwordHash: await hashPassword('e2e-pm-password') } });
// M10 smoke tests: a Finance approver and a Validator.
await db.user.create({ data: { clientId: client.id, email: 'finance@e2e.local', name: 'Farah Iqbal', roles: ['FINANCE'], passwordHash: await hashPassword('e2e-finance-password') } });
await db.user.create({ data: { clientId: client.id, email: 'validator@e2e.local', name: 'Vikram Shah', roles: ['REVIEWER'], passwordHash: await hashPassword('e2e-validator-password') } });
await db.$disconnect();
console.log(`e2e database ${name} ready`);
