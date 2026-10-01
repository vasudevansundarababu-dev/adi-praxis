import { expect, test } from '@playwright/test';
import path from 'node:path';
import { Clip, ENV, RUN_TAG, USERS, api, candidateSignIn, act, maybe, menu, pick, remember, staffApi, staffLogin, state, waitFor } from './lib';

/**
 * The demo video story (docs/user-guide/VIDEOS.md). Clips run in order and share state; each records one video.
 *  01 tour · 02 admin guidelines · 03 admin setup · 04 PM project · 05 PM requisition · 06 partner · 07 SME apply
 *  08 validator select · 09 SME onboarding · 10 PM staffing · 11 SME writes a task · 12 validator task review
 *  13 validator RL review · 14 SME certification · 15 finance
 */
test.describe.configure({ mode: 'serial' });

const SAMPLES = path.resolve(__dirname, '../../docs/testing/samples');
const DEMO = '[Demo video]';

test('01 getting started: sign in, menu, Help', async ({ browser }) => {
  const c = await Clip.start(browser, '01-getting-started');
  const p = c.page;
  await c.title('Getting started', 'The three apps, signing in, the two-level menu and the Help button');
  await p.goto(`${ENV.web}/login`);
  await c.say('This is the ADI Praxis console', 'For Admins, Program Managers, Validators and Finance');
  await c.say('The yellow banner shows the environment and build', 'Always quote the build when you report a problem');
  await staffLogin(c, 'admin', { narrate: true });
  await c.say('Home shows what is waiting for you', 'Each tile opens the right queue');
  await c.say('The menu has two rows', 'Groups on top; the pages of the selected group underneath. You only see groups your role may use');
  for (const [g, pg] of [['Projects', 'Templates'], ['Reviews', 'Applications'], ['Certification', 'Guidelines'], ['Payments', undefined], ['Admin', 'Users']] as const) {
    await menu(c, g, pg);
    await c.pause(900);
  }
  await c.say('Help opens the Support Bot on every page', 'It explains the screen and the process. It never changes anything');
  await c.click(p.getByRole('button', { name: 'Help' }));
  const panel = p.getByRole('dialog', { name: 'Support Bot' });
  await c.click(panel.getByRole('button', { name: 'What do I need to fill in on this screen?' }));
  await expect(panel.getByText(/Looking at this screen/)).toHaveCount(0, { timeout: 90_000 });
  await c.say('The answer is based only on what you can see', '', 5000);
  await p.keyboard.press('Escape');
  await c.say('Partners sign in to their own portal', `${ENV.web}/partner/login`);
  await p.goto(`${ENV.web}/partner/login`);
  await c.pause(2500);
  await c.say('Experts use the candidate app', 'Sign-in is simulated Google in the test and demo environments');
  await p.goto(`${ENV.candidate}/sign-in`);
  await c.pause(3000);
  await c.end();
});

test('02 admin: guidelines to a published course and test', async ({ browser }) => {
  const c = await Clip.start(browser, '02-admin-guidelines');
  const p = c.page;
  await c.title('Admin: guidelines, course and certification', 'Upload guidelines; Claude drafts a course and a test per tier; an Admin approves everything and publishes');
  await staffLogin(c, 'admin');
  await menu(c, 'Certification', 'Guidelines');
  await c.say('Create a guidelines package for a domain and task family');
  const name = `${DEMO} Banking KYC guidelines ${RUN_TAG}`;
  await c.type(p.getByLabel('Domain', { exact: false }).last(), 'banking');
  await c.type(p.getByLabel('Task family', { exact: false }), `KYC review (demo ${RUN_TAG})`);
  await c.type(p.getByLabel(/^Name/), name);
  await c.click(p.getByRole('button', { name: 'Create package' }));
  await expect(p.getByRole('heading', { name })).toBeVisible();
  await c.say('Upload the guidelines document', 'PDF, Word, Markdown or text, up to 10 MB');
  const card = p.getByRole('listitem').filter({ has: p.getByRole('heading', { name }) });
  await card.locator('input[type=file]').setInputFiles(path.join(SAMPLES, 'kyc-procedure-notes.pdf'));
  await c.click(card.getByRole('button', { name: 'Upload', exact: true }));
  await p.waitForURL(/\/guidelines\/versions\//, { timeout: 60_000 });
  remember('guidelinesVersionUrl', p.url());
  remember('guidelinesName', name);
  await c.say('Claude now drafts the knowledge map, a course, a blueprint and item families for each tier', 'Nothing reaches candidates until an Admin approves and publishes');
  await c.scroll(500);

  // Wait for generation behind the scenes, then show the drafted parts.
  const admin = await staffApi(browser, 'admin');
  const versionId = p.url().split('/').pop()!;
  remember('guidelinesVersionId', versionId);
  const runsDone = await waitFor('generation', async () => {
    const v = await admin.get(`guidelines/versions/${versionId}`);
    const runs = (v.runs ?? v.generationRuns ?? []) as { status: string }[];
    if (runs.some((r) => r.status === 'FAILED')) throw new Error('generation failed');
    return runs.length && runs.every((r) => r.status === 'SUCCEEDED') ? v : null;
  }, 45 * 60_000, 15_000);
  await p.reload();
  await c.say('Generation finished', 'Each run shows its model and cost');
  await c.say('The knowledge map: rules, steps, thresholds and edge cases, each citing its section');
  const km = p.getByRole('heading', { name: 'Knowledge map' });
  await km.scrollIntoViewIfNeeded();
  await c.pause(1500);
  const approve = p.getByRole('button', { name: 'Approve', exact: true });
  for (let i = 0; i < 3 && (await approve.count()); i++) await c.click(approve.first());
  await c.say('Approve, edit, reject, or mark a rule as critical', 'The rest are approved the same way');
  // Approve the remaining knowledge items without filming each click.
  for (const k of runsDone.knowledge as { id: string; status: string }[]) {
    if (k.status !== 'APPROVED') await admin.patch(`knowledge-items/${k.id}`, { status: 'APPROVED' }).catch(() => {});
  }
  await p.reload();

  await c.say('Each tier needs an approved course, blueprint and item families', 'This demo publishes the Annotator tier');
  const tier = (await admin.get(`guidelines/versions/${versionId}`)).tiers.find((t: { tier: string }) => t.tier === 'ANNOTATOR');
  await c.click(p.locator(`a[href="/guidelines/courses/${tier.course.id}"]`));
  await c.say('Check each module against the cited guideline sections', 'Candidates must score 80% on each module quiz');
  await c.scroll(700);
  await c.scroll(700);
  await c.click(p.getByRole('button', { name: 'Approve course' }));
  await expect(p.getByText('The course is approved.')).toBeVisible();
  await p.goto(state.guidelinesVersionUrl);
  await c.click(p.locator(`a[href="/guidelines/blueprints/${tier.blueprint.id}"]`));
  await c.say('The blueprint: test length, time limit, pass rules and competency weights', 'Every candidate gets different but equivalent questions');
  await c.click(p.getByRole('button', { name: 'Approve blueprint' }));
  await c.say('Each item family needs a valid sample before it can be approved', 'The correct answer always comes from the family rule, never from the model');
  const fam = p.getByRole('button', { name: 'Approve family' });
  await fam.first().scrollIntoViewIfNeeded();
  await c.click(fam.first());
  await expect(p.getByText('Approval recorded.')).toBeVisible();
  // Approve the remaining families off camera.
  const bp = await admin.get(`blueprints/${tier.blueprint.id}`);
  for (const f of bp.families as { id: string; status: string }[]) {
    if (f.status !== 'APPROVED') await admin.post(`item-families/${f.id}/decision`, { decision: 'APPROVE', note: 'Approved for the demo video' }).catch(() => {});
  }
  await p.goto(state.guidelinesVersionUrl);
  await c.say('When a tier is ready, publish it', 'A published tier cannot change; upload a new version instead');
  await c.click(p.getByRole('button', { name: 'Publish Annotator' }));
  await c.click(p.getByRole('button', { name: 'Yes, publish Annotator' }));
  await c.pause(2500);
  await admin.ctx.close();
  await c.end();
});

test('03 admin: partners, users, terms, codes and API keys', async ({ browser }) => {
  const c = await Clip.start(browser, '03-admin-setup');
  const p = c.page;
  await c.title('Admin: platform set-up', 'Partners, console users, diversity taxonomy, contributor terms, RL failure codes and API keys');
  await staffLogin(c, 'admin');
  await menu(c, 'Partners');
  await c.say('Staffing partners put candidates forward', 'Every candidate still goes through identity, selection and certification in Praxis');
  await c.click(p.getByRole('link', { name: 'Demo Staffing Partner' }));
  await c.say('Each partner has a business check, allowed domains and tiers, and fee terms', 'Suspending a partner stops it at once and ends its API tokens');
  await c.scroll(600);
  await c.say('Portal users sign in to the partner portal', 'They only ever see their own partner’s data');
  await c.scroll(600);
  await menu(c, 'Admin', 'Users');
  await c.say('Admin → Users lists console users and their roles', 'In release 1.1 users are added, changed and disabled through the API');
  await menu(c, 'Admin', 'Taxonomy');
  await c.say('Taxonomy: the diversity filters PMs use when they create a project');
  await menu(c, 'Admin', 'Terms');
  await c.say('Contributor terms: experts accept the current version during onboarding', 'Publishing a new version makes them accept it again');
  await menu(c, 'Admin', 'Failure codes');
  await c.say('Failure codes: reasons Validators attach to failed RL Gym results');
  await menu(c, 'Admin', 'API clients');
  await c.say('API clients: keys for RL Gym and client systems');
  await c.type(p.getByLabel(/^Name/), `${DEMO} RL Gym ${RUN_TAG}`);
  await pick(c, p.getByLabel(/^Kind/), 'RL Gym');
  await c.click(p.getByRole('button', { name: 'Create key' }));
  await expect(p.getByText('Copy this key now. It will not be shown again.')).toBeVisible();
  const key = (await p.locator('code, pre, input[readonly]').filter({ hasText: /\S{20,}/ }).first().innerText().catch(() => '')) || (await p.locator('input[readonly]').first().inputValue());
  remember('rlGymKey', key.trim());
  await c.say('The key is shown once only; only its hash is stored', 'Revoke stops it at once');
  await c.end();
});

test('04 PM: create a project, validators and opportunity page', async ({ browser }) => {
  const c = await Clip.start(browser, '04-pm-project');
  const p = c.page;
  await c.title('Program Manager: a new project', 'From a published template to a staffed, diverse set of tasks');
  await staffLogin(c, 'pm');
  await c.say('Home shows the PM’s projects and pay runs', 'Start a project with New project');
  await c.click(p.getByRole('link', { name: /New project/ }).first());
  await c.say('Step 1: choose a published workflow template');
  await pick(c, p.getByLabel(/Domain and workflow/));
  await c.pause(1500);
  await c.click(p.getByRole('button', { name: 'Next', exact: true }));
  await c.say('Step 2: name and dates');
  await c.type(p.getByLabel(/Project name/), `${DEMO} KYC refresh cases ${RUN_TAG}`);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await p.getByLabel(/Start date/).fill(day(3));
  await p.getByLabel(/Target end date/).fill(day(40));
  await c.click(p.getByRole('button', { name: 'Next', exact: true }));
  await c.say('Step 3: how many distinct tasks, per-expert cap and time per task', 'Coverage quotas come from the template and keep tasks diverse');
  await c.type(p.getByLabel(/Distinct-task target/), '24');
  await c.type(p.getByLabel(/Max tasks per expert/), '6');
  await c.type(p.getByLabel(/TPT \(minutes per task\)/), '90');
  await c.scroll(500);
  await c.click(p.getByRole('button', { name: 'Next', exact: true }));
  await c.say('Step 4: demographic filters', 'Required filters must match; preferred ones raise the match score');
  await c.click(p.getByRole('button', { name: '+ Add filter' }).first());
  const opt = p.locator('input[type=checkbox]').first();
  if (await opt.isVisible().catch(() => false)) await c.click(opt);
  await c.pause(1000);
  await c.click(p.getByRole('button', { name: 'Next', exact: true }));
  await c.say('Step 5: the job description', 'Reuse one, or create a new one');
  const existing = p.getByLabel('Use an existing job description');
  if (await existing.isVisible().catch(() => false)) {
    await c.click(existing);
    await pick(c, p.getByLabel(/^Job description/));
  }
  await c.click(p.getByRole('button', { name: 'Next', exact: true }));
  await c.say('Step 6: review, then submit', 'The template version, demographics and job description are frozen at submit');
  await c.scroll(400);
  await c.click(p.getByRole('button', { name: 'Submit project' }));
  await expect(act(p, 'Start staffing')).toBeVisible({ timeout: 30_000 });
  await c.say('The project is ready for staffing');
  await c.say('Assign the Validators who will decide this pool’s applications');
  await pick(c, p.getByLabel(/Add reviewer/));
  await c.click(p.getByRole('button', { name: 'Add', exact: true }));
  await c.pause(1200);
  await c.click(act(p, 'Opportunity page'));
  await c.say('The opportunity page is what candidates read before applying', 'Brief, eligibility criteria and the questions candidates will be asked');
  await c.scroll(700);
  await c.scroll(700);
  await c.say('Save and publish makes it visible in the candidate app', 'This demo leaves it as a draft');
  await c.end();
});

test('05 PM: open a requisition with guidelines and a rate card', async ({ browser }) => {
  const c = await Clip.start(browser, '05-pm-requisition');
  const p = c.page;
  await c.title('Program Manager: a requisition', 'Ask staffing partners and the careers page for certified people');
  await staffLogin(c, 'pm');
  await menu(c, 'Projects', 'Requisitions');
  await c.click(act(p, 'New requisition'));
  await c.say('A requisition belongs to a project with SME supply switched on');
  await pick(c, p.getByLabel(/^Project/), 'KYC authoring demo');
  await c.pause(1000);
  const title = `${DEMO} KYC annotators ${RUN_TAG}`;
  remember('requisitionTitle', title);
  await c.type(p.getByLabel(/^Title/), title);
  await c.type(p.getByLabel(/Summary for partners/), 'Annotate synthetic KYC onboarding cases. Training and certification are provided.');
  await c.type(p.getByLabel(/^Domain/), 'banking');
  await pick(c, p.getByLabel(/^Tier/), 'Annotator');
  await c.type(p.getByLabel(/^Headcount/), '5');
  await c.say('Minimum requirements: the screen recommends only; a Validator confirms any “not met”');
  await c.type(p.getByLabel(/Minimum years in the domain/), '2');
  await c.say('Channels and pay: which partners may submit, the careers page, and who pays the SMEs');
  await c.click(p.getByLabel(/Demo Staffing Partner/));
  await c.click(p.getByLabel(/Also accept direct applications/));
  await c.click(p.getByLabel(/^Direct: Praxis pays each SME/));
  await c.click(p.getByRole('button', { name: 'Create draft requisition' }));
  await p.waitForURL(/\/requisitions\/[0-9a-f-]{36}$/);
  remember('requisitionUrl', p.url());
  await c.say('Link the guidelines: partners see the summary and course outline');
  await pick(c, p.getByLabel(/^Package/), state.guidelinesName);
  await c.click(p.getByRole('button', { name: 'Link guidelines' }));
  await expect(p.getByText('Guidelines linked.')).toBeVisible();
  await c.say('Link a rate card: what each accepted task earns');
  await pick(c, p.getByLabel(/Rate card version/));
  await c.click(p.getByRole('button', { name: 'Link rate card' }));
  await expect(p.getByText('Rate card linked.')).toBeVisible();
  await c.say('Open it: allowed partners are told and can submit candidates');
  await c.click(p.getByRole('button', { name: 'Open', exact: true }));
  await expect(p.getByText(/Requisition is now open/i)).toBeVisible();
  await c.pause(2000);
  await c.end();
});

test('06 partner: submit a candidate and follow them', async ({ browser }) => {
  const c = await Clip.start(browser, '06-partner');
  const p = c.page;
  await c.title('Staffing partner portal', 'Put candidates forward for open requisitions and follow their progress');
  await staffLogin(c, 'partner', { narrate: true });
  await c.say('Home: open requisitions, candidates in progress, certified candidates and statements');
  await c.click(p.getByRole('link', { name: 'Requisitions', exact: true }).first());
  await c.click(p.getByRole('link', { name: state.requisitionTitle }));
  await c.say('The role, minimum requirements, guidelines summary and course outline', 'Test questions and answers are never shared with partners');
  await c.scroll(600);
  await c.scroll(600);
  await c.click(act(p, 'Submit a candidate'));
  const email = `ravi.demo.${Date.now().toString(36)}@example.test`;
  remember('raviEmail', email);
  await c.type(p.getByLabel(/^Full name/), 'Ravi Kumar');
  await c.type(p.getByLabel(/^Your reference/), `DSP-${Date.now().toString(36)}`);
  await c.type(p.getByLabel(/^Email/), email);
  await c.type(p.getByLabel(/^Country/), 'IN');
  await c.type(p.getByLabel(/^Years of relevant experience/), '6');
  await c.type(p.getByLabel(/^Experience summary/), 'Six years of retail and corporate KYC onboarding, periodic reviews and sanctions screening at Indian banks.');
  await c.type(p.getByLabel(/^Languages/), 'en, hi');
  await c.say('Two confirmations: the candidate was trained on the guidelines summary and agreed to be put forward');
  for (const box of await p.getByRole('checkbox').all()) await c.click(box);
  await c.click(p.getByRole('button', { name: 'Submit candidate' }));
  await expect(p.getByRole('heading', { name: 'Candidate submitted' })).toBeVisible({ timeout: 30_000 });
  await c.say('ADI Praxis emails the candidate an invite', 'The requirement screen is a recommendation; only a Validator decides “not met”');
  const link = await p.getByText(/\/partner-invite\//).first().innerText();
  remember('raviInvite', link.match(/https?:\/\/\S+\/partner-invite\/\S+/)![0]);
  await c.say('Test environment only: email is simulated, so the invite link is shown here');
  await c.click(act(p, 'Track this candidate'));
  await c.say('Where the candidate is now, stage by stage, and a history that is never edited');
  await c.scroll(500);
  await c.click(p.getByRole('link', { name: 'Statements', exact: true }).first());
  await c.say('Statements: a monthly fee for each of your candidates who is certified');
  await c.click(p.getByRole('link', { name: /API & webhooks/ }).first());
  await c.say('API & webhooks: sandbox and live API clients, signed webhooks and delivery history');
  await c.end();
});

/** Answers the SME profile chat with realistic, fully synthetic answers, then confirms what was picked up. */
async function profileChat(c: Clip, narrate: boolean) {
  const p = c.page;
  const answers: [RegExp, { chips?: string[]; text?: string }][] = [
    [/compliance processes|parts of/i, { chips: ['KYC / onboarding', 'Enhanced due diligence', 'Sanctions review'], text: 'Corporate and retail onboarding' }],
    [/roles behind/i, { text: 'KYC Analyst at a retail bank, 2017 to 2021; Senior KYC Analyst at a payments company, 2021 to 2025' }],
    [/most relevant role/i, { chips: ['Prepared cases', 'Reviewed others’ work'] }],
    [/jurisdictions/i, { chips: ['United Kingdom', 'India'] }],
    [/This pool looks for|meet these/i, { text: 'Eight years of KYC and EDD on corporate customers, including beneficial ownership and sanctions screening.' }],
    [/typical case/i, { text: 'A company with layered ownership: we traced owners above 25%, screened directors, cleared a sanctions near match on date of birth and escalated the high-risk relationship for approval.' }],
  ];
  for (let i = 0; i < 12; i++) {
    const done = p.getByText(/All done\. Check your answers and submit\./);
    if (await done.isVisible().catch(() => false)) break;
    const card = p.getByText(/Question \d+ of \d+/).first();
    await card.waitFor({ timeout: 60_000 });
    const qText = await card.locator('xpath=ancestor::*[.//textarea][1]').innerText();
    const a = answers.find(([re]) => re.test(qText))?.[1] ?? { text: 'Mostly corporate onboarding cases in the UK and India.' };
    for (const chip of a.chips ?? []) {
      const b = p.getByRole('button', { name: chip, exact: true });
      if (await b.count()) await c.click(b.first(), { hold: 250 });
    }
    if (a.text) await c.type(p.locator('#answer'), a.text);
    if (await p.getByRole('button', { name: 'Send' }).isDisabled()) await c.type(p.locator('#answer'), 'Corporate onboarding and periodic reviews in the UK and India.');
    await c.click(p.getByRole('button', { name: 'Send' }));
    await expect(p.getByRole('button', { name: /Saving/ })).toHaveCount(0, { timeout: 90_000 });
    if (narrate && i === 0) await c.say('Most answers are one tap; the assistant never decides anything', 'Never type customer names, account or ID numbers');
  }
  if (narrate) await c.say('Everything picked up from the answers must be confirmed by the candidate');
  const tab = p.getByRole('tab', { name: /Your SME profile/ });
  if (await tab.isVisible().catch(() => false)) await c.click(tab);
  for (let i = 0; i < 25; i++) {
    const confirm = p.getByRole('button', { name: 'Confirm', exact: true });
    if (!(await confirm.count())) break;
    await c.click(confirm.first(), { hold: 400 });
  }
}

/** Profile review page: required statements, then submit. */
async function submitProfile(c: Clip, narrate: boolean) {
  const p = c.page;
  await c.click(p.getByRole('link', { name: /Review and submit/ }).first());
  if (narrate) await c.say('Review the profile, add optional evidence, and submit', 'Evidence: PDF, Word, PNG or JPG up to 10 MB; never customer data or ID documents');
  await c.click(p.getByLabel(/information in my profile is accurate/));
  await c.click(p.getByLabel(/may use my answers and uploaded files/));
  await c.click(p.getByRole('button', { name: 'Confirm and submit' }));
  await expect(p.getByRole('heading', { name: 'Profile submitted' })).toBeVisible({ timeout: 30_000 });
  if (narrate) await c.say('A person reviews every application', 'Software never makes the decision');
}

async function verifyIdentity(c: Clip, narrate: boolean) {
  const p = c.page;
  const h = p.getByRole('heading', { name: 'Verify your identity' });
  if (!(await h.waitFor({ timeout: 15_000 }).then(() => true, () => false))) return; // already verified
  if (narrate) await c.say('First, a one-time identity check', 'ADI Praxis keeps only the result: never document images or ID numbers');
  await c.click(p.getByRole('button', { name: /Start verification|Continue verification/ }));
  await expect(p.getByText(/Simulate the Stripe Identity result/)).toBeVisible({ timeout: 30_000 });
  if (narrate) await c.say('Test environment: the identity provider is simulated', 'Choose the outcome to test');
  await c.click(p.getByRole('button', { name: 'Verified (18 or over)' }));
  await expect(p.getByText(/Identity verified/).first()).toBeVisible({ timeout: 60_000 });
  const cont = p.getByRole('button', { name: 'Continue' }).or(p.getByRole('link', { name: 'Continue' }));
  if (await cont.first().isVisible().catch(() => false)) await c.click(cont.first());
}

test('07 SME: a partner-invited expert signs in, verifies and applies', async ({ browser }) => {
  const c = await Clip.start(browser, '07-sme-apply');
  const p = c.page;
  await c.title('Expert: from invite to application', 'Ravi was put forward by a staffing partner. He signs in, verifies his identity and builds his SME profile');
  await p.goto(state.raviInvite);
  await c.say('Ravi opens the invite link from his email', 'He signs in with the same email the partner used');
  await candidateSignIn(c, state.raviEmail, 'Ravi Kumar', new URL(state.raviInvite).pathname);
  await verifyIdentity(c, true);
  await p.waitForURL(/\/enrollments\//, { timeout: 60_000 }).catch(async () => { await p.goto(state.raviInvite); await p.waitForURL(/\/enrollments\//, { timeout: 60_000 }); });
  remember('raviEnrollmentUrl', p.url());
  await c.say('The SME profile is a short chat', 'Six questions, most answered with a tap; it saves as you go');
  await profileChat(c, true);
  await submitProfile(c, true);
  await c.end();

  // Asha applies to the project's opportunity directly (not filmed in full; the same steps as Ravi).
  const a = await Clip.start(browser, 'zz-asha-apply');
  const email = `asha.demo.${Date.now().toString(36)}@example.test`;
  remember('ashaEmail', email);
  await a.page.goto(`${ENV.candidate}/opportunities`);
  await a.click(a.page.getByRole('link', { name: /View details/ }).first());
  await a.click(a.page.getByRole('button', { name: /Apply: build my SME profile/ }));
  await candidateSignIn(a, email, 'Asha Verma');
  await verifyIdentity(a, false);
  if (!/\/enrollments\//.test(a.page.url())) {
    await a.page.goto(`${ENV.candidate}/opportunities`);
    await a.click(a.page.getByRole('link', { name: /View details/ }).first());
    await a.click(a.page.getByRole('button', { name: /Apply: build my SME profile/ }));
  }
  await a.page.waitForURL(/\/enrollments\//, { timeout: 60_000 });
  remember('ashaEnrollmentUrl', a.page.url());
  await profileChat(a, false);
  await submitProfile(a, false);
  await a.end();
});

test('08 validator: select applicants', async ({ browser }) => {
  const c = await Clip.start(browser, '08-validator-select');
  const p = c.page;
  await c.title('Validator: deciding applications', 'AI gives a recommendation with citations. A person makes every decision');
  await staffLogin(c, 'validator', { narrate: true });
  await menu(c, 'Reviews', 'Applications');
  for (const [who, narrate] of [['Ravi Kumar', true], ['Asha Verma', false]] as const) {
    await expect(p.getByRole('link', { name: new RegExp(who) }).first()).toBeVisible({ timeout: 120_000 });
    await c.click(p.getByRole('link', { name: new RegExp(who) }).first());
    if (narrate) {
      await c.say('Criteria and assessment: met, partially met, not met or unknown, with the profile items cited', 'A recommendation only: check the cited items');
      await c.scroll(600);
      await c.say('The submitted profile, roles, and any credentials and evidence');
      await c.scroll(600);
    }
    await c.click(p.getByLabel('Select for this pool'));
    await c.type(p.getByLabel(/^Reason \(task-related/), 'Meets the KYC onboarding and EDD criteria with relevant recent roles.');
    const domain = p.getByLabel(/^Domain/);
    if (!(await domain.inputValue().catch(() => ''))) await c.type(domain, 'Banking');
    const roles = p.getByLabel('Task author');
    if (await roles.isVisible().catch(() => false)) if (!(await roles.isChecked())) await c.click(roles);
    await c.type(p.getByLabel(/^Message to the candidate/), 'Welcome to the pool. Next, complete your onboarding checklist.');
    if (narrate) await c.say('The message is respectful and specific to this pool', 'The reason is kept for the record');
    await c.click(p.getByRole('button', { name: 'Record decision' }));
    await expect(p.getByText(/Selected/).first()).toBeVisible({ timeout: 30_000 });
    await menu(c, 'Reviews', 'Applications');
  }
  await c.say('Both experts are selected', 'They now see “Selected” and start onboarding');
  await c.end();
});

/** The seven standard onboarding steps (plus extra steps for requisition applicants, which tick themselves). */
async function onboarding(c: Clip, narrate: boolean) {
  const p = c.page;
  await p.goto(`${ENV.candidate}/home`);
  await c.click(act(p, /Start onboarding|Continue onboarding/));
  await expect(p.getByRole('heading', { name: 'Onboarding', exact: true })).toBeVisible();
  if (narrate) await c.say('Onboarding is a short checklist', 'You can stop and come back at any time');
  const steps: [RegExp, () => Promise<void>, string][] = [
    [/Confirm your approved scope/, async () => c.click(act(p, 'This is correct')), 'Check the scope the Validator approved'],
    [/^Contributor terms/, async () => c.click(act(p, 'I have read and accept these terms')), 'Read and accept the contributor terms'],
    [/Confidentiality and IP/, async () => c.click(act(p, 'I have read and accept these terms')), 'Confidentiality and intellectual property'],
    [/^Data use/, async () => c.click(act(p, 'I have read and accept these terms')), 'How contributions and data are used'],
    [/Conflicts and authorisation/, async () => {
      await c.click(p.getByLabel('No', { exact: true }));
      await c.click(p.getByLabel(/I will contribute only original material/));
      await c.click(act(p, 'Save'));
    }, 'Declare any employer or customer conflicts'],
    [/Task guidance/, async () => c.click(act(p, 'I understand')), 'How tasks are structured: synthetic data only, and another expert reviews every task'],
    [/Work preferences/, async () => {
      const country = p.getByLabel(/^Country you work from/).and(p.locator('select'));
      if (!(await country.inputValue())) await pick(c, country, /India/);
      const lang = p.locator('select').filter({ has: p.locator('option', { hasText: 'English' }) }).first();
      if (await lang.isVisible().catch(() => false) && !(await lang.inputValue())) await pick(c, lang, /English/);
      await c.click(act(p, 'Save'));
    }, 'Country, languages, time zone and weekly hours, used only for matching'],
  ];
  for (const [title, run, say] of steps) {
    const row = p.getByRole('listitem').getByRole('button', { name: new RegExp(title.source.replace(/^\^/, '')) }).first();
    if (!(await row.count())) continue; // not in this checklist
    if (/Done$/.test((await row.textContent()) ?? '')) continue;
    if ((await row.getAttribute('aria-expanded')) !== 'true') await c.click(row);
    if (narrate) await c.say(say);
    await run();
    await c.pause(800);
  }
}

test('09 SME: onboarding checklist', async ({ browser }) => {
  const c = await Clip.start(browser, '09-sme-onboarding');
  await c.title('Expert: onboarding', 'Asha was selected. A short checklist before she can receive work');
  await candidateSignIn(c, state.ashaEmail, 'Asha Verma');
  await c.say('Home shows the next step: start onboarding');
  await onboarding(c, true);
  await expect(c.page.getByText(/You’re all set/)).toBeVisible({ timeout: 30_000 });
  await c.say('Onboarding is complete', 'A proposal appears on Home when a project needs her');
  await c.end();
});

test('10 PM: assign an expert to the project', async ({ browser }) => {
  const c = await Clip.start(browser, '10-pm-staffing');
  const p = c.page;
  await c.title('Program Manager: staffing', 'Match selected, onboarded experts to the project and send proposals');
  await staffLogin(c, 'pm');
  await menu(c, 'Projects', 'Projects');
  await c.click(p.getByRole('link', { name: 'KYC authoring demo' }));
  await c.click(act(p, /^(Start staffing|Resource assignment)$/));
  await c.say('Resource assignment ranks eligible experts by match score', 'Select a score to see how it is made up');
  await c.click(act(p, 'Re-run match'));
  const row = p.getByRole('row').filter({ hasText: 'Asha Verma' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await c.click(row.getByRole('button', { name: 'Assign', exact: true }));
  await c.say('Assigning sends a proposal', 'The expert has 7 days to accept; only accepted experts count');
  await c.end();
});

const INTERVIEW: [RegExp, { chips?: number; text?: string }][] = [
  [/Describe the case|case you have in mind|describe/i, { text: 'A UK holding company opening a business account; two corporate layers, a trust at the top and a director with a sanctions near match.' }],
  [/new onboarding or a periodic refresh/i, { chips: 1 }],
  [/wrong or missing/i, { chips: 2 }],
  [/order you would run/i, { chips: 4 }],
  [/ambiguous/i, { text: 'The sanctions screening returned a near match on the director’s name with a different date of birth.' }],
  [/right outcome/i, { chips: 1 }],
  [/risk rating/i, { chips: 1 }],
  [/junior would miss/i, { text: 'They would stop at the first corporate layer and miss the trust’s settlor as a beneficial owner.' }],
];

test('11 SME: accept the assignment and write a KYC task with the AI interview', async ({ browser }) => {
  const c = await Clip.start(browser, '11-sme-task');
  const p = c.page;
  await c.title('Expert: writing a KYC task', 'Accept the proposal, answer a short interview, check the AI draft section by section, and submit');
  await candidateSignIn(c, state.ashaEmail, 'Asha Verma');
  await c.say('A proposal is waiting: the role, effort per task, deadline and compensation');
  const accept = act(p, 'Accept');
  if (await accept.waitFor({ timeout: 10_000 }).then(() => true, () => false)) await c.click(accept);
  await c.click(act(p, 'Open workbench'));
  await p.waitForURL(/\/projects\//, { timeout: 60_000 });
  await c.say('The project’s task list', 'Each task fills a coverage slot, so the dataset stays diverse');
  const next = act(p, 'Get next task');
  if (await next.isEnabled()) await c.click(next);
  else await c.click(p.getByRole('region', { name: 'Your tasks' }).getByRole('link').first());
  await p.waitForURL(/\/tasks\//, { timeout: 60_000 });
  remember('ashaTaskUrl', p.url());
  await c.say('W00: how do you want to start?', 'Interview, your own document, a transcript, or write it yourself');
  await c.click(p.getByRole('button', { name: /Answer a short interview/ }));
  await c.say('Eight quick questions, mostly taps', 'Describe the pattern, never a real customer');
  for (let i = 0; i < 10; i++) {
    if (await p.getByText(/Interview complete/).isVisible().catch(() => false)) break;
    const box = p.locator('#interview-answer');
    await box.waitFor({ timeout: 60_000 });
    const q = await box.locator('xpath=ancestor::form[1]').innerText();
    const a = INTERVIEW.find(([re]) => re.test(q))?.[1] ?? { chips: 1 };
    const chips = box.locator('xpath=ancestor::form[1]').getByRole('button', { pressed: false }).filter({ hasNotText: /Send|Skip|Why we ask/ });
    for (let k = 0; k < (a.chips ?? 0) && (await chips.count()); k++) await c.click(chips.first(), { hold: 300 });
    if (a.text) await c.type(box, a.text);
    if (await p.getByRole('button', { name: 'Send', exact: true }).isDisabled()) await c.type(box, 'Corporate onboarding with layered ownership.');
    await c.click(p.getByRole('button', { name: 'Send', exact: true }));
    await expect(p.getByRole('button', { name: 'Saving…' })).toHaveCount(0, { timeout: 60_000 });
  }
  await c.say('Draft my task: the assistant writes a first draft of every section', 'About a minute; you can leave and come back');
  await c.click(p.getByRole('button', { name: 'Draft my task' }));
  await expect(p.getByText('Writing your draft…')).toHaveCount(0, { timeout: 20 * 60_000 });
  await p.waitForLoadState('networkidle');
  const nav = p.getByRole('navigation', { name: 'Workbench sections' });
  for (const [id, say] of [
    ['W01', 'W01 Slot brief: title, difficulty, jurisdiction, and the slot this case fills'],
    ['W02', 'W02 Scenario and customer file: synthetic parties and ownership'],
    ['W03', 'W03 Evidence and recorded tool calls, so RL Gym can replay the task exactly'],
    ['W04', 'W04 Reference trajectory: the steps, findings, disposition and the hand-off to a human'],
    ['W05', 'W05 Rubric and failure modes'],
  ] as const) {
    await c.click(nav.getByRole('button', { name: new RegExp(`^${id}`) }));
    await c.say(say, id === 'W01' ? 'Each drafted section says “AI draft: check and confirm”' : '');
    await c.scroll(500, 900);
    const ok = p.getByRole('button', { name: 'I’ve checked this section' });
    if (await ok.isVisible().catch(() => false)) await c.click(ok);
  }
  await c.click(nav.getByRole('button', { name: /^W06/ }));
  await c.say('W06: run the automated checks before submitting');
  await c.click(p.getByRole('button', { name: 'Run checks' }));
  await expect(p.getByRole('button', { name: 'Checking…' })).toHaveCount(0, { timeout: 60_000 });
  for (const why of await p.getByPlaceholder('Why this is not real data').all()) await c.type(why, 'Invented for this synthetic case using the SYN- formats.');
  await c.say('Possible real data must be replaced or explained; similar tasks are shown so the case stays distinct');
  await c.click(p.getByLabel(/This case is entirely synthetic/));
  await c.click(p.getByRole('button', { name: 'Submit for review' }));
  await expect(p.getByText(/Submitted\. A Validator will look at it/)).toBeVisible({ timeout: 60_000 });
  await c.say('Submitted: a Validator reviews it next');
  await c.end();
});

test('12 validator: review and accept the task', async ({ browser }) => {
  const c = await Clip.start(browser, '12-validator-task');
  const p = c.page;
  await c.title('Validator: reviewing a task', 'Check how it was made, the automated checks and similar tasks; then accept, request rework or reject');
  await staffLogin(c, 'validator');
  await menu(c, 'Reviews', 'Task reviews');
  await c.click(p.getByRole('listitem').filter({ hasText: /Asha Verma/ }).getByRole('link').first());
  await c.say('How this task was made: which sections were AI-drafted and whether the author edited them');
  await c.scroll(600);
  await c.say('Automated checks, and the closest existing tasks side by side');
  await c.scroll(700);
  await c.say('The task itself: scenario, evidence and tool calls, trajectory and rubric');
  await c.scroll(900);
  await c.scroll(900);
  await c.say('The checklist: every item must be Yes to accept');
  for (const yes of await p.getByRole('radio', { name: 'Yes', exact: true }).all()) await c.click(yes, { hold: 250 });
  await c.click(p.getByRole('radio', { name: /^Accept/ }));
  await c.say('Accepting writes the task into the Approved Task Dataset', 'Append-only: it never changes');
  await c.click(p.getByRole('button', { name: 'Record decision' }));
  await p.waitForURL(/\/review\/tasks$/, { timeout: 60_000 });
  await c.end();
});

test('13 validator: RL Gym review', async ({ browser }) => {
  // RL Gym sends a result for the accepted task (behind the scenes, with the key from clip 03).
  const admin = await staffApi(browser, 'admin');
  const recs = await admin.get('dataset/records');
  const rec = (recs.items ?? recs)[0];
  const sample = JSON.parse(require('node:fs').readFileSync(path.join(SAMPLES, 'rl-review-request.json'), 'utf8'));
  sample.rl_run_id = `demo-video-${Date.now().toString(36)}`;
  sample.source_record_ids = [rec.id];
  const r = await admin.ctx.request.post(`${ENV.api}/api/v1/integrations/rl-gym/review-requests`, { data: sample, headers: { authorization: `Bearer ${state.rlGymKey}`, 'idempotency-key': crypto.randomUUID() } });
  expect(r.ok(), await r.text()).toBeTruthy();
  await admin.ctx.close();

  const c = await Clip.start(browser, '13-validator-rl');
  const p = c.page;
  await c.title('Validator: RL Gym review', 'RL Gym ran an agent on an accepted task. A person gives the verdict');
  await staffLogin(c, 'validator');
  await menu(c, 'Reviews', 'RL reviews');
  await c.click(p.getByRole('link').filter({ hasText: sample.rl_run_id }).first());
  const claim = p.getByRole('button', { name: 'Claim this review' });
  if (await claim.waitFor({ timeout: 10_000 }).then(() => true, () => false)) await c.click(claim);
  await c.say('The original approved task, the agent’s trajectory, and the automated evals');
  await c.scroll(500);
  await c.say('Agree or disagree with each automated eval', 'A disagreement needs a reason');
  const agree = p.getByRole('radio', { name: 'Agree', exact: true });
  for (let i = 0; i < (await agree.count()); i++) {
    await c.click(agree.nth(i), { hold: 250 });
    if (!(await agree.nth(i).isChecked())) await agree.nth(i).check();
  }
  await c.click(p.getByRole('radio', { name: /^fail$/i }));
  await c.click(act(p, 'Add a general comment'));
  await c.type(p.getByPlaceholder('What went wrong, and where'), 'The agent never identified the trust’s settlor as a beneficial owner.');
  const code = p.locator('select').filter({ has: p.locator('option', { hasText: 'No reason code' }) }).first();
  if (await code.isVisible().catch(() => false)) await pick(c, code, /./);
  await c.say('A fail needs at least one comment', 'The verdict is permanent and sent to RL Gym');
  await c.click(p.getByRole('button', { name: 'Submit verdict' }));
  await expect(p.getByText(/Verdict:/)).toBeVisible({ timeout: 30_000 });
  await c.say('Delivery to RL Gym is shown on the same page');
  await c.end();
});

test('14 SME: course, certification test and payment set-up', async ({ browser }) => {
  // Ravi's onboarding steps are the same as Asha's; done before filming.
  const pre = await Clip.start(browser, 'zz-ravi-onboarding');
  await candidateSignIn(pre, state.raviEmail, 'Ravi Kumar');
  await onboarding(pre, false);
  await pre.end();

  const c = await Clip.start(browser, '14-sme-certification');
  const p = c.page;
  await c.title('Expert: course and certification', 'Requisition roles need a course on the guidelines and a timed certification test. Then payment set-up');
  await candidateSignIn(c, state.raviEmail, 'Ravi Kumar');
  await c.click(p.getByRole('link', { name: 'Certifications', exact: true }).first());
  await c.say('Each role has a short course on its guidelines, then a timed test');
  await c.click(act(p, /Start the course|Continue the course/));
  await p.waitForURL(/\/certifications\/[0-9a-f-]{36}$/);
  const certId = p.url().split('/').pop()!;
  const me = await api(c.ctx, ENV.candidate);
  for (let m = 0; m < 20; m++) {
    const course = await me.get(`me/certifications/${certId}/course`);
    const mod = (course.modules as { id: string; completed: boolean; locked: boolean; quiz?: { options: string[] }[] }[]).find((x) => !x.completed && !x.locked);
    if (!mod) break;
    // Learn the right answers behind the scenes (wrong attempts are allowed and do not count).
    const quiz = mod.quiz ?? [];
    const right: number[] = quiz.map(() => 0);
    let passedOffCamera = false;
    for (let k = 0; k < Math.max(...quiz.map((q) => q.options.length), 1); k++) {
      const r = await me.post(`me/certifications/${certId}/modules/${mod.id}/complete`, { answers: quiz.map(() => k) });
      (r.feedback as string[]).forEach((f, i) => { if (f === 'Correct.') right[i] = k; });
      if (r.passed) { passedOffCamera = true; break; }
    }
    await p.reload();
    if (m === 0) await c.say('Modules open one after another', 'Read the explanation, good and bad examples, and practise');
    await c.scroll(700, 900);
    if (!passedOffCamera) {
      if (m === 0) await c.say('Each module ends with a quiz: 80% to pass, and you can retry straight away');
      const sets = p.locator('form fieldset');
      for (let i = 0; i < right.length; i++) await c.click(sets.nth(i).locator('input[type=radio]').nth(right[i]!), { hold: 200 });
      await c.click(act(p, 'Check my answers'));
      await expect(p.getByText(/Well done: you passed this module/)).toBeVisible({ timeout: 30_000 });
    }
    const next = act(p, /Next module|Finish the course/);
    if (await next.isVisible().catch(() => false)) await c.click(next);
  }
  await p.goto(`${ENV.candidate}/certifications/${certId}/test`);
  await c.say('Before the test: it is timed, answers save as you go, and you have up to 3 attempts');
  await c.click(act(p, /Take the selfie check/));
  await expect(act(p, /Start the test now/)).toBeVisible({ timeout: 60_000 });
  await c.say('A selfie check before every attempt', 'Simulated in the test environment; only the result is kept');
  await c.click(act(p, /Start the test now/));
  await expect(p.getByText(/Question 1 of \d+/)).toBeVisible({ timeout: 120_000 });
  await c.say('A countdown stays on screen; every candidate gets different but equivalent questions', 'This demo picks answers without knowing them, so the result is whatever they earn');
  for (let i = 0; i < 120; i++) {
    const main = p.locator('main');
    const radio = main.locator('input[type=radio]:not(:disabled)');
    const box = main.locator('input[type=checkbox]:not(:disabled)');
    const none = act(p, 'No step breaks the guidelines');
    const order = act(p, 'This order is my answer');
    const text = main.locator('textarea');
    if (await none.isVisible().catch(() => false)) await c.click(none, { hold: 200 });
    else if (await order.isVisible().catch(() => false)) await c.click(order, { hold: 200 });
    else if (await radio.count()) await c.click(radio.first(), { hold: 200 });
    else if (await box.count()) await c.click(box.first(), { hold: 200 });
    else if (await text.count()) await c.type(text.first(), 'Check the registry, resolve every owner above 25%, screen all controllers, then escalate the high-risk case to an authorised person with the evidence.');
    const next = p.getByRole('button', { name: 'Next →' });
    if (!(await next.isVisible().catch(() => false)) || (await next.isDisabled())) break;
    await c.click(next, { hold: 300 });
  }
  await c.click(p.getByRole('button', { name: 'Submit test' }).first());
  await c.click(p.getByRole('button', { name: 'Yes, submit my test' }));
  await expect(p.getByRole('heading', { name: /You passed|You didn’t pass this time|being reviewed by a person/ })).toBeVisible({ timeout: 120_000 });
  await c.say('The result shows a band for each section', 'Questions and answers are never shown, so every form stays fair. A retake has new questions');
  await c.scroll(500);
  await c.click(p.getByRole('link', { name: 'Payments', exact: true }).first());
  await c.say('Payments: set up how you are paid', 'The payout provider collects tax and bank details; ADI Praxis never sees them');
  const popup = p.waitForEvent('popup');
  await c.click(act(p, /Set up payments/));
  const tab = await popup;
  await tab.waitForLoadState('networkidle');
  await tab.getByRole('button', { name: /Finish and return/ }).or(tab.getByRole('link', { name: /Finish and return/ })).first().click();
  await tab.close().catch(() => {});
  await p.bringToFront();
  await c.click(act(p, 'Check my status'));
  await c.say('Payment set-up is ready', 'Each task a person accepts earns from the rate card; payouts go out weekly');
  await c.end();
});

test('15 finance: rate cards, earnings, pay run, reconciliation and statements', async ({ browser }) => {
  const c = await Clip.start(browser, '15a-finance');
  const p = c.page;
  await c.title('Finance', 'Rate cards, earnings and holds, the weekly pay run, reconciliation and partner statements');
  await staffLogin(c, 'finance', { narrate: true });
  await menu(c, 'Payments');
  await c.click(p.getByRole('link', { name: 'Rate cards', exact: true }));
  await c.say('Rate cards: what an SME earns per accepted task', 'A rate card never changes; a new rate is a new version');
  await c.click(p.getByRole('link', { name: 'Earnings and holds', exact: true }));
  await c.say('Earnings are written once, when a person accepts a task', 'A correction is a reversal entry. A hold keeps an SME out of pay runs');
  await maybe(c, act(p, 'Show all'));
  await c.pause(1500);
  await c.click(p.getByRole('link', { name: 'Pay runs', exact: true }));
  await c.say('One pay run a week: built, confirmed by a PM, then approved and submitted by Finance');
  await c.click(act(p, 'Build pay run'));
  await c.pause(2500);
  if (!/\/pay-runs\/[0-9a-f-]{36}/.test(p.url())) await c.click(p.getByRole('row').nth(1).getByRole('link').first());
  remember('payRunUrl', p.url());
  // On a shared environment, only move a run forward when it pays nobody, so testers' pay runs are left alone.
  const payments = Number((await p.getByRole('heading', { name: /^Payments \(\d+\)/ }).innerText().catch(() => '(0)')).match(/\((\d+)\)/)?.[1] ?? 0);
  remember('payRunMayAdvance', String(ENV.local || payments === 0));
  await c.say('Payments, held amounts and balances carried to next week', 'Waiting for a PM to confirm');
  await c.end();

  const pmClip = await Clip.start(browser, '15b-pm-confirm');
  await pmClip.title('Program Manager: confirm the pay run', 'The PM checks the week and confirms it', 3);
  await staffLogin(pmClip, 'pm');
  await pmClip.page.goto(state.payRunUrl);
  const confirm = act(pmClip.page, 'Confirm pay run');
  if (state.payRunMayAdvance === 'true' && (await confirm.isVisible().catch(() => false))) {
    await pmClip.click(confirm);
    await pmClip.say('Confirmed: Finance can now approve it');
  }
  await pmClip.end();

  const f = await Clip.start(browser, '15c-finance');
  const q = f.page;
  await f.title('Finance: approve, submit and reconcile', 'Finance never approves a run that pays them', 3);
  await staffLogin(f, 'finance');
  await q.goto(state.payRunUrl);
  const advance = state.payRunMayAdvance === 'true';
  if (!advance) await f.say('Next: Finance approves, then submits to the payout provider', 'This shared run is left for the testers');
  const approve = act(q, 'Approve pay run');
  if (advance && (await approve.isVisible().catch(() => false))) {
    await f.click(approve);
    await f.say('Approved');
  }
  const submit = act(q, 'Submit to payout provider');
  if (advance && (await submit.isVisible().catch(() => false))) {
    await f.click(submit);
    await f.say('Submitted to the payout provider', 'Payees are checked again; a retry never pays anyone twice');
  }
  await menu(f, 'Payments');
  await f.click(q.getByRole('link', { name: 'Payout exceptions', exact: true }));
  await f.say('Reconciliation compares the provider’s daily report with our payments', 'Every mismatch becomes an exception to resolve with a note');
  if (ENV.local) await f.click(act(q, 'Run reconciliation'));
  await f.pause(2500);
  await f.click(q.getByRole('link', { name: 'Partner statements', exact: true }));
  await f.say('Partner statements: one fee line for each certified candidate, built monthly');
  if (ENV.local) await f.click(act(q, 'Build statements'));
  await f.pause(2500);
  await f.end();
});

test('16 clean-up: revoke the RL Gym key the videos created', async ({ browser }) => {
  const admin = await staffApi(browser, 'admin');
  const keys = await admin.get('api-clients');
  for (const k of (keys.items ?? keys) as { id: string; name: string; revokedAt?: string | null }[]) {
    if (k.name.startsWith(DEMO) && !k.revokedAt) await admin.post(`api-clients/${k.id}/revoke`).catch(() => {});
  }
  await admin.ctx.close();
});
