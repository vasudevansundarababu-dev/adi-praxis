import { expect, test } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3300';
const CANDIDATE = process.env.E2E_CANDIDATE_URL ?? 'http://localhost:3301';
const EXTERNAL = !!process.env.E2E_WEB_URL;
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.local', password: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password' };
const PM = { email: process.env.E2E_PM_EMAIL ?? 'pm@e2e.local', password: process.env.E2E_PM_PASSWORD ?? 'e2e-pm-password' };

test.describe('console smoke', () => {
  test('an Admin signs in and sees the console for their role', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.waitForLoadState('networkidle'); // let the form hydrate before submitting it
    await expect(page).toHaveTitle(/ADI Praxis/);
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Two-level menu: groups on the top row, the chosen group's pages on the second row.
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });
    await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();
    await nav.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('navigation', { name: 'Projects pages' }).getByRole('link', { name: 'Templates' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/templates/i);
    await expect(nav.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'true');
  });

  test('the Support Bot explains the screen, including which fields are required', async ({ page }) => {
    test.skip(EXTERNAL, 'the local mock assistant answers only in local runs');
    await page.goto(`${WEB}/login`);
    await page.waitForLoadState('networkidle'); // let the form hydrate before submitting it
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
    await page.goto(`${WEB}/users`);
    // In the dev server a page compiled for another test can force a full reload; ask once the page has settled.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Help' }).click();
    const panel = page.getByRole('dialog', { name: 'Support Bot' });
    await panel.getByRole('button', { name: 'What do I need to fill in on this screen?' }).click();
    await expect(panel.getByText(/Local assistant/)).toBeVisible({ timeout: 30_000 });
    await panel.getByLabel('Your question').fill('Which roles exist?');
    await panel.getByRole('button', { name: 'Ask' }).click();
    await expect(panel.getByText(/ROLES\./)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('a PM does not see Admin areas, and a wrong password is refused', async ({ page }) => {
    await page.goto(`${WEB}/login`);
    await page.waitForLoadState('networkidle'); // let the form hydrate before submitting it
    await page.getByLabel('Email').fill(PM.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('form').getByRole('alert')).toBeVisible(); // the form's error, not Next's route announcer
    await page.getByLabel('Password').fill(PM.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome, Smoke');
    await expect(page.getByText('Identity not verified yet')).toBeVisible();
    await expect(page.getByRole('link', { name: /Verify now/ })).toBeVisible();
  });
});

test.describe('tutorials', () => {
  test('a signed-in PM opens Tutorials: their video first, every video and the guide play, and the files need a sign-in', async ({ page, request }) => {
    const anonymous = await request.get(`${WEB}/tutorials/files/01-getting-started.mp4`);
    expect(anonymous.status()).toBe(401);
    await page.goto(`${WEB}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(PM.email);
    await page.getByLabel('Password').fill(PM.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tutorials' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tutorials and user guide');
    const mine = page.getByRole('region', { name: 'Videos for your role' });
    await expect(mine.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    await expect(mine.getByRole('heading', { name: 'Program Manager' })).toBeVisible();
    await expect(page.locator('video')).toHaveCount(7);
    // Range requests let the video seek; the guide opens as a PDF.
    const part = await page.request.get(`${WEB}/tutorials/files/03-program-manager.mp4`, { headers: { range: 'bytes=0-1023' } });
    expect(part.status()).toBe(206);
    expect(part.headers()['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
    expect((await part.body()).length).toBe(1024);
    const pdf = await page.request.get(`${WEB}${await page.getByRole('link', { name: 'Open the guide' }).getAttribute('href')}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await page.request.get(`${WEB}/tutorials/files/../../package.json`)).status()).not.toBe(200);
  });

  test('the candidate app has a public Tutorials page with the expert video and guide', async ({ page }) => {
    await page.goto(`${CANDIDATE}/opportunities`);
    await page.getByRole('link', { name: 'Tutorials' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tutorials');
    await expect(page.locator('video')).toHaveCount(1);
    const video = await page.request.get(`${CANDIDATE}${await page.locator('video').getAttribute('src')}`, { headers: { range: 'bytes=0-99' } });
    expect([200, 206]).toContain(video.status());
    const pdf = await page.request.get(`${CANDIDATE}${await page.getByRole('link', { name: 'Open the guide' }).getAttribute('href')}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
  });
});
