import { expect, test } from '@playwright/test';
import { base, fixture, gatedBackend } from './authoring-fixtures';

/**
 * Authoring v2.1 Wave 1, per template: the workflow graph below both editors on one task.
 * Classic starts from the template workflow and edits a node; the edit is saved; Chatbot shows the same graph;
 * the graph reflows to a list at narrow widths with no horizontal page scroll.
 *
 * UI fixture: the task read is real. The calls behind the staffing gate (identity, selection, onboarding) are served
 * by a small in-test backend, as in tester-workbench.spec.ts: saves, the workspace preference and the consent state.
 * Persistence, checks, the agent view and export are covered against the real database in the API suites.
 */
test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');

// The seeded catalogue keeps the old lineage name `Fraud–risk/compliance handoffs` (en dash); the fixture looks it up
// exactly, while profile and graph lookups ignore dash style.
const TEMPLATES = ['KYC onboarding and refresh', 'KYB and beneficial ownership', 'AML transaction-monitoring alerts', 'Omnichannel Creative & Locale Compliance', 'Launch of Noise Cancelling Phone', 'Adverse media review', 'Enhanced due diligence', 'Customer risk rating', 'Q4 Global Paid Search Query Clustering', 'Fraud–risk/compliance handoffs', 'Compliance monitoring'];
for (const workflow of TEMPLATES) {
  test(`Template ${workflow}: one workflow graph below Classic and Chatbot`, async ({ page }) => {
    const { taskId } = await fixture(page, workflow);
    const saved = await gatedBackend(page, taskId);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/tasks/${taskId}?editor=form`);
    await expect(page.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-pressed', 'true');
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

    // The switch saved the graph and the edit through the editor's autosave. (The task page is server-rendered, so a
    // reload reads the real API, which this fixture cannot write to; reload persistence is covered in the API suites.)
    expect(JSON.stringify(saved.output)).toContain('Review the case evidence');
    expect((saved.output as { workflowGraph?: { schemaVersion?: string } }).workflowGraph?.schemaVersion).toBe('praxis.workflow_graph.v1-proposed');

    // Narrow widths: the same connections as a list, no horizontal page scroll.
    for (const width of [736, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 736) await expect(page.getByTestId('workflow-graph-list')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    }

  });
}
