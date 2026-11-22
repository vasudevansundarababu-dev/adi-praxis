import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * New RL Gym part 2 (22 Nov 2026): the project's Tasks tab has no Validate controls any more, and its Export for
 * benchmark panel says RL Gym isn't connected when the API has no RL Gym settings (the e2e environment, like QA today).
 * The project, its two approved tasks and the PM are real (scripts/e2e-forge-validate.ts, own client, new flow on).
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3300';

interface Fixture {
  projectId: string;
  pm: { email: string; password: string };
}

function fixture(): Fixture {
  const out = execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-forge-validate.ts'], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!) as Fixture;
}

async function signIn(page: Page, f: Fixture) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(f.pm.email);
  await page.getByLabel('Password').fill(f.pm.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
}

test('Tasks tab: no Validate controls; Export for benchmark is off and says RL Gym isn’t connected; nothing is sent', async ({ page }) => {
  test.skip(!!process.env.E2E_WEB_URL, 'isolated local fixture only');
  test.setTimeout(180_000);
  const f = fixture();
  await signIn(page, f);
  const state = await (await page.request.get(`${WEB}/api/v1/projects/${f.projectId}/export`)).json();
  expect(state).toMatchObject({ connected: false, canExport: false, exported: false });
  expect(state.tasks).toHaveLength(2);

  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(exports|validate)$/.test(new URL(r.url()).pathname)) posts.push(r.url());
  });
  await page.goto(`${WEB}/projects/${f.projectId}?tab=tasks`);
  await page.waitForLoadState('networkidle');
  const tasks = page.getByRole('region', { name: 'Tasks' });
  await expect(tasks.getByRole('checkbox')).toHaveCount(0);
  await expect(tasks.getByRole('button', { name: 'Validate', exact: true })).toHaveCount(0);
  await expect(tasks.getByText('RL Gym isn’t connected yet, so export is off.')).toBeVisible();
  await expect(tasks.getByRole('button', { name: 'Export for benchmark' })).toBeDisabled();
  expect(posts).toEqual([]);
});
