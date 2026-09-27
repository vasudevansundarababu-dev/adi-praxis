import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { securityHeaders } from '@praxis/shared/security-headers';
import { buildTestApp, db } from './helpers';

describe('security headers (hardening before external testing)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('API responses are not cacheable, not framable and not sniffed, including errors', async () => {
    for (const url of ['/api/v1/auth/me', '/api/v1/no-such-route', '/readyz']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
    }
  });

  it('the apps send a CSP that forbids framing and plugins, HSTS outside dev, and only Google sign-in as an outside script', () => {
    const prod = Object.fromEntries(securityHeaders({ dev: false, scripts: ['https://accounts.google.com/gsi/client'] }).map((h) => [h.key, h.value]));
    expect(prod['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
    expect(prod['Content-Security-Policy']).toMatch(/object-src 'none'/);
    expect(prod['Content-Security-Policy']).toMatch(/script-src 'self' 'unsafe-inline' https:\/\/accounts.google.com\/gsi\/client(;|$)/);
    expect(prod['Content-Security-Policy']).not.toMatch(/unsafe-eval/);
    expect(prod['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(prod['X-Frame-Options']).toBe('DENY');
    const dev = Object.fromEntries(securityHeaders({ dev: true }).map((h) => [h.key, h.value]));
    expect(dev['Strict-Transport-Security']).toBeUndefined();
  });
});
