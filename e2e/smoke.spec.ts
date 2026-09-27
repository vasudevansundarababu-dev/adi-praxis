import { expect, test } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3300';
const CANDIDATE = process.env.E2E_CANDIDATE_URL ?? 'http://localhost:3301';
const EXTERNAL = !!process.env.E2E_WEB_URL;
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.local', password: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password' };
const PM = { email: process.env.E2E_PM_EMAIL ?? 'pm@e2e.local', password: process.env.E2E_PM_PASSWORD ?? 'e2e-pm-password' };

test.describe('console smoke', () => {
  test('an Admin signs in and sees the console for their role', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await expect(page).toHaveTitle(/ADI Praxis/);
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Templates' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    await nav.getByRole('link', { name: 'Templates' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/templates/i);
  });

  test('a PM does not see Admin areas, and a wrong password is refused', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.getByLabel('Email').fill(PM.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('Password').fill(PM.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  });
});

test.describe('candidate smoke', () => {
  test('the sign-in page offers Google sign-in and never the local mock in a deployed environment', async ({ page }) => {
    test.skip(!EXTERNAL, 'deployed environments only');
    await page.goto(`${CANDIDATE}/sign-in`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to ADI Praxis');
    await expect(page.getByText('Dev sign-in (mock Google)')).toHaveCount(0);
  });

  test('a new candidate signs in with the dev mock, is asked to verify identity, and can reach home', async ({ page }) => {
    test.skip(EXTERNAL, 'the mock sign-in exists only in local development');
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
