import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, createClient, createUser, db, idem, login, resetDb } from './helpers';

describe('tester reports #44 #66 #67 #117 #130 #151 #155 #158 #159 #161', () => {
  let app: FastifyInstance;
  let cookie: string;
  let email: string;
  beforeAll(async () => {
    await resetDb();
    app = await buildTestApp({ SME_SUPPLY_ENABLED: 'true' });
    const client = await createClient();
    const user = await createUser(client.id, ['ADMIN']);
    email = user.email;
    cookie = await login(app, email);
  });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  it('unmatched routes and malformed JSON use product errors and a request id', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/no-such-route' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'NOT_FOUND', message: 'This API route was not found.', requestId: missing.headers['x-request-id'] });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'BAD_REQUEST', requestId: expect.any(String) });
    expect(bad.body).not.toMatch(/FST_|Fastify|SyntaxError/);
  });

  it.each(['99999999999999999999', '9223372036854775808', '-1', '', 'abc', '1.5'])('invalid dataset cursor %j is rejected before PostgreSQL', async (value) => {
    for (const route of ['/dataset/records', '/dataset/export']) {
      const response = await app.inject({ method: 'GET', url: '/api/v1' + route + '?after=' + value, headers: { cookie } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'VALIDATION_FAILED', requestId: expect.any(String) });
    }
  });

  it.each(['0', '9223372036854775807'])('valid bounded cursor %s is accepted', async (value) => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/dataset/records?after=' + value, headers: { cookie } })).statusCode).toBe(200);
  });

  it('unknown body fields are refused for login, project creation and candidate corrections', async () => {
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'wrong', isAdmin: true } });
    expect(auth.statusCode).toBe(400);
    expect(auth.json().message).toContain('isAdmin');
    const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: { cookie, ...idem() }, payload: { name: 'Should not be created', templateId: randomUUID(), isAdmin: true } });
    expect(project.statusCode).toBe(400);
    expect(await db.project.count()).toBe(0);
    const token = await app.inject({ method: 'POST', url: '/api/v1/auth/dev/google-token', payload: { email: 'test-candidate@example.test', name: 'Test Candidate' } });
    const signed = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: token.json().credential, adultAttested: true } });
    const candidate = signed.cookies.find((c) => c.name === 'praxis_candidate')!;
    const empty = await app.inject({ method: 'POST', url: '/api/v1/me/enrollments/' + randomUUID() + '/withdraw', headers: { cookie: `praxis_candidate=${candidate.value}`, 'content-type': 'application/json' }, payload: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: 'BAD_REQUEST', requestId: expect.any(String) });
    expect(empty.body).not.toMatch(/FST_|Fastify/);
    const corrections = await app.inject({ method: 'POST', url: '/api/v1/me/profile/corrections', headers: { cookie: `praxis_candidate=${candidate.value}`, ...idem() }, payload: { enrollmentId: randomUUID(), expectedRevision: 0, isAdmin: true } });
    expect(corrections.statusCode).toBe(400);
    expect(corrections.json().message).toContain('isAdmin');
  });

  it.each(['/api/v1/projects/%00', '/api/v1/opportunities/job%00', '/api/v1/me/enrollments/%00'])('encoded NUL in %s is rejected without a database error', async (url) => {
    const response = await app.inject({ method: 'GET', url, headers: { cookie } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_ADDRESS', requestId: expect.any(String) });
  });

  it('OpenAPI declares actual audiences and demo-only endpoints', async () => {
    const document = app.swagger();
    const paths = document.paths as Record<string, Record<string, any>>;
    expect(paths['/api/v1/auth/me']!.get.security).toEqual([{ session: [] }]);
    expect(paths['/api/v1/me/enrollments/{id}/conversation']!.get.security).toEqual([{ candidateSession: [] }]);
    expect(paths['/api/v1/dataset/records']!.get.security).toEqual([{ session: [] }, { serviceToken: [] }]);
    expect(paths['/api/v1/partner-statements']!.get.responses).toHaveProperty('401');
    expect(paths['/partner/v1/requisitions']!.get.security).toEqual([{ partnerOAuth: ['requisitions:read'] }]);
    expect(paths['/api/v1/auth/login']!.post.security).toEqual([]);
    expect(paths['/api/v1/auth/dev/google-token']).toBeTruthy();
    expect(paths['/api/v1/dev/identity/{sessionId}/simulate']).toBeTruthy();
  });

  it('the configured production login threshold blocks attempt eleven', async () => {
    const limited = await buildTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '10' });
    for (let i = 0; i < 11; i++) {
      const response = await limited.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'not-an-account@example.test', password: 'incorrect-password' } });
      expect(response.statusCode).toBe(i < 10 ? 401 : 429);
    }
    await limited.close();
  });
});
