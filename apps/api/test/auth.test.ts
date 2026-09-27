import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto';
import { buildTestApp, createClient, createUser, db, idem, login, PASSWORD, resetDb } from './helpers';

describe('Internal sign-in (email + password, server-side sessions)', () => {
  let app: FastifyInstance;
  let clientId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const loginReq = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });

  it('valid credentials return the user and set an httpOnly, SameSite=Lax session cookie', async () => {
    const user = await createUser(clientId, ['PM'], 'pm@test.local');
    const res = await loginReq('PM@Test.Local', PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: user.id, email: 'pm@test.local', roles: ['PM'] });
    const cookie = res.cookies.find((c) => c.name === 'praxis_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');

    // Only the hash of the token is stored.
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(sha256(cookie.value));
    expect(session.tokenHash).not.toBe(cookie.value);
    expect(session.audience).toBe('INTERNAL');
  });

  it('the session cookie authenticates /auth/me', async () => {
    const user = await createUser(clientId, ['REVIEWER']);
    const cookie = await login(app, user.email);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });

  it('a wrong password is rejected with 401 and no session', async () => {
    const user = await createUser(clientId, ['PM']);
    const res = await loginReq(user.email, 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_CREDENTIALS');
    expect(res.cookies).toHaveLength(0);
    expect(await db.session.count()).toBe(0);
  });

  it('an unknown email gets the same 401 as a wrong password', async () => {
    const res = await loginReq('nobody@test.local', PASSWORD);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
  });

  it('malformed input is rejected with 400', async () => {
    const res = await loginReq('not-an-email', '');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_FAILED');
  });

  it('a disabled user cannot sign in', async () => {
    const user = await createUser(clientId, ['PM']);
    await db.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    const res = await loginReq(user.email, PASSWORD);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ACCOUNT_DISABLED');
  });

  it('no cookie, a garbage cookie, an expired session or a revoked session all get 401', async () => {
    const user = await createUser(clientId, ['PM']);
    const me = (cookie?: string) =>
      app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: cookie ? { cookie } : {} });

    expect((await me()).statusCode).toBe(401);
    expect((await me('praxis_session=garbage')).statusCode).toBe(401);

    const expired = await login(app, user.email);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await me(expired)).statusCode).toBe(401);

    const revoked = await login(app, user.email);
    await db.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    expect((await me(revoked)).statusCode).toBe(401);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const user = await createUser(clientId, ['PM']);
    const cookie = await login(app, user.email);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'praxis_session')?.value).toBe('');

    // Replaying the old cookie no longer works.
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('disabling a user signs them out of existing sessions', async () => {
    const admin = await createUser(clientId, ['ADMIN']);
    const pm = await createUser(clientId, ['PM']);
    const adminCookie = await login(app, admin.email);
    const pmCookie = await login(app, pm.email);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${pm.id}/status`,
      headers: { cookie: adminCookie, ...idem() },
      payload: { status: 'DISABLED' },
    });
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: pmCookie } });
    expect(me.statusCode).toBe(401);
  });

  it('login is rate limited per IP', async () => {
    const limited = await buildTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '2' });
    const attempt = () =>
      limited.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'x@test.local', password: 'nope' } });
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    await limited.close();
  });
});
