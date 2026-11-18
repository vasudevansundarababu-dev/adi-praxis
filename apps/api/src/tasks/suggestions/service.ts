import {
  emptySuggestionState,
  getFieldValue,
  hashValue,
  isBlankValue,
  sectionDigest,
  suggestibleFields,
  unconfirmedSections,
  type FieldSuggestion,
  type SectionKey,
  type SuggestionState,
  type SuggestionsResponse,
  type TaskCheck,
  type TemplateProfile,
} from '@praxis/shared';
import type { TaskInstance, Template } from '@prisma/client';
import type { Db, Tx } from '../../db';
import { AppError } from '../../lib/errors';
import { authoringPolicyView, effectivePolicy } from '../../policy/task-policy';
import { profileFor } from '../profile-output';
import { scanForRealData } from '../synthetic-scan';
import { FieldSuggesterTimeoutError, FieldSuggesterUnavailableError, sanitizeValue, type FieldSuggester, type SuggestContext } from './assistant';

type TaskLike = Pick<TaskInstance, 'id' | 'clientId' | 'projectId' | 'drafting' | 'output' | 'input' | 'taskType'> & { project: { template: Pick<Template, 'workflowName' | 'profileId'> } };

export const suggestionStateOf = (t: Pick<TaskInstance, 'drafting'>): SuggestionState => {
  const s = (t.drafting as { suggestions?: Partial<SuggestionState> } | null)?.suggestions;
  return { ...emptySuggestionState(), ...(s ?? {}), used: { ...(s?.used ?? {}) }, confirmed: { ...(s?.confirmed ?? {}) }, offered: { ...(s?.offered ?? {}) } };
};
/** Keeps the drafting record's other parts (its `sections` map is always present, as the drafting checks expect). */
export const draftingWithSuggestions = (t: Pick<TaskInstance, 'drafting'>, state: SuggestionState) => ({ ...((t.drafting ?? {}) as object), sections: (t.drafting as { sections?: unknown } | null)?.sections ?? {}, suggestions: state });

/** The task's sections profile, or null for tasks the profile editor doesn't handle (no suggestions there). */
export function sectionsProfile(t: Pick<TaskLike, 'project' | 'taskType'>): TemplateProfile | null {
  if (t.taskType !== 'AUTHORING') return null;
  const p = profileFor({ workflowName: t.project.template.workflowName, profileId: t.project.template.profileId });
  return p && p.storage === 'sections' ? p : null;
}

const slotOf = (t: Pick<TaskInstance, 'input'>) => (t.input as { slot?: { brief?: string; case?: { source?: string; label?: string; value?: string } } } | null)?.slot ?? null;
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join(' ') : v && typeof v === 'object' ? Object.values(v).map(textOf).join(' ') : v === undefined || v === null ? '' : String(v));

/** Long private answers (reference values the agent must not see), to keep them out of agent-visible suggestions. */
function privateAnswers(profile: TemplateProfile, output: unknown): string[] {
  const out: string[] = [];
  for (const s of profile.sections)
    for (const f of s.fields)
      if ((f.visibility ?? 'author_and_agent') !== 'author_and_agent') {
        const t = norm(textOf(getFieldValue(profile, output, s.key as SectionKey, f)));
        for (const part of t.split(/\s{2,}/)) if (part.length >= 20) out.push(part);
      }
  return out;
}

/**
 * Suggestions for the section's empty fields (or the listed ones), guarded: shaped to each field, no likely-real data,
 * no private reference answer inside an agent-visible field. The author decides what to use.
 */
export async function generateSuggestions(db: Db | Tx, t: TaskLike, args: { section: string; keys?: string[]; again?: boolean }, suggester: FieldSuggester): Promise<SuggestionsResponse> {
  const profile = sectionsProfile(t);
  if (!profile) throw new AppError(404, 'NO_FORM', 'This task’s form has no suggestions.');
  const section = profile.sections.find((s) => s.key === args.section);
  if (!section) throw new AppError(404, 'NO_SECTION', 'This section is not on this form.');
  const slot = slotOf(t);
  const output = t.output ?? {};
  const fields = suggestibleFields(profile, section.key, slot?.case?.source ?? null)
    .filter((f) => (args.keys?.length ? args.keys.includes(f.key) : isBlankValue(getFieldValue(profile, output, section.key as SectionKey, f))))
    .map((f) => ({ key: f.key, field: f }));
  const policy = await effectivePolicy(db, t.clientId, t);
  const rules = policy ? authoringPolicyView(policy.body).rules.filter((r) => r.visibility === 'agent_visible').map((r) => ({ key: r.rule_key, title: r.title, requirement: r.requirement })) : [];
  const authorText = profile.sections.flatMap((s) =>
    s.fields
      .filter((f) => (f.visibility ?? 'author_and_agent') === 'author_and_agent' && ['text', 'long_text', 'pick_list'].includes(f.type))
      .map((f) => [s, f, getFieldValue(profile, output, s.key as SectionKey, f)] as const)
      .filter(([, , v]) => typeof v === 'string' && v.trim())
      .map(([s2, f, v]) => `${s2.key} › ${f.label}: ${String(v)}`),
  );
  const ctx: SuggestContext = { workflow: t.project.template.workflowName, section: { key: section.key, title: section.title, help: section.help }, slot: { brief: slot?.brief ?? null, caseLabel: slot?.case?.label ?? slot?.case?.value ?? null }, rules, authorText, again: !!args.again };
  let raw: { key: string; value?: unknown }[] = [];
  if (fields.length) {
    try {
      raw = await suggester.suggest(fields, ctx);
    } catch (err) {
      if (err instanceof FieldSuggesterTimeoutError) throw new AppError(503, 'SUGGESTIONS_TIMEOUT', 'The suggestion took too long. Try again.');
      if (err instanceof FieldSuggesterUnavailableError) throw new AppError(503, 'SUGGESTIONS_UNAVAILABLE', 'Suggestions are not available right now. Write the text yourself, or try again in a minute.');
      throw err;
    }
  }
  const secret = privateAnswers(profile, output);
  const items: FieldSuggestion[] = [];
  for (const { key, field } of fields) {
    const value = sanitizeValue(field, raw.find((r) => r.key === key)?.value);
    if (value === undefined) continue;
    if (scanForRealData({ [key]: value }).length) continue;
    if ((field.visibility ?? 'author_and_agent') === 'author_and_agent') {
      const text = norm(textOf(value));
      if (secret.some((s) => text.includes(s))) continue;
    }
    items.push({ key, value, hash: hashValue(value) });
  }
  return { section: section.key, items, model: suggester.modelVersion, generatedAt: new Date().toISOString() };
}

/** Records that the author took these suggestions (only ones actually offered for the section). */
export function recordUse(state: SuggestionState, section: string, items: { key: string; hash: string }[]): string[] {
  const offered = state.offered?.[section];
  const done: string[] = [];
  for (const i of items) {
    const o = offered?.items.find((x) => x.key === i.key && x.hash === i.hash);
    if (!o) throw new AppError(409, 'NOT_OFFERED', 'That suggestion is no longer current. Ask for suggestions again.');
    state.used[`${section}.${i.key}`] = { hash: i.hash, at: new Date().toISOString(), model: offered!.model };
    done.push(i.key);
  }
  return done;
}

/** Submit (owner decision 1): every section is confirmed for its current saved content. */
export function suggestionChecks(t: TaskLike): TaskCheck[] {
  const profile = sectionsProfile(t);
  if (!profile) return [];
  return unconfirmedSections(profile, t.output ?? {}, suggestionStateOf(t)).map((s) => ({
    id: `suggestions.confirmed.${s}`,
    section: s,
    ok: false,
    message: `Confirm ${s}: tick that you’ve read every field and it describes how this work is really done`,
  }));
}

export { sectionDigest };
