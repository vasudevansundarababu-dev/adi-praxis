import { z } from 'zod';
import { getFieldValue } from './template-profile/helpers';
import type { SectionKey, TemplateProfile, TemplateProfileField } from './template-profile/schema';

/**
 * Suggested text for every field of the SME task form, with provenance and per-section confirmation (owner decisions
 * 1-6, 15 Nov 2026; docs/design/SUGGESTED-TEXT-AND-RUBRIC-TABLE.md). FIELD_SUGGESTIONS_ENABLED.
 *
 * - A suggestion only fills an empty field when the author chooses it; nothing is applied for them.
 * - Where a field's text came from is derived, never stored as a claim: a field the author took a suggestion for keeps
 *   the hash of that suggestion; if the saved value still equals it, it is "used as it is", otherwise "edited".
 * - A section confirmation stores the digest of the section's saved content; any change makes it stale.
 */

/** Deterministic, order-stable JSON (object keys sorted). */
export function suggestionJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(suggestionJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${suggestionJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** FNV-1a 64-bit as hex: the same in the browser and on the server. Not a security hash; it detects change. */
export function hashValue(v: unknown): string {
  const s = suggestionJson(v);
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * p) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function isBlankValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlankValue);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isBlankValue);
  return false;
}

const isPolicyReference = (f: TemplateProfileField) => f.type === 'repeated_array' && (f.itemFields ?? []).some((x) => /sha256/i.test(x.key));

/**
 * Fields that get a suggestion. Not the rubric (S7 has its own editor and template defaults), not the workflow graph,
 * not S4 policy references (picked from the project's published rules) and not the task's case selector (set by the slot).
 */
export function suggestibleFields(profile: TemplateProfile, section: string, selectorSource?: string | null): TemplateProfileField[] {
  const s = profile.sections.find((x) => x.key === section);
  if (!s) return [];
  return s.fields.filter((f) => !['criterion', 'graph_binding', 'policy_citation'].includes(f.type) && !isPolicyReference(f) && selectorSource !== `${section}.${f.key}`);
}

/** Sections the author confirms before Submit: every section with a field the author fills. */
export function sectionsToConfirm(profile: TemplateProfile): string[] {
  return profile.sections.filter((s) => s.fields.some((f) => f.type !== 'graph_binding')).map((s) => s.key);
}

/** The digest of a section's saved content (what a confirmation is bound to). */
export function sectionDigest(profile: TemplateProfile, output: unknown, section: string): string {
  const s = profile.sections.find((x) => x.key === section);
  if (!s) return hashValue(null);
  return hashValue(s.fields.map((f) => [f.key, isBlankValue(getFieldValue(profile, output, section as SectionKey, f)) ? null : getFieldValue(profile, output, section as SectionKey, f)]));
}

export interface UsedSuggestion {
  /** hashValue of the suggestion the author took. */
  hash: string;
  at: string;
  model: string;
}
export interface SectionConfirmation {
  digest: string;
  at: string;
  smeUserId: string;
}
/** Stored in TaskInstance.drafting.suggestions. */
export interface SuggestionState {
  used: Record<string, UsedSuggestion>;
  confirmed: Record<string, SectionConfirmation>;
  /** The latest suggestions shown per section (kept so a reload doesn't call the model again). */
  offered?: Record<string, SuggestionsResponse>;
}
export const emptySuggestionState = (): SuggestionState => ({ used: {}, confirmed: {} });

export type FieldOrigin = 'AUTHOR' | 'SUGGESTION_AS_IS' | 'SUGGESTION_EDITED';
export const FIELD_ORIGIN_LABELS: Record<FieldOrigin, string> = {
  AUTHOR: 'Written by you',
  SUGGESTION_AS_IS: 'Suggested · used as it is',
  SUGGESTION_EDITED: 'Suggested · edited by you',
};

/** Where a saved field's text came from; null when the field is empty. */
export function fieldOrigin(state: SuggestionState | null | undefined, path: string, value: unknown): FieldOrigin | null {
  if (isBlankValue(value)) return null;
  const u = state?.used[path];
  if (!u) return 'AUTHOR';
  return hashValue(value) === u.hash ? 'SUGGESTION_AS_IS' : 'SUGGESTION_EDITED';
}

export interface ProvenanceSummary {
  sections: { key: string; title: string; confirmed: boolean; fields: { key: string; label: string; origin: FieldOrigin }[] }[];
  counts: Record<FieldOrigin, number>;
  confirmedCount: number;
  toConfirm: number;
}

/**
 * The author's and reviewer's view: per field origin, per section confirmation (current only), and the counts. The
 * task's case selector (`selectorSource`, set by the slot) is nobody's writing and is not counted.
 */
export function provenanceSummary(profile: TemplateProfile, output: unknown, state: SuggestionState | null | undefined, selectorSource?: string | null): ProvenanceSummary {
  const counts: Record<FieldOrigin, number> = { AUTHOR: 0, SUGGESTION_AS_IS: 0, SUGGESTION_EDITED: 0 };
  const keys = sectionsToConfirm(profile);
  const sections = profile.sections
    .filter((s) => keys.includes(s.key))
    .map((s) => {
      const fields = s.fields.flatMap((f) => {
        if (selectorSource === `${s.key}.${f.key}` || f.type === 'graph_binding') return [];
        const origin = fieldOrigin(state, `${s.key}.${f.key}`, getFieldValue(profile, output, s.key as SectionKey, f));
        if (!origin) return [];
        counts[origin]++;
        return [{ key: f.key, label: f.label, origin }];
      });
      return { key: s.key, title: s.title, confirmed: isConfirmed(profile, output, state, s.key), fields };
    });
  return { sections, counts, confirmedCount: sections.filter((s) => s.confirmed).length, toConfirm: sections.length };
}

export function isConfirmed(profile: TemplateProfile, output: unknown, state: SuggestionState | null | undefined, section: string): boolean {
  const c = state?.confirmed[section];
  return !!c && c.digest === sectionDigest(profile, output, section);
}

/** Sections whose confirmation is missing or stale (the Submit check). */
export function unconfirmedSections(profile: TemplateProfile, output: unknown, state: SuggestionState | null | undefined): string[] {
  return sectionsToConfirm(profile).filter((k) => !isConfirmed(profile, output, state, k));
}

// ───────────────────────── API shapes ─────────────────────────

export interface FieldSuggestion {
  /** The section field's key. */
  key: string;
  /** Typed for the field: a string, a number, a list of option values, or a list of item records. */
  value: unknown;
  /** hashValue(value): what "use" records. */
  hash: string;
}
export interface SuggestionsResponse {
  section: string;
  items: FieldSuggestion[];
  model: string;
  generatedAt: string;
}
export interface SuggestionStateView {
  state: SuggestionState;
}

const SectionId = z.string().regex(/^S[1-8]$/);
export const SuggestRequest = z.object({ section: SectionId, keys: z.array(z.string().min(1).max(80)).max(40).optional(), again: z.boolean().optional() }).strict();
export type SuggestRequest = z.infer<typeof SuggestRequest>;
export const UseSuggestionsRequest = z.object({ section: SectionId, items: z.array(z.object({ key: z.string().min(1).max(80), hash: z.string().regex(/^[0-9a-f]{16}$/) }).strict()).min(1).max(40) }).strict();
export type UseSuggestionsRequest = z.infer<typeof UseSuggestionsRequest>;
export const ClearSuggestionRequest = z.object({ section: SectionId, key: z.string().min(1).max(80) }).strict();
export type ClearSuggestionRequest = z.infer<typeof ClearSuggestionRequest>;
export const ConfirmSectionRequest = z.object({ section: SectionId, confirmed: z.boolean(), digest: z.string().regex(/^[0-9a-f]{16}$/) }).strict();
export type ConfirmSectionRequest = z.infer<typeof ConfirmSectionRequest>;

/** The S8 authorship declaration with suggested text on (owner decision 1, 15 Nov 2026). */
export const AUTHORSHIP_DECLARATION = 'This task is my work. I wrote it, or I read, changed where needed and accepted every suggested text in it. It describes how this work is really done. I didn’t paste answers from outside tools.';
