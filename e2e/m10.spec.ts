import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * M10 UI smoke tests (docs/M10-BUILD.md, M10d): the partner submit flow, a candidate's course → test → result, and a
 * pay run from build to submission. Local only (isolated e2e servers, SME_SUPPLY_ENABLED on, mocks for AI and payouts).
 * Set-up that is not under test goes through the API; FLOW 2 selection is a fixture (scripts/e2e-m10.ts).
 */
const WEB = 'http://localhost:3300';
const CANDIDATE = 'http://localhost:3301';
const API = 'http://localhost:4300';
test.skip(!!process.env.E2E_WEB_URL, 'M10 smoke tests run against the local e2e servers only');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const GUIDELINES = `# 1. Scope
These guidelines cover onboarding of corporate customers for know-your-customer checks at a synthetic bank called Northwind Mutual.

# 2. Beneficial ownership
Any person who holds 25% or more of the customer, directly or through other entities, is a beneficial owner. Beneficial owners must always be identified and verified before approval.

# 3. Workflow
First check the company registry for the customer. Then resolve the ownership structure. Next screen every controller against sanctions lists. Then rate the risk of the relationship. Finally escalate or recommend the decision.
`;

const fixture = (...args: string[]) => JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@praxis/api', 'exec', 'tsx', 'scripts/e2e-m10.ts', ...args], { encoding: 'utf8' }).trim().split('\n').pop()!);

const apiContexts: APIRequestContext[] = [];
const manualPages: Page[] = [];
async function manualPage(browser: Browser) {
  const page = await browser.newPage();
  manualPages.push(page);
  return page;
}
async function staff(email: string, password: string) {
  const ctx = await pwRequest.newContext({ baseURL: `${API}/api/v1/`, extraHTTPHeaders: {} });
  apiContexts.push(ctx);
  const res = await ctx.post('auth/login', { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
  return ctx;
}
const idem = () => ({ 'idempotency-key': randomUUID() });
async function ok(p: Promise<import('@playwright/test').APIResponse>, status = 0) {
  const r = await p;
  if (status) expect(r.status(), await r.text()).toBe(status);
  else expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}

let admin: APIRequestContext;
let pm: APIRequestContext;
let validator: APIRequestContext;

test.beforeAll(async () => {
  admin = await staff('admin@e2e.local', 'e2e-admin-password');
  pm = await staff('pm@e2e.local', 'e2e-pm-password');
  validator = await staff('validator@e2e.local', 'e2e-validator-password');
});

test.afterAll(async () => {
  await Promise.all(apiContexts.splice(0).map((context) => context.dispose()));
});
test.afterEach(async () => {
  await Promise.all(manualPages.splice(0).map((page) => page.context().close()));
});

/** A published STAFFING project with SME supply on, a partner with a portal user, and an open requisition. */
async function supply(extra: object = {}) {
  const tag = randomUUID().slice(0, 6);
  const domain = await ok(admin.post('domains', { data: { name: `Banking ${tag}` }, headers: idem() }));
  const t = await ok(admin.post('templates', { data: { domainId: domain.id, workflowName: 'KYC onboarding', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC'], taskModes: ['AUTHORING'] }, headers: idem() }));
  await ok(admin.post(`templates/${t.id}/publish`, { headers: idem() }));
  const jd = await ok(pm.post('job-descriptions', { data: { title: 'KYC Analyst', responsibilities: 'Author synthetic KYC cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'USD', locationType: 'REMOTE' }, headers: idem() }));
  const p = await ok(pm.post('projects', { data: { templateId: t.id, name: `M10 ${tag}`, distinctTarget: 8, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-11-06', jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['IN', 'GB'], required: false }] }, headers: idem() }));
  for (const step of ['submit', 'match', 'opportunity/publish']) await ok(pm.post(`projects/${p.id}/${step}`, { headers: idem() }));
  await ok(pm.post(`projects/${p.id}/sme-supply`, { data: { enabled: true }, headers: idem() }));
  const partner = await ok(admin.post('partners', { data: { name: `Lotus Staffing ${tag}`, businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] }, headers: idem() }));
  const portal = { email: `ops.${tag}@partner.example`, password: 'partner-password-1' };
  await ok(admin.post(`partners/${partner.id}/users`, { data: { email: portal.email, name: 'Meera Nair', password: portal.password, requirePasswordChange: false }, headers: idem() }));
  const r = await ok(pm.post('requisitions', { data: { projectId: p.id, title: `KYC annotators ${tag}`, summary: 'Label KYC onboarding decisions.', domain: 'banking', tier: 'ANNOTATOR', headcount: 10, languages: ['en'], jurisdictions: ['IN'], minimumRequirements: { minYears: 2, qualifications: [], licenceRequired: false }, allowedPartnerIds: [partner.id], maxPerPartner: 50, ...extra }, headers: idem() }));
  await ok(pm.post(`requisitions/${r.id}/transition`, { data: { to: 'OPEN' }, headers: idem() }));
  return { requisitionId: r.id as string, title: r.title as string, partnerId: partner.id as string, portal };
}

async function staffLogin(page: Page, email: string, password: string) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle'); // let the form hydrate before submitting it
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
}

test('a partner signs in, submits a candidate for a requisition and sees them in the tracker', async ({ page }) => {
  const s = await supply();
  await page.goto(`${WEB}/partner/login`);
  await page.getByLabel('Email').fill(s.portal.email);
  await page.getByLabel('Password').fill(s.portal.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome');
  await page.goto(`${WEB}/partner/requisitions/${s.requisitionId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.title);
  await page.getByRole('link', { name: /submit/i }).first().click();
  const email = `asha.${randomUUID().slice(0, 6)}@example.test`;
  await page.getByLabel('Full name').fill('Asha Kulkarni');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Country').fill('IN');
  await page.getByLabel('Years of relevant experience').fill('5');
  await page.getByLabel('Experience summary').fill('Five years of corporate KYC reviews, including beneficial ownership and sanctions screening.');
  await page.getByLabel('Languages (comma-separated)').fill('en, hi');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Submit candidate' }).click();
  await expect(page.getByRole('heading', { name: 'Candidate submitted' })).toBeVisible();
  await page.goto(`${WEB}/partner/candidates`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Candidates');
  await expect(page.getByText('Asha Kulkarni').first()).toBeVisible();
  // Submitting the same person again is refused without naming anyone.
  await page.goto(`${WEB}/partner/requisitions/${s.requisitionId}/submit`);
  await page.getByLabel('Full name').fill('Asha Kulkarni');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Country').fill('IN');
  await page.getByLabel('Years of relevant experience').fill('5');
  await page.getByLabel('Experience summary').fill('Five years of corporate KYC reviews, including beneficial ownership and sanctions screening.');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Submit candidate' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /already submitted|not accepted/ })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Lotus Staffing/ })).toHaveCount(0);
});

test('a candidate completes the course, takes the test and sees the result', async ({ page }) => {
  const s = await supply({ directChannel: true, payRoute: 'VIA_PARTNER' });
  // Guidelines → generated course and test (worker, mock model) → approved and published by an Admin.
  const pkg = await ok(admin.post('guidelines/packages', { data: { domain: 'banking', taskFamily: `KYC ${randomUUID().slice(0, 4)}`, name: 'Northwind KYC guidelines' }, headers: idem() }));
  const v = await ok(admin.post(`guidelines/packages/${pkg.id}/versions`, { multipart: { major: 'true', file: { name: 'kyc.md', mimeType: 'text/markdown', buffer: Buffer.from(GUIDELINES) } }, headers: idem() }));
  await expect.poll(async () => (await ok(admin.get(`guidelines/versions/${v.id}`))).runs[0]?.status, { timeout: 120_000 }).toBe('SUCCEEDED');
  const tier = (await ok(admin.get(`guidelines/versions/${v.id}`))).tiers.find((x: { tier: string }) => x.tier === 'ANNOTATOR');
  await ok(admin.post(`courses/${tier.course.id}/decision`, { data: { decision: 'APPROVE' }, headers: idem() }));
  await ok(admin.post(`blueprints/${tier.blueprint.id}/decision`, { data: { decision: 'APPROVE' }, headers: idem() }));
  for (const f of (await ok(admin.get(`blueprints/${tier.blueprint.id}`))).families) await ok(admin.post(`item-families/${f.id}/decision`, { data: { decision: 'APPROVE' }, headers: idem() }));
  await ok(admin.post(`guidelines/versions/${v.id}/tiers/ANNOTATOR/publish`, { headers: idem() }));
  await ok(pm.put(`requisitions/${s.requisitionId}/guidelines`, { data: { packageId: pkg.id }, headers: idem() }));

  // The candidate signs in (dev mock), applies on the careers page, and is selected by a person (fixture).
  await page.goto(`${CANDIDATE}/sign-in?returnTo=/home`);
  await page.locator('#dev-email').fill(`ravi.${Date.now()}@example.test`);
  await page.locator('#dev-name').fill('Ravi Menon');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /continue with google \(mock\)/i }).click();
  await page.waitForURL((u) => ['/verify', '/home'].includes(u.pathname));
  const me = await ok(page.request.get(`${CANDIDATE}/api/v1/me`));
  // As the careers page does: a same-origin browser call.
  const applied = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/me/requisitions/${id}/apply`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ experienceSummary: 'Four years of KYC onboarding reviews at a retail bank.', experienceYears: 4, languages: ['en'], country: 'IN', consent: true }) });
    return { status: res.status, body: await res.text() };
  }, s.requisitionId);
  expect(applied.status, applied.body).toBe(200);
  fixture('select', me.id);

  const certs = await ok(page.request.get(`${CANDIDATE}/api/v1/me/certifications`));
  const certId = certs.items[0].id as string;
  await page.goto(`${CANDIDATE}/certifications/${certId}`);
  // Course: every module's quiz, in order (the mock's correct answer is the first option).
  for (let n = 0; n < 8; n++) {
    const check = page.getByRole('button', { name: 'Check my answers' });
    const toTest = page.getByRole('link', { name: /Go to the test/ });
    await expect(check.or(toTest).first()).toBeVisible();
    if (await toTest.isVisible()) break;
    for (const group of await page.locator('article fieldset').all()) await group.getByRole('radio').first().check();
    await check.click();
    await expect(page.getByText('Well done: you passed this module.')).toBeVisible();
    await page.getByRole('button', { name: /(Next module|Finish the course)/ }).click();
  }
  await page.getByRole('link', { name: /Go to the test/ }).click();
  await page.getByRole('button', { name: /Take the selfie check/ }).click();
  await page.waitForURL(/selfie=/); // the (mock) provider sends the candidate back
  await expect(page.getByRole('button', { name: /Start the test now/ })).toBeEnabled();
  await page.getByRole('button', { name: /Start the test now/ }).click();
  await expect(page.getByRole('button', { name: 'Submit test' })).toBeVisible({ timeout: 90_000 }); // the first form is assembled on demand
  await page.getByRole('button', { name: 'Submit test' }).click();
  await page.getByRole('button', { name: 'Yes, submit my test' }).click();
  // Unanswered, so the result is a fail with a retake after 48 hours.
  await expect(page.getByRole('heading', { name: /You didn’t pass this time|You passed|being reviewed/ })).toBeVisible();
  await expect(page.getByText(/retake the test from/i)).toBeVisible();
});

test('a pay run is built, confirmed by a PM, approved by Finance and submitted', async ({ browser }) => {
  fixture('payable');
  const f = await manualPage(browser);
  await staffLogin(f, 'finance@e2e.local', 'e2e-finance-password');
  await f.goto(`${WEB}/payments/pay-runs`);
  await expect(f.getByRole('heading', { level: 1 })).toHaveText('Pay runs');
  // The week before last (the fixture's earnings), so the Monday worker job drafting last week's run never collides.
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000);
  const monday = new Date(Date.UTC(twoWeeksAgo.getUTCFullYear(), twoWeeksAgo.getUTCMonth(), twoWeeksAgo.getUTCDate() - ((twoWeeksAgo.getUTCDay() + 6) % 7)));
  await f.getByLabel(/Week starting/).fill(monday.toISOString().slice(0, 10));
  await f.getByRole('button', { name: 'Build pay run' }).click();
  const exists = f.getByText('A pay run for this week already exists.');
  await expect(exists.or(f.getByRole('heading', { level: 1, name: /Week of/ })).first()).toBeVisible({ timeout: 30_000 });
  if (await exists.isVisible()) await f.getByRole('link', { name: /\d{4} – / }).first().click();
  await f.waitForURL(/\/payments\/pay-runs\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const runUrl = f.url();
  // Finance cannot approve before a PM confirms.
  await expect(f.getByRole('button', { name: 'Approve pay run' })).toHaveCount(0);

  const p = await manualPage(browser);
  await staffLogin(p, 'pm@e2e.local', 'e2e-pm-password');
  await p.goto(runUrl);
  await p.getByRole('button', { name: 'Confirm pay run' }).click();
  await expect(p.getByText('Waiting for Finance to approve.')).toBeVisible();

  await f.reload();
  await f.getByRole('button', { name: 'Approve pay run' }).click();
  await expect(f.getByRole('button', { name: 'Submit to payout provider' })).toBeVisible();
  await f.getByRole('button', { name: 'Submit to payout provider' }).click();
  await expect(f.getByRole('button', { name: 'Submit to payout provider' })).toHaveCount(0);
  const finance = await staff('finance@e2e.local', 'e2e-finance-password');
  const runId = runUrl.split('/').pop()!;
  const run = await ok(finance.get(`pay-runs/${runId}`));
  expect(run.status).toBe('SUBMITTED');
  expect(run.approvals).toHaveLength(1);
  expect(run.items.filter((i: { status: string }) => i.status === 'SUBMITTED').length).toBeGreaterThan(0);
});

test('a partner opens Tutorials: the partner video and guide, never the staff files', async ({ page }) => {
  const s = await supply();
  await page.goto(`${WEB}/partner/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Work email').fill(s.portal.email);
  await page.getByLabel('Password').fill(s.portal.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.getByRole('navigation', { name: 'Partner' }).getByRole('link', { name: 'Tutorials' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tutorials and partner guide');
  await expect(page.locator('video')).toHaveCount(1);
  expect((await page.request.get(`${WEB}/tutorials/files/06-staffing-partner.mp4`, { headers: { range: 'bytes=0-9' } })).status()).toBe(206);
  expect((await page.request.get(`${WEB}/tutorials/files/ADI-Praxis-Partner-Guide.pdf`)).status()).toBe(200);
  expect((await page.request.get(`${WEB}/tutorials/files/ADI-Praxis-User-Guide.pdf`)).status()).toBe(404);
  expect((await page.request.get(`${WEB}/tutorials/files/02-admin.mp4`)).status()).toBe(404);
});

test('an Admin adds a partner portal user with a temporary password; the partner chooses their own at first sign-in', async ({ browser }) => {
  const s = await supply();
  const page = await manualPage(browser);
  await staffLogin(page, 'admin@e2e.local', 'e2e-admin-password');
  await page.goto(`${WEB}/partners/${s.partnerId}`);
  const email = `ops2.${Date.now()}@partner.example`;
  await page.locator('#portal-user-name').fill('Ravi Ops');
  await page.locator('#portal-user-email').fill(email);
  await page.getByRole('button', { name: 'Add user' }).click();
  const box = page.getByRole('status').filter({ hasText: `Temporary password for ${email}` });
  await expect(box).toBeVisible();
  const temporary = (await box.locator('code').innerText()).trim();

  const p = await manualPage(browser);
  await p.goto(`${WEB}/partner/login`);
  await p.waitForLoadState('networkidle');
  await p.getByLabel('Work email').fill(email);
  await p.getByLabel('Password').fill(temporary);
  await p.getByRole('button', { name: /^sign in$/i }).click();
  await expect(p.getByRole('heading', { name: 'Choose your own password' })).toBeVisible({ timeout: 30_000 });
  await p.getByLabel('Current or temporary password').fill(temporary);
  await p.getByLabel('New password', { exact: false }).first().fill('ravi-partner-passphrase');
  await p.getByLabel('Confirm new password').fill('ravi-partner-passphrase');
  await p.getByRole('button', { name: 'Save new password' }).click();
  await expect(p.getByRole('heading', { name: /Welcome, Ravi/ })).toBeVisible({ timeout: 30_000 });
});
