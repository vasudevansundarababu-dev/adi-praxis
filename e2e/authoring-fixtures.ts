import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Shared fixture for the authoring v2.1 journeys (see authoring-wave1.spec.ts for what is real and what is served). */
export const base = process.env.E2E_CANDIDATE_BASE ?? 'http://localhost:3301';

export async function fixture(page: Page, workflow: string) {
  const token = await (await page.request.post(base + '/api/v1/auth/dev/google-token', { data: { email: `authoring.${randomUUID()}@example.test`, name: 'Authoring fixture' } })).json();
  const signed = await (await page.request.post(base + '/api/v1/auth/google', { data: { credential: token.credential, adultAttested: true } })).json();
  return JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'wave1', signed.id, workflow], { encoding: 'utf8' }).trim().split('\n').pop()!) as { taskId: string };
}

/** In-test backend for the gated calls; the stored output and revision feed the real task read on reload. */
export async function gatedBackend(page: Page, taskId: string) {
  const state: { output: Record<string, unknown> | null; revision: number | null } = { output: null, revision: null };
  await page.route(`**/api/v1/me/tasks/${taskId}`, async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      state.output = body.output;
      state.revision = body.expectedRevision + 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: state.revision, savedAt: new Date().toISOString() }) });
    }
    try {
      const res = await route.fetch();
      const json = await res.json();
      if (state.output) Object.assign(json, { output: state.output, revision: state.revision });
      return await route.fulfill({ response: res, json });
    } catch (e) {
      // A background refresh still in flight when the test ends is not a failure of the journey.
      if (/has been closed/.test(String(e))) return;
      throw e;
    }
  });
  await page.route(`**/api/v1/me/tasks/${taskId}/authoring-workspace`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() ?? '{}' }));
  await page.route(`**/api/v1/me/tasks/${taskId}/conversation`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: state.revision ?? 0, output: state.output ?? {}, state: { humanOnly: true, consent: { version: 'human-only/1' } }, messages: [], run: null, policy: null }) }),
  );
  return state;
}

