import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test('#123: phone workbench blocks keyboard edits and autosave, desktop remains editable', async ({ page }) => {
  test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');
  const base = 'http://localhost:3301';
  const token = await (await page.request.post(base + '/api/v1/auth/dev/google-token', { data: { email: `phone.${randomUUID()}@example.test`, name: 'Phone UI fixture' } })).json();
  const signed = await (await page.request.post(base + '/api/v1/auth/google', { data: { credential: token.credential, adultAttested: true } })).json();
  const fixture = JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'workbench', signed.id], { encoding: 'utf8' }).trim().split('\n').pop()!);
  let saves = 0;
  await page.route(`**/api/v1/me/tasks/${fixture.taskId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    saves++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: saves, savedAt: new Date().toISOString() }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/tasks/${fixture.taskId}`);
  const title = page.getByRole('textbox', { name: /^Title/ });
  await expect(title).toBeDisabled();
  await title.evaluate((element) => (element as HTMLInputElement).focus());
  await page.keyboard.type(' must not edit');
  await expect(title).toHaveValue('SYNTHETIC workbench UI fixture');
  expect(saves).toBe(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(title).toBeEnabled();
  await title.fill('Updated synthetic UI fixture');
  await expect.poll(() => saves).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(title).toBeDisabled();
  await title.evaluate((element) => (element as HTMLInputElement).focus());
  await page.keyboard.type(' blocked');
  await expect(title).toHaveValue('Updated synthetic UI fixture');
  expect(saves).toBe(1);
});
