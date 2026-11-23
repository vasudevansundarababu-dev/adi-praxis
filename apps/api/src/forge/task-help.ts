import { archetypePlain, businessNotes, complexityPlain, edgeCaseOptionLabel, getFieldValue, orderedTools, toolOptionLabel, type BusinessNote, type TemplateProfile } from '@praxis/shared';
import type { Template } from '@prisma/client';
import { templateBenchmark, taskBenchmarkOf } from '../anvil/benchmark';
import { jointTemplateSpec } from '../anvil/joint-template';
import { declaredToolIds } from '../anvil/tool-binding';
import type { Db, Tx } from '../db';
import { authoringPolicyView, effectivePolicy, sidecar } from '../policy/task-policy';
import { templateGuide } from '../support/authoring-help';

/**
 * MVP1 step 7: the minimal context Help sees for one task. Section titles and whether each is filled, never the
 * author's answers; the slot brief; the project's published, agent-visible rules (ids and titles only); and the review
 * comments the person can already see on their page.
 */
export interface TaskHelpContext {
  task: { status: string; brief: string | null; openSlot: boolean; coverage: Record<string, string> | null };
  template: { name: string; sections: { section: string; title: string; filled: boolean }[] };
  rules: { id: string; title: string }[];
  reviewComments: { section: string | null; text: string }[];
  /**
   * D-020 / D-025: the Benchmark panel in plain words, from the live template: each edge case's dropdown label, the
   * situation and what is unusual, the kind of problem and how much checking it needs, the business notes, and (when
   * Studio answers) whether the benchmark has cases for it. No raw codes.
   */
  benchmark?: {
    edgeCases: { dropdownLabel: string; situation: string; whatIsUnusual: string; kindOfProblem: string | null; checkingNeeded: string | null; appliesTo: string[]; businessNotes: BusinessNote[]; benchmarkCases?: string }[];
    focus: string | null;
    archetype: string | null;
    complexity: string | null;
  };
  /** D-020: the template's tools by purpose ("Screen an applicant — screening.check"). */
  toolGuide?: string[];
}

/** D-020: the Benchmark panel and the tool guide for Help, from the template and the task (nothing the author does not already see). */
const PRODUCT_PLAIN: Record<string, string> = { individual: 'individual accounts', adult_joint: 'joint accounts', teen_joint: 'teen joint accounts', custodial: 'custodial accounts' };
const AVAILABILITY_PLAIN: Record<string, string> = {
  supported: 'The benchmark has practice cases for this situation, so a task focused on it can run.',
  needs_data: 'The benchmark is still building enough practice cases for this situation; a focused task may wait until they exist.',
  needs_environment_change: 'The benchmark cannot run this situation yet; a focused task would wait. Leave the focus on None for now, or ask your project manager.',
};

export function benchmarkHelp(t: { benchmark: unknown; output: unknown; project: { template: Pick<Template, 'lineageId' | 'version' | 'anvilSpec'> } }, availability: Map<string, string> | null = null): Pick<TaskHelpContext, 'benchmark' | 'toolGuide'> {
  const b = templateBenchmark(t.project.template);
  const value = taskBenchmarkOf(t.benchmark);
  const s1 = ((t.output as { sections?: { S1?: Record<string, unknown> } } | null)?.sections?.S1 ?? {}) as Record<string, unknown>;
  const spec = jointTemplateSpec(t.project.template);
  const offered = spec ? declaredToolIds(spec.execution) : null;
  return {
    ...(b.edgeCases.length || value.edgeCase
      ? {
          benchmark: {
            edgeCases: b.edgeCases.map((e) => {
              const c = complexityPlain(e.complexity);
              const status = availability?.get(e.tag);
              return {
                dropdownLabel: edgeCaseOptionLabel(e),
                situation: e.context,
                whatIsUnusual: e.twist,
                kindOfProblem: archetypePlain(e.archetype),
                checkingNeeded: c ? (c.meaning ? `${c.name}: ${c.meaning}` : c.name) : null,
                appliesTo: (e.products ?? []).map((p) => PRODUCT_PLAIN[p] ?? p.replace(/_/g, ' ')),
                businessNotes: businessNotes(e),
                ...(status && AVAILABILITY_PLAIN[status] ? { benchmarkCases: AVAILABILITY_PLAIN[status] } : {}),
              };
            }),
            focus: value.edgeCase ? edgeCaseOptionLabel(b.edgeCases.find((e) => e.tag === value.edgeCase) ?? { tag: value.edgeCase }) : null,
            archetype: typeof s1.archetype === 'string' ? archetypePlain(s1.archetype) : null,
            complexity: typeof s1.complexity === 'string' ? (complexityPlain(s1.complexity)?.name ?? null) : null,
          },
        }
      : {}),
    ...(offered?.length ? { toolGuide: orderedTools(offered).map(toolOptionLabel) } : {}),
  };
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Each section's title and whether any of its fields has a value. */
export function sectionStatus(profile: TemplateProfile | null, output: unknown): TaskHelpContext['template']['sections'] {
  if (!profile) return [];
  return profile.sections.map((s) => ({ section: s.key, title: s.title, filled: s.fields.some((f) => filled(getFieldValue(profile, output, s.key, f))) }));
}

/** The task's published, agent-visible rules in force: frozen snapshot first, else the project's current rule set. */
export async function publishedRules(tx: Db | Tx, t: { id: string; projectId: string; clientId: string }): Promise<TaskHelpContext['rules']> {
  type R = { rule_key?: string; rule_id?: string; title?: string };
  const snap = await tx.taskPolicySnapshot.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } });
  let rules: R[];
  if (snap) rules = sidecar(snap, { agentVisibleOnly: true }).rules as R[];
  else {
    const eff = await effectivePolicy(tx, t.clientId, t);
    rules = eff ? (authoringPolicyView(eff.body).rules as R[]) : [];
  }
  return rules.slice(0, 50).map((r) => ({ id: String(r.rule_key ?? r.rule_id ?? ''), title: String(r.title ?? '').slice(0, 200) }));
}

/** Review comments as {section, text}, whatever shape older rows stored. */
export function commentsOf(v: unknown): TaskHelpContext['reviewComments'] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c): { section?: unknown; text?: unknown } => (c && typeof c === 'object' ? (c as { section?: unknown; text?: unknown }) : { text: c }))
    .filter((c) => typeof c.text === 'string' && c.text)
    .slice(0, 30)
    .map((c) => ({ section: typeof c.section === 'string' ? c.section : null, text: String(c.text).slice(0, 1000) }));
}

export function taskBasics(t: { status: string; input: unknown; coverageTags: unknown }): TaskHelpContext['task'] {
  const slot = (t.input as { slot?: { brief?: string; isOpen?: boolean; tags?: Record<string, string> } } | null)?.slot;
  const tags = (t.coverageTags as { tags?: Record<string, string> } | null)?.tags ?? slot?.tags ?? null;
  return { status: t.status, brief: slot?.brief ?? null, openSlot: slot?.isOpen ?? false, coverage: tags };
}

/** The template guide Help reads (sections, fields and their help, generated from the template profile). */
export const helpGuides = (profile: TemplateProfile | null) => (profile ? [templateGuide(profile)] : []);
