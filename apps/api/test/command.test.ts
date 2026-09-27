import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/platform/command';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';

describe('State changes: audit log and idempotency', () => {
  let app: FastifyInstance;
  let adminId: string;
  let cookie: string;

  beforeAll(async () => {
    app = await buildTestApp();
    // Probe commands exercising the runner's guarantees.
    app.post('/probe/no-audit', { config: { access: 'authenticated' } }, async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor }) => {
        await tx.user.update({ where: { id: actor.userId }, data: { name: 'changed without audit' } });
        return { status: 200, body: { ok: true } };
      });
      return reply;
    });
    app.post('/probe/fails-after-writes', { config: { access: 'authenticated' } }, async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
        await tx.user.update({ where: { id: actor.userId }, data: { name: 'should roll back' } });
        await audit({ entityType: 'User', entityId: actor.userId, action: 'probe.changed' });
        await emit({ name: 'user.created', aggregateType: 'User', aggregateId: actor.userId, payload: {} });
        throw new Error('boom');
      });
      return reply;
    });
  });

  beforeEach(async () => {
    await resetDb();
    const { id: clientId } = await createClient();
    const admin = await createUser(clientId, ['ADMIN'], 'admin@test.local');
    adminId = admin.id;
    cookie = await login(app, admin.email);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const createUserReq = (headers: Record<string, string>, email = 'pm@test.local') =>
    app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie, ...headers },
      payload: { email, name: 'Pat PM', roles: ['PM'], password: 'long-enough-password' },
    });

  describe('each state change writes exactly one AuditEvent', () => {
    it('create user', async () => {
      const res = await createUserReq(idem());
      expect(res.statusCode).toBe(201);
      const events = await db.auditEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorType: 'USER',
        actorId: adminId,
        entityType: 'User',
        entityId: res.json().id,
        action: 'user.created',
        before: null,
      });
      expect(events[0]!.after).toMatchObject({ email: 'pm@test.local', roles: ['PM'] });
      expect(JSON.stringify(events[0]!.after)).not.toContain('password');
      expect(events[0]!.requestId).toBe(res.headers['x-request-id']);
    });

    it('change roles records before and after', async () => {
      const { id } = (await createUserReq(idem())).json();
      await db.auditEvent.deleteMany();
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${id}/roles`,
        headers: { cookie, ...idem() },
        payload: { roles: ['PM', 'REVIEWER'] },
      });
      expect(res.statusCode).toBe(200);
      const events = await db.auditEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'user.roles_changed',
        before: { roles: ['PM'] },
        after: { roles: ['PM', 'REVIEWER'] },
      });
    });

    it('change status records before and after', async () => {
      const { id } = (await createUserReq(idem())).json();
      await db.auditEvent.deleteMany();
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${id}/status`,
        headers: { cookie, ...idem() },
        payload: { status: 'DISABLED' },
      });
      expect(res.statusCode).toBe(200);
      const events = await db.auditEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'user.status_changed',
        before: { status: 'ACTIVE' },
        after: { status: 'DISABLED' },
      });
    });

    it('a rejected command (validation, conflict, not found) writes no AuditEvent', async () => {
      await createUserReq(idem());
      await db.auditEvent.deleteMany();
      expect((await createUserReq(idem())).statusCode).toBe(409); // duplicate email
      const missing = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${randomUUID()}/roles`,
        headers: { cookie, ...idem() },
        payload: { roles: ['PM'] },
      });
      expect(missing.statusCode).toBe(404);
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${adminId}/roles`,
        headers: { cookie, ...idem() },
        payload: { roles: [] },
      });
      expect(invalid.statusCode).toBe(400);
      expect(await db.auditEvent.count()).toBe(0);
    });

    it('a command that changes state without auditing is refused and rolled back', async () => {
      const res = await app.inject({ method: 'POST', url: '/probe/no-audit', headers: { cookie, ...idem() }, payload: {} });
      expect(res.statusCode).toBe(500);
      expect((await db.user.findUniqueOrThrow({ where: { id: adminId } })).name).not.toBe('changed without audit');
      expect(await db.idempotencyKey.count()).toBe(0);
    });

    it('a failing command rolls back its change, audit, outbox event and idempotency record together', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/probe/fails-after-writes',
        headers: { cookie, ...idem() },
        payload: {},
      });
      expect(res.statusCode).toBe(500);
      expect((await db.user.findUniqueOrThrow({ where: { id: adminId } })).name).not.toBe('should roll back');
      expect(await db.auditEvent.count()).toBe(0);
      expect(await db.outboxEvent.count()).toBe(0);
      expect(await db.idempotencyKey.count()).toBe(0);
    });
  });

  describe('Idempotency-Key', () => {
    it('is required on state-changing requests', async () => {
      const res = await createUserReq({});
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Idempotency-Key/);
      expect(await db.user.count()).toBe(1);
      expect(await db.auditEvent.count()).toBe(0);
    });

    it('a repeated request with the same key replays the first response and changes nothing', async () => {
      const key = idem();
      const first = await createUserReq(key);
      const second = await createUserReq(key);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json()).toEqual(first.json());
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await db.user.count({ where: { email: 'pm@test.local' } })).toBe(1);
      expect(await db.auditEvent.count()).toBe(1);
      expect(await db.outboxEvent.count()).toBe(1);
    });

    it('a replayed failure is not cached: the same key can be retried after a rejected attempt', async () => {
      const key = idem();
      await db.user.create({
        data: { clientId: (await db.user.findUniqueOrThrow({ where: { id: adminId } })).clientId, email: 'pm@test.local', name: 'x', roles: ['PM'], passwordHash: 'x' },
      });
      expect((await createUserReq(key)).statusCode).toBe(409);
      await db.user.delete({ where: { email: 'pm@test.local' } });
      expect((await createUserReq(key)).statusCode).toBe(201);
    });

    it('reusing a key for a different request is rejected with 422', async () => {
      const key = idem();
      await createUserReq(key, 'first@test.local');
      const res = await createUserReq(key, 'second@test.local');
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await db.user.count({ where: { email: 'second@test.local' } })).toBe(0);
    });

    it('concurrent requests with the same key apply the change once', async () => {
      const key = idem();
      const results = await Promise.all([createUserReq(key), createUserReq(key), createUserReq(key)]);
      // One wins; the others replay its response.
      expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
      expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
      expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
      expect(await db.user.count({ where: { email: 'pm@test.local' } })).toBe(1);
      expect(await db.auditEvent.count()).toBe(1);
      expect(await db.idempotencyKey.count()).toBe(1);
    });

    it('keys are scoped per actor', async () => {
      const key = idem();
      const other = await createUser((await db.user.findUniqueOrThrow({ where: { id: adminId } })).clientId, ['ADMIN']);
      const otherCookie = await login(app, other.email);
      const a = await createUserReq(key, 'a@test.local');
      const b = await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { cookie: otherCookie, ...key },
        payload: { email: 'b@test.local', name: 'B', roles: ['PM'], password: 'long-enough-password' },
      });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      expect(b.headers['idempotent-replayed']).toBeUndefined();
    });

    it('an expired key is treated as new', async () => {
      const key = idem();
      await createUserReq(key, 'first@test.local');
      await db.idempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await createUserReq(key, 'second@test.local');
      expect(res.statusCode).toBe(201);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });
  });
});
