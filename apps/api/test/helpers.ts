import type { InternalRole } from '@praxis/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { loadConfig, type Config } from '../src/config';
import { createDb, type Db } from '../src/db';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

export const PASSWORD = 'correct-horse-battery';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    ...overrides,
  });
}

export const db: Db = createDb(TEST_DATABASE_URL);

/** Empties every table (keeps the migration history). */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

export async function createClient() {
  return db.client.create({ data: { name: `Client ${randomUUID()}` } });
}

let hashed: Promise<string> | undefined;
export async function createUser(clientId: string, roles: InternalRole[], email = `${randomUUID()}@test.local`) {
  hashed ??= hashPassword(PASSWORD);
  return db.user.create({ data: { clientId, email, name: email.split('@')[0]!, roles, passwordHash: await hashed } });
}

export async function buildTestApp(configOverrides: Record<string, string> = {}): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(configOverrides), db, pingRedis: async () => true });
}

/** Signs in through the real endpoint and returns the Cookie header value. */
export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'praxis_session');
  return `praxis_session=${cookie!.value}`;
}

export const idem = () => ({ 'idempotency-key': randomUUID() });

export interface CandidateOverrides {
  name?: string;
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  identityStatus?: 'NOT_STARTED' | 'VERIFIED' | 'ALTERNATIVE_VERIFIED' | 'PROCESSING';
  country?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  languages?: { language: string; level: string }[];
  specialties?: string[];
  skills?: string[];
  domainExperienceYears?: number | null;
  educationLevel?: string | null;
  hoursPerWeek?: number | null;
  timezone?: string | null;
  attributes?: Record<string, unknown>;
  concurrentProjectLimit?: number;
}

/** A synthetic SME user + matching record. Defaults: verified London KYC expert, 10 years, 20 h/week, English C2. */
export async function createCandidate(clientId: string, o: CandidateOverrides = {}) {
  const sme = await db.smeUser.create({
    data: {
      clientId,
      displayName: o.name ?? `Test Expert ${randomUUID().slice(0, 4)}`,
      accountStatus: o.accountStatus ?? 'ACTIVE',
      identityStatus: o.identityStatus ?? 'VERIFIED',
    },
  });
  return db.candidate.create({
    data: {
      clientId,
      smeUserId: sme.id,
      country: o.country === undefined ? 'GB' : o.country,
      city: o.city === undefined ? 'London' : o.city,
      latitude: o.latitude === undefined ? 51.5074 : o.latitude,
      longitude: o.longitude === undefined ? -0.1278 : o.longitude,
      languages: o.languages ?? [{ language: 'en', level: 'C2' }],
      specialties: o.specialties ?? ['KYC'],
      skills: o.skills ?? ['KYC', 'EDD'],
      domainExperienceYears: o.domainExperienceYears === undefined ? 10 : o.domainExperienceYears,
      educationLevel: o.educationLevel === undefined ? 'ISCED_6' : o.educationLevel,
      hoursPerWeek: o.hoursPerWeek === undefined ? 20 : o.hoursPerWeek,
      timezone: o.timezone === undefined ? 'Europe/London' : o.timezone,
      attributes: (o.attributes ?? {}) as object,
      concurrentProjectLimit: o.concurrentProjectLimit ?? 2,
      lastValidatedAt: new Date('2026-09-01T00:00:00Z'),
    },
  });
}
