import type { InternalRole } from '@praxis/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessPolicy, InternalActor } from '../src/auth/actor';
import { checkAccess } from '../src/auth/rbac';
import { buildTestApp, createClient, createUser, db, login, resetDb } from './helpers';

const actor = (roles: InternalRole[]): InternalActor => ({
  type: 'USER',
  userId: randomUUID(),
  clientId: randomUUID(),
  roles,
  sessionId: randomUUID(),
  mustChangePassword: false,
});

describe('RBAC decision (unit)', () => {
  const cases: [AccessPolicy, InternalRole[] | null, 'ok' | 401 | 403][] = [
    ['public', null, 'ok'],
    ['public', ['PM'], 'ok'],
    ['authenticated', null, 401],
    ['authenticated', [], 'ok'],
    [['ADMIN'], null, 401],
    [['ADMIN'], ['PM'], 403],
    [['ADMIN'], ['ADMIN'], 'ok'],
    [['PM', 'ADMIN'], ['PM'], 'ok'],
    [['REVIEWER'], ['PM', 'REVIEWER'], 'ok'],
    [['REVIEWER'], [], 403],
  ];
  it.each(cases)('policy %j with roles %j -> %s', (policy, roles, expected) => {
    expect(checkAccess(policy, roles ? actor(roles) : null)).toBe(expected);
  });
});

/**
 * Every role (and signed-out) against every kind of endpoint. Probe routes cover each policy type;
 * the real Admin user-management endpoints are checked too.
 */
describe('RBAC middleware grid (integration)', () => {
  let app: FastifyInstance;
  const cookies: Record<string, string | undefined> = {};

  const callers: Record<string, InternalRole[] | null> = {
    anonymous: null,
    admin: ['ADMIN'],
    pm: ['PM'],
    reviewer: ['REVIEWER'],
    'pm+reviewer': ['PM', 'REVIEWER'],
    'no roles': [],
  };

  const endpoints: { name: string; method: 'GET' | 'POST' | 'PATCH'; url: string; allowed: InternalRole[] | 'any' | 'public' }[] = [
    { name: 'public probe', method: 'GET', url: '/probe/public', allowed: 'public' },
    { name: 'authenticated probe', method: 'GET', url: '/probe/authenticated', allowed: 'any' },
    { name: 'admin probe', method: 'GET', url: '/probe/admin', allowed: ['ADMIN'] },
    { name: 'pm probe', method: 'GET', url: '/probe/pm', allowed: ['PM'] },
    { name: 'reviewer probe', method: 'GET', url: '/probe/reviewer', allowed: ['REVIEWER'] },
    { name: 'pm-or-admin probe', method: 'GET', url: '/probe/pm-or-admin', allowed: ['PM', 'ADMIN'] },
    { name: 'GET /auth/me', method: 'GET', url: '/api/v1/auth/me', allowed: 'any' },
    { name: 'GET /users', method: 'GET', url: '/api/v1/users', allowed: ['ADMIN'] },
    { name: 'POST /users', method: 'POST', url: '/api/v1/users', allowed: ['ADMIN'] },
    { name: 'PATCH /users/:id/roles', method: 'PATCH', url: `/api/v1/users/${randomUUID()}/roles`, allowed: ['ADMIN'] },
    { name: 'PATCH /users/:id/status', method: 'PATCH', url: `/api/v1/users/${randomUUID()}/status`, allowed: ['ADMIN'] },
  ];

  beforeAll(async () => {
    await resetDb();
    app = await buildTestApp();
    const probe = (url: string, access: AccessPolicy) =>
      app.get(url, { config: { access } }, async () => ({ ok: true }));
    probe('/probe/public', 'public');
    probe('/probe/authenticated', 'authenticated');
    probe('/probe/admin', ['ADMIN']);
    probe('/probe/pm', ['PM']);
    probe('/probe/reviewer', ['REVIEWER']);
    probe('/probe/pm-or-admin', ['PM', 'ADMIN']);

    const { id: clientId } = await createClient();
    for (const [name, roles] of Object.entries(callers)) {
      if (roles) cookies[name] = await login(app, (await createUser(clientId, roles)).email);
    }
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const grid = endpoints.flatMap((e) =>
    Object.entries(callers).map(([caller, roles]) => {
      let expected: 'allowed' | 401 | 403;
      if (e.allowed === 'public') expected = 'allowed';
      else if (!roles) expected = 401;
      else if (e.allowed === 'any' || roles.some((r) => (e.allowed as InternalRole[]).includes(r))) expected = 'allowed';
      else expected = 403;
      return [e.name, caller, expected, e] as const;
    }),
  );

  it.each(grid)('%s as %s -> %s', async (_name, caller, expected, e) => {
    const res = await app.inject({
      method: e.method,
      url: e.url,
      headers: cookies[caller] ? { cookie: cookies[caller] } : {},
      // Mutations get a (deliberately invalid) body: once past RBAC they fail validation, never succeed.
      payload: e.method === 'GET' ? undefined : {},
    });
    if (expected === 'allowed') {
      expect([401, 403]).not.toContain(res.statusCode);
    } else {
      expect(res.statusCode).toBe(expected);
      expect(res.json().error).toBe(expected === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
    }
  });

  it('rejects requests before the handler runs (no side effects for forbidden callers)', async () => {
    const before = await db.user.count();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: cookies.pm!, 'idempotency-key': randomUUID() },
      payload: { email: 'new@test.local', name: 'New', roles: ['ADMIN'], password: 'long-enough-password' },
    });
    expect(res.statusCode).toBe(403);
    expect(await db.user.count()).toBe(before);
  });

  it('a route registered without an access policy fails at startup', async () => {
    const bare = await buildTestApp();
    expect(() => bare.get('/no-policy', async () => ({}))).toThrow(/has no access policy/);
    await bare.close();
  });

  it('users are scoped to their own client', async () => {
    const other = await createClient();
    const otherAdmin = await createUser(other.id, ['ADMIN']);
    const otherCookie = await login(app, otherAdmin.email);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: otherCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((u: { id: string }) => u.id)).toEqual([otherAdmin.id]);
  });
});
