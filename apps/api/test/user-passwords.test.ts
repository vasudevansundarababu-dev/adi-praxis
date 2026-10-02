import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';

/** Admin-issued temporary passwords for console and partner users, changed at first sign-in. */
describe('temporary passwords and first-sign-in password change', () => {
  let app: FastifyInstance;
  let clientId: string;
  let adminId: string;
  let admin: string;

  beforeAll(async () => {
    app = await buildTestApp({ SME_SUPPLY_ENABLED: 'true' });
  });
  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    const a = await createUser(clientId, ['ADMIN'], 'admin@test.local');
    adminId = a.id;
    admin = await login(app, a.email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (url: string, cookie: string, payload: unknown = {}, headers: Record<string, string> = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...headers }, payload: payload as object });
  const get = (url: string, cookie: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  const signIn = async (email: string, password: string, url = '/api/v1/auth/login') => {
    const res = await app.inject({ method: 'POST', url, payload: { email, password } });
    return { res, cookie: res.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  };

  it('an Admin creates a user without a password: a temporary one is returned once, stored only as a hash, and never in the audit log', async () => {
    const key = idem();
    const res = await post('/users', admin, { email: 'new.pm@test.local', name: 'New PM', roles: ['PM'] }, key);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(body.mustChangePassword).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { email: 'new.pm@test.local' } });
    expect(u.passwordHash).not.toContain(body.temporaryPassword);
    expect(await verifyPassword(u.passwordHash, body.temporaryPassword)).toBe(true);
    // A replay of the same request does not reveal the password again.
    const replay = await post('/users', admin, { email: 'new.pm@test.local', name: 'New PM', roles: ['PM'] }, key);
    expect(replay.json().temporaryPassword).toBeUndefined();
    const audits = JSON.stringify(await db.auditEvent.findMany({ where: { entityId: u.id } }));
    expect(audits).not.toContain(body.temporaryPassword);
  });

  it('with a temporary password the user can only see who they are, sign out and change the password; then everything opens', async () => {
    const { temporaryPassword } = (await post('/users', admin, { email: 'pm2@test.local', name: 'Pat', roles: ['PM'] })).json();
    const { res, cookie } = await signIn('pm2@test.local', temporaryPassword);
    expect(res.json().user.mustChangePassword).toBe(true);
    expect((await get('/auth/me', cookie)).statusCode).toBe(200);
    const blocked = await get('/projects', cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('PASSWORD_CHANGE_REQUIRED');

    expect((await post('/auth/change-password', cookie, { currentPassword: 'wrong-password', newPassword: 'a-brand-new-passphrase' })).json().error).toBe('WRONG_PASSWORD');
    expect((await post('/auth/change-password', cookie, { currentPassword: temporaryPassword, newPassword: temporaryPassword })).statusCode).toBe(400);
    expect((await post('/auth/change-password', cookie, { currentPassword: temporaryPassword, newPassword: 'short' })).statusCode).toBe(400);
    expect((await post('/auth/change-password', cookie, { currentPassword: temporaryPassword, newPassword: 'pm2-is-my-password' })).statusCode).toBe(400);

    const ok = await post('/auth/change-password', cookie, { currentPassword: temporaryPassword, newPassword: 'a-brand-new-passphrase' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.mustChangePassword).toBe(false);
    expect((await get('/projects', cookie)).statusCode).toBe(200);
    expect((await signIn('pm2@test.local', temporaryPassword)).res.statusCode).toBe(401);
    expect((await signIn('pm2@test.local', 'a-brand-new-passphrase')).res.statusCode).toBe(200);
    expect(await db.auditEvent.count({ where: { action: 'user.password_changed' } })).toBe(1);
  });

  it('changing your password signs out your other sessions but keeps this one', async () => {
    const u = await createUser(clientId, ['REVIEWER'], 'val@test.local');
    const first = await login(app, u.email);
    const second = await login(app, u.email);
    expect((await post('/auth/change-password', second, { currentPassword: 'correct-horse-battery', newPassword: 'another-long-passphrase' })).statusCode).toBe(200);
    expect((await get('/auth/me', second)).statusCode).toBe(200);
    expect((await get('/auth/me', first)).statusCode).toBe(401);
  });

  it('an Admin resets a password: a new temporary password, the user is signed out everywhere, and must change it', async () => {
    const u = await createUser(clientId, ['FINANCE'], 'fin@test.local');
    const session = await login(app, u.email);
    const res = await post(`/users/${u.id}/password-reset`, admin);
    expect(res.statusCode).toBe(200);
    const { temporaryPassword } = res.json();
    expect(temporaryPassword).toBeTruthy();
    expect((await get('/auth/me', session)).statusCode).toBe(401);
    expect((await signIn(u.email, 'correct-horse-battery')).res.statusCode).toBe(401);
    const again = await signIn(u.email, temporaryPassword);
    expect(again.res.json().user.mustChangePassword).toBe(true);
    expect(await db.auditEvent.count({ where: { action: 'user.password_reset', entityId: u.id } })).toBe(1);
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(temporaryPassword);
  });

  it('an Admin cannot reset their own password, and only Admins can create users or reset passwords', async () => {
    expect((await post(`/users/${adminId}/password-reset`, admin)).statusCode).toBe(409);
    const pm = await createUser(clientId, ['PM'], 'pm@test.local');
    const pmCookie = await login(app, pm.email);
    expect((await post(`/users/${adminId}/password-reset`, pmCookie)).statusCode).toBe(403);
    expect((await post('/users', pmCookie, { email: 'x@test.local', name: 'X', roles: ['PM'] })).statusCode).toBe(403);
  });

  it('an Admin can still set a password through the API; the user must change it unless told otherwise', async () => {
    const res = await post('/users', admin, { email: 'svc@test.local', name: 'Seed', roles: ['PM'], password: 'a-known-long-password' });
    expect(res.json().temporaryPassword).toBeUndefined();
    expect(res.json().mustChangePassword).toBe(true);
    const keep = await post('/users', admin, { email: 'svc2@test.local', name: 'Seed 2', roles: ['PM'], password: 'a-known-long-password', requirePasswordChange: false });
    expect(keep.json().mustChangePassword).toBe(false);
  });

  it('partner portal users: temporary password on creation and reset, forced change, and disabling one user', async () => {
    const partner = (await post('/partners', admin, { name: 'Lotus Staffing', businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR'] })).json();
    const created = await post(`/partners/${partner.id}/users`, admin, { email: 'ops@partner.example', name: 'Meera' });
    expect(created.statusCode).toBe(201);
    const { id: userId, temporaryPassword } = created.json();
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    const s = await signIn('ops@partner.example', temporaryPassword, '/api/v1/partner-portal/login');
    expect(s.res.json().user.mustChangePassword).toBe(true);
    expect((await get('/partner-portal/me', s.cookie)).statusCode).toBe(200);
    const blocked = await get('/partner-portal/requisitions', s.cookie);
    expect(blocked.json().error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await post('/partner-portal/change-password', s.cookie, { currentPassword: temporaryPassword, newPassword: 'partner-own-passphrase' })).statusCode).toBe(200);
    expect((await get('/partner-portal/requisitions', s.cookie)).statusCode).toBe(200);

    const reset = await post(`/partners/${partner.id}/users/${userId}/password-reset`, admin);
    expect(reset.statusCode).toBe(200);
    expect((await get('/partner-portal/me', s.cookie)).statusCode).toBe(401);
    const s2 = await signIn('ops@partner.example', reset.json().temporaryPassword, '/api/v1/partner-portal/login');
    expect(s2.res.json().user.mustChangePassword).toBe(true);

    const off = await app.inject({ method: 'PATCH', url: `/api/v1/partners/${partner.id}/users/${userId}/status`, headers: { cookie: admin, ...idem() }, payload: { status: 'DISABLED' } });
    expect(off.statusCode).toBe(200);
    expect((await get('/partner-portal/me', s2.cookie)).statusCode).toBe(401);
    expect((await signIn('ops@partner.example', reset.json().temporaryPassword, '/api/v1/partner-portal/login')).res.statusCode).toBe(401);
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(temporaryPassword);
  });
});
