import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { agentProjection, type TaskCheck, type TemplateProfile } from '@praxis/shared';
import { citedRules } from '../anvil/clause-export';
import { actorProjection } from '../anvil/generic-package';
import { jcsSha256 } from '../anvil/jcs';
import { jointTemplateSpec } from '../anvil/joint-template';
import { declaredToolIds } from '../anvil/tool-binding';
import type { Db, Tx } from '../db';
import { authoredContent, profileFor } from './profile-output';

/**
 * E-007 phase 2, Authoring part (owner, 24 Nov 2026): stronger checks in the existing Validate, approval and Export for
 * benchmark, on a frozen snapshot of the task. No template changes and no new screens: the checks read the template as
 * published (S3, S5, S7, the form's field visibility) and report each problem with its section, field, check code,
 * who can fix it and whether trying again helps. S7's 5/2/0 is the scoring truth.
 *
 * The checks are deterministic. They never approve or reject anything: a blocking problem stops an approval or keeps a
 * task out of an export, and a person decides what happens next.
 */

export const TASK_CHECK_REPORT_SCHEMA = 'praxis.task-check-report.v1' as const;
export const TASK_CHECKER = 'praxis.task-integrity' as const;
export const TASK_CHECKER_VERSION = '1' as const;

/** Who can fix a problem: the task's author, the project's PM, the template (Studio), Authoring itself, or the RL Gym. */
export type ProblemOwner = 'author' | 'pm' | 'template' | 'authoring' | 'rlgym';

export interface TaskProblem {
  /** Stable check code, e.g. STEP_TOOL_NOT_OFFERED. */
  code: string;
  section: string;
  /** The field, as a path the author can find (S5.steps[3].tool); null when the problem is the whole section. */
  field: string | null;
  severity: 'blocking' | 'warning';
  owner: ProblemOwner;
  /** True only when the same request may succeed later without any change (a service was unavailable). */
  retryHelps: boolean;
  message: string;
}

export interface TaskCheckReport {
  schema: typeof TASK_CHECK_REPORT_SCHEMA;
  checker: typeof TASK_CHECKER;
  checkerVersion: typeof TASK_CHECKER_VERSION;
  taskId: string;
  recordId: string | null;
  templateId: string;
  templateVersion: number;
  /** JCS SHA-256 of the frozen snapshot the checks ran on: the authored content, the task's input and its template. */
  snapshotSha256: string;
  status: 'pass' | 'fail';
  problems: TaskProblem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const PRIVATE = new Set(['private_reference', 'private_rubric', 'evaluation_private']);
const CODE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

type FormField = { key: string; type: string; visibility?: string; scale?: string; itemFields?: FormField[] };
type Form = { sections?: { key: string; fields?: FormField[] }[] };

/** The template's form as published: the joint spec's form, else the registered profile. */
function formOf(template: Template): { form: Form | null; joint: boolean } {
  const spec = jointTemplateSpec(template);
  if (spec) return { form: spec.authoring.profile as unknown as Form, joint: true };
  return { form: profileFor(template) as unknown as Form | null, joint: false };
}

/** What the agent sees of the task (the same projection the export sends), or null when it cannot be computed. */
function agentView(template: Template, output: unknown, form: Form | null, joint: boolean): unknown {
  try {
    if (joint && form) return actorProjection(form as unknown as Record<string, unknown>, authoredContent(output) as Record<string, unknown>);
    const profile = profileFor(template);
    return profile ? agentProjection(profile as TemplateProfile, output) : null;
  } catch {
    return null;
  }
}

/** Every string value under `v`, with its path. */
function strings(v: unknown, path: string, out: { path: string; text: string }[] = []) {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Private answers reaching the agent: a private field's code value (archetype, complexity, the focused edge case) or a
 * long private text (a criterion's pass or fail condition, a reference answer) written into a field the agent sees.
 */
function privateLeaks(sections: Record<string, unknown>, form: Form | null, agent: unknown, extraPrivate: { path: string; text: string }[]): TaskProblem[] {
  if (!form?.sections || agent == null) return [];
  const priv: { path: string; text: string }[] = [...extraPrivate];
  for (const s of form.sections) {
    const values = isObj(sections[s.key]) ? (sections[s.key] as Record<string, unknown>) : {};
    for (const f of s.fields ?? []) {
      if (!(f.key in values)) continue;
      if (PRIVATE.has(f.visibility ?? '') || f.type === 'criterion') strings(values[f.key], `${s.key}.${f.key}`, priv);
      else if (f.itemFields?.length && Array.isArray(values[f.key]))
        (values[f.key] as unknown[]).forEach((item, i) => {
          if (!isObj(item)) return;
          for (const sub of f.itemFields!) if (PRIVATE.has(sub.visibility ?? '') && sub.key in item) strings(item[sub.key], `${s.key}.${f.key}[${i}].${sub.key}`, priv);
        });
    }
  }
  const visible = strings(agent, '').map((x) => ({ path: x.path, text: norm(x.text) }));
  const out: TaskProblem[] = [];
  const seen = new Set<string>();
  const codes = new Set(extraPrivate.map((x) => x.path));
  for (const p of priv) {
    const t = p.text.trim();
    // A code is checked only for the task's own benchmark answers (edge case, archetype, complexity): a pick-list value
    // shared by a public and a private field (a party role, say) is not a leak. Private free text is checked when long.
    const isCode = codes.has(p.path) && CODE.test(t);
    if (!isCode && t.length < 40) continue;
    const needle = norm(t);
    const hit = visible.find((v) => (isCode ? new RegExp(`(^|[^a-z0-9_])${needle}([^a-z0-9_]|$)`).test(v.text) : v.text.includes(needle)));
    if (!hit || seen.has(p.path)) continue;
    seen.add(p.path);
    const where = hit.path.replace(/^sections\./, '');
    out.push({ code: 'PRIVATE_IN_AGENT_VIEW', section: where.split('.')[0] ?? 'S1', field: where, severity: 'blocking', owner: 'author', retryHelps: false, message: `${where} shows the agent private content from ${p.path}${isCode ? ` ("${t}")` : ''}. Remove it from the field the agent sees.` });
  }
  return out;
}

/** S5 steps naming a tool the task does not offer the agent in S3. */
function stepTools(sections: Record<string, unknown>, declared: Set<string> | null): TaskProblem[] {
  const s3 = isObj(sections.S3) ? sections.S3 : {};
  const s5 = isObj(sections.S5) ? sections.S5 : {};
  if (!Array.isArray(s3.tools) || !Array.isArray(s5.steps)) return [];
  const offered = new Set(s3.tools.map((t) => (isObj(t) ? str(t.id) : str(t))).filter(Boolean));
  if (!offered.size) return [];
  const out: TaskProblem[] = [];
  (s5.steps as unknown[]).forEach((step, i) => {
    const tool = isObj(step) ? str(step.tool) : '';
    // A tool the template does not declare at all is already reported by the package check (APR-13d), not twice.
    if (tool && !offered.has(tool) && (!declared || declared.has(tool)))
      out.push({ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', field: `S5.steps[${i}].tool`, severity: 'blocking', owner: 'author', retryHelps: false, message: `Step ${i + 1} uses ${tool}, but S3 does not offer it to the agent. Offer it in S3 or change the step’s tool.` });
  });
  return out;
}

/** Numbers stated in S7's scoring rule: the maximum, the pass threshold and the 5/2/0 awards. */
export function statedScoring(rule: string) {
  const num = (re: RegExp) => {
    const m = re.exec(rule);
    return m ? Number(m[1]) : null;
  };
  return {
    max: num(/\bmax(?:imum)?\b[^0-9]{0,20}(\d+(?:\.\d+)?)/i),
    threshold: num(/\bat least\s+(\d+(?:\.\d+)?)/i),
    pass: num(/(\d+(?:\.\d+)?)\s*(?:points?|pts?)?\s*for\s+(?:a\s+)?pass/i),
    partial: num(/(\d+(?:\.\d+)?)\s*(?:points?|pts?)?\s*for\s+(?:a\s+)?partial/i),
    fail: num(/(\d+(?:\.\d+)?)\s*(?:points?|pts?)?\s*for\s+(?:a\s+)?fail/i),
  };
}

/** S7 against the 5/2/0 scale: critical criteria define failure; the stated maximum, threshold and awards agree. */
function scoring(sections: Record<string, unknown>, form: Form | null): TaskProblem[] {
  const s7 = isObj(sections.S7) ? sections.S7 : {};
  const criteria = Array.isArray(s7.criteria) ? (s7.criteria as unknown[]).filter(isObj) : [];
  if (!criteria.length) return [];
  const out: TaskProblem[] = [];
  const field = form?.sections?.find((s) => s.key === 'S7')?.fields?.find((f) => f.type === 'criterion') as (FormField & { criterionDefaults?: { id: string; failCondition?: string; criticalCondition?: string }[] }) | undefined;
  // Failure is defined by the criterion's fail condition, its whole-task failure, a "0:" anchor written into its partial
  // credit (the golden KYC form's style), or the template's own default for that criterion.
  const failureDefined = (c: Record<string, unknown>) => {
    if (str(c.failCondition) || str(c.criticalCondition)) return true;
    if (/(^|[^0-9.])0(\s*points?)?\s*[:=\-–]/i.test(str(c.partialCredit))) return true;
    const d = field?.criterionDefaults?.find((x) => x.id === str(c.id));
    return !!(d && (str(d.failCondition) || str(d.criticalCondition)));
  };
  criteria.forEach((c, i) => {
    if (c.critical === true && !failureDefined(c))
      out.push({ code: 'CRITICAL_WITHOUT_FAILURE', section: 'S7', field: `S7.criteria[${i}].failCondition`, severity: 'blocking', owner: 'author', retryHelps: false, message: `Criterion ${str(c.name) || str(c.id) || i + 1} is critical but does not say what counts as a failure. Write its fail condition (0).` });
  });
  if (field?.scale && field.scale !== 'five_two_zero') return out;
  const rule = str(s7.scoringRule);
  if (!rule) return out;
  const weights = criteria.map((c) => (typeof c.weight === 'number' ? c.weight : Number(c.weight)));
  const total = weights.every((w) => Number.isFinite(w)) ? Math.round(weights.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  const s = statedScoring(rule);
  if (s.max !== null && total !== null && s.max !== total)
    out.push({ code: 'S7_MAX_MISMATCH', section: 'S7', field: 'S7.scoringRule', severity: 'blocking', owner: 'author', retryHelps: false, message: `The scoring rule says the maximum is ${s.max}, but the criteria’s weights total ${total}. Make them agree.` });
  const ceiling = s.max ?? total;
  if (s.threshold !== null && ceiling !== null && (s.threshold > ceiling || s.threshold <= 0))
    out.push({ code: 'S7_THRESHOLD_OUT_OF_RANGE', section: 'S7', field: 'S7.scoringRule', severity: 'blocking', owner: 'author', retryHelps: false, message: `The pass threshold ${s.threshold} is outside 0 to ${ceiling}. Set a threshold the task can reach.` });
  const awards: [string, number | null, number][] = [['pass', s.pass, 5], ['partial', s.partial, 2], ['fail', s.fail, 0]];
  const wrong = awards.filter(([, got, want]) => got !== null && got !== want);
  if (wrong.length)
    out.push({ code: 'S7_SCALE_NOT_520', section: 'S7', field: 'S7.scoringRule', severity: 'blocking', owner: 'author', retryHelps: false, message: `The scoring rule awards ${wrong.map(([k, got]) => `${got} for ${k}`).join(', ')}; the scale is 5 for pass, 2 for partial and 0 for fail.` });
  return out;
}

/** The checks that need only the snapshot (no database). */
export function snapshotProblems(template: Template, output: unknown, benchmark: unknown = null): TaskProblem[] {
  const authored = authoredContent(output) as Record<string, unknown>;
  const sections = isObj(authored?.sections) ? (authored.sections as Record<string, unknown>) : {};
  const { form, joint } = formOf(template);
  const bench = isObj(benchmark) ? benchmark : {};
  const extra = ['edgeCase', 'archetype', 'complexity'].flatMap((k) => (str(bench[k]) ? [{ path: `benchmark.${k}`, text: str(bench[k]) }] : []));
  const spec = jointTemplateSpec(template);
  const ids = spec ? declaredToolIds(spec.execution) : null;
  return [...stepTools(sections, ids ? new Set(ids) : null), ...scoring(sections, form), ...privateLeaks(sections, form, agentView(template, output, form, joint), extra)];
}

/**
 * The checks that read the database: every S4 clause the task cites resolves to a clause version the PM approved (by
 * the time of approval); an approved record still belongs to the project's template version.
 */
export async function referenceProblems(tx: Db | Tx, ctx: { clientId: string; projectTemplateId?: string | null; output: unknown; record?: Pick<ApprovedTaskRecord, 'templateId' | 'templateVersion' | 'createdAt'> | null }): Promise<TaskProblem[]> {
  const out: TaskProblem[] = [];
  const at = ctx.record?.createdAt ?? new Date();
  const cited = citedRules(authoredContent(ctx.output)).filter((c) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.ruleId));
  for (const c of cited) {
    const v = await tx.policyRuleVersion.findFirst({ where: { ruleId: c.ruleId, contentHash: c.contentSha256, clientId: ctx.clientId }, select: { reviewedAt: true, citations: { take: 1, select: { id: true } } } });
    if (!v) {
      // S4 may cite a policy document of the project rule set (policyId = the document, sha256 = its version's file).
      const doc = await tx.policyDocumentVersion.findFirst({ where: { documentId: c.ruleId, sha256: c.contentSha256, clientId: ctx.clientId }, select: { document: { select: { archivedAt: true } } } });
      if (doc) {
        if (doc.document.archivedAt) out.push({ code: 'UNRESOLVED_CLAUSE', section: 'S4', field: `S4 policy ${c.ruleId.slice(0, 8)}`, severity: 'blocking', owner: 'author', retryHelps: false, message: 'A policy document the task cites has been archived. Choose a current policy in S4.' });
        continue;
      }
    }
    const why = !v ? 'no longer exists in the policy library' : !v.reviewedAt || v.reviewedAt > at ? 'was not approved when the task was approved' : !v.citations.length ? 'has no source citation' : null;
    if (why) out.push({ code: 'UNRESOLVED_CLAUSE', section: 'S4', field: `S4 clause ${c.ruleId.slice(0, 8)}`, severity: 'blocking', owner: !v ? 'author' : 'pm', retryHelps: false, message: `A policy clause the task cites ${why}. ${!v ? 'Choose a current clause in S4.' : 'The PM approves the clause version, then the task is approved again.'}` });
  }
  if (ctx.record && ctx.projectTemplateId && ctx.record.templateId !== ctx.projectTemplateId)
    out.push({ code: 'APPROVAL_STALE', section: 'S1', field: null, severity: 'blocking', owner: 'pm', retryHelps: false, message: `The task was approved on template version ${ctx.record.templateVersion}, but the project now uses another version. Send it back for rework so it is approved on the current version.` });
  return out;
}

const snapshotOf = (template: Template, output: unknown, input: unknown) => jcsSha256({ template: { id: template.id, version: template.version }, input: input ?? null, authored: authoredContent(output) ?? null });

/** The full report on a frozen snapshot: the approved record's content, or the content being approved. */
export async function taskCheckReport(
  tx: Db | Tx,
  t: { id: string; clientId: string; input: unknown; benchmark?: unknown; project: { templateId?: string | null; template: Template } },
  output: unknown,
  record: Pick<ApprovedTaskRecord, 'id' | 'templateId' | 'templateVersion' | 'createdAt'> | null = null,
): Promise<TaskCheckReport> {
  const template = t.project.template;
  const problems = [...snapshotProblems(template, output, t.benchmark ?? null), ...(await referenceProblems(tx, { clientId: t.clientId, projectTemplateId: t.project.templateId ?? template.id, output, record }))];
  return {
    schema: TASK_CHECK_REPORT_SCHEMA,
    checker: TASK_CHECKER,
    checkerVersion: TASK_CHECKER_VERSION,
    taskId: t.id,
    recordId: record?.id ?? null,
    templateId: template.id,
    templateVersion: template.version,
    snapshotSha256: snapshotOf(template, output, t.input),
    status: problems.some((p) => p.severity === 'blocking') ? 'fail' : 'pass',
    problems,
  };
}

/** A problem as a task check (D18): the author's own problems send the task back with the check pinned to its section. */
export const problemCheck = (p: TaskProblem): TaskCheck => ({ id: `integrity.${p.code}`, section: p.section, ok: false, ...(p.severity === 'warning' ? { severity: 'warning' as const } : {}), message: p.field ? `${p.message} (${p.field})` : p.message });

/** Problems the author can fix (sent back to them), and the ones nobody fixes by editing the task (shown as a plain stop). */
export function splitByOwner(problems: TaskProblem[]) {
  const blocking = problems.filter((p) => p.severity === 'blocking');
  return { author: blocking.filter((p) => p.owner === 'author'), others: blocking.filter((p) => p.owner !== 'author') };
}

export const OWNER_LABEL: Record<ProblemOwner, string> = { author: 'the author', pm: 'the PM', template: 'the template (Studio)', authoring: 'ADI Forge support', rlgym: 'RL Gym' };
