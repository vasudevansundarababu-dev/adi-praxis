'use client';

import { itemFieldsOf, publicText, type ItemField } from '@praxis/shared';
import { useEffect, useState, type ReactNode } from 'react';
import type { LibraryDocumentView, LibraryRuleView, LibraryView } from './policy-picker';

/**
 * S4 "Applicable rules" on forms that cite RULES (the shared `policy_citation` field, e.g. Marketing; D21, 16 Nov
 * 2026). The author picks published rules from the project's library; the rule ID (its key), the exact rule version,
 * the source locator and the quotation are filled from the library and read-only. The author writes only the
 * free-text notes and the optional output check. KYC-style document references (a `sha256` item key) keep the
 * document picker (`PolicyPicker`). Since KYC Judgment v1 (A5) the item also stores the version's `contentSha256`.
 */

/** The item fields the library fills (read-only in the form). */
export const CITATION_LOCKED = ['ruleId', 'ruleVersion', 'locator', 'quote'] as const;

const prim = (v: unknown) => typeof v === 'string' || typeof v === 'number';

/** Readable source locator: the document title plus the rule's page / section / clause, when the library has them. */
export function locatorText(locator: unknown, documentTitle: string): string {
  let where = '';
  if (prim(locator)) where = String(locator);
  else if (locator && typeof locator === 'object' && !Array.isArray(locator))
    where = Object.entries(locator as Record<string, unknown>)
      .filter(([, v]) => prim(v) && String(v).trim() !== '')
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(' · ');
  return where ? `${documentTitle} · ${where}` : documentTitle;
}

/** The citation item for one published rule (the author's notes start empty). */
export function citationFromRule(field: ItemField, doc: LibraryDocumentView, rule: LibraryRuleView): Record<string, unknown> {
  const it: Record<string, unknown> = {};
  for (const f of itemFieldsOf(field)) it[f.key] = f.type === 'flag' ? false : '';
  it.ruleId = rule.ruleKey;
  it.ruleVersion = rule.ruleVersionId;
  it.locator = locatorText(rule.locator, doc.title);
  it.quote = (rule.quote ?? '').trim() || rule.requirement;
  // KYC Judgment v1 A5: the exact version's content hash, so the export can send the clause (never typed or shown).
  if (rule.contentHash) it.contentSha256 = rule.contentHash;
  return it;
}

/** The published rule a stored citation points at (by its exact version), or null when it is not in the library. */
export function ruleOf(lib: LibraryView | null, it: Record<string, unknown>): { doc: LibraryDocumentView; rule: LibraryRuleView } | null {
  for (const doc of lib?.documents ?? []) for (const rule of doc.rules) if (rule.ruleVersionId === it.ruleVersion) return { doc, rule };
  return null;
}

const btn = 'rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50';

export function RuleCitationPicker({
  taskId,
  field,
  value,
  onChange,
  readOnly,
  initialLibrary = null,
  renderNote,
}: {
  taskId: string;
  field: ItemField;
  value: unknown;
  onChange: (v: Record<string, unknown>[]) => void;
  readOnly: boolean;
  initialLibrary?: LibraryView | null;
  /** Renders one editable item field (the form's own control, with its problems). */
  renderNote: (sub: ItemField, item: Record<string, unknown>, index: number, set: (v: unknown) => void) => ReactNode;
}) {
  const [lib, setLib] = useState<LibraryView | null>(initialLibrary);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const subs = itemFieldsOf(field);
  const locked = subs.filter((f) => (CITATION_LOCKED as readonly string[]).includes(f.key));
  const notes = subs.filter((f) => !(CITATION_LOCKED as readonly string[]).includes(f.key));
  useEffect(() => {
    if (initialLibrary) return;
    void fetch(`/api/v1/me/tasks/${taskId}/policy-library`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLib(d as LibraryView));
  }, [taskId, initialLibrary]);
  const ruleCount = lib?.documents.reduce((n, d) => n + d.rules.length, 0) ?? 0;
  const isAdded = (r: LibraryRuleView) => items.some((it) => it.ruleVersion === r.ruleVersionId);
  const add = () => {
    const fresh: Record<string, unknown>[] = [];
    for (const d of lib!.documents) for (const r of d.rules) if (picked.includes(r.ruleVersionId) && !isAdded(r)) fresh.push(citationFromRule(field, d, r));
    onChange([...items, ...fresh]);
    setPicked([]);
    setOpen(false);
  };
  const match = (r: LibraryRuleView) => {
    const s = q.trim().toLowerCase();
    return !s || `${r.ruleKey} ${r.title} ${r.requirement}`.toLowerCase().includes(s);
  };

  return (
    <fieldset className="min-w-0 rounded-md border border-line p-3" data-rule-picker>
      <legend className="px-1 text-sm font-medium">{publicText(field.label)}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-xs text-fg-muted">Pick the rules this task applies from the project’s published library. Rule ID, exact version, source locator and quotation are filled in for you and can’t be typed.</p>
        {!readOnly && ruleCount > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Add rule
          </button>
        )}
      </div>
      {lib && ruleCount === 0 && (
        <div className="mt-3 rounded-md border border-dashed border-line p-6 text-center" data-rule-empty>
          <p className="font-semibold">This project has no published rules yet.</p>
          <p className="mt-1 text-sm text-fg-muted">Ask your project admin to publish the project’s rules. You can’t type a rule here.</p>
        </div>
      )}
      {items.length > 0 && <p className="mt-2 text-xs text-fg-muted">{items.length} {items.length === 1 ? 'rule' : 'rules'} picked</p>}
      <ol className="mt-2 space-y-2">
        {items.map((it, i) => {
          const hit = ruleOf(lib, it);
          const set = (k: string) => (v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <li key={i} className="min-w-0 rounded-md border border-line p-3 text-sm" data-rule-item>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-mono text-xs">{String(it.ruleId ?? '')}</strong>
                <span className="min-w-0 break-words">{hit ? hit.rule.title : 'Not in the project’s library'}</span>
                {hit ? <span className="rounded-full bg-success/15 px-2 text-xs text-success">Published</span> : <span className="rounded-full bg-warning/15 px-2 text-xs text-warning">Pick it again from the library</span>}
                {!readOnly && (
                  <button type="button" className={`${btn} ml-auto`} aria-label={`Remove rule ${String(it.ruleId ?? i + 1)}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-[11rem_1fr]">
                {locked.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-fg-muted">{f.label} 🔒</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words">{f.key === 'ruleVersion' && hit ? `${String(it[f.key] ?? '')} (rule set v${lib?.setVersion ?? '?'})` : String(it[f.key] ?? '')}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1 text-xs text-fg-muted">From the project library.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {notes.map((f) => (
                  <div key={f.key} className={f.type === 'long_text' ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                    {renderNote(f, it, i, set(f.key))}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      {open && lib && (
        <div role="dialog" aria-modal="true" aria-labelledby="rule-h" className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl border border-line bg-surface p-5 text-sm">
            <h2 id="rule-h" className="text-lg font-semibold">
              Add rules from the project library
            </h2>
            <p className="text-xs text-fg-muted">Published rules only, at their exact published version.</p>
            <input className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1.5" placeholder="Search by rule ID or text" aria-label="Search rules" value={q} onChange={(e) => setQ(e.target.value)} />
            {lib.documents.map((d) => {
              const rules = d.rules.filter(match);
              if (!rules.length) return null;
              return (
                <section key={d.documentVersionId} className="mt-3">
                  <h3 className="font-semibold">
                    {d.title} {d.jurisdiction && <span className="rounded-full bg-line px-2 text-xs font-normal">{d.jurisdiction}</span>}
                  </h3>
                  <ul className="mt-1 divide-y divide-line">
                    {rules.map((r) => {
                      const added = isAdded(r);
                      return (
                        <li key={r.ruleVersionId} className="flex gap-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Pick ${r.ruleKey} ${r.title}`}
                            disabled={added}
                            checked={added || picked.includes(r.ruleVersionId)}
                            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.ruleVersionId] : p.filter((x) => x !== r.ruleVersionId)))}
                          />
                          <div className="min-w-0">
                            <span className="font-mono text-xs">{r.ruleKey}</span> <strong>{r.title}</strong> {r.marking && <span className="rounded-full bg-line px-2 text-xs">{r.marking}</span>} {added && <span className="rounded-full bg-success/15 px-2 text-xs text-success">Added</span>}
                            <p className="break-words text-xs text-fg-muted">{r.requirement}</p>
                            {r.appliesWhen && <p className="text-xs text-fg-muted">Applies when: {r.appliesWhen}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            <p className="mt-2 text-xs text-fg-muted">Missing a rule? Use “Propose a policy document” on this task. A project admin adds it to the library.</p>
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
