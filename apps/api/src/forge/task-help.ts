import { getFieldValue, type TemplateProfile } from '@praxis/shared';
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
