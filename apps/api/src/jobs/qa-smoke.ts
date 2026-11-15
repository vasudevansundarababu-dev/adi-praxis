import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AUTHORSHIP_VERSION, CONTRIBUTION_ROLES, GOLDEN_KYC_EXAMPLE, OpportunityBrief, sampleProfileOutput, type ContributionRole } from '@praxis/shared';
import { answerFor, type Http, type HttpForm, type HttpResponse } from './qa-users';

/**
 * `run.ts qa-smoke`: QA-only end-to-end smoke test (docs/DECISIONS.md, "QA smoke job"). It walks the real journey over
 * the public API at API_URL, against the real QA infrastructure (live LlamaExtract, live Gemini on Vertex, the deployed
 * worker), and reports PASS, FAIL or SKIPPED per step in one JSON line.
 *
 * Everything goes through the routes the apps use, as named actors: the demo PM and Admin, a named seeded Reviewer
 * (who makes every human decision: the SME's selection and the task's acceptance; AI output never decides), and a
 * fresh synthetic SME signed in with the mock Google provider. It creates its own project `SYNTHETIC QA smoke — <time>`
 * and never touches anyone else's. When a step cannot be done through an existing route, it fails and says so; there
 * are no back doors. It never reads the database and never runs with APP_ENV=production.
 *
 * MVP1 (ADI Forge) new flow, a second pass (`forge`, QA_SMOKE_NEW_FLOW=auto|on|off, default auto: only when the
 * client's new flow is on): its own project `SYNTHETIC QA smoke (new flow) — <time>` from the same template, one task
 * row per slot, Sourcing of a synthetic SME (and Reviewer on the Reviewer route), direct assignment, Offline candidate
 * sign-in, Before you start, Home, authoring and submit, the Reviewer's pass, the PM's Approve, and the export rule
 * "all tasks approved". It reads export eligibility only and never exports. It never changes the client's settings.
 */

type Log = (level: string, message: string, extra?: object) => void;

export const STEPS = ['health', 'sign-in', 'project', 'policy', 'staffing', 'authoring', 'review', 'export', 'cleanup'] as const;
export type StepName = (typeof STEPS)[number];
/** A step runs only when every step it needs passed; otherwise it is SKIPPED. Cleanup runs whenever a project exists. */
export const NEEDS: Record<StepName, StepName[]> = {
  health: [],
  'sign-in': ['health'],
  project: ['sign-in'],
  policy: ['project'],
  staffing: ['project'],
  authoring: ['policy', 'staffing'],
  review: ['authoring'],
  export: ['review'],
  cleanup: [],
};

/** The new-flow pass (MVP1, ADI Forge), run after the steps above. */
export const FORGE_STEPS = ['forge-settings', 'forge-project', 'forge-policy', 'forge-tasks', 'forge-sourcing', 'forge-assign', 'forge-sign-in', 'forge-authoring', 'forge-review', 'forge-export', 'forge-cleanup'] as const;
export type ForgeStepName = (typeof FORGE_STEPS)[number];
export const FORGE_NEEDS: Record<ForgeStepName, ForgeStepName[]> = {
  'forge-settings': [],
  'forge-project': ['forge-settings'],
  'forge-policy': ['forge-project'],
  'forge-tasks': ['forge-project'],
  'forge-sourcing': ['forge-tasks'],
  'forge-assign': ['forge-sourcing'],
  'forge-sign-in': ['forge-assign'],
  'forge-authoring': ['forge-policy', 'forge-sign-in'],
  'forge-review': ['forge-authoring'],
  'forge-export': ['forge-review'],
  'forge-cleanup': [],
};
/** auto: run the new-flow pass when the client's new flow is on; on: it must be on (FAIL otherwise); off: never. */
export const NEW_FLOW_MODES = ['auto', 'on', 'off'] as const;
export type NewFlowMode = (typeof NEW_FLOW_MODES)[number];
export type ForgeRoute = 'SME_PM' | 'SME_EXPERT_PM';

export type StepStatus = 'PASS' | 'FAIL' | 'SKIPPED';
export interface StepResult<N extends string = StepName> {
  name: N;
  status: StepStatus;
  durationMs: number;
  /** Why it failed (FAIL) or why it did not run (SKIPPED). */
  error?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PaidCall {
  kind: 'policy-extraction' | 'suitability-assessment' | 'authoring-assistant' | 'similarity-embedding';
  provider: string;
  count: number;
  /** Reported by the API where it reports cost (policy extraction); otherwise the estimate in PAID_CALL_ESTIMATES_USD. */
  usd: number;
  source: 'reported' | 'estimate';
}

export interface QaSmokeReport {
  report: 'qa-smoke';
  ok: boolean;
  appEnv: string;
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  ids: Record<string, string>;
  paidCalls: PaidCall[];
  totalPaidCalls: number;
  estimatedCostUsd: number;
  /** The new-flow pass: `ran` is false when it was off or skipped (each step then says why). */
  forge: { mode: NewFlowMode; ran: boolean; route: ForgeRoute; steps: StepResult<ForgeStepName>[]; ids: Record<string, string> };
}

/** Rough per-call cost of the calls the API does not price itself (Gemini Flash in QA; small prompts). */
export const PAID_CALL_ESTIMATES_USD = { suitability: 0.01, authoring: 0.005, embedding: 0.0001, extractionFallback: 0.1 } as const;

export interface QaSmokeOptions {
  appEnv: string;
  http: Http;
  adminEmail: string;
  adminPassword?: string;
  pmEmail: string;
  pmPassword?: string;
  /** The named seeded Reviewer who selects the SME and accepts the task. */
  reviewerEmail: string;
  reviewerPassword?: string;
  /** A fresh synthetic SME per run by default (see optionsFromEnv). */
  smeEmail: string;
  workflowName: string;
  /**
   * Pins one template (QA_SMOKE_TEMPLATE_ID), e.g. of another workflow; default: the newest published version of
   * workflowName. PMs are offered only the newest version of each workflow, so an older version cannot be pinned.
   */
  templateId?: string;
  policyMarkdown: string;
  /** Share of extracted citations that must be RESOLVED (not QUOTE_MISMATCH or UNRESOLVED). */
  minResolvedShare: number;
  timeouts: { extractionMs: number; assessmentMs: number; taskMs: number; chatMs: number };
  /** The new-flow pass (default auto). */
  newFlow?: NewFlowMode;
  /** Its project's review route (default Author → Reviewer → PM/Admin, so the Reviewer is exercised too). */
  forgeRoute?: ForgeRoute;
  /** The synthetic people it sources (default: fresh ones per run). */
  forgeSmeEmail?: string;
  forgeReviewerEmail?: string;
  pollMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export const SMOKE_PREFIX = 'SYNTHETIC QA smoke — ';
export const FORGE_SMOKE_PREFIX = 'SYNTHETIC QA smoke (new flow) — ';
const POLICY_FILE = 'qa-smoke-policy.md';

/** UTC yyyy-mm-dd hh:mm, for the project name. */
export const stamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export function defaultPolicyMarkdown(): string {
  return readFileSync(path.join(import.meta.dirname, POLICY_FILE), 'utf8');
}

export function optionsFromEnv(env: NodeJS.ProcessEnv, appEnv: string, http: Http, now = new Date()): QaSmokeOptions {
  const seconds = (name: string, fallback: number) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be a positive number of seconds`);
    return v * 1000;
  };
  const compact = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return {
    appEnv,
    http,
    adminEmail: env.QA_SEED_ADMIN_EMAIL ?? 'admin@praxis.demo',
    adminPassword: env.DEMO_ADMIN_PASSWORD,
    pmEmail: env.QA_SEED_PM_EMAIL ?? 'pm@praxis.demo',
    pmPassword: env.DEMO_PM_PASSWORD,
    reviewerEmail: (env.QA_SMOKE_REVIEWER_EMAIL ?? 'reviewer01@praxis.test').toLowerCase(),
    reviewerPassword: env.QA_SEED_REVIEWER_PASSWORD,
    // A fresh SME per run: accepted assignments on cancelled projects still count against an SME's concurrent-project
    // limit (2), so one fixed SME would be refused from the third run on.
    smeEmail: (env.QA_SMOKE_SME_EMAIL ?? `smoke-${compact}@praxis.test`).toLowerCase(),
    workflowName: env.QA_SMOKE_WORKFLOW ?? 'KYC onboarding and refresh',
    templateId: env.QA_SMOKE_TEMPLATE_ID?.trim() || undefined,
    newFlow: oneOf('QA_SMOKE_NEW_FLOW', env.QA_SMOKE_NEW_FLOW, NEW_FLOW_MODES, 'auto'),
    forgeRoute: oneOf('QA_SMOKE_FORGE_ROUTE', env.QA_SMOKE_FORGE_ROUTE, ['SME_EXPERT_PM', 'SME_PM'] as const, 'SME_EXPERT_PM'),
    forgeSmeEmail: (env.QA_SMOKE_FORGE_SME_EMAIL ?? `smoke-forge-sme-${compact}@praxis.test`).toLowerCase(),
    forgeReviewerEmail: (env.QA_SMOKE_FORGE_REVIEWER_EMAIL ?? `smoke-forge-rev-${compact}@praxis.test`).toLowerCase(),
    policyMarkdown: defaultPolicyMarkdown(),
    minResolvedShare: 0.5,
    timeouts: {
      extractionMs: seconds('QA_SMOKE_EXTRACTION_TIMEOUT_SECONDS', 900),
      assessmentMs: seconds('QA_SMOKE_ASSESSMENT_TIMEOUT_SECONDS', 600),
      taskMs: seconds('QA_SMOKE_TASK_TIMEOUT_SECONDS', 120),
      chatMs: seconds('QA_SMOKE_CHAT_TIMEOUT_SECONDS', 180),
    },
    now: () => new Date(),
  };
}

function oneOf<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = raw?.trim();
  if (!v) return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${name} must be one of ${allowed.join(', ')}`);
  return v as T;
}

class StepSkipped extends Error {}

const TERMINAL_JOB = ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'UNCERTAIN'];
const CHECKLIST_ALL_TRUE = { realistic: true, correct: true, coversSlot: true, difficultyFair: true, distinct: true, rubricCatches: true };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export async function qaSmoke(o: QaSmokeOptions, log: Log): Promise<QaSmokeReport> {
  if (o.appEnv === 'production') throw new Error('qa-smoke refuses to run with APP_ENV=production');
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 5000;
  const started = now();
  const t0 = Date.now();
  const secrets = [o.adminPassword, o.pmPassword, o.reviewerPassword].filter((s): s is string => !!s && s.length >= 4);
  const redact = (s: string) => secrets.reduce((acc, x) => acc.split(x).join('[redacted]'), s);

  const ids: Record<string, string> = {};
  const results = new Map<StepName, StepResult>();
  const paid: PaidCall[] = [];
  const addPaid = (c: PaidCall) => {
    const same = paid.find((p) => p.kind === c.kind && p.source === c.source && p.provider === c.provider);
    if (same) {
      same.count += c.count;
      same.usd = round(same.usd + c.usd);
    } else paid.push({ ...c, usd: round(c.usd) });
  };

  // ── HTTP as named actors, one cookie jar each; waits out rate limits ──
  const jar = new Map<string, string>();
  async function call(who: string, method: string, p: string, body?: unknown, opts: { ok?: number[]; root?: boolean; form?: HttpForm } = {}): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      const r = await o.http({ method, path: p, body: method === 'GET' || opts.form ? undefined : (body ?? {}), cookie: jar.get(who), root: opts.root, form: opts.form });
      if (r.cookies.length) jar.set(who, [...new Map([...(jar.get(who)?.split('; ').filter(Boolean) ?? []), ...r.cookies].map((c) => [c.split('=')[0], c])).values()].join('; '));
      if (r.status === 429 && attempt < 4 && r.body?.error !== 'MODEL_DAILY_CAP') {
        const wait = (r.retryAfterSeconds ?? 30) * 1000 + 1000;
        log('info', 'rate limited; waiting', { path: p, seconds: Math.round(wait / 1000) });
        await sleep(wait);
        continue;
      }
      if (r.status >= 400 && !(opts.ok ?? []).includes(r.status)) {
        const b = r.body && typeof r.body === 'object' ? r.body : {};
        const detail = b.error || b.message ? `${b.error ?? ''} ${b.message ?? ''}`.trim() : JSON.stringify(r.body)?.slice(0, 300);
        const extra = b.details ? ` ${JSON.stringify(b.details).slice(0, 600)}` : '';
        throw new Error(redact(`${method} ${p} as ${who}: ${r.status} ${detail}${extra}`));
      }
      return r;
    }
  }
  const login = async (who: string, email: string, password: string | undefined, secretName: string) => {
    if (!password) throw new Error(`${secretName} is not set`);
    await call(who, 'POST', '/auth/login', { email, password });
  };
  /** Polls until `done` returns a value, or fails after `ms` with `what`. */
  async function until<T>(ms: number, what: string, probe: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() >= deadline) throw new Error(`${what} (waited ${Math.round(ms / 1000)} s)`);
      await sleep(pollMs);
    }
  }

  const step = (name: StepName, fn: () => Promise<Record<string, unknown> | void>) => runStep(results, NEEDS, name, fn);
  async function runStep<N extends string>(results: Map<N, StepResult<N>>, needs: Record<N, N[]>, name: N, fn: () => Promise<Record<string, unknown> | void>) {
    const missing = needs[name].filter((n) => results.get(n)?.status !== 'PASS');
    const s0 = Date.now();
    if (missing.length) {
      results.set(name, { name, status: 'SKIPPED', durationMs: 0, reason: `needs ${missing.join(', ')}` });
      return;
    }
    try {
      const details = (await fn()) ?? undefined;
      results.set(name, { name, status: 'PASS', durationMs: Date.now() - s0, ...(details ? { details } : {}) });
      log('info', `qa-smoke ${name}: PASS`, details ?? {});
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      if (err instanceof StepSkipped) {
        results.set(name, { name, status: 'SKIPPED', durationMs: Date.now() - s0, reason: message });
        log('info', `qa-smoke ${name}: SKIPPED`, { reason: message });
      } else {
        results.set(name, { name, status: 'FAIL', durationMs: Date.now() - s0, error: message });
        log('error', `qa-smoke ${name}: FAIL`, { error: message });
      }
    }
  }

  // Shared state between steps.
  let template: Json = null;
  let reviewerUserId = '';
  let rule: { ruleId: string; ruleKey: string | null; versionId: string; quote: string } | null = null;
  let taskId = '';
  let recordId = '';
  const smeName = `SYNTHETIC QA smoke SME ${stamp(started)}`;
  // The new-flow pass's own state.
  const forgeMode: NewFlowMode = o.newFlow ?? 'auto';
  const forgeRoute: ForgeRoute = o.forgeRoute ?? 'SME_EXPERT_PM';
  const forgeResults = new Map<ForgeStepName, StepResult<ForgeStepName>>();
  const fids: Record<string, string> = {};

  // ── 1. Health and sign-in ──
  await step('health', async () => {
    const r = await call('anon', 'GET', '/readyz', undefined, { root: true, ok: [503] });
    if (r.status !== 200) throw new Error(`/readyz: ${r.status} ${JSON.stringify(r.body)}`);
    return { readyz: r.body };
  });

  await step('sign-in', async () => {
    await login('admin', o.adminEmail, o.adminPassword, 'DEMO_ADMIN_PASSWORD');
    await login('pm', o.pmEmail, o.pmPassword, 'DEMO_PM_PASSWORD');
    await login('reviewer', o.reviewerEmail, o.reviewerPassword, 'QA_SEED_REVIEWER_PASSWORD');
    const users = (await call('admin', 'GET', '/users')).body.items as { id: string; email: string; roles: string[]; status: string }[];
    const rev = users.find((u) => u.email.toLowerCase() === o.reviewerEmail);
    if (!rev || !rev.roles.includes('REVIEWER')) throw new Error(`${o.reviewerEmail} is not a Reviewer in this client (run qa-users first)`);
    reviewerUserId = rev.id;
    return { admin: o.adminEmail, pm: o.pmEmail, reviewer: o.reviewerEmail };
  });

  // ── 2. Project ──
  /** The newest published authoring version of the workflow (or the pinned template), as offered to the PM. */
  async function pickTemplate(): Promise<Json> {
    const all = (await call('pm', 'GET', '/templates')).body.items as Json[];
    const candidates = all.filter((t) => t.status === 'PUBLISHED' && (t.taskModes ?? []).includes('AUTHORING') && (o.templateId ? t.id === o.templateId : t.workflowName === o.workflowName));
    const found = candidates.sort((a, b) => b.version - a.version)[0] ?? null;
    if (!found) throw new Error(o.templateId ? `Template ${o.templateId} is not offered to the PM (PMs see only the newest published version of each workflow)` : `No published authoring template for "${o.workflowName}"`);
    return found;
  }

  await step('project', async () => {
    template = await pickTemplate();
    ids.templateId = template.id;
    const day = (n: number) => new Date(started.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const jd = (await call('pm', 'POST', '/job-descriptions', {
      title: `${SMOKE_PREFIX}${o.workflowName} task author`.slice(0, 200),
      responsibilities: 'Synthetic QA smoke test project. Every case, person and document is invented.',
      skills: (template.skills?.length ? template.skills : ['KYC']).slice(0, 20),
      wagePerTask: 1,
      wageCurrency: 'USD',
      locationType: 'REMOTE',
    })).body;
    const name = `${SMOKE_PREFIX}${stamp(started)}`;
    const p = (await call('pm', 'POST', '/projects', {
      name,
      templateId: template.id,
      jobDescriptionId: jd.id,
      authoringExperience: 'BOTH',
      reviewRoute: 'SME_PM',
      distinctTarget: 1,
      maxPerExpert: 1,
      tptMinutes: template.defaultTptMinutes ?? 60,
      startDate: day(0),
      endDate: day(30),
      demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN', 'US'], required: false }],
    })).body;
    ids.projectId = p.id;
    await call('pm', 'POST', `/projects/${p.id}/submit`);
    await call('pm', 'POST', `/projects/${p.id}/opportunity/publish`);
    await call('admin', 'POST', `/projects/${p.id}/reviewers`, { userId: reviewerUserId });
    return { projectId: p.id, name, template: `${template.workflowName} v${template.version}`, profileId: template.profileId ?? null };
  });

  // ── 3. Policy: upload, live extraction, review one rule, publish the rule set ──
  await step('policy', async () => {
    const pid = ids.projectId!;
    const up = (await call('pm', 'POST', `/projects/${pid}/policy/documents`, undefined, {
      form: { fields: { title: 'SYNTHETIC Northwind KYC standard (QA smoke)', category: 'Bank policy', jurisdiction: 'US' }, file: { name: POLICY_FILE, type: 'text/markdown', content: o.policyMarkdown } },
    })).body;
    ids.documentVersionId = up.version.id;
    const before = (await call('pm', 'GET', `/projects/${pid}/policy/extraction`)).body;
    if (!before.available) throw new Error(`Extraction is not available: ${(before.problems ?? []).join(' ')}`);
    const start = (await call('pm', 'POST', `/projects/${pid}/policy/extraction`, { documentVersionIds: [up.version.id] })).body;
    ids.extractionBatchId = start.batchId;
    // The Admin view carries the cost; the worker runs the job.
    const batch = await until(o.timeouts.extractionMs, 'Extraction did not finish (is praxis-worker running?)', async () => {
      const v = (await call('admin', 'GET', `/projects/${pid}/policy/extraction`)).body;
      const b = (v.batches as Json[]).find((x) => x.id === start.batchId);
      return b && b.jobs.length && b.jobs.every((j: Json) => TERMINAL_JOB.includes(j.status)) ? b : undefined;
    });
    for (const j of batch.jobs as Json[]) {
      const reported = j.actualUsd ?? j.estimatedUsd;
      addPaid({ kind: 'policy-extraction', provider: j.provider ?? before.profile?.provider ?? 'unknown', count: 1, usd: typeof reported === 'number' ? reported : PAID_CALL_ESTIMATES_USD.extractionFallback, source: typeof reported === 'number' ? 'reported' : 'estimate' });
    }
    const job = batch.jobs[0];
    if (job.status !== 'SUCCEEDED') throw new Error(`Extraction job ${job.id} is ${job.status}: ${job.error ?? 'no error given'}`);
    if (!(job.candidateCount >= 1)) throw new Error(`Extraction job ${job.id} found no rules`);

    const rules = (await call('pm', 'GET', `/projects/${pid}/policy/rules`)).body.items as Json[];
    const resolutions = rules.flatMap((r) => (r.sources ?? []).map((s: Json) => s.resolution as string));
    const tally = resolutions.reduce<Record<string, number>>((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {});
    const resolvedShare = resolutions.length ? (tally.RESOLVED ?? 0) / resolutions.length : 0;
    const extraction = { provider: job.provider, candidates: job.candidateCount, rules: rules.length, citations: tally };
    if (resolvedShare < o.minResolvedShare) throw new Error(`Only ${Math.round(resolvedShare * 100)}% of ${resolutions.length} citations are RESOLVED (${JSON.stringify(tally)}); expected at least ${Math.round(o.minResolvedShare * 100)}%`);

    // A person reviews every extracted rule that has no open problems and excludes the rest with a reason
    // (publication needs every draft decided), then publishes the rule set.
    const problems: string[] = [];
    let reviewed = 0;
    let excluded = 0;
    for (const r of rules.filter((x) => x.state !== 'EXCLUDED')) {
      const v = (await call('pm', 'GET', `/projects/${pid}/policy/rule-versions/${r.versionId}`)).body;
      if (v.state !== 'REVIEWED' && v.problems?.length) {
        problems.push(`${r.ruleKey ?? r.ruleId}: ${v.problems.join('; ')}`);
        await call('pm', 'POST', `/projects/${pid}/policy/rule-versions/${v.versionId}/exclude`, { expectedContentHash: v.contentHash, reason: `${SMOKE_PREFIX}excluded by the smoke test: ${v.problems.join('; ')}`.slice(0, 1000) });
        excluded++;
        continue;
      }
      if (v.state !== 'REVIEWED') await call('pm', 'POST', `/projects/${pid}/policy/rule-versions/${v.versionId}/review`, { expectedContentHash: v.contentHash, required: true });
      reviewed++;
      rule ??= { ruleId: v.ruleId, ruleKey: v.ruleKey ?? null, versionId: v.versionId, quote: v.citations?.[0]?.quote ?? v.body?.requirement ?? '' };
    }
    if (!rule) throw new Error(`No extracted rule can be reviewed as it stands: ${problems.slice(0, 3).join(' | ')}`);
    ids.ruleVersionId = rule.versionId;
    const set = (await call('pm', 'POST', `/projects/${pid}/policy/rule-set`, { expectedLatestVersion: null })).body;
    ids.ruleSetId = set.id;
    return { ...extraction, resolvedShare: round(resolvedShare), reviewed, excluded, citedRule: rule.ruleKey ?? rule.ruleId, ruleSetVersion: set.version };
  });

  // ── 4. Staffing: a fresh SME through FLOW 2 to selected, onboarded and assigned ──
  await step('staffing', async () => {
    const pid = ids.projectId!;
    const sme = 'sme';
    const { credential } = (await call(sme, 'POST', '/auth/dev/google-token', { email: o.smeEmail, name: smeName })).body;
    const me = (await call(sme, 'POST', '/auth/google', { credential, adultAttested: true })).body;
    ids.smeUserId = me.id;
    if (!['VERIFIED', 'ALTERNATIVE_VERIFIED'].includes(me.identityStatus)) {
      const { url } = (await call(sme, 'POST', '/me/identity/session', {})).body;
      const session = /\/dev\/identity\/([^/?#]+)/.exec(url ?? '')?.[1];
      if (!session) throw new Error('The identity provider is not the mock one (no /dev/identity session URL); QA must use the mock identity check');
      await call(sme, 'POST', `/dev/identity/${session}/simulate`, { status: 'verified', adult: true });
    }

    const opp = (await call('pm', 'GET', `/projects/${pid}/opportunity`)).body;
    if (opp.status !== 'PUBLISHED' || !opp.opportunityId) throw new Error(`The project's opportunity is ${opp.status}`);
    const e = (await call(sme, 'POST', '/me/enrollments', { opportunityId: opp.opportunityId })).body;
    ids.enrollmentId = e.id;
    if (e.status === 'DRAFT') await completeAndSubmit(sme, e.id);

    // The worker runs the suitability assessment on the live model; it only recommends.
    const assessed = await until(o.timeouts.assessmentMs, 'The suitability assessment did not finish (is praxis-worker running with SUITABILITY_MODEL?)', async () => {
      const s = (await call(sme, 'GET', `/me/enrollments/${e.id}/status`)).body;
      if (s.status !== 'SUBMITTED') return s;
      // Fail fast when the model call failed rather than waiting out the timeout.
      const peek = await call('reviewer', 'GET', `/review/enrollments/${e.id}`, undefined, { ok: [403, 404, 409] });
      const a = peek.status === 200 ? peek.body.assessment : null;
      if (a?.status === 'ERROR') throw new Error(`The suitability assessment failed: ${a.errorCode ?? ''} ${String(a.limitations ?? '').slice(0, 300)} (model ${a.modelVersion ?? 'unknown'})`);
      return undefined;
    });
    const review = (await call('reviewer', 'GET', `/review/enrollments/${e.id}`)).body;
    addPaid({ kind: 'suitability-assessment', provider: review.assessment?.modelVersion ?? 'unknown', count: 1, usd: PAID_CALL_ESTIMATES_USD.suitability, source: 'estimate' });
    if (assessed.status !== 'REVIEW_PENDING') throw new Error(`After submit the application is ${assessed.status}, not REVIEW_PENDING`);
    if (review.assessment && ['NOT_RUN', 'ERROR'].includes(review.assessment.status)) {
      log('warn', 'suitability assessment did not complete; the Reviewer decides without it', { status: review.assessment.status, errorCode: review.assessment.errorCode });
    }

    // The named seeded Reviewer's own decision (FLOW2 8.2); the AI recommendation is shown, never applied.
    const brief = OpportunityBrief.safeParse(review.opportunity?.brief);
    const roles = (brief.success ? brief.data.contributionRoles : []).filter((r): r is ContributionRole => (CONTRIBUTION_ROLES as readonly string[]).includes(r));
    await call('reviewer', 'POST', `/review/enrollments/${e.id}/decision`, {
      outcome: 'SELECTED',
      reasons: [{ criterionId: null, text: `${SMOKE_PREFIX}synthetic test account selected by a named Reviewer for the QA smoke test.` }],
      candidateMessage: 'You are selected for this synthetic QA smoke project.',
      scope: {
        domain: (brief.success && brief.data.domain) || template.domainName || 'Banking',
        specialty: (brief.success && brief.data.specialty) || null,
        jurisdictions: brief.success && brief.data.jurisdictions.length ? brief.data.jurisdictions : ['US'],
        languages: ['en'],
        contributionRoles: roles.length ? roles : ['TASK_AUTHOR'],
        expiresAt: null,
      },
    });
    await onboard(sme, e.id);
    const after = (await call(sme, 'GET', `/me/enrollments/${e.id}/status`)).body;
    if (after.status !== 'SELECTED' || after.onboardingStatus !== 'COMPLETE') throw new Error(`After selection and onboarding the application is ${after.status}, onboarding ${after.onboardingStatus}`);

    // The PM matches and assigns; the SME accepts (FLOW2 C08).
    const matches = (await call('pm', 'POST', `/projects/${pid}/match`)).body;
    const mine = (matches.items as Json[]).filter((m) => m.name === smeName);
    if (mine.length !== 1) throw new Error(`The match list has ${mine.length} entries for ${smeName} (of ${matches.items.length}); ${(matches.warnings ?? []).join(' ')}`);
    ids.candidateId = mine[0].candidateId;
    await call('pm', 'POST', `/projects/${pid}/assignments`, { candidateIds: [mine[0].candidateId] });
    const proposals = ((await call(sme, 'GET', '/me/assignments')).body.items as Json[]).filter((a) => a.status === 'PROPOSED');
    if (proposals.length !== 1) throw new Error(`The SME has ${proposals.length} proposed assignments, expected 1`);
    ids.smeAssignmentId = proposals[0].id;
    await call(sme, 'POST', `/me/assignments/${proposals[0].id}/accept`, { expectedRevision: proposals[0].revision });
    return { sme: o.smeEmail, enrollment: 'SELECTED', onboarding: 'COMPLETE', assignment: 'ACCEPTED', decidedBy: o.reviewerEmail };
  });

  // ── 5. Authoring: state slot, AI-assistant call, save, authorship review, submit ──
  await step('authoring', async () => {
    const pid = ids.projectId!;
    const sme = 'sme';
    // The worker issues the first task on acceptance; the SME can also pull one.
    let pulled = false;
    const listed = await until(o.timeouts.taskMs, 'No task was issued to the SME', async () => {
      const r = await call(sme, 'GET', `/me/projects/${pid}`, undefined, { ok: [409] });
      const tasks = r.status === 200 ? (r.body.tasks as Json[]) : [];
      if (tasks.length) return tasks[0];
      if (r.status === 200 && r.body.canPull && !pulled) {
        pulled = true;
        const n = await call(sme, 'POST', `/me/projects/${pid}/tasks/next`, {}, { ok: [409] });
        if (n.status === 200) return n.body;
      }
      return undefined;
    });
    taskId = listed.id;
    ids.taskId = taskId;
    let t = (await call(sme, 'GET', `/me/tasks/${taskId}`)).body;
    const slot = t.input?.slot ?? {};

    await call(sme, 'POST', `/me/tasks/${taskId}/conversation/consent`, { version: AUTHORSHIP_VERSION, accepted: true });
    // An uploaded form's own worked example (Admin view), when the form is not the golden account-opening one.
    let example: Record<string, unknown> | null = null;
    const profileId = t.template?.profileId as string | null;
    if (profileId && profileId !== 'kyc-account-opening') {
      const f = await call('admin', 'GET', `/template-profiles/${encodeURIComponent(profileId)}`, undefined, { ok: [404] });
      example = f.status === 200 ? (f.body.examples?.[0]?.output ?? null) : null;
    }
    let output = buildOutput(t, rule!, example);
    const sampled = profileId && profileId !== 'kyc-account-opening' && !example;
    const save = async (out: Record<string, unknown>, revision: number) => {
      const r = await call(sme, 'PUT', `/me/tasks/${taskId}`, { output: out, activeSecondsDelta: 120, expectedRevision: revision }, { ok: [422] });
      if (r.status === 422) throw new Error(`Save refused: ${JSON.stringify(r.body?.details ?? r.body).slice(0, 600)}`);
      return r;
    };
    let saved = await save(output, t.revision);
    // A template Anvil defined grades each criterion with its own evaluator. The author learns the template's criterion
    // IDs and evaluator versions from the workbench's pre-check, exactly as a human author does, and binds the rubric.
    const bound: { criteriaFrom: 'example' | 'pre-check' | null; criteria: number } = { criteriaFrom: example ? 'example' : null, criteria: 0 };
    if (!example && t.template?.profileId !== 'kyc-account-opening') {
      for (let round = 0; round < 2; round++) {
        const pre = await call(sme, 'POST', `/me/tasks/${taskId}/check`, {});
        addPaid({ kind: 'similarity-embedding', provider: 'vertex-embeddings', count: 1, usd: PAID_CALL_ESTIMATES_USD.embedding, source: 'estimate' });
        const next = bindCriteriaFromChecks(output, (pre.body.checks ?? []) as Json[]);
        if (!next) break;
        output = next;
        bound.criteriaFrom = 'pre-check';
        bound.criteria = ((output.sections as Json).S7?.criteria ?? []).length;
        saved = await save(output, saved.body.revision);
      }
    }

    // One live AUTHORING_MODEL call through the chatbot; the author keeps their own text (the proposal is discarded).
    const msg = (await call(sme, 'POST', `/me/tasks/${taskId}/conversation/messages`, {
      content: 'I have entered the case myself in the form. Please check whether my account opening case is organised under the right sections and tell me which fields still look thin.',
      expectedRevision: saved.body.revision,
    })).body;
    ids.chatRunId = msg.runId;
    const run = await until(o.timeouts.chatMs, 'The authoring assistant did not answer (is praxis-worker running with AUTHORING_MODEL?)', async () => {
      const c = (await call(sme, 'GET', `/me/tasks/${taskId}/conversation`)).body;
      return c.run?.id === msg.runId && ['SUCCEEDED', 'FAILED'].includes(c.run.status) ? c : undefined;
    });
    addPaid({ kind: 'authoring-assistant', provider: run.run.model ?? 'unknown', count: 1, usd: PAID_CALL_ESTIMATES_USD.authoring, source: 'estimate' });
    if (run.run.status !== 'SUCCEEDED') throw new Error(`The authoring assistant run ${msg.runId} FAILED: ${run.run.error ?? 'no error given'}`);
    if (run.state?.pending) await call(sme, 'POST', `/me/tasks/${taskId}/conversation/decision`, { runId: msg.runId, accept: false });

    // The author's declaration for this revision, then submit.
    const conv = (await call(sme, 'GET', `/me/tasks/${taskId}/conversation`)).body;
    const resolutions = ((conv.state?.unresolved ?? []) as string[]).map((question) => ({ question, answer: 'Synthetic QA smoke: the author confirms this in their own words; every fact in the case is invented.' }));
    await call(sme, 'POST', `/me/tasks/${taskId}/conversation/review`, { expectedRevision: conv.revision, ownWork: true, noExternalLlm: true, authorisedSources: true, ...(resolutions.length ? { resolutions } : {}) });
    t = (await call(sme, 'GET', `/me/tasks/${taskId}`)).body;
    let sub = await call(sme, 'POST', `/me/tasks/${taskId}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations: {} }, { ok: [422] });
    const unexplained = (sub.body?.details?.unexplained ?? []) as string[];
    const failing = ((sub.body?.details?.checks ?? []) as Json[]).filter((c) => !c.ok && c.severity !== 'warning');
    if (sub.status === 422 && unexplained.length && !failing.length) {
      // Possible-real-data flags on invented names: the author explains them, as the workbench asks.
      const flagExplanations = Object.fromEntries(unexplained.map((id) => [id, 'Synthetic QA smoke data: every name, number and document is invented.']));
      sub = await call(sme, 'POST', `/me/tasks/${taskId}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations }, { ok: [422] });
    }
    if (sub.status === 422) {
      const checks = ((sub.body?.details?.checks ?? []) as Json[]).filter((c) => !c.ok && c.severity !== 'warning').map((c) => `${c.id}: ${c.message}`);
      const gap = sampled ? ` (the form "${profileId}" has no worked example, so the smoke test built the case from the form's schema and the template's pre-check; a worked example, e.g. authoring.examples in the Anvil proposal, would make this exact)` : '';
      throw new Error(`Submit refused (${sub.body?.error}): ${checks.join(' | ') || JSON.stringify(sub.body?.details).slice(0, 600)}${gap}`);
    }
    addPaid({ kind: 'similarity-embedding', provider: 'vertex-embeddings', count: 1, usd: PAID_CALL_ESTIMATES_USD.embedding, source: 'estimate' });
    return { taskId, ...bound, slot: slot.brief ?? null, case: slot.case ? `${slot.case.field} ${slot.case.value}` : null, form: t.definition, submittedVersion: sub.body.version, assistantModel: run.run.model ?? null };
  });

  // ── 6. Review: the named Reviewer accepts; the dataset record exists and the chain verifies ──
  await step('review', async () => {
    const r = (await call('reviewer', 'GET', `/review/tasks/${taskId}`)).body;
    const cov = r.coverageTags ?? r.slot ?? {};
    await call('reviewer', 'POST', `/review/tasks/${taskId}/decision`, {
      decision: 'ACCEPT',
      expectedRevision: r.revision,
      checklist: CHECKLIST_ALL_TRUE,
      notes: `${SMOKE_PREFIX}accepted by a named seeded Reviewer.`,
      ...(r.slot?.isOpen ? { confirmedCoverage: { tags: cov.tags ?? {}, edgeCase: cov.edgeCase ?? 'none' } } : {}),
    });
    const records = (await call('admin', 'GET', `/dataset/records?projectId=${ids.projectId}`)).body.items as Json[];
    const record = records.find((x) => x.taskInstanceId === taskId);
    if (!record) throw new Error(`No ApprovedTaskRecord for task ${taskId} after acceptance`);
    recordId = record.id;
    ids.recordId = recordId;
    const v = (await call('admin', 'GET', '/dataset/verification')).body;
    if (!v.ok) throw new Error(`The approved-record hash chain does not verify: ${JSON.stringify(v.breaks).slice(0, 600)}`);
    return { recordId, seq: record.seq, decidedBy: o.reviewerEmail, chain: { ok: true, checked: v.checked } };
  });

  // ── 7. Export: Praxis's pre-check only; never calls Anvil ──
  await step('export', async () => {
    const pid = ids.projectId!;
    const st = (await call('pm', 'GET', `/projects/${pid}/export`)).body;
    if (st.validator?.name !== 'praxis-precheck') throw new StepSkipped(`The export validator here is "${st.validator?.name}": validating would call Anvil, which the smoke test never does`);
    if (!st.canValidate) throw new Error(`Export cannot validate: ${st.reason}`);
    const v = (await call('pm', 'POST', `/projects/${pid}/validate`, { recordIds: [recordId] })).body;
    ids.validationRunId = v.id;
    const res = v.results?.[0];
    if (!res || res.status === 'not_validated') throw new Error(`The pre-check did not validate the record: ${JSON.stringify(res?.issues ?? v).slice(0, 400)}`);
    return { validator: v.validator, result: res.status, issues: (res.issues ?? []).map((i: Json) => i.code), canExport: st.canExport };
  });

  // ── 8. Cleanup: cancel the smoke project unless it already completed; append-only records stay by design ──
  await step('cleanup', async () => {
    if (!ids.projectId) throw new StepSkipped('no project was created');
    if (!jar.has('pm')) throw new Error('not signed in as the PM');
    // A STAFFED project cannot be cancelled or paused; the worker starts it (IN_PROGRESS) shortly after staffing.
    const p = await until(o.timeouts.taskMs, 'The project stayed STAFFED (the worker starts it); no route cancels a STAFFED project', async () => {
      const x = (await call('pm', 'GET', `/projects/${ids.projectId}`)).body;
      return x.status === 'STAFFED' ? undefined : x;
    });
    // A full pass approves the one required task, so the project completes by itself: terminal, nothing left open.
    if (p.status === 'CANCELLED' || p.status === 'COMPLETED') return { status: p.status, cancelled: false };
    if (p.status === 'IN_PROGRESS') await call('pm', 'POST', `/projects/${ids.projectId}/pause`);
    const c = (await call('pm', 'POST', `/projects/${ids.projectId}/cancel`)).body;
    return { from: p.status, status: c.status, cancelled: true };
  });

  await forgePass();

  const steps = STEPS.map((n) => results.get(n)!);
  const forgeSteps = FORGE_STEPS.map((n) => forgeResults.get(n)!);
  const report: QaSmokeReport = {
    report: 'qa-smoke',
    ok: steps.every((s) => s.status !== 'FAIL') && forgeSteps.every((s) => s.status !== 'FAIL'),
    appEnv: o.appEnv,
    startedAt: started.toISOString(),
    durationMs: Date.now() - t0,
    steps,
    ids,
    paidCalls: paid,
    totalPaidCalls: paid.reduce((n, p) => n + p.count, 0),
    estimatedCostUsd: round(paid.reduce((n, p) => n + p.usd, 0)),
    forge: { mode: forgeMode, ran: forgeResults.get('forge-settings')?.status === 'PASS', route: forgeRoute, steps: forgeSteps, ids: fids },
  };
  return JSON.parse(redact(JSON.stringify(report))) as QaSmokeReport;

  // ───────────────────────── helpers ─────────────────────────

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
    const roles: unknown[] = (s.profile.roles as { id: string; status: string }[]).filter((r) => r.status === 'PROPOSED').map((r) => ({ action: 'CONFIRM', id: r.id }));
    if (s.questions.some((q: { fields: string[] }) => q.fields.includes('roles')) && s.profile.roles.length === 0) {
      roles.push({ action: 'ADD', role: { title: 'Synthetic QA KYC analyst', employerType: 'Synthetic organisation', start: '2015-01', end: null, responsibility: 'PERFORMED', specialtyRelevant: true } });
    }
    const claims = (s.profile.claims as { id: string; status: string }[]).filter((c) => c.status === 'PROPOSED').map((c) => ({ action: 'CONFIRM', id: c.id }));
    if (fields.length || roles.length || claims.length) {
      s = (await call(who, 'POST', '/me/profile/corrections', { enrollmentId, expectedRevision: s.session.revision, fields, roles, claims })).body;
    }
    await call(who, 'POST', `/me/enrollments/${enrollmentId}/submit`, { expectedRevision: s.session.revision, confirmAccuracy: true, evidencePermission: true });
  }

  /** C07 checklist, item by item, as the candidate. */
  async function onboard(who: string, enrollmentId: string) {
    const view = (await call(who, 'GET', `/me/onboarding?enrollmentId=${enrollmentId}`)).body;
    for (const item of view.items as { key: string; kind: string; done: boolean; terms: { sha256: string } | null }[]) {
      if (item.done || item.kind === 'certification' || item.kind === 'payee') continue;
      const data = item.kind === 'conflicts'
        ? { hasConflicts: false, authorizedToContribute: true }
        : item.kind === 'preferences'
          ? { country: 'US', languages: [{ language: 'en', level: 'C2' }], timezone: 'America/Chicago', hoursPerWeek: 20, emailNotifications: false }
          : undefined;
      await call(who, 'POST', '/me/onboarding/acknowledgements', { enrollmentId, itemKey: item.key, ...(item.terms ? { termsHash: item.terms.sha256 } : {}), ...(data ? { data } : {}) });
    }
  }

  // ───────────────────────── MVP1 new flow (ADI Forge) ─────────────────────────

  /**
   * The new-flow pass, after the earlier journey's steps. Everything again through the routes the apps use, as named
   * actors: the demo PM (project, Sourcing, assignment, the final Approve), the demo Admin (reads the settings only), a
   * synthetic SME and, on the Reviewer route, a synthetic Reviewer, both uploaded in Sourcing and signed in to the
   * candidate app with Offline sign-in. Every decision is a person's (the Reviewer's pass, the PM's Approve).
   */
  async function forgePass() {
    const fstep = (name: ForgeStepName, fn: () => Promise<Record<string, unknown> | void>) => runStep(forgeResults, FORGE_NEEDS, name, fn);
    const compact = started.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const smeEmail = o.forgeSmeEmail ?? `smoke-forge-sme-${compact}@praxis.test`;
    const reviewerEmail = o.forgeReviewerEmail ?? `smoke-forge-rev-${compact}@praxis.test`;
    const withReviewer = forgeRoute === 'SME_EXPERT_PM';
    const projects: string[] = [];
    let ftemplate: Json = null;
    let frule: { ruleId: string; ruleKey: string | null; versionId: string; quote: string } | null = null;
    let tasks: Json[] = [];
    const people: { sme?: { id: string; email: string }; reviewer?: { id: string; email: string } } = {};
    const signedIn = new Set<string>();

    await fstep('forge-settings', async () => {
      if (forgeMode === 'off') throw new StepSkipped('QA_SMOKE_NEW_FLOW=off');
      if (results.get('sign-in')?.status !== 'PASS') throw new StepSkipped('needs sign-in');
      const r = await call('admin', 'GET', '/admin/forge-settings', undefined, { ok: [403, 404] });
      const off = (why: string) => (forgeMode === 'on' ? new Error(`${why}; QA_SMOKE_NEW_FLOW=on needs it on (Admin → Candidate app sign-in)`) : new StepSkipped(why));
      if (r.status !== 200) throw off(`GET /admin/forge-settings answered ${r.status}: this API has no new-flow settings`);
      if (!r.body.newFlow) throw off('The new flow is off for this client');
      if (r.body.candidateSignIn !== 'OFFLINE') throw new Error('Candidate sign-in is Online: the smoke test signs its synthetic SME and Reviewer in with Offline sign-in, so QA must use Offline (Admin → Candidate app sign-in)');
      return { newFlow: true, candidateSignIn: r.body.candidateSignIn, route: forgeRoute };
    });

    /** A submitted new-flow project whose one SME may author all `perExpert` tasks. Returns its id and task rows. */
    async function createProject(perExpert: number, suffix = '') {
      const day = (n: number) => new Date(started.getTime() + n * 86_400_000).toISOString().slice(0, 10);
      const jd = (await call('pm', 'POST', '/job-descriptions', {
        title: `${FORGE_SMOKE_PREFIX}${ftemplate.workflowName} task author`.slice(0, 200),
        responsibilities: 'Synthetic QA smoke test project (new flow). Every case, person and document is invented.',
        skills: (ftemplate.skills?.length ? ftemplate.skills : ['KYC']).slice(0, 20),
        wagePerTask: 1,
        wageCurrency: 'USD',
        locationType: 'REMOTE',
      })).body;
      const p = (await call('pm', 'POST', '/projects', {
        // Names are unique per client: to the second, so a re-run never collides; a replacement names its task count.
        name: `${FORGE_SMOKE_PREFIX}${started.toISOString().slice(0, 19).replace('T', ' ')}${suffix}`,
        templateId: ftemplate.id,
        jobDescriptionId: jd.id,
        authoringExperience: 'BOTH',
        reviewRoute: forgeRoute,
        distinctTarget: perExpert,
        maxPerExpert: perExpert,
        tptMinutes: ftemplate.defaultTptMinutes ?? 60,
        startDate: day(0),
        endDate: day(30),
        demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB', 'IN', 'US'], required: false }],
      })).body;
      projects.push(p.id);
      await call('pm', 'POST', `/projects/${p.id}/submit`);
      const rows = (await call('pm', 'GET', `/projects/${p.id}/forge-tasks`)).body.items as Json[];
      return { id: p.id as string, rows };
    }

    // ── Project: from the same template; one SME may hold every task (a probe finds how many the template makes) ──
    await fstep('forge-project', async () => {
      ftemplate = template ?? (await pickTemplate());
      fids.templateId = ftemplate.id;
      let p = await createProject(1);
      let probe: string | null = null;
      if (p.rows.length > 1) {
        // A case-selector template makes one task per value whatever the target; the per-expert cap cannot exceed the
        // target, so a project sized to the task count replaces the probe (cancelled at once).
        probe = p.id;
        await cancelProject(p.id);
        p = await createProject(p.rows.length, ` (${p.rows.length} tasks)`);
      }
      fids.projectId = p.id;
      if (probe) fids.probeProjectId = probe;
      tasks = p.rows;
      return { projectId: p.id, template: `${ftemplate.workflowName} v${ftemplate.version}`, route: forgeRoute, tasks: tasks.length, ...(probe ? { probeCancelled: probe } : {}) };
    });

    // ── Policy: the same synthetic policy, one rule a person writes from it (no extraction), reviewed and published ──
    await fstep('forge-policy', async () => {
      const pid = fids.projectId!;
      const up = (await call('pm', 'POST', `/projects/${pid}/policy/documents`, undefined, {
        form: { fields: { title: 'SYNTHETIC Northwind KYC standard (QA smoke, new flow)', category: 'Bank policy', jurisdiction: 'US' }, file: { name: POLICY_FILE, type: 'text/markdown', content: o.policyMarkdown } },
      })).body;
      const quote = 'The analyst must verify the identity of every account owner before the account is opened.';
      if (!o.policyMarkdown.includes(quote)) throw new Error('The synthetic policy no longer contains the sentence the new-flow rule cites');
      const made = (await call('pm', 'POST', `/projects/${pid}/policy/rules`, {
        documentVersionId: up.version.id,
        ruleKey: 'NW-2.1',
        body: {
          title: 'Verify every owner',
          requirement: quote,
          requirementType: 'obligation',
          visibility: 'agent_visible',
          applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
          prerequisites: [],
          precedence: [],
          exceptions: { kind: 'none', items: [] },
          effective: { from: null, to: null, conditionText: 'always' },
          evidenceNeeds: [],
          verificationHint: null,
          uncertainty: [],
        },
        citations: [{ fieldPath: 'requirement', role: 'supports', quote }],
      })).body;
      await call('pm', 'POST', `/projects/${pid}/policy/rule-versions/${made.versionId}/review`, { expectedContentHash: made.contentHash, required: true });
      const set = (await call('pm', 'POST', `/projects/${pid}/policy/rule-set`, { expectedLatestVersion: null })).body;
      frule = { ruleId: made.ruleId, ruleKey: made.ruleKey ?? 'NW-2.1', versionId: made.versionId, quote };
      fids.ruleVersionId = made.versionId;
      fids.ruleSetId = set.id;
      return { rule: frule.ruleKey, ruleSetVersion: set.version };
    });

    // ── Tasks: one row per slot, made once; nothing can be exported yet ──
    await fstep('forge-tasks', async () => {
      const pid = fids.projectId!;
      const again = (await call('pm', 'GET', `/projects/${pid}/forge-tasks`)).body.items as Json[];
      const same = (a: Json[], b: Json[]) => a.length === b.length && a.every((x, i) => x.taskId === b[i]?.taskId);
      if (!tasks.length) throw new Error('The project has no task rows (one per slot is expected)');
      if (!same(tasks, again)) throw new Error(`Reading the Tasks list again changed it (${tasks.length} rows, then ${again.length}): rows must be made once per slot`);
      const slots = new Set(tasks.map((t) => t.slotLabel));
      if (slots.size !== tasks.length) throw new Error(`${tasks.length} task rows for ${slots.size} slots: one row per slot is expected`);
      const notOpen = tasks.filter((t) => t.status !== 'CREATED' || t.author);
      if (notOpen.length) throw new Error(`${notOpen.length} new task rows are not Open and unassigned`);
      const ex = (await call('pm', 'GET', `/projects/${pid}/export`)).body;
      if (ex.canExport) throw new Error('Export is open before any task is approved');
      return { tasks: tasks.length, selectors: tasks.map((t) => t.selector?.label ?? null), export: ex.reason };
    });

    // ── Sourcing: the synthetic SME (and Reviewer), uploaded by the PM for this project ──
    await fstep('forge-sourcing', async () => {
      const pid = fids.projectId!;
      const add = async (role: 'SME' | 'REVIEWER', email: string) =>
        (await call('pm', 'POST', '/sourcing/people', { projectId: pid, role, firstName: 'SYNTHETIC', lastName: `QA smoke ${role === 'SME' ? 'SME' : 'Reviewer'} ${compact}`, email, agency: 'SYNTHETIC QA smoke' })).body as { id: string; email: string };
      people.sme = await add('SME', smeEmail);
      fids.smeSourcedPersonId = people.sme.id;
      if (withReviewer) {
        people.reviewer = await add('REVIEWER', reviewerEmail);
        fids.reviewerSourcedPersonId = people.reviewer.id;
      }
      const offered = (await call('pm', 'GET', `/projects/${pid}/assignable`)).body.people as Json[];
      const missing = [people.sme, people.reviewer].filter((x): x is { id: string; email: string } => !!x && !offered.some((a) => a.sourcedPersonId === x.id));
      if (missing.length) throw new Error(`The Assign screen does not offer ${missing.map((m) => m.email).join(', ')}`);
      return { sme: smeEmail, ...(withReviewer ? { reviewer: reviewerEmail } : {}) };
    });

    // ── Assign: the SME authors every task; the Reviewer reviews every task ──
    await fstep('forge-assign', async () => {
      const pid = fids.projectId!;
      for (const t of tasks) await call('pm', 'POST', `/projects/${pid}/assignments/direct`, { sourcedPersonId: people.sme!.id, taskId: t.taskId });
      if (people.reviewer) for (const t of tasks) await call('pm', 'POST', `/projects/${pid}/assignments/direct`, { sourcedPersonId: people.reviewer.id, taskId: t.taskId });
      const listed = (await call('pm', 'GET', `/projects/${pid}/people`)).body.items as Json[];
      for (const person of [people.sme, people.reviewer].filter(Boolean) as { id: string; email: string }[]) {
        const row = listed.find((x) => x.sourcedPersonId === person.id);
        const held = new Set(((row?.tasks ?? []) as Json[]).map((x) => x.taskId));
        if (!tasks.every((t) => held.has(t.taskId))) throw new Error(`Resource assignments shows ${held.size} of ${tasks.length} tasks for ${person.email}`);
      }
      const rows = (await call('pm', 'GET', `/projects/${pid}/forge-tasks`)).body.items as Json[];
      const assigned = rows.filter((r) => r.status === 'ASSIGNED' && r.author).length;
      if (assigned !== tasks.length) throw new Error(`${assigned} of ${tasks.length} tasks are Assigned with an author`);
      return { assigned, ...(people.reviewer ? { reviewers: rows.filter((r) => r.reviewer).length } : {}) };
    });

    /** Offline sign-in (the mock Google sign-in QA uses), then Before you start. Returns Home. */
    async function candidateSignIn(who: string, email: string, name: string) {
      const { credential } = (await call(who, 'POST', '/auth/dev/google-token', { email, name })).body;
      const r = await call(who, 'POST', '/auth/google', { credential, adultAttested: true }, { ok: [409] });
      if (r.status === 409) throw new Error(`Offline sign-in was refused for ${email}: ${r.body?.error ?? ''} ${r.body?.message ?? ''}`.trim());
      signedIn.add(who);
      const view = (await call(who, 'GET', '/me/forge/terms')).body;
      const docs = (view.terms ?? []) as (Json | null)[];
      if (!docs.length || docs.some((d) => !d)) throw new Error('A current version of every contributor terms document must be published before anyone signs in (Admin → Terms)');
      if (!view.accepted) await call(who, 'POST', '/me/forge/terms', { hashes: Object.fromEntries(docs.map((d) => [d.key, d.sha256])), syntheticOnly: true });
      const home = (await call(who, 'GET', '/me/forge/home')).body;
      if (!home.newFlow || !home.termsAccepted) throw new Error(`Home for ${email}: newFlow ${home.newFlow}, terms accepted ${home.termsAccepted}`);
      return home;
    }

    // ── Candidate app: sign in, accept the terms, Home lists the tasks ──
    await fstep('forge-sign-in', async () => {
      const home = await candidateSignIn('fsme', smeEmail, `SYNTHETIC QA smoke SME ${compact}`);
      const mine = new Map((home.authorTasks as Json[]).map((t) => [t.taskId, t.status]));
      const missing = tasks.filter((t) => mine.get(t.taskId) !== 'New');
      if (missing.length) throw new Error(`Home shows ${tasks.length - missing.length} of ${tasks.length} tasks as New for the SME (${JSON.stringify([...mine.values()])})`);
      if (withReviewer) await candidateSignIn('freviewer', reviewerEmail, `SYNTHETIC QA smoke Reviewer ${compact}`);
      return { sme: { home: tasks.length, status: 'New' }, ...(withReviewer ? { reviewer: 'terms accepted' } : {}) };
    });

    // ── Authoring: the SME saves a valid synthetic case on every task, declares authorship and submits ──
    await fstep('forge-authoring', async () => {
      const versions: number[] = [];
      for (const row of tasks) versions.push(await authorAndSubmit('fsme', row.taskId, frule!));
      const home = (await call('fsme', 'GET', '/me/forge/home')).body;
      const inReview = (home.authorTasks as Json[]).filter((t) => tasks.some((x) => x.taskId === t.taskId) && t.status === 'In review').length;
      if (inReview !== tasks.length) throw new Error(`Home shows ${inReview} of ${tasks.length} tasks In review after submit`);
      return { submitted: tasks.length, versions };
    });

    // ── Review: the Reviewer passes each task; the PM approves each; export opens only with the last approval ──
    await fstep('forge-review', async () => {
      const pid = fids.projectId!;
      if (withReviewer) {
        const listed = new Map(((await call('freviewer', 'GET', '/me/forge/home')).body.reviewTasks as Json[]).map((t) => [t.taskId, t.status]));
        const waiting = tasks.filter((t) => listed.get(t.taskId) === 'To review').length;
        if (waiting !== tasks.length) throw new Error(`The Reviewer's Home shows ${waiting} of ${tasks.length} tasks To review`);
        for (const row of tasks) {
          const v = (await call('freviewer', 'GET', `/me/reviews/${row.taskId}`)).body;
          await call('freviewer', 'POST', `/me/reviews/${row.taskId}/decision`, {
            decision: 'PASS',
            expectedVersion: v.expectedVersion,
            expectedRevision: v.expectedRevision,
            checklist: CHECKLIST_ALL_TRUE,
            notes: `${FORGE_SMOKE_PREFIX}passed by the synthetic Reviewer.`,
            ...(v.flaggedDuplicate ? { duplicateDecision: 'ACCEPT_AS_DISTINCT' } : {}),
            ...(v.confirmCoverage ? { confirmedCoverage: { tags: v.coverageTags?.tags ?? {}, edgeCase: v.coverageTags?.edgeCase ?? 'none' } } : {}),
          });
        }
      }
      for (const [i, row] of tasks.entries()) {
        const before = (await call('pm', 'GET', `/projects/${pid}/export`)).body;
        if (before.canExport) throw new Error(`Export is open with ${i} of ${tasks.length} tasks approved`);
        if (!String(before.reason ?? '').includes(`(${i} of ${tasks.length} now)`)) throw new Error(`Export reason with ${i} of ${tasks.length} approved: "${before.reason}"`);
        const v = (await call('pm', 'GET', `/projects/${pid}/forge-tasks/${row.taskId}`)).body;
        if (!v.canDecide) throw new Error(`The PM cannot decide on ${row.taskId} (status ${v.status}, waiting for ${v.waitingFor ?? 'nobody'})`);
        await call('pm', 'POST', `/projects/${pid}/tasks/${row.taskId}/decision`, {
          decision: 'APPROVE',
          expectedVersion: v.expectedVersion,
          expectedRevision: v.expectedRevision,
          notes: `${FORGE_SMOKE_PREFIX}approved by the PM.`,
          ...(v.checklistRequired ? { checklist: Object.fromEntries((v.checklist as { key: string }[]).map((c) => [c.key, true])) } : {}),
          ...(v.flaggedDuplicate && forgeRoute === 'SME_PM' ? { duplicateDecision: 'ACCEPT_AS_DISTINCT' } : {}),
          ...(v.confirmCoverage ? { confirmedCoverage: { tags: v.coverageTags?.tags ?? {}, edgeCase: v.coverageTags?.edgeCase ?? 'none' } } : {}),
        });
      }
      const records = ((await call('admin', 'GET', `/dataset/records?projectId=${pid}`)).body.items as Json[]).filter((r) => tasks.some((t) => t.taskId === r.taskInstanceId));
      if (records.length !== tasks.length) throw new Error(`${records.length} approved records for ${tasks.length} approved tasks`);
      const chain = (await call('admin', 'GET', '/dataset/verification')).body;
      if (!chain.ok) throw new Error(`The approved-record hash chain does not verify: ${JSON.stringify(chain.breaks).slice(0, 600)}`);
      const home = (await call('fsme', 'GET', '/me/forge/home')).body;
      const accepted = (home.authorTasks as Json[]).filter((t) => tasks.some((x) => x.taskId === t.taskId) && t.status === 'Accepted').length;
      if (accepted !== tasks.length) throw new Error(`The SME's Home shows ${accepted} of ${tasks.length} tasks Accepted`);
      fids.recordIds = records.map((r) => r.id).join(',');
      return { approved: tasks.length, reviewerPassed: withReviewer ? tasks.length : 0, records: records.length, chain: { ok: true, checked: chain.checked } };
    });

    // ── Export: eligibility only; the smoke test never exports (that would call RL Gym) ──
    await fstep('forge-export', async () => {
      const ex = (await call('pm', 'GET', `/projects/${fids.projectId}/export`)).body;
      if (!ex.canExport) throw new Error(`Every task is approved but export is closed: ${ex.reason}`);
      if ((ex.tasks ?? []).length !== tasks.length) throw new Error(`Export lists ${(ex.tasks ?? []).length} approved tasks, expected ${tasks.length}`);
      return { canExport: true, tasks: ex.tasks.length, validator: ex.validator?.name ?? null, exported: false };
    });

    // ── Cleanup: sign the synthetic candidates out; cancel the project unless it completed (records stay by design) ──
    await fstep('forge-cleanup', async () => {
      for (const who of signedIn) await call(who, 'POST', '/me/logout', undefined, { ok: [401] });
      if (!fids.projectId) {
        if (!projects.length) throw new StepSkipped('no new-flow project was created');
        for (const id of projects) await cancelProject(id);
        return { cancelled: projects.length };
      }
      return { signedOut: signedIn.size, ...(await cancelProject(fids.projectId)) };
    });
  }

  /** Cancels a smoke project unless it is already terminal (an in-progress one is paused first). */
  async function cancelProject(id: string) {
    const p = await until(o.timeouts.taskMs, 'The project stayed STAFFED (the worker starts it); no route cancels a STAFFED project', async () => {
      const x = (await call('pm', 'GET', `/projects/${id}`)).body;
      return x.status === 'STAFFED' ? undefined : x;
    });
    if (p.status === 'CANCELLED' || p.status === 'COMPLETED') return { status: p.status, cancelled: false };
    if (p.status === 'IN_PROGRESS') await call('pm', 'POST', `/projects/${id}/pause`);
    const c = (await call('pm', 'POST', `/projects/${id}/cancel`)).body;
    return { from: p.status, status: c.status, cancelled: true };
  }

  /** One task as its author: consent, a valid synthetic case (bound to the template's checks), declaration, submit. */
  async function authorAndSubmit(who: string, id: string, citedRule: { ruleId: string; ruleKey: string | null; versionId: string; quote: string }): Promise<number> {
    let t = (await call(who, 'GET', `/me/tasks/${id}`)).body;
    await call(who, 'POST', `/me/tasks/${id}/conversation/consent`, { version: AUTHORSHIP_VERSION, accepted: true });
    let example: Record<string, unknown> | null = null;
    const profileId = t.template?.profileId as string | null;
    if (profileId && profileId !== 'kyc-account-opening') {
      const f = await call('admin', 'GET', `/template-profiles/${encodeURIComponent(profileId)}`, undefined, { ok: [404] });
      example = f.status === 200 ? (f.body.examples?.[0]?.output ?? null) : null;
    }
    let output = buildOutput(t, citedRule, example);
    const save = async (out: Record<string, unknown>, revision: number) => {
      const r = await call(who, 'PUT', `/me/tasks/${id}`, { output: out, activeSecondsDelta: 120, expectedRevision: revision }, { ok: [422] });
      if (r.status === 422) throw new Error(`Save refused: ${JSON.stringify(r.body?.details ?? r.body).slice(0, 600)}`);
      return r;
    };
    let saved = await save(output, t.revision);
    if (!example && profileId !== 'kyc-account-opening') {
      for (let round = 0; round < 2; round++) {
        const pre = await call(who, 'POST', `/me/tasks/${id}/check`, {});
        addPaid({ kind: 'similarity-embedding', provider: 'vertex-embeddings', count: 1, usd: PAID_CALL_ESTIMATES_USD.embedding, source: 'estimate' });
        const next = bindCriteriaFromChecks(output, (pre.body.checks ?? []) as Json[]);
        if (!next) break;
        output = next;
        saved = await save(output, saved.body.revision);
      }
    }
    const conv = (await call(who, 'GET', `/me/tasks/${id}/conversation`)).body;
    const resolutions = ((conv.state?.unresolved ?? []) as string[]).map((question) => ({ question, answer: 'Synthetic QA smoke: the author confirms this in their own words; every fact in the case is invented.' }));
    await call(who, 'POST', `/me/tasks/${id}/conversation/review`, { expectedRevision: conv.revision, ownWork: true, noExternalLlm: true, authorisedSources: true, ...(resolutions.length ? { resolutions } : {}) });
    t = (await call(who, 'GET', `/me/tasks/${id}`)).body;
    let sub = await call(who, 'POST', `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations: {} }, { ok: [422] });
    const unexplained = (sub.body?.details?.unexplained ?? []) as string[];
    const failing = ((sub.body?.details?.checks ?? []) as Json[]).filter((c) => !c.ok && c.severity !== 'warning');
    if (sub.status === 422 && unexplained.length && !failing.length) {
      const flagExplanations = Object.fromEntries(unexplained.map((x) => [x, 'Synthetic QA smoke data: every name, number and document is invented.']));
      sub = await call(who, 'POST', `/me/tasks/${id}/submit`, { expectedRevision: t.revision, syntheticDeclaration: true, flagExplanations }, { ok: [422] });
    }
    if (sub.status === 422) {
      const checks = ((sub.body?.details?.checks ?? []) as Json[]).filter((c) => !c.ok && c.severity !== 'warning').map((c) => `${c.id}: ${c.message}`);
      throw new Error(`Submit of ${id} refused (${sub.body?.error}): ${checks.join(' | ') || JSON.stringify(sub.body?.details).slice(0, 600)}`);
    }
    addPaid({ kind: 'similarity-embedding', provider: 'vertex-embeddings', count: 1, usd: PAID_CALL_ESTIMATES_USD.embedding, source: 'estimate' });
    return sub.body.version as number;
  }
}

function round(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * The synthetic case the SME saves. The KYC account-opening form uses the Golden KYC worked case (it passes every
 * check); an uploaded form uses its own first worked example; any other form uses its deterministic synthetic sample.
 * The case then cites the rule this run reviewed and published, by key and exact version, and names the slot's
 * case-selector value (e.g. its state).
 */
export function buildOutput(task: Json, rule: { ruleId: string; ruleKey: string | null; versionId: string; quote: string }, example: Record<string, unknown> | null = null): Record<string, unknown> {
  const profile = task.template?.profile ?? null;
  const base: Json = task.template?.profileId === 'kyc-account-opening'
    ? structuredClone(GOLDEN_KYC_EXAMPLE)
    : example
      ? structuredClone(example)
      : profile
        ? sampleProfileOutput(profile)
        : null;
  if (!base) throw new Error(`No synthetic case builder for the "${task.definition}" form of "${task.template?.workflow}" (template has no profile)`);
  const sections = (base.sections ??= {});
  // Forms that cite policy in S4 cite exactly the rule this run published (other forms have nothing to bind).
  if (Array.isArray(sections.S4?.policies) && sections.S4.policies.length) {
    const first = sections.S4.policies[0] ?? {};
    sections.S4 = {
      ...sections.S4,
      policies: [{ ...first, ruleId: rule.ruleKey ?? rule.ruleId, ruleVersion: rule.versionId, locator: rule.ruleKey ?? first.locator ?? 'R1', quote: rule.quote || first.quote, appliesTo: first.appliesTo ?? 'The whole case', rationale: 'Synthetic QA smoke: the case applies the rule this run reviewed and published.' }],
    };
  }
  // Every pick list holds a value the form allows (the generic sample's S3 environment "none" is not on every form).
  for (const s of profile?.sections ?? [])
    for (const f of s.fields ?? []) {
      const allowed = ((f.options ?? []) as { value: string }[]).map((x) => x.value);
      const sec = sections[s.key];
      if (!allowed.length || !sec || f.allowCustom) continue;
      if (f.type === 'pick_list' && sec[f.key] != null && !allowed.includes(sec[f.key])) sec[f.key] = allowed[0];
      if (f.type === 'multi_select' && Array.isArray(sec[f.key])) {
        const kept = (sec[f.key] as unknown[]).filter((v) => allowed.includes(v as string));
        sec[f.key] = kept.length ? kept : [allowed[0]];
      }
    }
  const slotCase = task.input?.slot?.case as { source: string; value: string } | undefined;
  if (slotCase) {
    const [section, field] = slotCase.source.split('.') as [string, string];
    sections[section] = { ...(sections[section] ?? {}), [field]: slotCase.value };
  }
  const tags = task.input?.slot?.tags ?? {};
  base.header = { ...(base.header ?? {}), coverageTags: tags, edgeCase: task.input?.slot?.edgeCase ?? base.header?.edgeCase ?? null };
  return base;
}

/**
 * Binds the rubric to a template Anvil defined, from the workbench pre-check (`POST /me/tasks/:id/check`): the
 * `anvil.evaluator-binding` check names the template's criterion IDs, and `anvil.evaluator-kinds` names each one's
 * evaluator and version. Returns the corrected output, or null when neither check asks for a change. Weights are split
 * evenly (two decimals, total exactly 100) and the first criterion is critical. The criterion text stays synthetic.
 */
export function bindCriteriaFromChecks(output: Record<string, unknown>, checks: { id: string; ok: boolean; message: string }[]): Record<string, unknown> | null {
  const failing = (id: string) => checks.find((c) => c.id === id && !c.ok)?.message;
  const out = structuredClone(output) as Json;
  const s7 = (out.sections.S7 ??= {});
  const current = (Array.isArray(s7.criteria) ? s7.criteria : []) as Json[];
  const binding = failing('anvil.evaluator-binding');
  if (binding) {
    const list = /criterion IDs \(([^)]*)\)/.exec(binding)?.[1];
    const idsFound = (list ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!idsFound.length) throw new Error(`The pre-check did not name the template's criterion IDs: ${binding}`);
    const template = current[0] ?? {};
    const n = idsFound.length;
    const base = Math.floor(10_000 / n);
    s7.criteria = idsFound.map((id, i) => ({
      ...template,
      id,
      name: `Synthetic QA smoke check: ${id.replace(/_/g, ' ')}`,
      passCondition: `The agent's run evidence fully supports ${id.replace(/_/g, ' ')} (synthetic QA smoke).`,
      partialCredit: `The run evidence partly supports ${id.replace(/_/g, ' ')}.`,
      failCondition: `The run evidence does not support ${id.replace(/_/g, ' ')}.`,
      weight: (base + (i < 10_000 - base * n ? 1 : 0)) / 100,
      critical: i === 0,
      evaluatorKind: null,
      evaluatorVersion: null,
    }));
    return out;
  }
  const kinds = failing('anvil.evaluator-kinds');
  if (kinds) {
    const pairs = new Map([...kinds.matchAll(/([A-Za-z0-9_.:-]+) \(([^()\s]+) v([^()\s]+)\)/g)].map((m) => [m[1]!, { kind: m[2]!, version: m[3]! }]));
    if (!pairs.size) throw new Error(`The pre-check did not name the template's evaluators: ${kinds}`);
    s7.criteria = current.map((c) => (pairs.has(c.id) ? { ...c, evaluatorKind: pairs.get(c.id)!.kind, evaluatorVersion: pairs.get(c.id)!.version } : c));
    return out;
  }
  return null;
}
