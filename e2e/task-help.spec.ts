import { expect, test } from '@playwright/test';
import { base, fixture, gatedBackend } from './authoring-fixtures';

/**
 * D15 (16 Nov 2026): asking Help on a KYC task crashed the whole page when the answer arrived ("destroy is not a
 * function": the drawer's scroll effect returned scrollIntoView's Promise). Help must answer in the drawer and the task
 * form must keep working. The Help answer is real (the local assistant, no model); the gated calls are served in-test.
 */
test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');

test('Help answers a question and the task page keeps working (D15)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { taskId } = await fixture(page, 'KYC onboarding and refresh');
  await gatedBackend(page, taskId);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/tasks/${taskId}?editor=form`);
  await expect(page.getByRole('button', { name: 'Classic' })).toBeVisible();

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const drawer = page.locator('[data-task-help]');
  await expect(drawer).toBeVisible();
  await page.getByLabel('Your question about this task').fill('What goes in S1?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(drawer.getByText('Looking at this task…')).toHaveCount(0, { timeout: 20_000 });
  await expect(drawer.locator('.whitespace-pre-wrap')).toHaveCount(2);
  // A second question after the first answer (the step that crashed): still answered, nothing thrown.
  await page.getByLabel('Your question about this task').fill('How do I submit?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(drawer.locator('.whitespace-pre-wrap')).toHaveCount(4, { timeout: 20_000 });
  await expect(page.getByText('Application error')).toHaveCount(0);
  await expect(drawer.locator('[data-help-failed]')).toHaveCount(0);
  expect(errors).toEqual([]);

  // Close Help: the task page is still there and usable; the mascot is back.
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Classic' })).toBeVisible();
});
