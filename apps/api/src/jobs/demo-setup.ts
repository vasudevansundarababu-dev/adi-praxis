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

  if ((await call('p', 'GET', '/projects')).items.some((p: { name: string }) => p.name === 'KYC authoring demo')) {
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
  const p = await call('p', 'POST', '/projects', { templateId: t.id, name: 'KYC authoring demo', distinctTarget: 12, maxPerExpert: 12, tptMinutes: 90, startDate: d(start), endDate: d(end), jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: false }] });
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
    await call('a', 'POST', `/partners/${partner.id}/users`, { email: 'partner@praxis.demo', name: 'Meera Nair', password: partnerPw });
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
