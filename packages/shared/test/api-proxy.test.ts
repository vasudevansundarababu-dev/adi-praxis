import { describe, expect, it } from 'vitest';
import { JSON_REQUEST_LIMIT, proxyApi } from '../src/api-proxy';

describe('tester #160: bounded same-origin proxy', () => {
  it.each([2, 10])('returns a JSON413 for a %sMB body, including without Content-Length', async (mb) => {
    let calls = 0;
    const upstream: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
    for (const declared of [true, false]) {
      const body = JSON.stringify({ name: 'x'.repeat(mb * 1024 * 1024) });
      const request = new Request('https://web.example.test/api/v1/projects', { method: 'POST', body, headers: { 'content-type': 'application/json', ...(declared ? { 'content-length': String(body.length) } : {}) } });
      const response = await proxyApi(request, 'https://api.example.test', upstream);
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'REQUEST_TOO_LARGE', message: expect.any(String), requestId: response.headers.get('x-request-id') });
    }
    expect(calls).toBe(0);
  });

  it('checks actual bytes when the caller lies about request length', async () => {
    let called = false;
    const request = new Request('https://web.example.test/api/v1/projects', { method: 'POST', body: 'x'.repeat(JSON_REQUEST_LIMIT + 1), headers: { 'content-length': '1' } });
    expect((await proxyApi(request, 'https://api.example.test', async () => { called = true; return new Response(); })).status).toBe(413);
    expect(called).toBe(false);
  });

  it('preserves audience credentials and idempotency, pins the host and keeps distinct cookies', async () => {
    const request = new Request('https://untrusted.example/api/v1/auth/login?q=1', { method: 'POST', body: '{}', headers: { cookie: 'praxis_candidate=fake', authorization: 'Bearer fake', 'idempotency-key': 'fixed-test-key', host: 'untrusted.example' } });
    const response = await proxyApi(request, 'https://api.example.test', async (url, init) => {
      expect(String(url)).toBe('https://api.example.test/api/v1/auth/login?q=1');
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('praxis_candidate=fake');
      expect(headers.get('authorization')).toBe('Bearer fake');
      expect(headers.get('idempotency-key')).toBe('fixed-test-key');
      expect(headers.has('host')).toBe(false);
      const out = new Headers({ 'content-encoding': 'gzip', 'content-length': '100' });
      out.append('set-cookie', 'a=fake; HttpOnly; Path=/');
      out.append('set-cookie', 'b=fake; HttpOnly; Path=/');
      return new Response('{"ok":true}', { headers: out });
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-encoding')).toBe(false);
  });

  it('does not expose network errors or encoded NUL to the API', async () => {
    const response = await proxyApi(new Request('https://web.example/api/v1/projects'), 'https://api.example', async () => { throw new Error('private internal host details'); });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private internal');
    let called = false;
    expect((await proxyApi(new Request('https://web.example/api/v1/projects/%00'), 'https://api.example', async () => { called = true; return new Response(); })).status).toBe(400);
    expect(called).toBe(false);
  });
});
