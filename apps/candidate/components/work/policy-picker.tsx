'use client';

import type { ItemField } from '@praxis/shared';
import { useEffect, useState } from 'react';

/**
 * S4 policy references (D6, owner 15 Nov 2026: the SME cannot type a reference). The author picks published documents
 * from the project's library; Policy ID, Version, Publication reference and SHA-256 are filled from the library and
 * read-only. The author writes only the free-text notes (Applicability, Rationale, Exceptions). The stored and exported
 * item shape is unchanged. Matches the Policies page design (PR #81): marking labels and chip colours.
 */

export interface LibraryRuleView {
  ruleKey: string;
  ruleVersionId: string;
  title: string;
  requirement: string;
  marking: string | null;
  appliesWhen: string | null;
}
export interface LibraryDocumentView {
  documentVersionId: string;
  title: string;
  jurisdiction: string | null;
  category: string | null;
  effectiveFrom: string | null;
  policyId: string;
  version: string;
  publicationRef: string;
  sha256: string;
  rules: LibraryRuleView[];
}
export interface LibraryView {
  setVersion: number | null;
  documents: LibraryDocumentView[];
}

const MARKINGS: Record<string, string> = {
  Mandatory: 'bg-accent/20 text-accent',
  'Mandatory when applicable': 'bg-link/15 text-link',
  'Permitted option': 'bg-link/15 text-link',
  'Needs clarification': 'bg-warning/15 text-warning',
  'Required reference': 'bg-line text-fg-muted',
  'Other responsibility/scope': 'bg-line text-fg-muted',
};
const btn = 'rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50';

/** Which item field holds which identity (read from the template's item fields, not hard-coded per template). */
export function identityKeys(field: ItemField) {
  const items = field.itemFields ?? [];
  const find = (re: RegExp, not?: RegExp) => items.find((f) => re.test(f.key) && !(not && not.test(f.key)))?.key ?? null;
  const sha = find(/sha256/i);
  const version = find(/version/i);
  const locator = find(/locator|publication|reference/i);
  const id = items.find((f) => /id$/i.test(f.key) && f.key !== sha && f.key !== version)?.key ?? null;
  const notes = items.filter((f) => ![sha, version, locator, id].includes(f.key));
  return { id, version, locator, sha, notes };
}

export function PolicyPicker({ taskId, field, value, onChange, readOnly, initialLibrary = null }: { taskId: string; field: ItemField; value: unknown; onChange: (v: Record<string, unknown>[]) => void; readOnly: boolean; initialLibrary?: LibraryView | null }) {
  const [lib, setLib] = useState<LibraryView | null>(initialLibrary);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const keys = identityKeys(field);
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  useEffect(() => {
    if (initialLibrary) return;
    void fetch(`/api/v1/me/tasks/${taskId}/policy-library`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLib(d as LibraryView));
  }, [taskId, initialLibrary]);
  const docOf = (it: Record<string, unknown>) => lib?.documents.find((d) => (keys.sha && it[keys.sha] === d.sha256) || (keys.id && it[keys.id] === d.policyId));
  const isAdded = (d: LibraryDocumentView) => items.some((it) => docOf(it)?.documentVersionId === d.documentVersionId);
  const add = () => {
    const docs = lib!.documents.filter((d) => picked.includes(d.documentVersionId));
    const fresh = docs.map((d) => {
      const it: Record<string, unknown> = {};
      for (const f of field.itemFields ?? []) it[f.key] = '';
      if (keys.id) it[keys.id] = d.policyId;
      if (keys.version) it[keys.version] = d.version;
      if (keys.locator) it[keys.locator] = d.publicationRef;
      if (keys.sha) it[keys.sha] = d.sha256;
      return it;
    });
    onChange([...items, ...fresh]);
    setPicked([]);
    setOpen(false);
  };
  const counts = (d: LibraryDocumentView) => {
    const m = new Map<string, number>();
    for (const r of d.rules) if (r.marking) m.set(r.marking, (m.get(r.marking) ?? 0) + 1);
    return [...m.entries()];
  };

  return (
    <fieldset className="min-w-0 rounded-md border border-line p-3" data-policy-picker>
      <legend className="px-1 text-sm font-medium">{field.label}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-xs text-fg-muted">Pick the policies this task uses from the project’s published library. Identity, version, publication reference and SHA-256 are filled in for you and can’t be typed.</p>
        {!readOnly && !!lib?.documents.length && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Add policy
          </button>
        )}
      </div>
      {lib && !lib.documents.length && (
        <div className="mt-3 rounded-md border border-dashed border-line p-6 text-center" data-policy-empty>
          <p className="font-semibold">This project has no published policies yet.</p>
          <p className="mt-1 text-sm text-fg-muted">Ask your project admin to add policies. You can’t type a policy reference here.</p>
        </div>
      )}
      {items.length > 0 && <p className="mt-2 text-xs text-fg-muted">{items.length} {items.length === 1 ? 'policy' : 'policies'} picked</p>}
      <ol className="mt-2 space-y-2">
        {items.map((it, i) => {
          const d = docOf(it);
          return (
            <li key={i} className="rounded-md border border-line p-3 text-sm" data-policy-item>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-mono text-xs">{String((keys.id && it[keys.id]) ?? '')}</strong>
                <span>{d?.title ?? 'Not in the project’s library'}</span>
                {d ? <span className="rounded-full bg-success/15 px-2 text-xs text-success">Published</span> : <span className="rounded-full bg-warning/15 px-2 text-xs text-warning">Pick it again from the library</span>}
                {!readOnly && (
                  <button type="button" className={`${btn} ml-auto`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-[11rem_1fr]">
                {(['id', 'version', 'locator', 'sha'] as const).map((k) => {
                  const key = keys[k];
                  if (!key) return null;
                  const label = field.itemFields?.find((f) => f.key === key)?.label ?? key;
                  const v = String(it[key] ?? '');
                  return (
                    <div key={k} className="contents">
                      <dt className="text-fg-muted">{label} 🔒</dt>
                      <dd className="break-all font-mono">{k === 'sha' && v.length === 64 ? `${v.slice(0, 16)}…${v.slice(-8)}` : v}</dd>
                    </div>
                  );
                })}
              </dl>
              <p className="mt-1 text-xs text-fg-muted">From the project library. Only reviewers see the notes below; the agent doesn’t.</p>
              {keys.notes.map((f) => (
                <label key={f.key} className="mt-2 block text-sm">
                  {f.label} <span className="text-xs text-fg-muted">(optional)</span>
                  <textarea className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" rows={2} disabled={readOnly} value={String(it[f.key] ?? '')} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)))} />
                </label>
              ))}
            </li>
          );
        })}
      </ol>

      {open && lib && (
        <div role="dialog" aria-modal="true" aria-labelledby="pol-h" className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl border border-line bg-surface p-5 text-sm">
            <h2 id="pol-h" className="text-lg font-semibold">
              Add policy from the project library
            </h2>
            <p className="text-xs text-fg-muted">Published policies only. Each one brings its applied rules with it.</p>
            <input className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1.5" placeholder="Search by name" aria-label="Search policies" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="mt-2 divide-y divide-line">
              {lib.documents
                .filter((d) => !q.trim() || d.title.toLowerCase().includes(q.toLowerCase()))
                .map((d) => {
                  const added = isAdded(d);
                  return (
                    <li key={d.documentVersionId} className="flex gap-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Pick ${d.title}`}
                        disabled={added}
                        checked={added || picked.includes(d.documentVersionId)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.documentVersionId] : p.filter((x) => x !== d.documentVersionId)))}
                      />
                      <div className="min-w-0">
                        <strong>{d.title}</strong> {d.jurisdiction && <span className="rounded-full bg-line px-2 text-xs">{d.jurisdiction}</span>} · version {d.version}
                        {d.effectiveFrom ? ` · effective ${d.effectiveFrom}` : ''} · {d.rules.length} rules applied {added && <span className="rounded-full bg-success/15 px-2 text-xs text-success">Added</span>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {counts(d).map(([m, n]) => (
                            <span key={m} className={`rounded-full px-2 text-xs font-semibold ${MARKINGS[m] ?? 'bg-line text-fg-muted'}`}>
                              {m} {n}
                            </span>
                          ))}
                          <button type="button" className="text-xs text-link underline" onClick={() => setShown((s) => ({ ...s, [d.documentVersionId]: !s[d.documentVersionId] }))}>
                            {shown[d.documentVersionId] ? 'Hide rules' : 'Show rules'}
                          </button>
                        </div>
                        {shown[d.documentVersionId] && (
                          <ul className="mt-1 space-y-1 text-xs">
                            {d.rules.map((r) => (
                              <li key={r.ruleVersionId}>
                                <span className="font-mono">{r.ruleKey}</span> {r.title} {r.marking && <span className={`rounded-full px-2 font-semibold ${MARKINGS[r.marking] ?? 'bg-line'}`}>{r.marking}</span>}
                                {r.appliesWhen && <span className="text-fg-muted"> · Applies when: {r.appliesWhen}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
            <p className="mt-2 text-xs text-fg-muted">Missing a policy? Use “Propose a policy document” on this task. A project admin adds it to the library.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!picked.length} onClick={add}>
                Add selected ({picked.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}
