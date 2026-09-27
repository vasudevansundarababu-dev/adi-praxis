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
  const p = await call('p', 'POST', '/projects', { templateId: t.id, name: 'KYC authoring demo', distinctTarget: 12, maxPerExpert: 12, tptMinutes: 90, startDate: d(start), endDate: d(end), jobDescriptionId: jd.id, demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }] });
  await call('p', 'POST', `/projects/${p.id}/submit`);
  await call('p', 'POST', `/projects/${p.id}/match`);
  await call('p', 'POST', `/projects/${p.id}/opportunity/publish`);
  await call('p', 'POST', `/projects/${p.id}/reviewers`, { userId: reviewerId });
  const opp = await call('p', 'GET', `/projects/${p.id}/opportunity`);
  log('info', 'demo project ready', { projectId: p.id, opportunityId: opp.opportunityId ?? opp.id });
}
