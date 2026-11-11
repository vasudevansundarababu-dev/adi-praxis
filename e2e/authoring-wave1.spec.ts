import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Authoring v2.1 Wave 1, per template: the workflow graph below both editors on one task.
 * Classic starts from the template workflow and edits a node; Chatbot shows the same graph; reload keeps it;
 * the graph reflows to a list at narrow widths with no horizontal page scroll; the agent view hides private material.
 */
test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');

const TEMPLATES = ['KYC onboarding and refresh', 'KYB and beneficial ownership', 'AML transaction-monitoring alerts', 'Omnichannel Creative & Locale Compliance', 'Launch of Noise Cancelling Phone'];
const base = 'http://localhost:3301';

async function fixture(page: Page, workflow: string) {
  const token = await (await page.request.post(base + '/api/v1/auth/dev/google-token', { data: { email: `wave1.${randomUUID()}@example.test`, name: 'Wave 1 fixture' } })).json();
  const signed = await (await page.request.post(base + '/api/v1/auth/google', { data: { credential: token.credential, adultAttested: true } })).json();
  return JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'wave1', signed.id, workflow], { encoding: 'utf8' }).trim().split('\n').pop()!) as { taskId: string };
}

async function acceptConsent(page: Page) {
  const accept = page.getByRole('button', { name: /accept|agree|continue/i }).first();
  if (await accept.isVisible().catch(() => false)) {
    const box = page.getByRole('checkbox').first();
    if (await box.isVisible().catch(() => false)) await box.check();
    await accept.click();
  }
}

for (const workflow of TEMPLATES) {
  test(`Wave 1 · ${workflow}: one workflow graph below Classic and Chatbot`, async ({ page }) => {
    const { taskId } = await fixture(page, workflow);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/tasks/${taskId}?editor=form`);
    await acceptConsent(page);
    await page.getByRole('button', { name: 'Classic' }).click();
    await expect(page.getByText(/Single agent/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Start from the template workflow' }).click();
    const graph = page.getByTestId('workflow-graph');
    await expect(graph).toBeVisible();
    await expect(page.getByText('Passes every workflow check')).toBeVisible();
    const nodes = await graph.locator('[data-node]').count();
    expect(nodes).toBeGreaterThanOrEqual(7);

    // Edit a node above the graph in Classic.
    await graph.locator('[data-node="review"]').click();
    const name = page.getByRole('textbox', { name: 'Name' });
    await name.fill('Review the case evidence');
    await expect(graph.getByText('Review the case evidence')).toBeVisible();

    // Switching to Chatbot saves first and shows the same graph, read-only.
    await page.getByRole('button', { name: 'Chatbot' }).click();
    await expect(page.getByTestId('workflow-graph').locator('[data-node]')).toHaveCount(nodes);
    await expect(page.getByTestId('workflow-graph').getByText('Review the case evidence')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start from the template workflow' })).toHaveCount(0);

    // Reload keeps the graph and the edit.
    await page.reload();
    await expect(page.getByTestId('workflow-graph').getByText('Review the case evidence')).toBeVisible();

    // Narrow widths: the same connections as a list, no horizontal page scroll.
    for (const width of [736, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 736) await expect(page.getByTestId('workflow-graph-list')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    }

    // The agent view carries the projected graph only.
    const preview = await (await page.request.get(`${base}/api/v1/me/tasks/${taskId}/agent-preview`)).json();
    expect(preview.task.workflowGraph.nodes).toHaveLength(nodes);
    expect(JSON.stringify(preview)).not.toContain('findings.sufficient');
  });
}
