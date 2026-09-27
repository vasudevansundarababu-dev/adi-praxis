import { expect, test } from '@playwright/test';

const WEB = 'http://localhost:3300';
const CANDIDATE = 'http://localhost:3301';

test.describe('console smoke', () => {
  test('an Admin signs in and sees the console for their role', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await expect(page).toHaveTitle(/ADI Praxis/);
    await page.getByLabel('Email').fill('admin@e2e.local');
    await page.getByLabel('Password').fill('e2e-admin-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Templates' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    await nav.getByRole('link', { name: 'Templates' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/templates/i);
  });

  test('a PM does not see Admin areas, and a wrong password is refused', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.getByLabel('Email').fill('pm@e2e.local');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill('e2e-pm-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });
});

test.describe('candidate smoke', () => {
  test('a new candidate signs in with the dev mock, is asked to verify identity, and can reach home', async ({ page }) => {
    await page.goto(`${CANDIDATE}/sign-in?returnTo=/home`);
    await page.locator('#dev-email').fill(`smoke.${Date.now()}@example.test`);
    await page.locator('#dev-name').fill('Smoke Tester');
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /continue with google \(mock\)/i }).click();
    // Unverified candidates are sent to identity verification first (FLOW2 C02).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verify your identity');
    await expect(page.getByRole('button', { name: 'Start verification' })).toBeVisible();
    await page.goto(`${CANDIDATE}/home`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome, Smoke Tester');
    await expect(page.getByText('Identity not verified yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Verify your identity' })).toBeVisible();
  });
});
