import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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

const TEMPLATES = ['KYC onboarding and refresh', 'KYB and beneficial ownership', 'AML transaction-monitoring alerts', 'Omnichannel Creative & Locale Compliance', 'Launch of Noise Cancelling Phone', 'Adverse media review', 'Enhanced due diligence', 'Customer risk rating'];
const base = process.env.E2E_CANDIDATE_BASE ?? 'http://localhost:3301';

async function fixture(page: Page, workflow: string) {
  const token = await (await page.request.post(base + '/api/v1/auth/dev/google-token', { data: { email: `wave1.${randomUUID()}@example.test`, name: 'Wave 1 fixture' } })).json();
  const signed = await (await page.request.post(base + '/api/v1/auth/google', { data: { credential: token.credential, adultAttested: true } })).json();
  return JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'wave1', signed.id, workflow], { encoding: 'utf8' }).trim().split('\n').pop()!) as { taskId: string };
}

/** In-test backend for the gated calls; the stored output and revision feed the real task read on reload. */
async function gatedBackend(page: Page, taskId: string) {
  const state: { output: Record<string, unknown> | null; revision: number | null } = { output: null, revision: null };
  await page.route(`**/api/v1/me/tasks/${taskId}`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      state.output = body.output;
      state.revision = body.expectedRevision + 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: state.revision, savedAt: new Date().toISOString() }) });
    }
    const res = await route.fetch();
    const json = await res.json();
    if (state.output) Object.assign(json, { output: state.output, revision: state.revision });
    return route.fulfill({ response: res, json });
  });
  await page.route(`**/api/v1/me/tasks/${taskId}/authoring-workspace`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' }));
  await page.route(`**/api/v1/me/tasks/${taskId}/conversation`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: state.revision ?? 0, output: state.output ?? {}, state: { humanOnly: true, consent: { version: 'human-only/1' } }, messages: [], run: null, policy: null }) }),
  );
  return state;
}

for (const workflow of TEMPLATES) {
  test(`Wave 1 · ${workflow}: one workflow graph below Classic and Chatbot`, async ({ page }) => {
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
