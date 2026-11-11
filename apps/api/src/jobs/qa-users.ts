import { CONTRIBUTION_ROLES, FIELD_DEFS, OpportunityBrief, type ContributionRole } from '@praxis/shared';
import { runAssessment } from '../candidate/selection-service';
import type { SuitabilityEvaluator } from '../candidate/suitability';
import type { Db } from '../db';

/**
 * `run.ts qa-users [--dry-run]`: QA-only seed of synthetic test users (docs/DECISIONS.md, "QA seed users").
 *
 * - 10 Reviewer console users (QA_SEED_REVIEWER_EMAILS, default reviewer01..10@praxis.test), role REVIEWER, created
 *   by the demo Admin through POST /users in the demo client, with one shared password (QA_SEED_REVIEWER_PASSWORD).
 *   Every one is attached as a Validator to every live project of every offerable published template.
 * - 30 SME candidates (QA_SEED_CANDIDATE_EMAILS, default sme01..30@praxis.test), at least 3 per offerable published
 *   template and every candidate in at least one pool (see `spread`),
 *   each taken through the real FLOW 2 journey over HTTP: mock Google sign-in (subject `mock-<email>`), mock identity
 *   check, enrollment, the accessible profile form (CF-30), explicit submit, the worker's suitability assessment,
 *   a SELECTED decision by a named seeded Reviewer, then the C07 onboarding checklist. The result is "ready for
 *   staffing" exactly as FLOW 2 section 9 defines it for that template's pool project.
 *
 * Everything goes through the public API, so states, idempotency and audit events are the real ones; the database is
 * only read (to plan and to see where each candidate is). Re-running resumes each candidate from its current state
 * and creates nothing twice. Never runs with APP_ENV=production.
 */

type Log = (level: string, message: string, extra?: object) => void;

export interface HttpResponse {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** name=value pairs from Set-Cookie. */
  cookies: string[];
  retryAfterSeconds: number | null;
}
export type Http = (req: { method: string; path: string; body?: unknown; cookie?: string }) => Promise<HttpResponse>;

export interface QaUsersOptions {
  appEnv: string;
  dryRun: boolean;
  http: Http;
  /** Demo client's Admin and PM (created by demo-setup). */
  adminEmail: string;
  adminPassword?: string;
  pmEmail: string;
  pmPassword?: string;
  reviewerEmails: string[];
  reviewerPassword?: string;
  candidateEmails: string[];
  /** How long to wait for the worker to assess submitted profiles. */
  assessmentTimeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called on each poll while waiting for assessments (tests deliver outbox events here). */
  onPoll?: () => Promise<void>;
  /**
   * When set, the job also runs pending or failed assessments itself (the worker's own runAssessment, so the same
   * claim, validation, SYSTEM audit and no decision), up to 3 tries each. Used in QA, where the worker's model may be
   * unavailable. The worker and the job never both run one assessment: runAssessment claims it first.
   */
  evaluator?: SuitabilityEvaluator;
}

export interface Slot {
  templateId: string;
  workflowName: string;
  projectId: string | null;
  candidateEmail: string;
  reviewerEmail: string;
}

export interface QaUsersResult {
  dryRun: boolean;
  templates: { id: string; workflowName: string; projectId: string | null; projectName: string; created: boolean }[];
  slots: (Slot & { state: string })[];
  reviewers: { email: string; state: string }[];
  /** Slots not yet ready for staffing at the end of the run (e.g. still awaiting assessment). */
  incomplete: number;
}

export const SYNTHETIC = 'SYNTHETIC QA';
const POOL_PREFIX = `${SYNTHETIC} pool — `;
export const poolName = (workflowName: string) => `${POOL_PREFIX}${workflowName}`.slice(0, 200);
const pad = (n: number) => String(n).padStart(2, '0');
export const defaultEmails = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${pad(i + 1)}@praxis.test`);

/** Comma-separated list from the environment, or the default. Lower-cased, de-duplicated, validated. */
export function emailList(raw: string | undefined, fallback: string[], expected: number, name: string): string[] {
  const list = raw?.trim() ? [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))] : fallback;
  const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (bad.length) throw new Error(`${name} has invalid addresses: ${bad.join(', ')}`);
  if (list.length !== expected) throw new Error(`${name} must list exactly ${expected} addresses (got ${list.length})`);
  return list;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv, appEnv: string, dryRun: boolean, http: Http): QaUsersOptions {
  return {
    appEnv,
    dryRun,
    http,
    adminEmail: env.QA_SEED_ADMIN_EMAIL ?? 'admin@praxis.demo',
    adminPassword: env.DEMO_ADMIN_PASSWORD,
    pmEmail: env.QA_SEED_PM_EMAIL ?? 'pm@praxis.demo',
    pmPassword: env.DEMO_PM_PASSWORD,
    reviewerEmails: emailList(env.QA_SEED_REVIEWER_EMAILS, defaultEmails('reviewer', 10), 10, 'QA_SEED_REVIEWER_EMAILS'),
    reviewerPassword: env.QA_SEED_REVIEWER_PASSWORD,
    candidateEmails: emailList(env.QA_SEED_CANDIDATE_EMAILS, defaultEmails('sme', 30), 30, 'QA_SEED_CANDIDATE_EMAILS'),
    assessmentTimeoutMs: Number(env.QA_SEED_ASSESSMENT_TIMEOUT_SECONDS ?? 900) * 1000,
  };
}

/** fetch against API_URL, for the Cloud Run job. */
export function fetchHttp(apiUrl: string): Http {
  return async ({ method, path, body, cookie }) => {
    const r = await fetch(`${apiUrl}/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'idempotency-key': crypto.randomUUID(), cookie: cookie ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ra = Number(r.headers.get('retry-after'));
    return {
      status: r.status,
      body: await r.json().catch(() => null),
      cookies: r.headers.getSetCookie().map((c) => c.split(';')[0]!),
      retryAfterSeconds: Number.isFinite(ra) && ra > 0 ? ra : null,
    };
  };
}

/** Template the job covers: the newest PUBLISHED version of each workflow in an active domain (what a PM can use). */
async function offerableTemplates(db: Db, clientId: string) {
  const all = await db.template.findMany({ where: { clientId, status: 'PUBLISHED', domain: { status: 'ACTIVE' } }, include: { domain: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return all.filter((t) => !all.some((o) => o.lineageId === t.lineageId && o.version > t.version));
}

const LIVE_PROJECT = { notIn: ['CANCELLED', 'COMPLETED'] as ('CANCELLED' | 'COMPLETED')[] };

/** The template's pool: its oldest live project with a published opportunity (or our own synthetic pool by name). */
async function poolProject(db: Db, clientId: string, templateId: string, workflowName: string) {
  const published = await db.project.findFirst({
    where: { clientId, templateId, status: LIVE_PROJECT, opportunity: { status: 'PUBLISHED' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return published ?? db.project.findFirst({ where: { clientId, name: { equals: poolName(workflowName), mode: 'insensitive' } } });
}

/**
 * Spreads candidates over templates so that every template has at least 3 different candidates and every candidate
 * has at least one pool: max(candidates, 3 x templates) slots, shared out as evenly as possible, candidates taken in
 * turn (a candidate never twice in one template). Decisions rotate through the reviewers.
 */
export function spread<T>(templates: T[], candidates: string[], reviewers: string[]) {
  const total = Math.max(candidates.length, 3 * templates.length);
  const out: { template: T; candidateEmail: string; reviewerEmail: string }[] = [];
  let next = 0;
  templates.forEach((template, i) => {
    const quota = Math.min(candidates.length, Math.floor(total / templates.length) + (i < total % templates.length ? 1 : 0));
    const taken = new Set<string>();
    while (taken.size < quota) {
      const c = candidates[next++ % candidates.length]!;
      if (taken.has(c)) continue;
      taken.add(c);
      out.push({ template, candidateEmail: c, reviewerEmail: reviewers[out.length % reviewers.length]! });
    }
  });
  return out;
}

const READY = 'READY_FOR_STAFFING';

export async function qaUsers(db: Db, o: QaUsersOptions, log: Log): Promise<QaUsersResult> {
  if (o.appEnv === 'production') throw new Error('qa-users refuses to run with APP_ENV=production');
  if (new Set(o.candidateEmails.map((e) => e.toLowerCase())).size !== o.candidateEmails.length) throw new Error('Candidate emails must be distinct');
  if (o.reviewerEmails.some((r) => o.candidateEmails.includes(r))) throw new Error('A reviewer email cannot also be a candidate email');
  if (!o.dryRun) {
    if (!o.adminPassword || !o.pmPassword) throw new Error('DEMO_ADMIN_PASSWORD and DEMO_PM_PASSWORD are required (run demo-setup first)');
    if (!o.reviewerPassword || o.reviewerPassword.length < 12) throw new Error('QA_SEED_REVIEWER_PASSWORD is required (at least 12 characters)');
  }
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const admin = await db.user.findUnique({ where: { email: o.adminEmail } });
  if (!admin) throw new Error(`${o.adminEmail} not found: run demo-setup first`);
  const clientId = admin.clientId;
  const templates = await offerableTemplates(db, clientId);
  if (templates.length === 0) throw new Error('No published templates to cover');

  // ── HTTP with a cookie jar per actor; waits out login rate limits instead of failing ──
  const jar = new Map<string, string>();
  async function call(who: string, method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      const r = await o.http({ method, path, body: method === 'GET' ? undefined : (body ?? {}), cookie: jar.get(who) });
      if (r.cookies.length) jar.set(who, [...new Map([...(jar.get(who)?.split('; ').filter(Boolean) ?? []), ...r.cookies].map((c) => [c.split('=')[0], c])).values()].join('; '));
      if (r.status === 429 && attempt < 6) {
        const wait = (r.retryAfterSeconds ?? 60) * 1000 + 1000;
        log('info', 'rate limited; waiting', { path, seconds: Math.round(wait / 1000) });
        await sleep(wait);
        continue;
      }
      if (r.status >= 400 && !okStatuses.includes(r.status)) throw new Error(`${method} ${path} as ${who}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 500)}`);
      return r;
    }
  }
  const login = (who: string, email: string, password: string) => call(who, 'POST', '/auth/login', { email, password });

  const result: QaUsersResult = { dryRun: o.dryRun, templates: [], slots: [], reviewers: [], incomplete: 0 };

  // ── Plan (also the whole of a dry run) ──
  const pools = new Map<string, { id: string | null; name: string; created: boolean }>();
  for (const t of templates) {
    const p = await poolProject(db, clientId, t.id, t.workflowName);
    pools.set(t.id, { id: p?.id ?? null, name: p?.name ?? poolName(t.workflowName), created: false });
  }
  const plan = spread(templates, o.candidateEmails, o.reviewerEmails);

  if (o.dryRun) {
    for (const email of o.reviewerEmails) {
      const u = await db.user.findUnique({ where: { email } });
      result.reviewers.push({ email, state: !u ? 'to create' : u.roles.includes('REVIEWER') ? 'exists' : `exists without REVIEWER (${u.roles.join(',')})` });
    }
    for (const t of templates) {
      const p = pools.get(t.id)!;
      result.templates.push({ id: t.id, workflowName: t.workflowName, projectId: p.id, projectName: p.name, created: false });
    }
    for (const s of plan) {
      const pool = pools.get(s.template.id)!;
      result.slots.push({ templateId: s.template.id, workflowName: s.template.workflowName, projectId: pool.id, candidateEmail: s.candidateEmail, reviewerEmail: s.reviewerEmail, state: await slotState(db, s.candidateEmail, pool.id) });
    }
    result.incomplete = result.slots.filter((s) => s.state !== READY).length;
    log('info', 'qa-users dry run: writes nothing', {
      templates: result.templates.map((t) => `${t.workflowName} -> ${t.projectId ? `${t.projectName} (${t.projectId})` : `create "${t.projectName}"`}`),
      reviewers: result.reviewers.map((r) => `${r.email}: ${r.state}`),
      candidates: result.slots.map((s) => `${s.candidateEmail} -> ${s.workflowName}: ${s.state}; decided by ${s.reviewerEmail}`),
    });
    return result;
  }

  await login('admin', o.adminEmail, o.adminPassword!);
  await login('pm', o.pmEmail, o.pmPassword!);
  const pmId = (await db.user.findUniqueOrThrow({ where: { email: o.pmEmail } })).id;

  // ── B. Reviewers ──
  const reviewerIds = new Map<string, string>();
  for (const [i, email] of o.reviewerEmails.entries()) {
    let u = await db.user.findUnique({ where: { email } });
    let state = 'exists';
    if (!u) {
      await call('admin', 'POST', '/users', { email, name: `${SYNTHETIC} Reviewer ${pad(i + 1)}`, roles: ['REVIEWER'], password: o.reviewerPassword, requirePasswordChange: false });
      u = await db.user.findUniqueOrThrow({ where: { email } });
      state = 'created';
    } else if (u.clientId !== clientId) {
      throw new Error(`${email} belongs to another client`);
    } else if (!u.roles.includes('REVIEWER')) {
      await call('admin', 'PATCH', `/users/${u.id}/roles`, { roles: [...u.roles, 'REVIEWER'] });
      state = 'REVIEWER role added';
    }
    if (u.status !== 'ACTIVE') throw new Error(`${email} is ${u.status}; reactivate it in the console first`);
    reviewerIds.set(email, u.id);
    result.reviewers.push({ email, state });
  }

  // ── Pool project per template (created by the PM through the normal project flow when the template has none) ──
  for (const t of templates) {
    const pool = pools.get(t.id)!;
    if (!pool.id) {
      pool.id = await createPool(t);
      pool.created = true;
    } else {
      // Only our own synthetic pool can be half-made (a run stopped mid-way); finish it the same way.
      const project = await db.project.findUniqueOrThrow({ where: { id: pool.id }, include: { opportunity: true } });
      if (project.status === 'DRAFT') await call(actorFor(project.ownerId), 'POST', `/projects/${project.id}/submit`);
      if (project.opportunity?.status !== 'PUBLISHED') await publishOpportunity(pool.id);
    }
    result.templates.push({ id: t.id, workflowName: t.workflowName, projectId: pool.id, projectName: pool.name, created: pool.created });
  }

  // Validators on every live project of these templates, so review queues (candidates and tasks) are staffed.
  const projects = await db.project.findMany({ where: { clientId, templateId: { in: templates.map((t) => t.id) }, status: LIVE_PROJECT }, include: { reviewers: true } });
  for (const p of projects) {
    for (const id of reviewerIds.values()) {
      if (!p.reviewers.some((r) => r.userId === id)) await call('admin', 'POST', `/projects/${p.id}/reviewers`, { userId: id });
    }
  }

  // ── A. Candidates: each slot advanced as far as it can go, in phases so assessments run in parallel ──
  const slots = plan.map((s) => ({ ...s, projectId: pools.get(s.template.id)!.id!, enrollmentId: null as string | null, smeUserId: null as string | null }));
  const signedIn = new Set<string>();
  for (const s of slots) {
    const who = `sme:${s.candidateEmail}`;
    if (!signedIn.has(s.candidateEmail)) {
      await signInCandidate(s.candidateEmail);
      signedIn.add(s.candidateEmail);
    }
    const opp = await db.opportunity.findUniqueOrThrow({ where: { projectId: s.projectId } });
    const e = (await call(who, 'POST', '/me/enrollments', { opportunityId: opp.id })).body as { id: string; status: string };
    s.enrollmentId = e.id;
    if (e.status === 'DRAFT') await completeAndSubmit(who, e.id);
  }

  const deadline = Date.now() + o.assessmentTimeoutMs;
  const tries = new Map<string, number>();
  for (;;) {
    await o.onPoll?.();
    if (o.evaluator) await assessPending(o.evaluator);
    const waiting = await db.enrollment.count({ where: { id: { in: slots.map((s) => s.enrollmentId!) }, status: 'SUBMITTED' } });
    if (waiting === 0 || Date.now() >= deadline) {
      if (waiting) log('warn', 'some profiles are still awaiting the suitability assessment; re-run the job to continue', { waiting });
      break;
    }
    await sleep(o.pollMs ?? 5000);
  }

  const reviewerSignedIn = new Set<string>();
  for (const s of slots) {
    const who = `sme:${s.candidateEmail}`;
    let e = await db.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId! } });
    if (e.status === 'REVIEW_PENDING') {
      if (!reviewerSignedIn.has(s.reviewerEmail)) {
        await login(`rev:${s.reviewerEmail}`, s.reviewerEmail, o.reviewerPassword!);
        reviewerSignedIn.add(s.reviewerEmail);
      }
      await decide(`rev:${s.reviewerEmail}`, s.enrollmentId!, s.template.domain.name);
      e = await db.enrollment.findUniqueOrThrow({ where: { id: s.enrollmentId! } });
    }
    if (e.status === 'SELECTED') await onboard(who, e.id, s.candidateEmail);
    const state = await slotState(db, s.candidateEmail, s.projectId);
    if (state !== READY) log('warn', 'candidate not ready for staffing yet', { candidate: s.candidateEmail, template: s.template.workflowName, state });
    result.slots.push({ templateId: s.template.id, workflowName: s.template.workflowName, projectId: s.projectId, candidateEmail: s.candidateEmail, reviewerEmail: s.reviewerEmail, state });
  }
  result.incomplete = result.slots.filter((s) => s.state !== READY).length;
  log('info', 'qa-users done', {
    reviewers: result.reviewers.map((r) => `${r.email}: ${r.state}`),
    templates: result.templates.map((t) => `${t.workflowName}: ${t.projectName}${t.created ? ' (created)' : ''}`),
    ready: result.slots.length - result.incomplete,
    incomplete: result.slots.filter((s) => s.state !== READY).map((s) => `${s.candidateEmail} -> ${s.workflowName}: ${s.state}`),
  });
  return result;

  // ───────────────────────── steps ─────────────────────────

  async function assessPending(evaluator: SuitabilityEvaluator) {
    const submitted = await db.enrollment.findMany({ where: { id: { in: slots.map((s) => s.enrollmentId!) }, status: 'SUBMITTED' } });
    const pending = await db.suitabilityAssessment.findMany({
      where: { enrollmentId: { in: submitted.map((e) => e.id) }, status: { in: ['NOT_RUN', 'ERROR'] } },
      orderBy: { createdAt: 'asc' },
    });
    const queue = pending.filter((a) => (tries.get(a.id) ?? 0) < 3);
    const runOne = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        tries.set(a.id, (tries.get(a.id) ?? 0) + 1);
        const r = await runAssessment(db, evaluator, a.id);
        if (r === 'error') {
          const failed = await db.suitabilityAssessment.findUniqueOrThrow({ where: { id: a.id } });
          log('warn', 'assessment failed', { assessmentId: a.id, try: tries.get(a.id), model: evaluator.modelVersion, errorCode: failed.errorCode, detail: failed.limitations?.slice(0, 300) });
        }
      }
    };
    await Promise.all(Array.from({ length: 5 }, runOne));
  }

  async function createPool(t: (typeof templates)[number]) {
    const name = poolName(t.workflowName);
    const skills = t.skills.length ? t.skills.slice(0, 20) : [t.domain.name];
    const jd = (await call('pm', 'POST', '/job-descriptions', {
      title: `${SYNTHETIC} — ${t.workflowName} task author`.slice(0, 200),
      responsibilities: `Synthetic QA pool for testing staffing, authoring and review on the "${t.workflowName}" template. All content is synthetic.`,
      skills,
      wagePerTask: 1,
      wageCurrency: 'USD',
      locationType: 'REMOTE',
    })).body;
    const d = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const authoring = t.taskModes.includes('AUTHORING');
    const distinctTarget = t.defaultDistinctTarget;
    const p = (await call('pm', 'POST', '/projects', {
      name,
      templateId: t.id,
      jobDescriptionId: jd.id,
      ...(authoring ? { authoringExperience: 'BOTH', distinctTarget, maxPerExpert: Math.min(t.defaultMaxPerExpert, distinctTarget) } : { taskCount: 12 }),
      tptMinutes: t.defaultTptMinutes ?? 60,
      startDate: d(1),
      endDate: d(60),
      demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN', 'US'], required: false }],
    })).body;
    await call('pm', 'POST', `/projects/${p.id}/submit`);
    await publishOpportunity(p.id);
    log('info', 'pool project created', { template: t.workflowName, projectId: p.id });
    return p.id as string;
  }

  /** The PM for their own projects, otherwise the Admin. */
  function actorFor(ownerId: string) {
    return ownerId === pmId ? 'pm' : 'admin';
  }

  async function publishOpportunity(projectId: string) {
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    await call(actorFor(project.ownerId), 'POST', `/projects/${projectId}/opportunity/publish`);
  }

  async function signInCandidate(email: string) {
    const who = `sme:${email}`;
    const n = o.candidateEmails.indexOf(email) + 1;
    const { credential } = (await call(who, 'POST', '/auth/dev/google-token', { email, name: `${SYNTHETIC} SME ${pad(n)}` })).body;
    const me = (await call(who, 'POST', '/auth/google', { credential, adultAttested: true })).body;
    if (!['VERIFIED', 'ALTERNATIVE_VERIFIED'].includes(me.identityStatus)) {
      await call(who, 'POST', '/me/identity/session', {});
      const attempt = await db.identityAttempt.findFirstOrThrow({ where: { smeUserId: me.id, provider: 'stripe' }, orderBy: { createdAt: 'desc' } });
      await call(who, 'POST', `/dev/identity/${attempt.providerSessionId}/simulate`, { status: 'verified', adult: true });
    }
  }

  /** The accessible profile form (CF-30): confirms or answers every question, then the explicit submit (C05). */
  async function completeAndSubmit(who: string, enrollmentId: string) {
    let s = (await call(who, 'GET', `/me/enrollments/${enrollmentId}/conversation`)).body;
    const fields: { fieldKey: string; action: string; value?: unknown }[] = [];
    const seen = new Set<string>();
    for (const q of s.questions as { fields: string[]; answerType: string; options: string[] }[]) {
      for (const f of q.fields) {
        if (f === 'roles' || seen.has(f)) continue;
        seen.add(f);
        const cur = s.profile.fields[f] as { status: string; value: unknown } | undefined;
        if (cur?.status === 'CONFIRMED') continue;
        if (cur?.status === 'PROPOSED' && cur.value !== null) fields.push({ fieldKey: f, action: 'CONFIRM' });
        else fields.push({ fieldKey: f, action: 'EDIT', value: answerFor(f, q) });
      }
    }
    const roles = (s.profile.roles as { id: string; status: string }[]).filter((r) => r.status === 'PROPOSED').map((r) => ({ action: 'CONFIRM', id: r.id }));
    const needsRole = s.questions.some((q: { fields: string[] }) => q.fields.includes('roles')) && s.profile.roles.length === 0;
    if (needsRole) roles.push({ action: 'ADD', role: { title: 'Synthetic QA domain analyst', employerType: 'Synthetic organisation', start: '2015-01', end: null, responsibility: 'PERFORMED', specialtyRelevant: true } } as never);
    const claims = (s.profile.claims as { id: string; status: string }[]).filter((c) => c.status === 'PROPOSED').map((c) => ({ action: 'CONFIRM', id: c.id }));
    if (fields.length || roles.length || claims.length) {
      s = (await call(who, 'POST', '/me/profile/corrections', { enrollmentId, expectedRevision: s.session.revision, fields, roles, claims })).body;
    }
    await call(who, 'POST', `/me/enrollments/${enrollmentId}/submit`, { expectedRevision: s.session.revision, confirmAccuracy: true, evidencePermission: true });
  }

  /** The named Reviewer's human decision (FLOW2 8.2). The AI recommendation is shown, never applied. */
  async function decide(who: string, enrollmentId: string, domainName: string) {
    const e = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { opportunityVersion: true } });
    const brief = OpportunityBrief.safeParse(e.opportunityVersion.brief);
    const roles = (brief.success ? brief.data.contributionRoles : []).filter((r): r is ContributionRole => (CONTRIBUTION_ROLES as readonly string[]).includes(r));
    await call(who, 'POST', `/review/enrollments/${enrollmentId}/decision`, {
      outcome: 'SELECTED',
      reasons: [{ criterionId: null, text: `${SYNTHETIC} seed: synthetic test account selected by a Reviewer for QA staffing, authoring and review tests.` }],
      candidateMessage: 'You are selected for this pool (synthetic QA test account).',
      scope: {
        domain: (brief.success && brief.data.domain) || domainName,
        specialty: (brief.success && brief.data.specialty) || null,
        jurisdictions: brief.success && brief.data.jurisdictions.length ? brief.data.jurisdictions : ['GB', 'IN'],
        languages: ['en'],
        contributionRoles: roles.length ? roles : ['TASK_AUTHOR'],
        expiresAt: null,
      },
    });
  }

  /** C07 checklist, item by item, as the candidate. */
  async function onboard(who: string, enrollmentId: string, email: string) {
    const india = o.candidateEmails.indexOf(email) % 2 === 1;
    const view = (await call(who, 'GET', `/me/onboarding?enrollmentId=${enrollmentId}`)).body;
    for (const item of view.items as { key: string; kind: string; done: boolean; terms: { sha256: string } | null }[]) {
      if (item.done || item.kind === 'certification' || item.kind === 'payee') continue;
      const data = item.kind === 'conflicts'
        ? { hasConflicts: false, authorizedToContribute: true }
        : item.kind === 'preferences'
          ? { country: india ? 'IN' : 'GB', languages: [{ language: 'en', level: 'C2' }], timezone: india ? 'Asia/Kolkata' : 'Europe/London', hoursPerWeek: 20, emailNotifications: false }
          : undefined;
      await call(who, 'POST', '/me/onboarding/acknowledgements', { enrollmentId, itemKey: item.key, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...(data ? { data } : {}) });
    }
  }
}

/** A bland synthetic answer of the right shape for a profile field. */
function answerFor(field: string, q: { answerType: string; options: string[] }): string | number | string[] {
  const kind = FIELD_DEFS[field]?.kind ?? 'text';
  const choice = q.answerType === 'choice' && q.options.length ? q.options[0]! : null;
  if (kind === 'number') return field === 'hours_per_week' ? 20 : 10;
  if (kind === 'list') return [choice ?? 'Synthetic QA test entry'];
  return choice ?? 'Synthetic QA test answer: this account and its profile are synthetic test data.';
}

/** Where one candidate stands for one pool: READY_FOR_STAFFING once selected, onboarded and identity-eligible. */
export async function slotState(db: Db, email: string, projectId: string | null): Promise<string> {
  const pid = await db.providerIdentity.findUnique({ where: { provider_subject: { provider: 'GOOGLE', subject: `mock-${email.toLowerCase()}` } }, include: { smeUser: true } });
  if (!pid) return 'not signed up';
  if (!['VERIFIED', 'ALTERNATIVE_VERIFIED'].includes(pid.smeUser.identityStatus)) return `identity ${pid.smeUser.identityStatus}`;
  if (!projectId) return 'no pool yet';
  const e = await db.enrollment.findFirst({ where: { smeUserId: pid.smeUserId, opportunity: { projectId } }, include: { onboarding: true } });
  if (!e) return 'not enrolled';
  if (e.status !== 'SELECTED') return `enrollment ${e.status}`;
  return e.onboarding?.status === 'COMPLETE' ? READY : `onboarding ${e.onboarding?.status ?? 'NOT_STARTED'}`;
}
