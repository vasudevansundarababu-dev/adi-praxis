'use client';

import {
  FIELD_ORIGIN_LABELS,
  fieldOrigin,
  isBlankValue,
  isConfirmed,
  provenanceSummary,
  publicText,
  sectionDigest,
  type FieldOrigin,
  type FieldSuggestion,
  type ProvenanceSummary as Summary,
  type SuggestionState,
  type SuggestionsResponse,
  type TemplateProfile,
  type TemplateProfileField,
} from '@praxis/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Suggested text for every field (owner decisions 1-6, 15 Nov 2026; mockup
 * docs/design/mockups/suggested-text-and-rubric-table.html). A suggestion fills an empty field only when the author
 * chooses it. The field's origin is shown; each section ends with the author's confirmation. FIELD_SUGGESTIONS_ENABLED.
 */

const btn = 'rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50';
const aiBtn = 'rounded-md border border-purple-400/60 bg-purple-500/10 px-3 py-1.5 text-sm font-semibold text-purple-200 disabled:opacity-50';
const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold';

export const SUGGESTION_TIMEOUT_MESSAGE = 'The suggestion took too long. Try again.';

/** The message for a failed request; a slow model (API) or a slow answer (proxy) both read as "took too long" (D31). */
export function failureMessage(data: { error?: string; message?: string } | null, suggesting = false): string {
  if (suggesting && (data?.error === 'SUGGESTIONS_TIMEOUT' || data?.error === 'UPSTREAM_TIMEOUT')) return SUGGESTION_TIMEOUT_MESSAGE;
  return data?.message ?? 'Something went wrong. Try again.';
}

async function send<T>(url: string, body: unknown, suggesting = false): Promise<{ ok: boolean; data: T | null; message: string | null }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  return { ok: res.ok, data: res.ok ? data : null, message: res.ok ? null : failureMessage(data, suggesting) };
}

export interface Suggestions {
  state: SuggestionState;
  loading: Record<string, boolean>;
  error: string | null;
  /** Loads the section's suggestions (kept on the server; the model is called only when none are kept). */
  load: (section: string, opts?: { keys?: string[]; again?: boolean }) => Promise<void>;
  offeredFor: (section: string, key: string) => FieldSuggestion | null;
  /** Records that the author took these suggestions (the caller sets the field values). */
  markUsed: (section: string, items: FieldSuggestion[]) => Promise<void>;
  clear: (section: string, key: string) => Promise<void>;
  confirm: (section: string, confirmed: boolean, digest: string) => Promise<boolean>;
}

export function useSuggestions(taskId: string, enabled: boolean, initial: SuggestionState | null = null): Suggestions {
  const [state, setState] = useState<SuggestionState>(initial ?? { used: {}, confirmed: {}, offered: {} });
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/me/tasks/${taskId}/suggestions`;
  const asked = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!enabled || initial) return;
    void fetch(base)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { state: SuggestionState } | null) => d && setState(d.state));
  }, [enabled, initial, base]);
  const load = useCallback(
    async (section: string, opts: { keys?: string[]; again?: boolean } = {}) => {
      if (!enabled) return;
      if (!opts.again && !opts.keys && asked.current[section]) return;
      asked.current[section] = true;
      setLoading((l) => ({ ...l, [section]: true }));
      const r = await send<SuggestionsResponse>(base, { section, ...(opts.keys ? { keys: opts.keys } : {}), ...(opts.again ? { again: true } : {}) }, true);
      setLoading((l) => ({ ...l, [section]: false }));
      if (!r.ok || !r.data) {
        asked.current[section] = false;
        return setError(r.message);
      }
      setError(null);
      setState((s) => ({ ...s, offered: { ...(s.offered ?? {}), [section]: r.data! } }));
    },
    [enabled, base],
  );
  const offeredFor = (section: string, key: string) => state.offered?.[section]?.items.find((i) => i.key === key) ?? null;
  const apply = (r: { ok: boolean; data: { state: SuggestionState } | null; message: string | null }) => {
    if (r.ok && r.data) setState((s) => ({ ...r.data!.state, offered: s.offered }));
    setError(r.message);
    return r.ok;
  };
  return {
    state,
    loading,
    error,
    load,
    offeredFor,
    markUsed: async (section, items) => {
      apply(await send<{ state: SuggestionState }>(`${base}/use`, { section, items: items.map((i) => ({ key: i.key, hash: i.hash })) }));
    },
    clear: async (section, key) => {
      apply(await send<{ state: SuggestionState }>(`${base}/clear`, { section, key }));
    },
    confirm: async (section, confirmed, digest) => apply(await send<{ state: SuggestionState }>(`${base}/confirm`, { section, confirmed, digest })),
  };
}

const ORIGIN_CLASS: Record<FieldOrigin, string> = { AUTHOR: `${pill} bg-link/15 text-link`, SUGGESTION_AS_IS: `${pill} bg-purple-500/15 text-purple-300`, SUGGESTION_EDITED: `${pill} bg-purple-500/15 text-purple-300` };

export function OriginPill({ origin }: { origin: FieldOrigin | null }) {
  if (!origin) return null;
  return (
    <span className={ORIGIN_CLASS[origin]} data-origin={origin}>
      {FIELD_ORIGIN_LABELS[origin]}
    </span>
  );
}

/** How a suggested value reads (pick lists by their labels, rows as a small table). */
function SuggestedValue({ field, value }: { field: TemplateProfileField; value: unknown }) {
  const label = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? String(v);
  if (Array.isArray(value) && value.every((x) => x && typeof x === 'object')) {
    const cols = (field.itemFields ?? []).filter((s) => (value as Record<string, unknown>[]).some((r) => !isBlankValue(r[s.key])));
    return (
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[24rem] text-left text-xs">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="border-b border-line px-2 py-1 font-medium text-fg-muted">
                  {publicText(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(value as Record<string, unknown>[]).map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} className="border-b border-line px-2 py-1 align-top">
                    {Array.isArray(r[c.key]) ? (r[c.key] as unknown[]).map(String).join(', ') : String(r[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(value)) return <p className="mt-1 text-sm">{value.map(label).join(', ')}</p>;
  return <p className="mt-1 whitespace-pre-wrap break-words text-sm">{field.type === 'pick_list' ? label(value) : String(value)}</p>;
}

/**
 * Under each field: the suggestion while the field is empty (Use / Edit, then use / Suggest another / I'll write my own),
 * or the field's origin once filled (with Undo for a suggestion).
 */
export function FieldSuggestionBox(p: {
  field: TemplateProfileField;
  section: string;
  value: unknown;
  s: Suggestions;
  inputId: string;
  readOnly: boolean;
  onUse: (value: unknown) => void;
}) {
  const { field, section, value, s } = p;
  const [hidden, setHidden] = useState(false);
  const path = `${section}.${field.key}`;
  const origin = fieldOrigin(s.state, path, value);
  const offered = s.offeredFor(section, field.key);
  if (p.readOnly) return origin ? <div className="mt-1"><OriginPill origin={origin} /></div> : null;
  if (origin)
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" data-field-origin={path}>
        <OriginPill origin={origin} />
        {origin !== 'AUTHOR' && (
          <button
            type="button"
            className="text-link underline"
            onClick={() => {
              p.onUse(Array.isArray(value) ? [] : field.type === 'number' ? null : '');
              void s.clear(section, field.key);
            }}
          >
            Undo, show the suggestion again
          </button>
        )}
      </div>
    );
  if (s.loading[section] && !offered) return <p className="mt-1 text-xs text-fg-muted" role="status">Getting a suggestion…</p>;
  if (!offered) return null;
  if (hidden)
    return (
      <button type="button" className="mt-1 text-xs text-link underline" onClick={() => setHidden(false)}>
        Show the suggestion
      </button>
    );
  const isText = field.type === 'text' || field.type === 'long_text';
  const use = async (focus: boolean) => {
    p.onUse(offered.value);
    await s.markUsed(section, [offered]);
    if (focus) setTimeout(() => (document.getElementById(p.inputId) as HTMLTextAreaElement | null)?.focus(), 30);
  };
  return (
    <div className="mt-2 rounded-md border border-dashed border-purple-400/60 bg-purple-500/5 p-3" data-suggestion={path}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pill} bg-purple-500/15 text-purple-300`}>Suggested text</span>
        <span className="text-xs text-fg-muted">From the template, this task and the project’s rules · no case data</span>
      </div>
      <SuggestedValue field={field} value={offered.value} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={aiBtn} onClick={() => void use(false)}>
          {Array.isArray(offered.value) && offered.value.every((x) => x && typeof x === 'object') ? `Use these ${(offered.value as unknown[]).length} rows` : 'Use this text'}
        </button>
        {isText && (
          <button type="button" className={btn} onClick={() => void use(true)}>
            Edit, then use
          </button>
        )}
        <button type="button" className={btn} disabled={s.loading[section]} onClick={() => void s.load(section, { keys: [field.key], again: true })}>
          Suggest another
        </button>
        <button type="button" className="text-xs text-link underline" onClick={() => setHidden(true)}>
          I’ll write my own
        </button>
      </div>
    </div>
  );
}

/** "Use all suggestions in this section": fills only the empty fields; the section still needs confirming. */
export function UseAllSuggestions({ section, pending, s, onUseAll }: { section: string; pending: FieldSuggestion[]; s: Suggestions; onUseAll: (items: FieldSuggestion[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-link/40 bg-link/5 p-3 text-sm" data-suggestions-banner>
      <p className="min-w-0 flex-1">
        <strong>Suggestions help you start.</strong> They’re written from this template and the project’s published rules, not from any real customer. Read each one: use it, change it, or write your own. You’ll confirm each section before you submit.
      </p>
      <button
        type="button"
        className={aiBtn}
        disabled={!pending.length}
        onClick={async () => {
          onUseAll(pending);
          await s.markUsed(section, pending);
        }}
      >
        {pending.length ? `Use all ${pending.length} suggestion${pending.length > 1 ? 's' : ''} in ${section}` : `Nothing left to fill in ${section}`}
      </button>
      {s.loading[section] && <span role="status" className="text-xs text-fg-muted">Getting suggestions…</span>}
      {s.error && (
        <p role="alert" className="w-full text-xs text-error">
          {s.error}
        </p>
      )}
    </div>
  );
}

/** The end of each section: the author's confirmation, bound to the section's saved content. */
export function SectionConfirm(p: { profile: TemplateProfile; output: Record<string, unknown>; section: string; s: Suggestions; ready: boolean; flush: () => Promise<boolean>; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const confirmed = isConfirmed(p.profile, p.output, p.s.state, p.section);
  const stale = !confirmed && !!p.s.state.confirmed[p.section];
  const fromSuggestion = (p.profile.sections.find((x) => x.key === p.section)?.fields ?? []).filter((f) => {
    const o = fieldOrigin(p.s.state, `${p.section}.${f.key}`, (p.output.sections as Record<string, Record<string, unknown>> | undefined)?.[p.section]?.[f.key]);
    return o === 'SUGGESTION_AS_IS' || o === 'SUGGESTION_EDITED';
  }).length;
  const at = p.s.state.confirmed[p.section]?.at;
  return (
    <div className={`rounded-md border p-3 text-sm ${confirmed ? 'border-success/60' : 'border-line'}`} data-section-confirm={p.section}>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={p.readOnly || busy || (!confirmed && !p.ready)}
          onChange={async (e) => {
            setBusy(true);
            setMsg(null);
            const want = e.target.checked;
            if (want && !(await p.flush())) {
              setBusy(false);
              return setMsg('Your changes could not be saved yet. Try again.');
            }
            const ok = await p.s.confirm(p.section, want, sectionDigest(p.profile, p.output, p.section));
            setBusy(false);
            if (!ok) setMsg(p.s.error ?? 'Could not save the confirmation. Try again.');
          }}
        />
        <span>
          <strong>I’ve read every field in {p.section}, and it describes how this work is actually done.</strong>
          <span className="block text-xs text-fg-muted">
            {fromSuggestion
              ? `${fromSuggestion} field${fromSuggestion > 1 ? 's' : ''} here came from a suggestion. Ticking this records that you checked ${fromSuggestion > 1 ? 'them' : 'it'} and take ${fromSuggestion > 1 ? 'them' : 'it'} as your own.`
              : 'All fields here are your own words.'}{' '}
            {!confirmed && !p.ready && 'Fill the required fields first.'}
          </span>
          {confirmed && at && <span className="block text-xs text-success">Confirmed by you at {new Date(at).toLocaleTimeString()}. Changing a field in {p.section} clears this.</span>}
          {stale && <span className="block text-xs text-warning">You changed {p.section} after confirming it. Read it again and tick to confirm.</span>}
        </span>
      </label>
      {msg && (
        <p role="alert" className="mt-1 text-xs text-error">
          {msg}
        </p>
      )}
    </div>
  );
}

/** S8 (and the reviewer page): the split of written / used as is / edited, and the sections confirmed. */
export function ProvenanceCounts({ summary, reviewer = false }: { summary: Summary; reviewer?: boolean }) {
  const cells: [FieldOrigin, string][] = [
    ['AUTHOR', reviewer ? 'fields written by the author' : 'fields written by you'],
    ['SUGGESTION_AS_IS', 'suggestions used as they are'],
    ['SUGGESTION_EDITED', reviewer ? 'suggestions the author edited' : 'suggestions you edited'],
  ];
  return (
    <div className="space-y-2" data-provenance>
      <div className="grid gap-2 sm:grid-cols-3">
        {cells.map(([k, l]) => (
          <div key={k} className="rounded-md border border-line p-2">
            <span className="block text-lg font-semibold">{summary.counts[k]}</span>
            <span className="text-xs text-fg-muted">{l}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        {summary.confirmedCount} of {summary.toConfirm} sections confirmed.{reviewer ? '' : ' The reviewer sees this split and which fields came from a suggestion.'}
      </p>
      {reviewer && (
        <ul className="space-y-1 text-sm">
          {summary.sections.map((s) => (
            <li key={s.key}>
              <strong>{s.key}</strong> {s.confirmed ? <span className="text-success">· confirmed</span> : <span className="text-warning">· not confirmed for this version</span>}
              {s.fields.filter((f) => f.origin !== 'AUTHOR').length > 0 && (
                <span className="text-fg-muted">
                  {' '}
                  · from a suggestion: {s.fields.filter((f) => f.origin !== 'AUTHOR').map((f) => `${f.label} (${f.origin === 'SUGGESTION_AS_IS' ? 'as is' : 'edited'})`).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export { provenanceSummary };
