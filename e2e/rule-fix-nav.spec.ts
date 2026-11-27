import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * Owner, 27 Nov 2026: the rule page takes the reviewer straight to the field to fix. "To fix" lists every problem as a
 * link; each link opens the field's section, scrolls to it, focuses it and outlines it in amber with a hint under it;
 * the hint goes away once the field is filled in; "Next problem" walks the list; a rule with nothing left reads "Ready
 * to approve". Fixture: a policy-library project in its own client (scripts/e2e-policy-library.ts). Nothing is saved.
 * SHOT_DIR=<folder> also saves screenshots of the rule page.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3300';
test.skip(!!process.env.E2E_WEB_URL, 'Runs against the local e2e servers only (it builds its own fixture)');

const shot = async (page: Page, name: string) => {
  if (!process.env.SHOT_DIR) return;
  mkdirSync(process.env.SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: false });
};

test('the rule page lists what to fix, takes you to each field, and says when the rule is ready', async ({ page }) => {
  test.setTimeout(180_000);
  const out = execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-policy-library.ts'], { encoding: 'utf8' }).trim().split('\n').pop()!;
  const fx = JSON.parse(out) as { projectId: string; flaggedRuleId: string; readyRuleId: string; pm: { email: string; password: string } };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(fx.pm.email);
  await page.getByLabel('Password').fill(fx.pm.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

  await page.goto(`${WEB}/projects/${fx.projectId}/policy/rules/${fx.flaggedRuleId}`);
  const list = page.locator('[data-fix-list]');
  await expect(list).toBeVisible({ timeout: 30_000 });
  await shot(page, 'after-1-to-fix-list');
  const links = list.locator('[data-fix-link]');
  const fields = await links.evaluateAll((as) => as.map((a) => a.getAttribute('data-fix-link')!));
  // The fixture rule: no condition, issuer, jurisdiction and process missing, no in-force date.
  for (const f of ['condition', 'issuer', 'jurisdiction', 'process', 'effective']) expect(fields, f).toContain(f);

  // Every link lands on its field: the field is on screen and has the focus (or holds it).
  for (let i = 0; i < fields.length; i++) {
    const href = await links.nth(i).getAttribute('href');
    await links.nth(i).click();
    const target = page.locator(href!);
    await expect(target, href!).toBeInViewport({ timeout: 10_000 });
    await expect.poll(() => page.evaluate((id) => { const el = document.getElementById(id); return !!el && (el === document.activeElement || el.contains(document.activeElement)); }, href!.slice(1)), { timeout: 5_000, message: href! }).toBe(true);
    if (href === '#lib-jurisdiction') await shot(page, 'after-2-jurisdiction-highlighted');
  }

  // The amber outline and the hint sit at the field; the hint goes away as soon as the field is filled in.
  const jurisdiction = page.locator('#lib-jurisdiction');
  await expect(jurisdiction).toHaveClass(/outline-warning/);
  await expect(page.locator('[data-fix-hint="jurisdiction"]')).toContainText('Enter US for federal or bank rules, or US-CA for California.');
  await jurisdiction.fill('US');
  await expect(page.locator('[data-fix-hint="jurisdiction"]')).toHaveCount(0);
  await expect(jurisdiction).not.toHaveClass(/outline-warning/);

  // "Next problem" goes to the first problem, then the next.
  await page.evaluate(() => window.scrollTo(0, 0));
  const next = page.locator('[data-next-problem="open"]');
  await expect(next).toBeVisible();
  await next.getByRole('button', { name: 'Next problem' }).click();
  await expect(page.locator(`#lib-issuer`)).toBeInViewport();
  await next.getByRole('button', { name: 'Next problem' }).click();
  await expect(next).toContainText('(3 of');
  await shot(page, 'after-3-next-problem');

  // A rule with nothing left: "Ready to approve", with the way to approve it in view.
  await page.goto(`${WEB}/projects/${fx.projectId}/policy/rules/${fx.readyRuleId}`);
  const ready = page.locator('[data-next-problem="ready"]');
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await expect(ready).toContainText('Ready to approve');
  await expect(ready.getByRole('link', { name: 'Approve in the review queue' })).toBeInViewport();
  await expect(page.locator('[data-fix-list]')).toHaveCount(0);
  await shot(page, 'after-4-ready');
});
