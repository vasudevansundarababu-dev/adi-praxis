import { EXECUTABLE_WORKFLOW } from '@praxis/shared';
import { hashPassword } from '../auth/password';
import type { Db } from '../db';
import { seed } from '../../prisma/seed';

/**
 * Demo environment only: the client, an Admin, a PM and a Reviewer, and a published KYC authoring project with its
 * opportunity page, so the candidate journey can be tried end to end. Idempotent. Uses the public API for everything
 * a PM or Admin would do, so the same rules and audit trail apply.
 */
export async function demoSetup(db: Db, env: NodeJS.ProcessEnv, log: (level: string, message: string, extra?: object) => void) {
  const api = env.API_URL;
  const pw = { admin: env.DEMO_ADMIN_PASSWORD, pm: env.DEMO_PM_PASSWORD, reviewer: env.DEMO_REVIEWER_PASSWORD };
  if (!api || !pw.admin || !pw.pm || !pw.reviewer) throw new Error('API_URL and DEMO_*_PASSWORD are required');
  const { client } = await seed(db, { ...env, SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: pw.admin });
  for (const [email, name, role, password] of [['pm@praxis.demo', 'Pat Morgan', 'PM', pw.pm], ['reviewer@praxis.demo', 'Riley Chen', 'REVIEWER', pw.reviewer]] as const) {
    if (!(await db.user.findUnique({ where: { email } }))) {
      await db.user.create({ data: { clientId: client.id, email, name, roles: [role], passwordHash: await hashPassword(password) } });
    }
  }

  const jar: Record<string, string> = {};
  async function call(who: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${api}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), cookie: jar[who] ?? '' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    const c = r.headers.get('set-cookie');
    if (c) jar[who] = c.split(';')[0]!;
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`);
    return j as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  await call('a', 'POST', '/auth/login', { email: 'admin@praxis.demo', password: pw.admin });
  await call('p', 'POST', '/auth/login', { email: 'pm@praxis.demo', password: pw.pm });

  await executableDemoSetup(call, log);
  await executableDemoSetup(call, log, true);

  if (await projectNamed(call, 'KYC authoring demo')) {
    log('info', 'demo project already exists');
    await supplySetup(db, client.id, env, call, log);
    return;
  }
  const t = (await call('a', 'GET', '/templates')).items.find((x: { workflowName: string }) => x.workflowName === 'KYC onboarding and refresh');
  if (!t) throw new Error('KYC template missing: is TASKFLOW_PATH set?');
  if (t.status === 'DRAFT') {
    await call('a', 'PATCH', `/templates/${t.id}`, { defaultTptMinutes: 90, skills: ['KYC', 'EDD'], taskModes: ['AUTHORING'] });
    await call('a', 'POST', `/templates/${t.id}/publish`);
  }
  const reviewerId = (await call('a', 'GET', '/users')).items.find((u: { email: string }) => u.email === 'reviewer@praxis.demo').id;
  const jd = await call('p', 'POST', '/job-descriptions', { title: 'KYC Analyst (task author)', responsibilities: 'Write realistic, fully synthetic KYC onboarding cases with their correct solution and rubric.', skills: ['KYC', 'EDD'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' });
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(Date.now() + 45 * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  // 12 distinct tasks, up to 12 per expert: one selected expert can staff the demo project on their own.
  const p = await call('p', 'POST', '/projects', { authoringExperience: 'BOTH', templateId: t.id, name: 'KYC authoring demo', distinctTarget: 12, maxPerExpert: 12, tptMinutes: 90, startDate: d(start), endDate: d(end), jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] });
  await call('p', 'POST', `/projects/${p.id}/submit`);
  await call('p', 'POST', `/projects/${p.id}/match`);
  await call('p', 'POST', `/projects/${p.id}/opportunity/publish`);
  await call('p', 'POST', `/projects/${p.id}/reviewers`, { userId: reviewerId });
  const opp = await call('p', 'GET', `/projects/${p.id}/opportunity`);
  log('info', 'demo project ready', { projectId: p.id, opportunityId: opp.opportunityId ?? opp.id });
  await supplySetup(db, client.id, env, call, log);
}

type Call = (who: string, method: string, path: string, body?: unknown) => Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * M10 test data (only with SME_SUPPLY_ENABLED and the extra demo passwords): a Finance user, a partner with a portal
 * login, a USD rate card and an open SME-supply requisition on the demo project (direct pay, careers page on).
 * Guidelines are not uploaded: testers upload them. Idempotent.
 */
async function supplySetup(db: Db, clientId: string, env: NodeJS.ProcessEnv, call: Call, log: (level: string, message: string, extra?: object) => void) {
  if (!['true', '1'].includes(env.SME_SUPPLY_ENABLED ?? '')) return;
  const finance = env.DEMO_FINANCE_PASSWORD;
  const partnerPw = env.DEMO_PARTNER_PASSWORD;
  if (!finance || !partnerPw) {
    log('warn', 'SME supply demo data skipped: DEMO_FINANCE_PASSWORD and DEMO_PARTNER_PASSWORD are not set');
    return;
  }
  if (!(await db.user.findUnique({ where: { email: 'finance@praxis.demo' } }))) {
    await db.user.create({ data: { clientId, email: 'finance@praxis.demo', name: 'Farah Iqbal', roles: ['FINANCE'], passwordHash: await hashPassword(finance) } });
  }
  const partners = (await call('a', 'GET', '/partners')).items as { id: string; name: string }[];
  let partner = partners.find((x) => x.name === 'Demo Staffing Partner');
  if (!partner) {
    partner = (await call('a', 'POST', '/partners', { name: 'Demo Staffing Partner', businessVerification: 'VERIFIED', allowedDomains: ['banking'], allowedTiers: ['ANNOTATOR', 'REVIEWER_SME', 'EXPERT'] })) as { id: string; name: string };
    await call('a', 'POST', `/partners/${partner.id}/users`, { email: 'partner@praxis.demo', name: 'Meera Nair', password: partnerPw, requirePasswordChange: false });
    await call('a', 'PUT', `/partners/${partner.id}/fee-terms`, { certifiedFee: '150', feeCurrency: 'USD', feeTermsVersion: 'Demo fees 2026-09' });
  }
  const cards = (await call('a', 'GET', '/rate-cards')).items as { id: string; name: string }[];
  const card = cards.find((x) => x.name === 'KYC authoring (USD)') ?? (await call('a', 'POST', '/rate-cards', { name: 'KYC authoring (USD)', currency: 'USD', perTask: { AUTHORING: '40', ANNOTATION: '8' } }));
  const title = 'KYC authors — India (Annotator)';
  if ((await call('p', 'GET', '/requisitions')).items.some((r: { title: string }) => r.title === title)) {
    log('info', 'SME supply demo data already exists');
    return;
  }
  const project = (await call('p', 'GET', '/projects')).items.find((p: { name: string }) => p.name === 'KYC authoring demo');
  await call('p', 'POST', `/projects/${project.id}/sme-supply`, { enabled: true });
  const r = await call('p', 'POST', '/requisitions', {
    projectId: project.id,
    title,
    summary: 'Annotate synthetic KYC onboarding cases for a UK and India bank workflow. Training and certification are provided.',
    domain: 'banking',
    tier: 'ANNOTATOR',
    headcount: 20,
    hoursPerWeek: 10,
    languages: ['en'],
    jurisdictions: ['IN', 'GB'],
    minimumRequirements: { minYears: 2, qualifications: [], licenceRequired: false },
    allowedPartnerIds: [partner.id],
    directChannel: true,
    maxPerPartner: 50,
    payRoute: 'DIRECT',
  });
  await call('p', 'PUT', `/requisitions/${r.id}/rate-card`, { rateCardId: card.id });
  await call('p', 'POST', `/requisitions/${r.id}/transition`, { to: 'OPEN' });
  log('info', 'SME supply demo data ready', { partnerId: partner.id, requisitionId: r.id });
}

/** The client's project with this name (names are unique per client, case-insensitively), seen as Admin. */
async function projectNamed(call: Call, name: string): Promise<{ id: string; status: string } | undefined> {
  return (await call('a', 'GET', '/projects')).items.find((p: { name: string }) => p.name.toLowerCase() === name.toLowerCase());
}

/** Creates only reviewable demo configuration through public APIs. No task or rights approval is fabricated. */
export async function executableDemoSetup(call: Call, log: (level: string, message: string, extra?: object) => void, staged = false) {
  const name = staged ? 'SYNTHETIC TEST — Harbor staged marketing decisions' : 'SYNTHETIC TEST — Harbor marketing decisions';
  // Look up as Admin: a PM lists only their own projects, but project names are unique across the client, so a
  // same-named project owned by anyone else would otherwise make every re-run fail with 409 on create.
  const existing = await projectNamed(call, name);
  if (existing) {
    if (existing.status === 'DRAFT') await call('a', 'POST', `/projects/${existing.id}/submit`);
    if (['DRAFT', 'READY_FOR_STAFFING'].includes(existing.status)) await call('a', 'POST', `/projects/${existing.id}/synthetic-example`);
    log('info', 'synthetic executable project already exists', { projectId: existing.id, status: existing.status });
    return;
  }
  const domains = (await call('a', 'GET', '/domains')).items;
  const domain = domains.find((d: { name: string }) => d.name === 'Marketing') ?? await call('a', 'POST', '/domains', { name: 'Marketing' });
  let t = (await call('a', 'GET', '/templates')).items.find((x: { workflowName: string; domainId: string }) => x.workflowName === EXECUTABLE_WORKFLOW && x.domainId === domain.id);
  if (!t) t = await call('a', 'POST', '/templates', {
    domainId: domain.id, workflowName: EXECUTABLE_WORKFLOW,
    primaryWork: 'Author original synthetic marketing decisions using explicit executable rules. Single or sequential stages submit output.json with explicit grading and state projection.',
    verificationCriteria: 'Reference output satisfies every constraint and rubric binding. Hard failures zero the final reward in Anvil.',
    humanGate: 'Independent task review and separate rights review are required. This setup does not approve any authored task.',
    defaultTptMinutes: 30, skills: ['Marketing'], taskModes: ['AUTHORING'], openSlotShare: 0,
    coverageDimensions: { dimensions: [{ key: 'scenario', label: 'Scenario', values: ['launch_allocation'] }], cells: [{ tags: { scenario: 'launch_allocation' }, quota: 1, required: true }] },
    edgeCaseCatalog: [], defaultDistinctTarget: 1, defaultMaxPerExpert: 1,
  });
  if (t.status === 'DRAFT') await call('a', 'POST', `/templates/${t.id}/publish`);
  const jd = await call('p', 'POST', '/job-descriptions', { title: 'Synthetic marketing task author', responsibilities: 'Use the built-in synthetic decision example, inspect and edit the constraints, reference answer and rubric, and submit for independent human review.', skills: ['Marketing'], wagePerTask: 1, wageCurrency: 'USD', locationType: 'REMOTE' });
  const d = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const project = await call('p', 'POST', '/projects', { authoringExperience: 'BOTH', templateId: t.id, name, distinctTarget: 1, maxPerExpert: 1, tptMinutes: 30, startDate: d(1), endDate: d(30), jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] });
  await call('p', 'POST', `/projects/${project.id}/submit`);
  const example = await call('p', 'POST', `/projects/${project.id}/synthetic-example`);
  log('info', 'synthetic executable draft created; awaits staffing and real author/reviewer actions', { projectId: project.id, templateId: t.id, taskId: example.taskId });
}
