import { expect, test } from '@playwright/test';

for (const origin of ['http://localhost:3300', 'http://localhost:3301']) {
  test(`${origin}: oversized JSON receives a product error through the same-origin proxy`, async ({ request }) => {
    test.skip(!!process.env.E2E_WEB_URL, 'isolated local regression only');
    for (const size of [2, 10]) {
      const response = await request.post(`${origin}/api/v1/auth/login`, {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ email: 'test@example.test', password: 'x'.repeat(size * 1024 * 1024) }),
      });
      expect(response.status()).toBe(413);
      expect(await response.json()).toMatchObject({ error: 'REQUEST_TOO_LARGE', requestId: expect.any(String) });
    }
    const missing = await request.get(`${origin}/api/v1/no-such-route`);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'NOT_FOUND', requestId: expect.any(String) });
  });
}
