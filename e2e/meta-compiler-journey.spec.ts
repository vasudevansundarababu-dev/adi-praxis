import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Q2: Screen 1 → 2 → 3 → 4 → review → approved, locally with the mock drafter, mock runner and mock Google sign-in.
 * The one-step test setup (S4-14) provides the synthetic template, project, test SME and separate Reviewer; every
 * step after that goes through the UI.
 */
test.skip(!!process.env.E2E_WEB_URL, 'mock drafter, runner and sign-in exist only in local runs');

const WEB = 'http://localhost:3300';
const CANDIDATE = 'http://localhost:3301';
const ADMIN = { email: 'admin@e2e.local', password: 'e2e-admin-password' };
const WORKFLOW = 'Synthetic studio test workflow';

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test('an Admin takes a template from the directory to a deployed studio; the SME commits a task; a separate Reviewer approves it', async ({ browser }) => {
  test.setTimeout(240_000);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, ADMIN.email, ADMIN.password);
  await expect(admin.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
  const setup = await admin.request.post(`${WEB}/api/v1/test-setup/meta-compiler`, { data: {}, headers: { 'idempotency-key': randomUUID() } });
  expect(setup.ok(), await setup.text()).toBeTruthy();
  const s = await setup.json();

  // Screen 1: the directory lists the workflow; its name opens the Meta-Compiler.
  await admin.goto(`${WEB}/templates`);
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Harbor Templates Directory', { timeout: 30_000 });
  await expect(admin.getByRole('button', { name: /new template/i })).toHaveCount(0);
  await expect(admin.getByRole('link', { name: /new template/i })).toHaveCount(0);
  const row = admin.getByRole('row').filter({ has: admin.getByRole('link', { name: WORKFLOW, exact: true }) });
  await expect(row.getByText('Active')).toBeVisible();
  await expect(row.getByRole('cell', { name: `v${s.templateVersion}`, exact: true })).toBeVisible(); // S1-06
  await row.getByRole('link', { name: WORKFLOW, exact: true }).click();

  // Screen 2 (S1-05): the workflow name opened this template; all six sections valid, so Generate → links to Screen 3.
  await expect(admin).toHaveURL(new RegExp(`/templates/${s.templateId}$`), { timeout: 30_000 });
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText(WORKFLOW, { timeout: 30_000 });
  await expect(admin.getByRole('toolbar', { name: 'Meta-Compiler actions' })).toBeVisible();
  await admin.getByRole('link', { name: 'Generate →' }).click();

  // Screen 3: generate (mock drafter), verify (mock runner: 0.00 / 1.00), deploy to the test project and SME.
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Generate, verify and deploy', { timeout: 30_000 });
  await expect(admin.getByText('Live AI is off here')).toBeVisible();
  await admin.getByRole('button', { name: /^Generate( again)?$/ }).click();
  await expect(admin.getByRole('progressbar', { name: 'UI compilation' })).toHaveAttribute('aria-valuenow', '100', { timeout: 60_000 });
  await admin.getByRole('button', { name: /^Run checks( again)?$/ }).click();
  await expect(admin.getByText('Gates passed')).toBeVisible({ timeout: 90_000 });
  await admin.getByRole('combobox', { name: 'Project' }).selectOption({ label: `${s.projectName} (v${s.templateVersion})` });
  await admin.getByRole('combobox', { name: 'Assigned SME' }).selectOption(s.sme.candidateId);
  await admin.getByRole('button', { name: 'Deploy studio' }).click();
  const deployed = admin.getByTestId('deployed');
  await expect(deployed).toContainText('Studio deployed');
  await expect(deployed.locator('code')).toHaveText(s.studioUrl);

  // Back on Screen 1 the deployment shows its SME studio link.
  await admin.goto(`${WEB}/templates`);
  await expect(row.getByRole('link', { name: /SME UI/ })).toHaveAttribute('href', s.studioUrl);

  // Screen 4: the assigned SME signs in (mock Google), authors and commits a task.
  const smeCtx = await browser.newContext();
  const sme = await smeCtx.newPage();
  const token = await (await sme.request.post(`${CANDIDATE}/api/v1/auth/dev/google-token`, { data: { email: s.sme.email, name: 'Test SME' } })).json();
  expect((await sme.request.post(`${CANDIDATE}/api/v1/auth/google`, { data: { credential: token.credential, adultAttested: true } })).ok()).toBeTruthy();
  await sme.goto(`${CANDIDATE}/studio/${s.studioKey}`);
  await sme.waitForLoadState('networkidle'); // let the studio hydrate before typing into it
  await expect(sme.getByRole('heading', { level: 1 })).toHaveText(WORKFLOW, { timeout: 30_000 });
  const steps = sme.getByRole('navigation', { name: 'Authoring steps' });
  await expect(steps.getByRole('button')).toHaveCount(6);
  const title = `Synthetic journey task ${randomUUID().slice(0, 8)}`;
  await sme.getByRole('textbox', { name: /Task title \/ scenario name/ }).fill(title);
  await expect(sme.getByText('Task title is required')).toHaveCount(0);
  await steps.getByRole('button', { name: /Data & Oracle Labelling/ }).click();
  const tag = sme.getByRole('combobox', { name: /^Tag for / }).first();
  await tag.selectOption({ index: 1 });
  await expect(steps.getByRole('button', { name: /Data & Oracle Labelling/ })).toContainText('Complete');
  await steps.getByRole('button', { name: /Final Confirmation/ }).click();
  await sme.getByRole('checkbox', { name: /only synthetic data/ }).check();
  await sme.getByRole('button', { name: 'Save & Commit' }).click();
  await expect(sme.getByTestId('submitted')).toContainText('Submitted for review', { timeout: 30_000 });

  // Review: the separate test Reviewer (not the Admin) accepts it; the task reaches the Approved Task Dataset.
  const revCtx = await browser.newContext();
  const rev = await revCtx.newPage();
  const password = `journey-reviewer-${randomUUID().slice(0, 8)}`;
  if (s.reviewer.temporaryPassword) {
    await signIn(rev, s.reviewer.email, s.reviewer.temporaryPassword);
    await expect(rev.getByRole('heading', { name: 'Choose your own password' })).toBeVisible({ timeout: 30_000 });
    await rev.getByLabel('Current or temporary password').fill(s.reviewer.temporaryPassword);
    await rev.getByLabel('New password', { exact: false }).first().fill(password);
    await rev.getByLabel('Confirm new password').fill(password);
    await rev.getByRole('button', { name: 'Save new password' }).click();
    await expect(rev).not.toHaveURL(/change-password/, { timeout: 30_000 });
  } else {
    test.skip(true, 'the Reviewer already exists from an earlier run; run against a freshly prepared e2e database');
  }
  await rev.goto(`${WEB}/review/tasks`);
  // The queue labels a task by its slot brief, not the SME's title; this project has exactly one submitted task.
  const item = rev.getByRole('listitem').filter({ hasText: `${s.projectName} · ${WORKFLOW}` });
  await expect(item).toHaveCount(1);
  await item.getByRole('link').click();
  await expect(rev.getByText(title).first()).toBeVisible();
  const decision = rev.getByRole('complementary', { name: 'Decision' });
  for (const group of await decision.getByRole('radiogroup').all()) await group.getByLabel('Yes').check();
  await decision.getByLabel('Accept', { exact: true }).check();
  await decision.getByRole('button', { name: 'Record decision' }).click();
  await expect(decision.getByRole('button', { name: 'Record decision' })).toHaveCount(0, { timeout: 30_000 });

  // The SME sees the outcome in their own task list.
  await sme.goto(`${CANDIDATE}/studio/${s.studioKey}`);
  await expect(sme.getByRole('region', { name: 'Your committed tasks' }).getByRole('listitem').filter({ hasText: title })).toContainText('Accepted');
  await Promise.all([adminCtx.close(), smeCtx.close(), revCtx.close()]);
});

test('the workflow name opens Screen 2 and Back keeps the filter; Save Variant copies it; Reset to factory restores it (S1-05, S2-12, S2-13)', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
  await page.goto(`${WEB}/templates`);
  // S1-05: the name opens Screen 2 for that template; Back returns to the directory with the filter kept.
  await page.getByRole('navigation', { name: 'Filter by domain' }).getByRole('link', { name: /^Digital Marketing/ }).click();
  await expect(page).toHaveURL(/\?domain=/, { timeout: 30_000 });
  const filtered = page.url();
  await page.getByRole('link', { name: 'Launch of Noise Cancelling Phone', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch of Noise Cancelling Phone', { timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(filtered, { timeout: 30_000 });
  await expect(page.getByRole('region', { name: /^Banking/ })).toHaveCount(0);
  await page.goForward();
  await page.getByRole('toolbar', { name: 'Meta-Compiler actions' }).getByRole('button', { name: 'Save Variant' }).click();
  const label = `Journey variant ${randomUUID().slice(0, 6)}`;
  await page.getByRole('textbox', { name: 'Variant label' }).fill(label);
  await page.getByRole('dialog').getByRole('button', { name: 'Save Variant' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(label), { timeout: 30_000 });

  const stage1 = () => page.getByRole('tab', { name: /^Domain, Persona & Horizon/ }).click();
  await stage1();
  const title = page.getByRole('textbox', { name: 'Display title' });
  const original = await title.inputValue();
  await title.fill('Changed by the journey test');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  await page.reload();
  await stage1();
  await expect(title).toHaveValue('Changed by the journey test');

  await page.getByRole('button', { name: 'Reset to factory' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Factory blueprint loaded. Save to keep it.')).toBeVisible();
  await expect(title).toHaveValue(original);
});

test('a PM sees published workflows read-only: no Meta-Compiler, no Screen 3, no Tasks DB, no SME details (S1-15)', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'pm@e2e.local', 'e2e-pm-password');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
  await page.goto(`${WEB}/templates`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Templates Directory', { timeout: 30_000 });
  await expect(page.getByRole('columnheader', { name: 'Project & Assigned SME' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /SME UI/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tasks DB & JSON' })).toHaveCount(0);
  await expect(page.getByText(/Draft/)).toHaveCount(0);
  await page.getByRole('link', { name: 'Launch of Noise Cancelling Phone', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch of Noise Cancelling Phone', { timeout: 30_000 });
  await expect(page.getByRole('toolbar', { name: 'Meta-Compiler actions' })).toHaveCount(0);
  const id = page.url().split('/').pop();
  for (const path of [`/templates/${id}/generate`, '/templates/tasks']) {
    const res = await page.goto(`${WEB}${path}`);
    expect(res?.status(), path).toBe(404);
  }
  for (const path of [`/templates/${id}/uispec`, `/templates/${id}/deployments`, '/studio-tasks']) {
    expect((await page.request.get(`${WEB}/api/v1${path}`)).status(), path).toBe(403);
  }
  const setup = await page.request.post(`${WEB}/api/v1/test-setup/meta-compiler`, { data: {}, headers: { 'idempotency-key': randomUUID() } });
  expect(setup.status()).toBe(403);
});
