import { expect, test, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Multi-select validation in the project's task table (owner, 21 Nov 2026). The project, its two approved tasks and the
 * PM are real (scripts/e2e-forge-validate.ts, in their own client with the new flow on). RL Gym is mocked: the browser's
 * Validate and Export calls are answered here with an RL Gym-style verdict, so nothing reaches a live service.
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

/** RL Gym's verdict for the records sent: the first is not validated (RL Gym's own work), the rest are valid. */
function rlGymRun(projectId: string, kind: 'VALIDATE' | 'EXPORT', records: { recordId: string; taskId: string; title: string }[]) {
  const results = records.map((r, i) =>
    i === 0
      ? { ...r, status: 'not_validated', issues: [{ code: 'AV_TEMPLATE_NOT_QUALIFIED', path: null, message: 'RL Gym’s own work (not a task repair), blocked; the source is checked separately. (RL Gym request req-e2e-1)' }] }
      : { ...r, status: 'valid', issues: [] },
  );
  const part = { partIndex: 1, partCount: 1, packageId: 'pkg-e2e', packageSha256: 'a'.repeat(64), zipSha256: 'b'.repeat(64), bytes: 1024, recordIds: records.map((r) => r.recordId), validate: { kind: 'business', httpStatus: 409, status: 'validation_blocked', valid: null, errorCount: 0, requestId: 'req-e2e-1', anvilPackageSha256: null }, resolve: null };
  const anvil = { contract: 'praxis.authored-task-export.v1', support: 'enabled', batchId: 'batch-e2e', parts: [part], problems: [] };
  return { id: randomUUID(), projectId, kind, validator: 'anvil-discovery+praxis-precheck', validatorVersion: 'mock', results, counts: { valid: results.length - 1, needsFix: 0, notValidated: 1 }, requestedById: randomUUID(), createdAt: new Date().toISOString(), downloadPath: null, anvil };
}

async function signIn(page: Page, f: Fixture) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(f.pm.email);
  await page.getByLabel('Password').fill(f.pm.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
}

test('select approved tasks, validate them in one call, see one result line per task; Export ignores the selection', async ({ page }) => {
  test.skip(!!process.env.E2E_WEB_URL, 'isolated local fixture only');
  test.setTimeout(180_000);
  const f = fixture();
  await signIn(page, f);
  const approved = (await (await page.request.get(`${WEB}/api/v1/projects/${f.projectId}/export`)).json()).tasks as { recordId: string; taskId: string; title: string }[];
  expect(approved).toHaveLength(2);

  const sent: { path: string; body: unknown }[] = [];
  const answer = (kind: 'VALIDATE' | 'EXPORT') => async (route: Route) => {
    const body = route.request().postDataJSON();
    sent.push({ path: new URL(route.request().url()).pathname, body });
    const ids: string[] = kind === 'EXPORT' ? approved.map((t) => t.recordId) : body.recordIds;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rlGymRun(f.projectId, kind, ids.map((id) => approved.find((t) => t.recordId === id)!))) });
  };
  await page.route(`**/api/v1/projects/${f.projectId}/validate`, answer('VALIDATE'));
  await page.route(`**/api/v1/projects/${f.projectId}/exports`, answer('EXPORT'));

  await page.goto(`${WEB}/projects/${f.projectId}?tab=tasks`);
  await page.waitForLoadState('networkidle');
  const tasks = page.getByRole('region', { name: 'Tasks' });
  const all = tasks.getByRole('checkbox', { name: 'Select all approved tasks for validation' });
  const one = tasks.getByRole('checkbox', { name: 'Select TSK-001 for validation' });
  const two = tasks.getByRole('checkbox', { name: 'Select TSK-002 for validation' });
  const validate = tasks.getByRole('button', { name: 'Validate', exact: true });
  await expect(validate).toBeDisabled();

  // Select-all ticks both approved tasks; Validate sends both in one call.
  await all.check();
  await expect(one).toBeChecked();
  await expect(two).toBeChecked();
  await expect(tasks.getByText('2 selected')).toBeVisible();
  await validate.click();
  const results = tasks.getByRole('list', { name: 'Result per task' });
  await expect(results.getByRole('listitem').filter({ has: page.getByRole('link') })).toHaveCount(2);
  expect(sent).toEqual([{ path: `/api/v1/projects/${f.projectId}/validate`, body: { recordIds: approved.map((t) => t.recordId) } }]);
  // RL Gym's code and request id are shown on the task's line.
  const first = results.locator(`[data-result="${approved[0]!.recordId}"]`);
  await expect(first).toContainText('not validated');
  await expect(first).toContainText('AV_TEMPLATE_NOT_QUALIFIED');
  await expect(first).toContainText('RL Gym request req-e2e-1');
  await expect(first).toContainText('(RL Gym validation_blocked, request req-e2e-1');
  await expect(tasks.getByText('RL Gym contract praxis.authored-task-export.v1: enabled.')).toBeVisible();
  await expect(results.locator(`[data-result="${approved[1]!.recordId}"]`)).toContainText('— valid');

  // Clearing select-all and picking one task validates just that task.
  await all.uncheck();
  await expect(one).not.toBeChecked();
  await two.check();
  await expect(all).not.toBeChecked();
  expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  await validate.click();
  await expect(results.getByRole('listitem').filter({ has: page.getByRole('link') })).toHaveCount(1);
  expect(sent[1]).toEqual({ path: `/api/v1/projects/${f.projectId}/validate`, body: { recordIds: [approved[1]!.recordId] } });

  // Export always covers every approved task: its body is empty whatever is selected.
  await page.getByRole('button', { name: 'Export to RL Gym' }).click();
  await expect(tasks.getByText(/^Last export/)).toBeVisible();
  expect(sent[2]).toEqual({ path: `/api/v1/projects/${f.projectId}/exports`, body: {} });
  await expect(results.getByRole('listitem').filter({ has: page.getByRole('link') })).toHaveCount(2);
});
