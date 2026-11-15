import { smeTaskStatus } from '@praxis/shared';
import {
  apiSession,
  authorAndSubmit,
  createForgeProject,
  defaultPolicyMarkdown,
  draftTask,
  forgeCandidateSignIn,
  paidLedger,
  publishSyntheticRule,
  signIn,
  SYNTHETIC_RULE_KEY,
  SYNTHETIC_RULE_QUOTE,
  type ApiSession,
  type CitedRule,
  type PaidCall,
} from './qa-smoke';
import type { Http } from './qa-users';

/**
 * `run.ts qa-seed-projects [--apply]`: QA-only. Seeds two clearly labelled SYNTHETIC projects in the MVP1 (ADI Forge)
 * new flow for Authoring QA (docs/DECISIONS.md, "QA seed projects job"), over the public API at API_URL, with the
 * qa-smoke new-flow helpers:
 *
 * - "SYNTHETIC QA lifecycle — KYC v6": one task per case-selector slot, left in a mix of states: two Submitted (waiting
 *   for the PM/Admin decision), one In progress (draft saved), the rest New (assigned, not started).
 * - "SYNTHETIC QA all-approved export — KYC v6": every task Submitted; once the owner approves them all in the console,
 *   Export to RL Gym opens.
 *
 * Both use the review route Author → PM/Admin (SME_PM), so submitted tasks go straight to the owner. Each task has its
 * own synthetic SME (first name SYNTHETIC, an @praxis.test email), added through Sourcing, assigned directly, signed in
 * with Offline candidate sign-in, who accepts the currently published terms. Each project gets the synthetic sample
 * policy and one hand-written rule, reviewed and published as its rule set (no extraction), so every case cites a rule.
 *
 * It never approves, rejects or sends anything back, never creates approved records and never exports: the owner makes
 * every decision in the console. It never changes client settings or terms. It finds the projects by name and continues
 * them, moving tasks only forward, so a re-run never duplicates anything. Dry run by default; --apply also needs
 * QA_SEED_PROJECTS_CONFIRM=create-synthetic-projects. Never production.
 */

type Log = (level: string, message: string, extra?: object) => void;
/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const QA_SEED_PROJECTS_CONFIRM = 'create-synthetic-projects';
/** QA's KYC v6 (the per-state form, one task per governing state). */
export const DEFAULT_SEED_TEMPLATE_ID = '10f6e179-23cd-4666-85bd-22dff3509990';

export type SeedPlan = 'mixed' | 'all-submitted';
export interface SeedProjectSpec {
  key: 'lifecycle' | 'all-approved';
  name: string;
  plan: SeedPlan;
  /** The target for a template without a case selector (a case-selector template makes one task per value). */
  fallbackTarget: number;
}
export const SEED_PROJECTS: readonly SeedProjectSpec[] = [
  { key: 'lifecycle', name: 'SYNTHETIC QA lifecycle — KYC v6', plan: 'mixed', fallbackTarget: 4 },
  { key: 'all-approved', name: 'SYNTHETIC QA all-approved export — KYC v6', plan: 'all-submitted', fallbackTarget: 2 },
];

/** How far the job moves a task, in order; it never moves one back, and never past SUBMITTED. */
const ORDER = ['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'] as const;
type Target = Exclude<(typeof ORDER)[number], 'CREATED'>;
const rank = (status: string) => (ORDER as readonly string[]).indexOf(status);

/** The state each task (in slot order) is left in. The mixed plan needs at least four tasks. */
export function targetStates(plan: SeedPlan, n: number): Target[] {
  if (plan === 'all-submitted') return Array.from({ length: n }, () => 'SUBMITTED');
  if (n < 4) throw new Error(`The lifecycle project needs at least 4 tasks (2 Submitted, 1 In progress, 1 New); the template made ${n}`);
  return Array.from({ length: n }, (_, i) => (i < 2 ? 'SUBMITTED' : i === 2 ? 'IN_PROGRESS' : 'ASSIGNED'));
}

/** The synthetic SME who authors task `i` (0-based, slot order) of a project: fixed, so a re-run finds them. */
export const seedSmeEmail = (key: string, i: number) => `qa-seed-${key}-sme-${i + 1}@praxis.test`;

export const approvalLink = (projectId: string, taskId: string) => `/projects/${projectId}/tasks/${taskId}/review`;

export interface SeedTaskReport {
  taskId: string;
  slot: string | null;
  state: string;
  smeStatus: string;
  target: Target;
  /** The sourced person (Sourcing) who authors the task; never a name or email. */
  authorPersonId: string | null;
  /** The console page where the owner approves the task (Submitted tasks only). */
  approvalLink?: string;
  /** Dry run: what --apply would do. */
  planned?: string[];
  note?: string;
}

export interface SeedProjectReport {
  key: SeedProjectSpec['key'];
  name: string;
  projectId: string | null;
  created: boolean;
  ruleSetId: string | null;
  ruleVersionId: string | null;
  tasks: SeedTaskReport[];
  planned?: string[];
  error?: string;
}

export interface QaSeedProjectsReport {
  report: 'qa-seed-projects';
  ok: boolean;
  apply: boolean;
  appEnv: string;
  startedAt: string;
  durationMs: number;
  templateId: string;
  reviewRoute: 'SME_PM';
  projects: SeedProjectReport[];
  approvalLinks: string[];
  paidCalls: PaidCall[];
  totalPaidCalls: number;
  estimatedCostUsd: number;
}

export interface QaSeedProjectsOptions {
  appEnv: string;
  http: Http;
  apply: boolean;
  /** Must equal QA_SEED_PROJECTS_CONFIRM for --apply. */
  confirm?: string;
  adminEmail: string;
  adminPassword?: string;
  pmEmail: string;
  pmPassword?: string;
  templateId: string;
  policyMarkdown: string;
  pollMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function parseQaSeedProjectsArgs(args: string[]) {
  const extra = args.filter((a) => a !== '--apply');
  if (extra.length) throw new Error(`Unknown qa-seed-projects argument "${extra[0]}". Use: --apply (default is a dry run)`);
  return { apply: args.includes('--apply') };
}

export function optionsFromEnv(env: NodeJS.ProcessEnv, appEnv: string, http: Http, apply: boolean): QaSeedProjectsOptions {
  return {
    appEnv,
    http,
    apply,
    confirm: env.QA_SEED_PROJECTS_CONFIRM,
    adminEmail: env.QA_SEED_ADMIN_EMAIL ?? 'admin@praxis.demo',
    adminPassword: env.DEMO_ADMIN_PASSWORD,
    pmEmail: env.QA_SEED_PM_EMAIL ?? 'pm@praxis.demo',
    pmPassword: env.DEMO_PM_PASSWORD,
    templateId: env.QA_SEED_PROJECTS_TEMPLATE_ID?.trim() || DEFAULT_SEED_TEMPLATE_ID,
    policyMarkdown: defaultPolicyMarkdown(),
  };
}

export async function qaSeedProjects(o: QaSeedProjectsOptions, log: Log): Promise<QaSeedProjectsReport> {
  if (o.appEnv === 'production') throw new Error('qa-seed-projects refuses to run with APP_ENV=production');
  if (o.apply && o.confirm !== QA_SEED_PROJECTS_CONFIRM) throw new Error(`qa-seed-projects --apply needs QA_SEED_PROJECTS_CONFIRM=${QA_SEED_PROJECTS_CONFIRM}`);
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = now();
  const t0 = Date.now();
  const ledger = paidLedger();
  const api = apiSession({ http: o.http, log, sleep, pollMs: o.pollMs ?? 5000, secrets: [o.adminPassword, o.pmPassword] });
  const projects: SeedProjectReport[] = [];

  await signIn(api, 'admin', o.adminEmail, o.adminPassword, 'DEMO_ADMIN_PASSWORD');
  await signIn(api, 'pm', o.pmEmail, o.pmPassword, 'DEMO_PM_PASSWORD');

  // Read only: the job never changes the client's settings.
  const settings = await api.call('admin', 'GET', '/admin/forge-settings', undefined, { ok: [403, 404] });
  if (settings.status !== 200 || !settings.body.newFlow) throw new Error('The new flow is off for this client; qa-seed-projects needs it on (it never switches it on itself)');
  if (settings.body.candidateSignIn !== 'OFFLINE') throw new Error('Candidate sign-in is Online: the synthetic SMEs sign in with Offline sign-in, so QA must use Offline (Admin → Candidate app sign-in)');

  const template = ((await api.call('pm', 'GET', '/templates')).body.items as Json[]).find((t) => t.id === o.templateId);
  if (!template || template.status !== 'PUBLISHED' || !(template.taskModes ?? []).includes('AUTHORING')) {
    throw new Error(`Template ${o.templateId} is not offered to the PM as a published authoring template (PMs see only the newest published version of each workflow)`);
  }

  for (const spec of SEED_PROJECTS) {
    const r: SeedProjectReport = { key: spec.key, name: spec.name, projectId: null, created: false, ruleSetId: null, ruleVersionId: null, tasks: [] };
    projects.push(r);
    try {
      await seedProject(api, o, spec, template, r, ledger, started, log);
    } catch (err) {
      r.error = api.redact(err instanceof Error ? err.message : String(err));
      log('error', `qa-seed-projects ${spec.key}: failed`, { projectId: r.projectId, error: r.error });
    }
  }

  const report: QaSeedProjectsReport = {
    report: 'qa-seed-projects',
    ok: projects.every((p) => !p.error),
    apply: o.apply,
    appEnv: o.appEnv,
    startedAt: started.toISOString(),
    durationMs: Date.now() - t0,
    templateId: o.templateId,
    reviewRoute: 'SME_PM',
    projects,
    approvalLinks: projects.flatMap((p) => p.tasks.map((t) => t.approvalLink).filter((x): x is string => !!x)),
    paidCalls: ledger.list,
    totalPaidCalls: ledger.calls(),
    estimatedCostUsd: ledger.usd(),
  };
  return JSON.parse(api.redact(JSON.stringify(report))) as QaSeedProjectsReport;
}

/** Finds or creates one project and moves each of its tasks forward to its target state. */
async function seedProject(api: ApiSession, o: QaSeedProjectsOptions, spec: SeedProjectSpec, template: Json, r: SeedProjectReport, ledger: ReturnType<typeof paidLedger>, started: Date, log: Log) {
  const note = 'Synthetic QA seed';
  const existing = ((await api.call('admin', 'GET', '/projects')).body.items as Json[]).find((p) => p.name === spec.name);
  if (existing) {
    r.projectId = existing.id;
    if (existing.templateId !== o.templateId) throw new Error(`Project "${spec.name}" exists on template ${existing.templateId}, not ${o.templateId}; not continuing it`);
    if (existing.reviewRoute !== 'SME_PM') throw new Error(`Project "${spec.name}" exists with review route ${existing.reviewRoute}, not SME_PM; not continuing it`);
    if (['CANCELLED', 'COMPLETED'].includes(existing.status)) throw new Error(`Project "${spec.name}" exists and is ${existing.status}; not continuing it and not making another`);
  }

  if (!o.apply) {
    if (!existing) {
      r.planned = ['create project (Author → PM/Admin)', 'upload synthetic policy, write, review and publish one rule', 'one synthetic SME per task: add in Sourcing, assign, Offline sign-in, accept terms', `move tasks to: ${spec.plan === 'mixed' ? '2 Submitted, 1 In progress, the rest New' : 'all Submitted'}`];
      return;
    }
  }

  // ── Project ──
  let pid: string;
  if (existing && existing.status !== 'DRAFT') pid = existing.id;
  else if (existing) {
    // An earlier run stopped before submitting: size and submit it now.
    pid = existing.id;
    await sizeToTasks(api, pid);
    await api.call('pm', 'POST', `/projects/${pid}/submit`);
  } else {
    const p = await createForgeProject(api, {
      name: spec.name,
      jobTitle: `${spec.name} task author`,
      responsibilities: 'Synthetic QA seed project for Authoring QA. Every case, person and document is invented.',
      template,
      route: 'SME_PM',
      distinctTarget: spec.fallbackTarget,
      maxPerExpert: 1,
      start: started,
      onCreated: (id) => {
        r.projectId = id;
        r.created = true;
      },
      beforeSubmit: (id) => sizeToTasks(api, id),
    });
    pid = p.id;
    log('info', `qa-seed-projects ${spec.key}: project created`, { projectId: pid, tasks: p.rows.length });
  }

  // ── Policy: one reviewed rule in a published rule set ──
  const rule = await ensureRule(api, pid, o, r);

  // ── Tasks ──
  const rows = (await api.call('pm', 'GET', `/projects/${pid}/forge-tasks`)).body.items as Json[];
  const targets = targetStates(spec.plan, rows.length);
  const people = async () => {
    const assigned = (await api.call('pm', 'GET', `/projects/${pid}/people`)).body.items as Json[];
    const open = (await api.call('pm', 'GET', `/projects/${pid}/assignable`)).body.people as Json[];
    return { assigned, open };
  };
  let ppl = await people();
  const personFor = (email: string) => ppl.assigned.find((x) => x.email === email && x.role === 'SME') ?? ppl.open.find((x) => x.email === email && x.role === 'SME');
  const authorOf = (taskId: string) => ppl.assigned.find((x) => x.role === 'SME' && (x.tasks as Json[]).some((t) => t.taskId === taskId));

  const work: { i: number; row: Json; target: Target; email: string; who: string; planned: string[]; note?: string }[] = [];
  for (const [i, row] of rows.entries()) {
    const email = seedSmeEmail(spec.key, i);
    const w = { i, row, target: targets[i]!, email, who: `${spec.key}-${i + 1}`, planned: [] as string[], note: undefined as string | undefined };
    work.push(w);
    const author = authorOf(row.taskId);
    if (author && author.email !== email) {
      w.note = 'authored by someone the job did not add; left as it is';
      continue;
    }
    if (rank(row.status) < 0) {
      w.note = `already ${row.status}; left as it is`;
      continue;
    }
    if (!personFor(email)) w.planned.push('add SME in Sourcing');
    if (row.status === 'CREATED' && !row.author) w.planned.push('assign');
    w.planned.push('Offline sign-in, accept terms');
    if (rank(row.status) < rank(w.target)) w.planned.push(w.target === 'IN_PROGRESS' ? 'save draft' : 'author and submit');
  }

  if (!o.apply) {
    r.tasks = work.map((w) => taskReport(pid, w.row, w.target, authorOf(w.row.taskId)?.sourcedPersonId ?? null, w.planned, w.note));
    return;
  }

  // Sourcing and assignment, as the PM.
  for (const w of work) {
    if (w.note) continue;
    let person = personFor(w.email);
    if (!person) {
      person = (await api.call('pm', 'POST', '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'SYNTHETIC', lastName: `QA seed ${spec.key} SME ${w.i + 1}`, email: w.email, agency: 'SYNTHETIC QA seed' })).body;
      ppl.open.push({ sourcedPersonId: person.id, email: w.email, role: 'SME' });
    }
    if (w.row.status === 'CREATED' && !w.row.author) await api.call('pm', 'POST', `/projects/${pid}/assignments/direct`, { sourcedPersonId: person.sourcedPersonId ?? person.id, taskId: w.row.taskId });
  }
  ppl = await people();

  // Each SME signs in (Offline), accepts the published terms, and works their task up to its target; then signs out.
  const signedIn: string[] = [];
  try {
    for (const w of work) {
      if (w.note) continue;
      await forgeCandidateSignIn(api, w.who, w.email, `SYNTHETIC QA seed ${spec.key} SME ${w.i + 1}`, () => signedIn.push(w.who));
      const status = w.row.status === 'CREATED' ? 'ASSIGNED' : (w.row.status as string);
      if (rank(status) >= rank(w.target)) continue;
      if (w.target === 'IN_PROGRESS') await draftTask(api, w.who, w.row.taskId, rule, { paid: ledger, bind: false, note });
      else await authorAndSubmit(api, w.who, w.row.taskId, rule, { paid: ledger, note });
      log('info', `qa-seed-projects ${spec.key}: task ${w.i + 1} moved to ${w.target}`, { taskId: w.row.taskId });
    }
  } finally {
    for (const who of signedIn) await api.call(who, 'POST', '/me/logout', undefined, { ok: [401] });
  }

  const after = (await api.call('pm', 'GET', `/projects/${pid}/forge-tasks`)).body.items as Json[];
  r.tasks = after.map((row, i) => taskReport(pid, row, targets[i]!, authorOf(row.taskId)?.sourcedPersonId ?? null, undefined, work[i]?.note));
}

/**
 * One synthetic SME per task, so the project needs one SME place per task (places = target ÷ per-expert cap). A
 * case-selector template makes one task per value whatever the target, so while the project is a draft the job reads
 * its task rows and sets the target to their number (per-expert cap 1) before submitting.
 */
async function sizeToTasks(api: ApiSession, pid: string) {
  const rows = (await api.call('pm', 'GET', `/projects/${pid}/forge-tasks`)).body.items as Json[];
  const p = (await api.call('pm', 'GET', `/projects/${pid}`)).body;
  if (rows.length && (p.distinctTarget !== rows.length || p.maxPerExpert !== 1)) await api.call('pm', 'PATCH', `/projects/${pid}`, { distinctTarget: rows.length, maxPerExpert: 1 });
}

/** Reuses the project's reviewed NW-2.1 rule (publishing the rule set if it is not yet), or writes and publishes it. */
async function ensureRule(api: ApiSession, pid: string, o: QaSeedProjectsOptions, r: SeedProjectReport): Promise<CitedRule> {
  const rules = (await api.call('pm', 'GET', `/projects/${pid}/policy/rules`)).body.items as Json[];
  const sets = (await api.call('pm', 'GET', `/projects/${pid}/policy/rule-sets`)).body.items as Json[];
  // The API stores the key with its R- prefix (R-NW-2.1).
  const found = rules.find((x) => String(x.ruleKey ?? '').replace(/^R-/, '') === SYNTHETIC_RULE_KEY && x.state !== 'EXCLUDED');
  if (!found) {
    if (!o.apply) {
      r.planned = [...(r.planned ?? []), 'upload synthetic policy, write, review and publish one rule'];
      return { ruleId: '', ruleKey: SYNTHETIC_RULE_KEY, versionId: '', quote: SYNTHETIC_RULE_QUOTE };
    }
    const made = await publishSyntheticRule(api, pid, { policyMarkdown: o.policyMarkdown, title: 'SYNTHETIC Northwind KYC standard (QA seed)' });
    r.ruleSetId = made.ruleSet.id;
    r.ruleVersionId = made.rule.versionId;
    return made.rule;
  }
  if (found.state !== 'REVIEWED') {
    if (o.apply) await api.call('pm', 'POST', `/projects/${pid}/policy/rule-versions/${found.versionId}/review`, { expectedContentHash: found.contentHash, required: true });
    else r.planned = [...(r.planned ?? []), 'review rule NW-2.1'];
  }
  let setId = sets[0]?.id ?? null;
  if (!sets.some((s) => (s.ruleVersionIds ?? []).includes(found.versionId))) {
    if (o.apply) setId = (await api.call('pm', 'POST', `/projects/${pid}/policy/rule-set`, { expectedLatestVersion: sets[0]?.version ?? null })).body.id;
    else r.planned = [...(r.planned ?? []), 'publish the rule set'];
  }
  r.ruleSetId = setId;
  r.ruleVersionId = found.versionId;
  return { ruleId: found.ruleId, ruleKey: found.ruleKey, versionId: found.versionId, quote: SYNTHETIC_RULE_QUOTE };
}

function taskReport(pid: string, row: Json, target: Target, authorPersonId: string | null, planned?: string[], note?: string): SeedTaskReport {
  return {
    taskId: row.taskId,
    slot: row.selector?.label ?? row.slotLabel ?? null,
    state: row.status,
    smeStatus: smeTaskStatus(row.status),
    target,
    authorPersonId,
    ...(row.status === 'SUBMITTED' ? { approvalLink: approvalLink(pid, row.taskId) } : {}),
    ...(planned ? { planned } : {}),
    ...(note ? { note } : {}),
  };
}

