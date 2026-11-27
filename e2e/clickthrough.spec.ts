import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { gatedBackend } from './authoring-fixtures';

/**
 * Night plan, 26 Nov 2026 (owner: "Click every page and see everything loads. Every page has help."): a click-through
 * of every console and SME app page, as each test role the e2e fixtures define (never a real admin). For each page it
 * records the HTTP status, console errors, server errors (5xx) and whether a Help panel is on the page; it fails on any
 * 5xx or console error. The log goes to CLICKTHROUGH_LOG (JSON) for the night report. E2E database only.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3300';
const CANDIDATE = process.env.E2E_CANDIDATE_URL ?? 'http://localhost:3301';
const LOG = process.env.CLICKTHROUGH_LOG ?? 'clickthrough-log.json';
const ADMIN = { email: 'admin@e2e.local', password: 'e2e-admin-password' };
const PM = { email: 'pm@e2e.local', password: 'e2e-pm-password' };
const VALIDATOR = { email: 'validator@e2e.local', password: 'e2e-validator-password' };
const FINANCE = { email: 'finance@e2e.local', password: 'e2e-finance-password' };

type Row = { app: 'console' | 'sme'; role: string; route: string; status: number | null; consoleErrors: string[]; serverErrors: string[]; clientErrors: string[]; help: boolean };
const rows: Row[] = [];

// Messages the browser prints that are not page defects (dev-server noise, aborted prefetches, a 401 probe before sign-in).
const NOISE = [/Download the React DevTools/, /\[Fast Refresh\]/, /\[HMR\]/, /net::ERR_ABORTED/, /favicon/, /status of 401/, /status of 404 \(Not Found\).*_next/];

async function visit(page: Page, app: Row['app'], role: string, url: string, opts: { mayRefuse?: boolean } = {}) {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  const clientErrors: string[] = [];
  const onConsole = (m: import('@playwright/test').ConsoleMessage) => {
    if (m.type() === 'error' && !NOISE.some((r) => r.test(m.text()))) consoleErrors.push(m.text().slice(0, 300));
  };
  const onResponse = (r: import('@playwright/test').Response) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
    else if (r.status() >= 400) clientErrors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => null);
  const help = (await page.locator('[data-support-bot], [data-task-help], [data-public-help], button:has-text("Help")').count()) > 0;
  page.off('console', onConsole);
  page.off('response', onResponse);
  // A page the role may not open answers 404 by design (role guard): that is an access refusal, not a defect.
  const refused = res?.status() === 404 && opts.mayRefuse;
  rows.push({ app, role, route: url.replace(/^https?:\/\/[^/]+/, ''), status: res?.status() ?? null, consoleErrors: refused ? [] : consoleErrors, serverErrors, clientErrors, help });
}

async function consoleLogin(page: Page, who: { email: string; password: string }) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

const STATIC_CONSOLE = ['/', '/projects', '/projects/new', '/templates', '/templates/forms', '/templates/tasks', '/dataset', '/users', '/taxonomy', '/terms', '/failure-codes', '/api-clients', '/admin/candidate-sign-in', '/tutorials', '/sourcing', '/review/tasks', '/review/applications', '/review/identity', '/review/conflicts', '/review/rl', '/review/policy-proposals', '/change-password'];

test.describe.configure({ mode: 'serial' });

test('console: every page, as Admin, PM, Validator and Finance (e2e fixtures)', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  // D-109: the signed-out sign-in page has its public help.
  await page.context().clearCookies();
  await visit(page, 'console', 'Signed out', `${WEB}/login`);
  for (const [role, who] of [['Admin', ADMIN], ['PM', PM], ['Validator', VALIDATOR], ['Finance', FINANCE]] as const) {
    await page.context().clearCookies();
    await consoleLogin(page, who);
    for (const r of STATIC_CONSOLE) await visit(page, 'console', role, WEB + r, { mayRefuse: role !== 'Admin' });
    // Every project the role can see, with each tab and its sub-pages.
    const list = await page.request.get(`${WEB}/api/v1/projects`).then((x) => (x.ok() ? x.json() : { items: [] })).catch(() => ({ items: [] }));
    for (const p of (list.items ?? []).slice(0, 3) as { id: string }[]) {
      for (const tab of ['', '?tab=people', '?tab=tasks', '?tab=policies', '?tab=benchmark']) await visit(page, 'console', role, `${WEB}/projects/${p.id}${tab}`);
      for (const sub of ['policy', 'tasks', 'dashboard', 'opportunity', 'recruiter', 'staffing', 'assign']) await visit(page, 'console', role, `${WEB}/projects/${p.id}/${sub}`);
      const tasks = await page.request.get(`${WEB}/api/v1/projects/${p.id}/forge-tasks`).then((x) => (x.ok() ? x.json() : { items: [] })).catch(() => ({ items: [] }));
      for (const t of (tasks.items ?? []).slice(0, 2) as { taskId: string }[]) await visit(page, 'console', role, `${WEB}/projects/${p.id}/tasks/${t.taskId}/review`);
      const rules = await page.request.get(`${WEB}/api/v1/projects/${p.id}/policy/rules`).then((x) => (x.ok() ? x.json() : { items: [] })).catch(() => ({ items: [] }));
      for (const r of (rules.items ?? []).slice(0, 1) as { ruleId: string }[]) await visit(page, 'console', role, `${WEB}/projects/${p.id}/policy/rules/${r.ruleId}`);
    }
    const tpls = await page.request.get(`${WEB}/api/v1/templates`).then((x) => (x.ok() ? x.json() : { items: [] })).catch(() => ({ items: [] }));
    for (const t of (tpls.items ?? []).slice(0, 1) as { id: string }[]) await visit(page, 'console', role, `${WEB}/templates/${t.id}`);
  }
});

test('console: the new-flow project of the multi-select fixture, as its PM', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const out = execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-forge-validate.ts'], { encoding: 'utf8' }).trim().split('\n').pop()!;
  const fx = JSON.parse(out) as { projectId: string; pm: { email: string; password: string } };
  await consoleLogin(page, fx.pm);
  for (const r of ['/', '/projects', '/templates', '/tutorials']) await visit(page, 'console', 'PM (new flow)', WEB + r);
  for (const tab of ['', '?tab=people', '?tab=tasks', '?tab=policies', '?tab=benchmark']) await visit(page, 'console', 'PM (new flow)', `${WEB}/projects/${fx.projectId}${tab}`);
  for (const sub of ['policy', 'assign', 'recruiter']) await visit(page, 'console', 'PM (new flow)', `${WEB}/projects/${fx.projectId}/${sub}`);
  const tasks = await page.request.get(`${WEB}/api/v1/projects/${fx.projectId}/forge-tasks`).then((x) => x.json());
  for (const t of (tasks.items ?? []) as { taskId: string }[]) await visit(page, 'console', 'PM (new flow)', `${WEB}/projects/${fx.projectId}/tasks/${t.taskId}/review`);
});

test('SME app: every page, as a signed-in SME (mock Google sign-in)', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  for (const r of ['/', '/sign-in', '/forgot-password', '/set-password/not-a-real-link', '/privacy', '/terms', '/opportunities', '/tutorials']) await visit(page, 'sme', 'Signed out', CANDIDATE + r);
  const token = await (await page.request.post(`${CANDIDATE}/api/v1/auth/dev/google-token`, { data: { email: `clickthrough.${randomUUID()}@example.test`, name: 'Click Through' } })).json();
  const signed = await page.request.post(`${CANDIDATE}/api/v1/auth/google`, { data: { credential: token.credential, adultAttested: true } });
  expect(signed.ok()).toBe(true);
  for (const r of ['/home', '/welcome', '/opportunities', '/verify', '/run-reviews', '/edge-outcomes', '/payments', '/certifications', '/assessments', '/tutorials']) await visit(page, 'sme', 'SME', CANDIDATE + r);
  const opps = await page.request.get(`${CANDIDATE}/api/v1/opportunities`).then((x) => (x.ok() ? x.json() : { items: [] })).catch(() => ({ items: [] }));
  for (const o of (opps.items ?? []).slice(0, 1) as { id: string }[]) await visit(page, 'sme', 'SME', `${CANDIDATE}/opportunities/${o.id}`);
  // An SME with an authoring task (the authoring fixture): the task page.
  const me = (await signed.json()) as { id: string };
  const fx = JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', 'wave1', me.id, 'KYC onboarding and refresh'], { encoding: 'utf8' }).trim().split('\n').pop()!) as { taskId: string };
  // The fixture SME has not finished onboarding, so the task's gated calls are served in-test, as the authoring
  // journeys do (authoring-fixtures.ts); the page itself and everything else is real.
  await gatedBackend(page, fx.taskId);
  await visit(page, 'sme', 'SME', `${CANDIDATE}/tasks/${fx.taskId}`);
});

test.afterAll(() => {
  writeFileSync(LOG, JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.serverErrors.length || r.consoleErrors.length || (r.status ?? 0) >= 500);
  console.log(`clickthrough: ${rows.length} page views, ${bad.length} with errors, ${rows.filter((r) => !r.help).length} without a Help panel`);
});

test('D-109 / D-110: every signed-out page, and the console change-password page, has its Help panel', () => {
  const pub = rows.filter((r) => r.role === 'Signed out' || r.route.startsWith('/change-password'));
  expect(pub.length).toBeGreaterThan(0);
  expect(pub.filter((r) => !r.help).map((r) => `${r.app} ${r.role} ${r.route}`)).toEqual([]);
});

test('no page view had a server error or a console error', () => {
  const bad = rows.filter((r) => r.serverErrors.length || r.consoleErrors.length || (r.status ?? 0) >= 500);
  expect(bad.map((r) => `${r.role} ${r.route}: ${[...r.serverErrors, ...r.consoleErrors].join(' | ') || r.status}`)).toEqual([]);
});
