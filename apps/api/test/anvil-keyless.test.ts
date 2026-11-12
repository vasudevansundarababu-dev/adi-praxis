import type { FastifyInstance } from 'fastify';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { AnvilExportClient } from '../src/anvil/export-client';
import { ensureAnvilGrant } from '../src/anvil/grant';
import { anvilAudience, GoogleServiceIdentityVerifier } from '../src/anvil/service-identity';
import { buildApp } from '../src/app';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Keyless Praxis <-> Anvil (owner 12 Nov 2026; Keystone K6). Local RSA keys stand in for Google's: no network, no
 * real tokens, no paid calls.
 */
const AUD = 'https://praxis-api.example.test';
const SA = 'anvil-qa-v1-runtime@adi-anvil-mvp-2026.iam.gserviceaccount.com';
const SUB = '115559370176638900713';
const STOP = new Date(Date.now() + 30 * 86_400_000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const verifier = new GoogleServiceIdentityVerifier({ audience: AUD, subject: SUB, email: SA }, async () => ({ kid1: pem }));
const now = () => Math.floor(Date.now() / 1000);
function jwt(claims: object, key = privateKey, alg = 'RS256') {
  const h = Buffer.from(JSON.stringify({ alg, kid: 'kid1', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url');
  return `${h}.${p}.${s}`;
}
const good = () => ({ iss: 'https://accounts.google.com', aud: AUD, sub: SUB, email: SA, email_verified: true, iat: now(), exp: now() + 3600 });
const log = () => {};

describe('keyless service identity: the verifier', () => {
  it('accepts only the pinned account, with the exact issuer and audience, in time', async () => {
    expect(await verifier.verify(jwt(good()))).toEqual({ email: SA, subject: SUB });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const bad = [
      jwt({ ...good(), aud: 'https://anvil-qa.adi-labs.ai' }),
      jwt({ ...good(), iss: 'accounts.google.com' }),
      jwt({ ...good(), iss: 'https://evil.example' }),
      jwt({ ...good(), sub: '999999999999999999999' }),
      jwt({ ...good(), email: 'someone-else@adi-anvil-mvp-2026.iam.gserviceaccount.com' }),
      jwt({ ...good(), email_verified: false }),
      jwt({ ...good(), iat: now() - 7200, exp: now() - 3600 }),
      jwt(good(), other),
      jwt(good(), privateKey, 'HS256'),
      'not.a.token',
    ];
    for (const t of bad) expect(await verifier.verify(t)).toBeNull();
  });

  it('needs an audience, subject and account', () => {
    expect(() => new GoogleServiceIdentityVerifier({ audience: AUD, subject: '', email: SA })).toThrow();
  });

  it('Praxis -> Anvil audience defaults to the origin of the export base URL', () => {
    expect(anvilAudience('https://anvil-qa.adi-labs.ai/api/v1/projects/x/dataset-exports/generic')).toBe('https://anvil-qa.adi-labs.ai');
    expect(anvilAudience('https://anvil-qa.adi-labs.ai/api/v1/x', 'https://other.example')).toBe('https://other.example');
  });
});

describe('keyless service identity: requests', () => {
  let app: FastifyInstance;
  let clientId: string;
  const call = (token: string) => app.inject({ method: 'GET', url: `/api/v1/integrations/anvil/templates/proposals/${randomUUID()}`, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate, anvilIdentity: verifier });
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' })).client.id;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('without a grant row the valid token is refused; with it the caller is the Anvil client', async () => {
    expect((await call(jwt(good()))).statusCode).toBe(401);
    await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }, log);
    const res = await call(jwt(good()));
    expect(res.statusCode).toBe(404); // authenticated and authorised: the proposal simply does not exist
    expect((await call(jwt({ ...good(), sub: '2' + SUB.slice(1) }))).statusCode).toBe(401);
  });

  it('the grant is created once, audited, has no usable key, and a redeploy never undoes a revocation', async () => {
    const env = { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() };
    const g = (await ensureAnvilGrant(db, clientId, env, log))!;
    expect(g).toMatchObject({ kind: 'ANVIL', serviceAccount: SA });
    expect(g.expiresAt!.toISOString()).toBe(STOP.toISOString());
    expect((await ensureAnvilGrant(db, clientId, env, log))!.id).toBe(g.id);
    expect(await db.apiClient.count()).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'api_client.keyless_granted', entityId: g.id, actorType: 'SYSTEM' } })).toBe(1);

    const admin = await login(app, 'admin@test.local', 'admin-password-123');
    expect((await app.inject({ method: 'POST', url: `/api/v1/api-clients/${g.id}/revoke`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    expect((await call(jwt(good()))).statusCode).toBe(401);
    await ensureAnvilGrant(db, clientId, env, log);
    expect((await db.apiClient.findUniqueOrThrow({ where: { id: g.id } })).revokedAt).not.toBeNull();
    expect((await call(jwt(good()))).statusCode).toBe(401);
  });

  it('no grant without a future pilot stop, and none when no account is configured', async () => {
    expect(await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: '' }, log)).toBeNull();
    expect(await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() - 1000).toISOString() }, log)).toBeNull();
    expect(await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: '', ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }, log)).toBeNull();
    expect(await db.apiClient.count()).toBe(0);
  });

  it('an expired grant stops working', async () => {
    const g = (await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }, log))!;
    await db.apiClient.update({ where: { id: g.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(jwt(good()))).statusCode).toBe(401);
  });

  it('with no verifier configured, identity tokens are refused (no anonymous access)', async () => {
    const plain = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
    await ensureAnvilGrant(db, clientId, { ANVIL_CALLER_SERVICE_ACCOUNT: SA, ANVIL_CREDENTIAL_NOT_AFTER: STOP.toISOString() }, log);
    const res = await plain.inject({ method: 'GET', url: `/api/v1/integrations/anvil/templates/proposals/${randomUUID()}`, headers: { authorization: `Bearer ${jwt(good())}` } });
    expect(res.statusCode).toBe(401);
    expect((await plain.inject({ method: 'GET', url: `/api/v1/integrations/anvil/templates/proposals/${randomUUID()}` })).statusCode).toBe(401);
    await plain.close();
  });
});

describe('keyless service identity: Praxis calling Anvil', () => {
  const BASE = 'https://anvil-qa.example.test/api/v1/projects/p/dataset-exports/generic';
  it('sends a fresh identity token from the provider, never a stored key', async () => {
    const seen: string[] = [];
    const fetchImpl = async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers.Authorization!);
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { contracts: [], enabled: false } }) };
    };
    let n = 0;
    const client = new AnvilExportClient(BASE, async () => `id-token-${++n}`, fetchImpl as never);
    await client.contracts();
    await client.contracts();
    expect(seen).toEqual(['Bearer id-token-1', 'Bearer id-token-2']);
  });

  it('reports a missing identity as a transport problem, without calling Anvil', async () => {
    let called = false;
    const client = new AnvilExportClient(BASE, async () => { throw new Error('no metadata server'); }, (async () => { called = true; }) as never);
    const r = await client.contracts();
    expect(r).toMatchObject({ kind: 'transport', code: 'IDENTITY_UNAVAILABLE', retryable: true });
    expect(called).toBe(false);
  });
});
