import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { agentProjection, followUpsOf, typeSpecificWording, type TaskCheck, type TemplateProfile } from '@praxis/shared';
import { caseSelectorOf as templateCaseSelector, selectorField } from './task-service';
import { citedClauseVersions, citedRuleIdentities, citedRules, citedRuleVersions } from '../anvil/clause-export';
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

/**
 * Owner (24 Nov 2026): "keep the existing tasks which I authored". Tasks approved before the stronger checks are never
 * re-validated into a blocked state and their approvals are never back-filled: their problems are reported as warnings,
 * with the explicit gap "approved before the stronger checks", and they still export and run. This is the moment the
 * checks went in (commit 7c12b835).
 */
export const STRONGER_CHECKS_FROM = new Date('2026-11-24T17:34:39Z');
export const CHECKS_GAP = 'approved_before_stronger_checks' as const;

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
  /** Set when the record was approved before the stronger checks: its problems are warnings, never a block. */
  gap: typeof CHECKS_GAP | null;
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

/**
 * Tools that act on an outcome: recording or resolving a finding, asking the customer, referring to a specialist,
 * recommending. A step's conditional follow-up that calls one decides for the agent what a finding means.
 */
export const OUTCOME_TOOLS: ReadonlySet<string> = new Set(['finding.write', 'finding.resolve', 'information.request', 'specialist.refer', 'recommend']);

/**
 * KYC Judgment v1 A6 (T2, owner 25 Nov 2026): S5 steps state duties, not outcomes. A conditional follow-up that calls an
 * outcome tool ("if a possible match → specialist.refer") hands the agent the answer the published rules should give.
 * A warning on Validate, never a block: the author rewrites it as a duty step.
 */
function outcomeBranches(sections: Record<string, unknown>): TaskProblem[] {
  const s5 = isObj(sections.S5) ? sections.S5 : {};
  if (!Array.isArray(s5.steps)) return [];
  const out: TaskProblem[] = [];
  (s5.steps as unknown[]).forEach((step, i) => {
    followUpsOf(step).forEach((f, j) => {
      const decided = f.tools.filter((t) => OUTCOME_TOOLS.has(t));
      if (!f.if || !decided.length) return;
      out.push({ code: 'STEP_OUTCOME_BRANCH', section: 'S5', field: `S5.steps[${i}].followUps[${j}]`, severity: 'warning', owner: 'author', retryHelps: false, message: `Step ${i + 1} decides the outcome for the agent: “if ${f.if}” → ${decided.join(', ')}. Write it as a duty (for example a separate step: “where the applicable rules require it, …”), so the agent finds what a finding requires in the published rules.` });
    });
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
const DOC_FILE = /[\w.-]+\.(?:md|markdown|pdf|docx?|txt|html?|rtf|odt)\b/i;
const DOC_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const DOC_ID_TEXT = /\bdocument\s+(?:id\s+)?[0-9a-f]{8}\b/i;

/** What in an S4 value names a policy document (a file name, a document id), or null. */
function namedDocument(v: unknown): string | null {
  if (isObj(v) && str(v.documentId)) return `document ${str(v.documentId).slice(0, 8)}`;
  for (const { text } of strings(v, '')) {
    const m = DOC_FILE.exec(text) ?? DOC_UUID.exec(text) ?? DOC_ID_TEXT.exec(text);
    if (m) return `"${m[0]}"`;
  }
  return null;
}

/**
 * KYC Judgment v1 (Haiku pilot, 25 Nov 2026): the agent reads the bank's policy library by rule id with policy.read; it
 * cannot open a policy document by its file name or id. S4 text the agent sees that names one sends it looking for a
 * document that is not there. A warning on Validate, never a block: the author describes the library instead.
 */
function policyDocumentsNamed(sections: Record<string, unknown>, view: unknown): TaskProblem[] {
  const s3 = isObj(sections.S3) ? sections.S3 : {};
  const tools = Array.isArray(s3.tools) ? (s3.tools as unknown[]).map((t) => (isObj(t) ? str(t.id) : str(t))) : [];
  if (!tools.includes('policy.read')) return [];
  const seen = isObj(view) && isObj((view as { sections?: unknown }).sections) ? (view as { sections: Record<string, unknown> }).sections.S4 : sections.S4;
  if (!isObj(seen)) return [];
  const out: TaskProblem[] = [];
  const flag = (field: string, what: string) =>
    out.push({ code: 'POLICY_DOCUMENT_NAMED', section: 'S4', field, severity: 'warning', owner: 'author', retryHelps: false, message: `S4 names a policy document (${what}). The agent reads the bank’s policy library with policy.read by rule id; it cannot open a document by its file name or id. Describe the library instead (for example: the federal, state and bank rules for account opening, read with policy.read by rule id).` });
  for (const [k, v] of Object.entries(seen)) {
    if (Array.isArray(v))
      v.forEach((item, i) => {
        const what = namedDocument(item);
        if (what) flag(`S4.${k}[${i}]`, what);
      });
    else {
      const what = namedDocument(v);
      if (what) flag(`S4.${k}`, what);
    }
  }
  return out;
}

export function snapshotProblems(template: Template, output: unknown, benchmark: unknown = null): TaskProblem[] {
  const authored = authoredContent(output) as Record<string, unknown>;
  const sections = isObj(authored?.sections) ? (authored.sections as Record<string, unknown>) : {};
  const { form, joint } = formOf(template);
  const bench = isObj(benchmark) ? benchmark : {};
  const extra = ['edgeCase', 'archetype', 'complexity'].flatMap((k) => (str(bench[k]) ? [{ path: `benchmark.${k}`, text: str(bench[k]) }] : []));
  const spec = jointTemplateSpec(template);
  const ids = spec ? declaredToolIds(spec.execution) : null;
  const view = agentView(template, output, form, joint);
  return [...stepTools(sections, ids ? new Set(ids) : null), ...outcomeBranches(sections), ...policyDocumentsNamed(sections, view), ...typeWording(template, view), ...scoring(sections, form), ...privateLeaks(sections, form, view, extra)];
}

/**
 * KYC Judgment v1 §16 (owner, 25 Nov 2026): a task that covers every application type is written once, for all of them.
 * Agent-visible wording that names one type is a warning (never a block): the case, not the task, brings the type.
 */
function typeWording(template: Template, view: unknown): TaskProblem[] {
  const sel = templateCaseSelector(template.caseSelector);
  if (!sel || selectorField(template, sel.source)?.type !== 'multi_select') return [];
  const sections = isObj(view) && isObj((view as { sections?: unknown }).sections) ? ((view as { sections: Record<string, unknown> }).sections) : {};
  // Studio's own hints (authoring.template.validateHints) say which fields and words to check, when the template has them.
  const hints = (jointTemplateSpec(template)?.authoring.template as { validateHints?: { fields: string[]; warn_when_mentions: string[]; message: string }[] } | undefined)?.validateHints;
  if (hints?.length) {
    const out: TaskProblem[] = [];
    for (const h of hints)
      for (const path of h.fields) {
        const [sk, fk] = path.split('.') as [string, string];
        const v = isObj(sections[sk]) ? (sections[sk] as Record<string, unknown>)[fk] : undefined;
        const text = JSON.stringify(v ?? '').toLowerCase();
        const term = h.warn_when_mentions.find((w) => new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text));
        if (term) out.push({ code: 'ACCOUNT_TYPE_NAMED', section: sk, field: path, severity: 'warning', owner: 'author', retryHelps: false, message: `${h.message} ${path} mentions "${term}".` });
      }
    return out;
  }
  return typeSpecificWording(sel, sections).map((h) => ({ code: 'ACCOUNT_TYPE_NAMED', section: h.path.split('.')[0]!, field: h.path, severity: 'warning' as const, owner: 'author' as const, retryHelps: false, message: `This task covers every application type, but ${h.path} names one ("${h.term}"). Write it so it fits every type; the case brings its own.` }));
}

/**
 * The checks that read the database: every S4 clause the task cites resolves to a clause version the PM approved (by
 * the time of approval); an approved record still belongs to the project's template version.
 */
export async function referenceProblems(tx: Db | Tx, ctx: { clientId: string; projectId?: string | null; taskId?: string | null; projectTemplateId?: string | null; output: unknown; record?: Pick<ApprovedTaskRecord, 'templateId' | 'templateVersion' | 'createdAt'> | null }): Promise<TaskProblem[]> {
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
  // Rule picker citations (KYC Judgment v1 A5): the exact version by id, with the stored hash matching when there is one.
  for (const c of citedRuleVersions(authoredContent(ctx.output))) {
    const found = await tx.policyRuleVersion.findFirst({ where: { id: c.ruleVersionId, clientId: ctx.clientId }, select: { contentHash: true, reviewedAt: true, citations: { take: 1, select: { id: true } } } });
    const v = found && (c.contentSha256 === null || c.contentSha256 === found.contentHash) ? found : null;
    const why = !v ? 'no longer exists in the policy library at the version picked' : !v.reviewedAt || v.reviewedAt > at ? 'was not approved when the task was approved' : !v.citations.length ? 'has no source citation' : null;
    if (why) out.push({ code: 'UNRESOLVED_CLAUSE', section: 'S4', field: `S4 rule ${c.ruleKey}`, severity: 'blocking', owner: !v ? 'author' : 'pm', retryHelps: false, message: `A policy rule the task cites ${why}. ${!v ? 'Pick the rule again from the library in S4.' : 'The PM approves the rule version, then the task is approved again.'}` });
  }
  // C1 identity citations (KYC Judgment v1 C4): the project's rule with that key and version, whose text hashes to it.
  const identities = citedRuleIdentities(authoredContent(ctx.output));
  if (identities.length) {
    const projectId = ctx.projectId ?? (ctx.taskId ? (await tx.taskInstance.findUnique({ where: { id: ctx.taskId }, select: { projectId: true } }))?.projectId ?? null : null);
    const resolved = await citedClauseVersions(tx, ctx.clientId, { sections: { S4: { identities: identities.map((c) => ({ ruleId: c.ruleKey, ruleVersion: c.version, textSha256: c.textSha256 })) } } }, projectId);
    for (const { citation, version: v } of resolved) {
      const why = !v ? 'is not in the project’s policy library at the version and text cited' : !v.reviewedAt || v.reviewedAt > at ? 'was not approved when the task was approved' : !v.citations.length ? 'has no source citation' : null;
      if (why) out.push({ code: 'UNRESOLVED_CLAUSE', section: 'S4', field: `S4 rule ${citation}`, severity: 'blocking', owner: !v ? 'author' : 'pm', retryHelps: false, message: `A policy rule the task cites ${why}. ${!v ? 'Pick the rule again from the library in S4.' : 'The PM approves the rule version, then the task is approved again.'}` });
    }
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
  const found = [...snapshotProblems(template, output, t.benchmark ?? null), ...(await referenceProblems(tx, { clientId: t.clientId, taskId: t.id, projectTemplateId: t.project.templateId ?? template.id, output, record }))];
  const gap = record && record.createdAt < STRONGER_CHECKS_FROM ? CHECKS_GAP : null;
  const problems = gap ? found.map((p) => ({ ...p, severity: 'warning' as const, message: `${p.message} (Approved before the stronger checks: shown as a warning; the task still exports and runs.)` })) : found;
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
    gap,
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
