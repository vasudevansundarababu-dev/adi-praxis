import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');
async function workbench(page: Page) {
  const base = 'http://localhost:3301';
  const token = await (await page.request.post(base + '/api/v1/auth/dev/google-token', { data: { email: `phone.${randomUUID()}@example.test`, name: 'Phone UI fixture' } })).json();
  const signed = await (await page.request.post(base + '/api/v1/auth/google', { data: { credential: token.credential, adultAttested: true } })).json();
  const fixture = JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'workbench', signed.id], { encoding: 'utf8' }).trim().split('\n').pop()!);
  return { base, ...fixture };
}

test('#123: phone workbench blocks keyboard edits and autosave, desktop remains editable', async ({ page }) => {
  const { base, ...fixture } = await workbench(page);
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
  for (const width of [360, 640]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const lastSection = page.getByRole('navigation', { name: 'Workbench sections' }).getByRole('button', { name: /^W06/ });
    await lastSection.scrollIntoViewIfNeeded();
    const box = await lastSection.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
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

test('#121: immediate in-app back waits for the latest draft save', async ({ page }) => {
  const fixture = await workbench(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let payload: any;
  await page.route(`**/api/v1/me/tasks/${fixture.taskId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    payload = route.request().postDataJSON();
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: payload.expectedRevision + 1, savedAt: new Date().toISOString() }) });
  });
  const current = `${fixture.base}/tasks/${fixture.taskId}`;
  await page.goto(current);
  await page.getByRole('textbox', { name: /^Title/ }).fill('The newest unsaved title');
  await page.locator('a[data-save-before-leaving]').click();
  await expect.poll(() => payload?.output.header.title).toBe('The newest unsaved title');
  await expect(page).toHaveURL(current);
  release();
  await expect(page).toHaveURL(`${fixture.base}/projects/${fixture.projectId}`);
});

test('#121: in-flight edits save serially with acknowledged revisions before leaving', async ({ page }) => {
  const fixture = await workbench(page);
  let first!: () => void, second!: () => void;
  const holds = [new Promise<void>((resolve) => { first = resolve; }), new Promise<void>((resolve) => { second = resolve; })];
  const requests: { body: any; key: string }[] = [];
  let active = 0, peak = 0;
  await page.route(`**/api/v1/me/tasks/${fixture.taskId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const body = route.request().postDataJSON();
    requests.push({ body, key: route.request().headers()['idempotency-key'] });
    active++; peak = Math.max(peak, active);
    await holds[requests.length - 1];
    active--;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: body.expectedRevision + 1, savedAt: new Date().toISOString() }) });
  });
  const current = `${fixture.base}/tasks/${fixture.taskId}`;
  await page.goto(current);
  const title = page.getByRole('textbox', { name: /^Title/ });
  await title.fill('First snapshot');
  await expect.poll(() => requests.length).toBe(1);
  await title.fill('Latest edit made during save');
  await page.locator('a[data-save-before-leaving]').click();
  await page.waitForTimeout(2000); // Exceeds the public 1.5 s debounce while the first request is held.
  expect(requests).toHaveLength(1);
  await expect(page).toHaveURL(current);
  first();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.map((r) => r.body.expectedRevision)).toEqual([0, 1]);
  expect(requests[0].body.output.header.title).toBe('First snapshot');
  expect(requests[1].body.output.header.title).toBe('Latest edit made during save');
  expect(new Set(requests.map((r) => r.key)).size).toBe(2);
  expect(peak).toBe(1);
  await expect(page).toHaveURL(current);
  second();
  await expect(page).toHaveURL(`${fixture.base}/projects/${fixture.projectId}`);
});

for (const invalidAck of [false, true]) {
  test(`#121: ${invalidAck ? 'invalid save acknowledgement' : 'revision conflict'} retains edits and blocks back navigation`, async ({ page }) => {
    const fixture = await workbench(page);
    await page.route(`**/api/v1/me/tasks/${fixture.taskId}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ status: invalidAck ? 200 : 409, contentType: 'application/json', body: JSON.stringify(invalidAck ? { revision: 99, savedAt: new Date().toISOString() } : { error: 'STALE_REVISION', message: 'The task changed. Reload before saving.' }) });
    });
    const current = `${fixture.base}/tasks/${fixture.taskId}`;
    await page.goto(current);
    const title = page.getByRole('textbox', { name: /^Title/ });
    await title.fill('Keep these unsaved edits');
    await page.locator('a[data-save-before-leaving]').click();
    await expect(page.getByText(invalidAck ? 'Save confirmation could not be verified. Reload before continuing.' : 'The task changed. Reload before saving.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(current);
    await expect(title).toHaveValue('Keep these unsaved edits');
  });
}
