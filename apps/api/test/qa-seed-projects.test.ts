import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { MockSuitabilityEvaluator } from '../src/candidate/suitability';
import {
  DEFAULT_SEED_TEMPLATE_ID,
  optionsFromEnv,
  parseQaSeedProjectsArgs,
  QA_SEED_PROJECTS_CONFIRM,
  qaSeedProjects,
  SEED_PROJECTS,
  targetStates,
  type QaSeedProjectsReport,
} from '../src/jobs/qa-seed-projects';
import type { Http } from '../src/jobs/qa-users';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * The QA seed-projects job against the real API in-process, every provider mocked (CLAUDE.md rule 5): mock Google
 * sign-in (Offline mode), hashing embeddings, mock models. The template is the KYC per-state form (QA's KYC v6: one
 * task per governing state, five). The job never approves, rejects, sends back or exports anything.
 */
const SECRET = 'test-mock-secret';
const PW = { admin: 'demo-admin-password-1', pm: 'demo-pm-password-123' };
const [LIFECYCLE, EXPORT] = SEED_PROJECTS as [(typeof SEED_PROJECTS)[number], (typeof SEED_PROJECTS)[number]];

describe('qa-seed-projects against the real API in-process (all providers mocked)', () => {
  let app: FastifyInstance;
  let clientId: string;
  let admin: string;
  let templateId: string;
  const config = testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() });
  const sent: { method: string; path: string }[] = [];
  /** A fresh client address per test: the in-process rate limiter keys on it and lives as long as the app. */
  let ip = 0;

  const http: Http = async ({ method, path, body, cookie, root, form }) => {
    sent.push({ method, path });
    let payload: string | Buffer | undefined = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { cookie: cookie ?? '', ...idem() };
    if (form) {
      const boundary = '----qaseed';
      const parts = Object.entries(form.fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${form.file.name}"\r\nContent-Type: ${form.file.type}\r\n\r\n${form.file.content}\r\n--${boundary}--\r\n`);
      payload = Buffer.from(parts.join(''), 'utf8');
      headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    } else if (payload !== undefined) headers['content-type'] = 'application/json';
    const r = await app.inject({ method: method as 'GET', url: `${root ? '' : '/api/v1'}${path}`, headers, payload, remoteAddress: `10.0.0.${ip}` });
    let parsed: unknown = null;
    try {
      parsed = r.body ? JSON.parse(r.body) : null;
    } catch {
      parsed = r.body;
    }
    return { status: r.statusCode, body: parsed, cookies: r.cookies.map((c) => `${c.name}=${c.value}`), retryAfterSeconds: null };
  };
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: { cookie: admin, ...idem() }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    app = await buildApp({ config, db, pingRedis: async () => true, google: new MockGoogleVerifier(SECRET), identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), evaluator: new MockSuitabilityEvaluator(), email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
  });
  beforeEach(async () => {
    await resetDb();
    sent.length = 0;
    ip++;
    // As QA stands: the demo Admin and PM, published terms, the new flow on with Offline sign-in, KYC per-state form.
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: PW.admin, TASKFLOW_PATH: '/none' });
    clientId = client.id;
    await db.user.create({ data: { clientId, email: 'pm@praxis.demo', name: 'Pat Morgan', roles: ['PM'], passwordHash: await hashPassword(PW.pm) } });
    admin = await login(app, 'admin@praxis.demo', PW.admin);
    expect((await inject('PUT', '/admin/forge-settings', { newFlow: true, candidateSignIn: 'OFFLINE' })).statusCode).toBe(200);
    const key = (await inject('POST', '/api-clients', { name: 'Anvil QA', kind: 'ANVIL' })).json().key;
    const packet = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8'));
    const proposed = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${key}`, ...idem() }, payload: packet });
    expect(proposed.statusCode, proposed.body).toBe(201);
    templateId = proposed.json().data.template_version_id as string;
    expect((await inject('POST', `/templates/${templateId}/publish`)).statusCode).toBe(200);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const env = { DEMO_ADMIN_PASSWORD: PW.admin, DEMO_PM_PASSWORD: PW.pm };
  const run = (apply: boolean, extraEnv: Record<string, string> = {}, appEnv = 'demo') =>
    qaSeedProjects({ ...optionsFromEnv({ ...env, QA_SEED_PROJECTS_TEMPLATE_ID: templateId, ...extraEnv }, appEnv, http, apply), now: () => new Date('2026-11-15T10:00:00Z'), pollMs: 1, sleep: async () => undefined }, () => undefined);
  const apply = () => run(true, { QA_SEED_PROJECTS_CONFIRM });
  const seedProjects = () => db.project.findMany({ where: { name: { in: SEED_PROJECTS.map((p) => p.name) } }, orderBy: { name: 'asc' } });
  const project = (r: QaSeedProjectsReport, key: string) => r.projects.find((p) => p.key === key)!;
  /** Requests that would make or record a decision, an export or a settings/terms change. */
  const forbidden = () =>
    sent.filter((x) => x.method !== 'GET' && (/\/decision$/.test(x.path) || /\/(exports?|validate)$/.test(x.path) || x.path.startsWith('/admin/') || x.path.startsWith('/terms') || /\/(pause|cancel)$/.test(x.path)));

  it('parses its arguments, defaults to QA KYC v6 and refuses production and an unconfirmed --apply', async () => {
    expect(parseQaSeedProjectsArgs([])).toEqual({ apply: false });
    expect(parseQaSeedProjectsArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseQaSeedProjectsArgs(['--force'])).toThrow(/Unknown qa-seed-projects argument "--force"/);
    expect(optionsFromEnv({}, 'demo', http, false).templateId).toBe(DEFAULT_SEED_TEMPLATE_ID);
    expect(targetStates('mixed', 5)).toEqual(['SUBMITTED', 'SUBMITTED', 'IN_PROGRESS', 'ASSIGNED', 'ASSIGNED']);
    expect(targetStates('all-submitted', 3)).toEqual(['SUBMITTED', 'SUBMITTED', 'SUBMITTED']);
    expect(() => targetStates('mixed', 3)).toThrow(/at least 4 tasks/);

    await expect(run(false, {}, 'production')).rejects.toThrow('qa-seed-projects refuses to run with APP_ENV=production');
    await expect(run(true, { QA_SEED_PROJECTS_CONFIRM }, 'production')).rejects.toThrow(/APP_ENV=production/);
    await expect(run(true)).rejects.toThrow(`--apply needs QA_SEED_PROJECTS_CONFIRM=${QA_SEED_PROJECTS_CONFIRM}`);
    await expect(run(true, { QA_SEED_PROJECTS_CONFIRM: 'yes' })).rejects.toThrow(/QA_SEED_PROJECTS_CONFIRM/);
    // Refused before any request.
    expect(sent).toEqual([]);
    expect(await seedProjects()).toEqual([]);
  });

  it('as a run.ts job: refuses APP_ENV=production even with --apply and the confirmation', () => {
    let out = '';
    let code = 0;
    try {
      execFileSync('npx', ['tsx', 'src/jobs/run.ts', 'qa-seed-projects', '--apply'], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL, API_URL: 'http://127.0.0.1:9', QA_SEED_PROJECTS_CONFIRM },
        encoding: 'utf8',
      });
    } catch (e) {
      const x = e as { status: number; stdout: string };
      code = x.status;
      out = x.stdout;
    }
    expect(code).toBe(1);
    expect(out).toMatch(/qa-seed-projects refuses to run with APP_ENV=production/);
  }, 60_000);

  it('dry run: signs in and reads only; plans both projects and creates nothing', async () => {
    const r = await run(false);
    expect(r).toMatchObject({ report: 'qa-seed-projects', ok: true, apply: false, templateId, reviewRoute: 'SME_PM', approvalLinks: [], totalPaidCalls: 0, estimatedCostUsd: 0 });
    for (const p of r.projects) expect(p).toMatchObject({ projectId: null, created: false, tasks: [], planned: expect.arrayContaining(['create project (Author → PM/Admin)']) });
    expect(sent.filter((x) => x.method !== 'GET').map((x) => x.path)).toEqual(['/auth/login', '/auth/login']);
    expect(await seedProjects()).toEqual([]);
    expect(await db.sourcedPerson.count()).toBe(0);
  });

  it('--apply: lifecycle tasks New / In progress / Submitted, export project all Submitted; nothing approved or exported', async () => {
    const termsBefore = await db.termsDocument.findMany({ orderBy: { id: 'asc' } });
    const settingsBefore = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { settings: true } });
    const r = await apply();
    expect(r.projects.filter((p) => p.error), JSON.stringify(r.projects, null, 2)).toEqual([]);
    expect(r).toMatchObject({ ok: true, apply: true });

    const ps = await seedProjects();
    expect(ps.map((p) => p.name).sort()).toEqual(SEED_PROJECTS.map((p) => p.name).sort());
    for (const p of ps) expect(p).toMatchObject({ reviewRoute: 'SME_PM', templateId });

    // Lifecycle: one task per governing state, in slot order: 2 Submitted, 1 In progress, 2 New.
    const life = project(r, LIFECYCLE.key);
    expect(life.created).toBe(true);
    expect(life.tasks.map((t) => t.state)).toEqual(['SUBMITTED', 'SUBMITTED', 'IN_PROGRESS', 'ASSIGNED', 'ASSIGNED']);
    expect(life.tasks.map((t) => t.smeStatus)).toEqual(['In review', 'In review', 'In progress', 'New', 'New']);
    const lifeTasks = await db.taskInstance.findMany({ where: { projectId: life.projectId! }, include: { slot: true }, orderBy: { slot: { position: 'asc' } } });
    expect(lifeTasks.map((t) => t.status)).toEqual(['SUBMITTED', 'SUBMITTED', 'IN_PROGRESS', 'ASSIGNED', 'ASSIGNED']);
    expect(new Set(lifeTasks.map((t) => t.slotId)).size).toBe(5);
    expect(lifeTasks[2]!.output).not.toBeNull();
    expect(lifeTasks[3]!.startedAt).toBeNull();

    // Export project: every task Submitted, waiting for the PM/Admin; export stays closed.
    const exp = project(r, EXPORT.key);
    expect(exp.tasks.length).toBe(5);
    expect(exp.tasks.every((t) => t.state === 'SUBMITTED')).toBe(true);
    const ex = (await inject('GET', `/projects/${exp.projectId}/export`)).json();
    expect(ex.canExport).toBe(false);
    for (const t of exp.tasks) {
      const v = (await inject('GET', `/projects/${exp.projectId}/forge-tasks/${t.taskId}`)).json();
      expect(v.canDecide).toBe(true);
    }

    // One synthetic SME per task: Sourcing, SYNTHETIC first name, @praxis.test, signed in, terms accepted, signed out.
    const people = await db.sourcedPerson.findMany({ where: { projectId: { in: ps.map((p) => p.id) } } });
    expect(people).toHaveLength(10);
    expect(people.every((x) => x.role === 'SME' && x.firstName === 'SYNTHETIC' && x.emailNorm.endsWith('@praxis.test') && x.assignedAt)).toBe(true);
    expect(await db.auditEvent.count({ where: { clientId, action: 'candidate.terms_accepted' } })).toBe(10);
    expect(await db.session.count({ where: { smeUserId: { in: people.map((x) => x.smeUserId!) }, revokedAt: null } })).toBe(0);
    for (const t of [...life.tasks, ...exp.tasks]) expect(people.map((x) => x.id)).toContain(t.authorPersonId);
    expect(new Set([...life.tasks, ...exp.tasks].map((t) => t.authorPersonId)).size).toBe(10);

    // Policy: a published rule set per project with the one reviewed rule; every task's policy cites it.
    for (const p of r.projects) {
      expect(p.ruleSetId).toBeTruthy();
      const sets = await db.projectRuleSet.findMany({ where: { projectId: p.projectId! } });
      expect(sets.map((x) => x.ruleVersionIds)).toEqual([[p.ruleVersionId]]);
      for (const t of p.tasks) {
        const policy = await inject('GET', `/tasks/${t.taskId}/policy`);
        expect(policy.statusCode, policy.body).toBe(200);
        expect(policy.body).toContain(p.ruleVersionId!);
      }
    }
    const submitted = await db.taskInstance.findMany({ where: { projectId: { in: ps.map((p) => p.id) }, status: 'SUBMITTED' } });
    expect(submitted).toHaveLength(7);

    // Approval links for the submitted tasks only.
    const links = [...life.tasks, ...exp.tasks].filter((t) => t.state === 'SUBMITTED').map((t) => `/projects/${t === life.tasks.find((x) => x.taskId === t.taskId) ? life.projectId : exp.projectId}/tasks/${t.taskId}/review`);
    expect(r.approvalLinks.sort()).toEqual(links.sort());
    expect(life.tasks.filter((t) => t.approvalLink)).toHaveLength(2);

    // Never a decision, approved record, export, settings or terms change.
    expect(forbidden()).toEqual([]);
    expect(await db.taskReview.count()).toBe(0);
    expect(await db.approvedTaskRecord.count()).toBe(0);
    expect(await db.projectValidationRun.count()).toBe(0);
    expect(await db.termsDocument.findMany({ orderBy: { id: 'asc' } })).toEqual(termsBefore);
    expect(await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { settings: true } })).toEqual(settingsBefore);
    expect(sent.filter((x) => x.path === '/admin/forge-settings').map((x) => x.method)).toEqual(['GET']);

    // Cost: embeddings only (two pre-checks and one submit per submitted task); no model call, no extraction.
    expect(r.paidCalls.map((p) => p.kind)).toEqual(['similarity-embedding']);
    expect(r.totalPaidCalls).toBeLessThanOrEqual(7 * 3);
    expect(r.estimatedCostUsd).toBeLessThan(0.01);

    // No names or emails in the report, no secrets.
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain('SYNTHETIC QA seed lifecycle SME');
    for (const pw of Object.values(PW)) expect(text).not.toContain(pw);
  }, 240_000);

  it('re-run: finds both projects by name and continues them; never duplicates or moves a task back, even after the owner approves one', async () => {
    const first = await apply();
    expect(first.ok).toBe(true);
    const counts = async () => ({
      projects: (await seedProjects()).length,
      people: await db.sourcedPerson.count(),
      tasks: await db.taskInstance.count(),
      documents: await db.policyDocument.count(),
      rules: await db.policyRule.count(),
      sets: await db.projectRuleSet.count(),
      jds: await db.jobDescription.count(),
    });
    const before = await counts();

    // The owner approves one lifecycle task in the console (here: the same route the console uses).
    const life = project(first, LIFECYCLE.key);
    const approved = life.tasks[0]!;
    const v = (await inject('GET', `/projects/${life.projectId}/forge-tasks/${approved.taskId}`)).json();
    const decided = await inject('POST', `/projects/${life.projectId}/tasks/${approved.taskId}/decision`, {
      decision: 'APPROVE',
      expectedVersion: v.expectedVersion,
      expectedRevision: v.expectedRevision,
      notes: 'Owner approval in the console.',
      ...(v.checklistRequired ? { checklist: Object.fromEntries((v.checklist as { key: string }[]).map((c) => [c.key, true])) } : {}),
      ...(v.flaggedDuplicate ? { duplicateDecision: 'ACCEPT_AS_DISTINCT' } : {}),
      ...(v.confirmCoverage ? { confirmedCoverage: { tags: v.coverageTags?.tags ?? {}, edgeCase: v.coverageTags?.edgeCase ?? 'none' } } : {}),
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const records = await db.approvedTaskRecord.count();
    expect(records).toBe(1);

    sent.length = 0;
    const second = await apply();
    expect(second.projects.filter((p) => p.error), JSON.stringify(second.projects, null, 2)).toEqual([]);
    expect(second.projects.map((p) => [p.key, p.projectId, p.created])).toEqual(first.projects.map((p) => [p.key, p.projectId, false]));
    expect(await counts()).toEqual(before);
    expect(project(second, LIFECYCLE.key).tasks.map((t) => t.state)).toEqual(['ACCEPTED', 'SUBMITTED', 'IN_PROGRESS', 'ASSIGNED', 'ASSIGNED']);
    expect(project(second, LIFECYCLE.key).tasks[0]!.approvalLink).toBeUndefined();
    expect(project(second, EXPORT.key).tasks.every((t) => t.state === 'SUBMITTED')).toBe(true);
    // Nothing was authored, submitted or decided again; no new approved record.
    expect(sent.filter((x) => x.method !== 'GET' && /\/me\/tasks\//.test(x.path))).toEqual([]);
    expect(forbidden()).toEqual([]);
    expect(await db.approvedTaskRecord.count()).toBe(records);
    expect(second.totalPaidCalls).toBe(0);

    // A dry run on the seeded projects plans only the sign-ins.
    const dry = await run(false);
    for (const p of dry.projects) {
      expect(p.projectId).toBeTruthy();
      for (const t of p.tasks.filter((x) => !x.note)) expect(t.planned).toEqual(['Offline sign-in, accept terms']);
    }
    expect(project(dry, LIFECYCLE.key).tasks[0]!.note).toBe('already ACCEPTED; left as it is');
  }, 300_000);

  it('continues a half-made project: a lifecycle project created by an earlier interrupted run is finished, not duplicated', async () => {
    // An earlier run created the lifecycle project and stopped before submitting it: a draft, no policy, nobody assigned.
    const pm = await login(app, 'pm@praxis.demo', PW.pm);
    const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie: pm, ...idem() }, payload });
    const skills = (await db.template.findUniqueOrThrow({ where: { id: templateId } })).skills;
    const jd = (await post('/job-descriptions', { title: 'x', responsibilities: 'Synthetic.', skills, wagePerTask: 1, wageCurrency: 'USD', locationType: 'REMOTE' })).json();
    const made = await post('/projects', { name: LIFECYCLE.name, templateId, jobDescriptionId: jd.id, authoringExperience: 'BOTH', reviewRoute: 'SME_PM', distinctTarget: 4, maxPerExpert: 1, tptMinutes: 60, startDate: '2026-11-15', endDate: '2026-12-15', demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: false }] });
    expect(made.statusCode, made.body).toBe(201);

    const r = await apply();
    expect(r.ok, JSON.stringify(r.projects, null, 2)).toBe(true);
    expect(project(r, LIFECYCLE.key)).toMatchObject({ projectId: made.json().id, created: false });
    expect(project(r, LIFECYCLE.key).tasks.map((t) => t.state)).toEqual(['SUBMITTED', 'SUBMITTED', 'IN_PROGRESS', 'ASSIGNED', 'ASSIGNED']);
    expect(project(r, EXPORT.key).created).toBe(true);
    expect(await db.project.count({ where: { name: LIFECYCLE.name } })).toBe(1);
    // Sized to its tasks before submit: one SME place per task.
    expect(await db.project.findUniqueOrThrow({ where: { id: made.json().id } })).toMatchObject({ distinctTarget: 5, maxPerExpert: 1, requiredWorkers: 5 });
  }, 240_000);

  it('the new flow off or Online sign-in: refuses with the reason and changes nothing', async () => {
    expect((await inject('PUT', '/admin/forge-settings', { candidateSignIn: 'ONLINE' })).statusCode).toBe(200);
    await expect(apply()).rejects.toThrow(/QA must use Offline/);
    expect((await inject('PUT', '/admin/forge-settings', { newFlow: false })).statusCode).toBe(200);
    await expect(apply()).rejects.toThrow(/new flow is off/);
    expect(sent.filter((x) => x.path === '/admin/forge-settings').map((x) => x.method)).toEqual(['GET', 'GET']);
    expect(await seedProjects()).toEqual([]);
  });
});
