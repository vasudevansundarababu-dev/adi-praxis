import { expect, test } from '@playwright/test';
import { base, fixture, gatedBackend } from './authoring-fixtures';

/**
 * Authoring v2.1 Wave 2: building the workflow in Classic. From the template workflow the SME adds a decision, a
 * person in the case, a step that runs alongside (with a join) and a bounded correction loop; the workflow still
 * passes every check, the change is saved, and Chatbot shows the same graph.
 */
test.skip(!!process.env.E2E_WEB_URL, 'isolated UI fixture; never production');

test('Wave 2 · build the workflow in Classic: decision, person step, parallel step and correction loop', async ({ page }) => {
  const { taskId } = await fixture(page, 'KYB and beneficial ownership');
  const saved = await gatedBackend(page, taskId);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/tasks/${taskId}?editor=form`);
  await page.getByRole('button', { name: 'Start from the template workflow' }).click();
  const graph = page.getByTestId('workflow-graph');
  const before = await graph.locator('[data-node]').count();

  // A decision and a person step after the concluding step.
  await graph.locator('[data-node="conclude"]').click();
  await page.getByRole('button', { name: 'Add a decision after' }).click();
  await graph.locator('[data-node="conclude"]').click();
  await page.getByRole('button', { name: 'Add a person step after' }).click();
  // A step that runs alongside the first review step, joined before the next step.
  await graph.locator('[data-node="review"]').click();
  await page.getByRole('button', { name: 'Add a step that runs alongside' }).click();
  // A correction loop from the new decision back to the concluding step.
  await graph.locator('polygon').last().click();
  await page.getByLabel('Correction loop back to').selectOption({ label: 'Recommend outcome' });
  await page.getByRole('button', { name: 'Add correction loop' }).click();

  await expect(page.getByText('Passes every workflow check')).toBeVisible();
  expect(await graph.locator('[data-node]').count()).toBeGreaterThanOrEqual(before + 4);
  await expect(graph.getByText('Person in the case', { exact: false }).first()).toBeVisible();

  // Switching saves through the editor's autosave; Chatbot shows the same graph.
  const nodes = await graph.locator('[data-node]').count();
  await page.getByRole('button', { name: 'Chatbot' }).click();
  await expect(page.getByTestId('workflow-graph').locator('[data-node]')).toHaveCount(nodes);
  const g = (saved.output as { workflowGraph: { nodes: { type: string }[]; loops: unknown[] } }).workflowGraph;
  expect(g.nodes.some((n) => n.type === 'join')).toBe(true);
  expect(g.nodes.some((n) => n.type === 'human_step')).toBe(true);
  expect(g.loops.length).toBeGreaterThanOrEqual(2);
});
