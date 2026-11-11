'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

export type SearchType = 'projects' | 'templates' | 'candidates' | 'requisitions' | 'users' | 'partners';

interface Hit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
  match: 'letters' | 'meaning' | 'both';
}
interface Result {
  items: Hit[];
  ids: string[];
  semantic: 'used' | 'short_query' | 'unavailable';
}

export const MATCH_LABELS: Record<Hit['match'], string> = { letters: 'name match', meaning: 'similar meaning', both: 'name and meaning' };

/** Shows only the rows whose data-search-id is in `ids` (all rows when ids is null). Returns how many stay visible. */
export function filterRows(root: ParentNode, scope: string, ids: string[] | null): number {
  const keep = ids ? new Set(ids) : null;
  let shown = 0;
  root.querySelectorAll<HTMLElement>(`[data-search-scope="${scope}"] [data-search-id]`).forEach((row) => {
    const visible = !keep || keep.has(row.dataset.searchId ?? '');
    row.hidden = !visible;
    if (visible) shown++;
  });
  return shown;
}

/**
 * Search bar above a console table (owner, 12 Nov 2026). Matches as you type: a few letters find a record by name
 * (typo-tolerant); longer queries also match by meaning. The table filters to the matches, and the best matches are
 * offered as links. Wrap the table in an element with data-search-scope={scope} and give each row data-search-id.
 */
export function TableSearch({ type, scope = type, label, placeholder }: { type: SearchType; scope?: string; label: string; placeholder?: string }) {
  const listId = useId();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResult(null);
      setError(null);
      filterRows(document, scope, null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search/${type}?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        if (n !== seq.current) return;
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Result;
        setResult(data);
        setError(null);
        setActive(-1);
        filterRows(document, scope, data.ids);
      } catch {
        if (n === seq.current) setError('Search is not available right now.');
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, type, scope]);

  const items = result?.items ?? [];
  return (
    <div className="relative mb-3 max-w-xl" role="search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={open && items.length > 0 ? `${listId}-list` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          autoComplete="off"
          value={q}
          placeholder={placeholder ?? label}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(-1, i - 1));
            } else if (e.key === 'Enter' && active >= 0 && items[active]) {
              e.preventDefault();
              window.location.assign(items[active]!.href);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2"
        />
      </div>
      <p role="status" aria-live="polite" className="mt-1 text-xs text-fg-muted">
        {error ??
          (result
            ? `${result.ids.length} ${result.ids.length === 1 ? 'match' : 'matches'}${result.semantic === 'used' ? ' (by name and meaning)' : result.semantic === 'short_query' ? ' (by name; type 4+ characters to also match by meaning)' : ' (by name)'}`
            : '')}
      </p>
      {open && items.length > 0 && (
        <ul id={`${listId}-list`} role="listbox" aria-label={`${label} suggestions`} className="absolute z-20 mt-1 w-full rounded-md border border-line bg-surface shadow-lg">
          {items.map((h, i) => (
            <li key={h.id} id={`${listId}-opt-${i}`} role="option" aria-selected={i === active}>
              <Link href={h.href} className={`block px-3 py-2 text-sm hover:bg-surface-muted ${i === active ? 'bg-surface-muted' : ''}`}>
                <span className="font-medium">{h.title}</span>
                <span className="block text-xs text-fg-muted">
                  {h.subtitle} · {MATCH_LABELS[h.match]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
