'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { Req, RequiredNote } from '@/components/required';
import { mutate } from '@/lib/client-api';

type Item = { id: string; candidateName: string | null; enrollmentId: string | null; details: string | null; declaredAt: string };

export function ConflictList({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string | null>(null);
  // UI standard 3a: searched and paged 10 a page; the open decision form's text is kept in this list's state.
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((i) => matchesQuery([i.candidateName ?? 'Unnamed candidate', i.details], q)), [items, q]);
  const paged = usePagedRows(shown, { param: 'conflictsPage', resetKey: q });

  async function resolve(id: string) {
    const res = await mutate('POST', `/review/conflicts/${id}/resolve`, { resolution });
    if (!res.ok) return setError(res.error);
    setItems(items.filter((i) => i.id !== id));
    setOpen(null);
    setResolution('');
  }

  if (items.length === 0) return <p className="mt-6 text-fg-muted">No unresolved conflicts.</p>;
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Search conflicts</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conflicts" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      {shown.length === 0 && (
        <p className="mt-3 text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      )}
    <ul className="mt-3 space-y-3">
      {paged.items.map((i) => (
        <li key={i.id} className="rounded-md border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{i.candidateName ?? 'Unnamed candidate'}</span>
            <span className="text-fg-muted">{new Date(i.declaredAt).toLocaleString()}</span>
            <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id} className="ml-auto text-link">
              Resolve
            </button>
          </div>
          <p className="mt-1">{i.details}</p>
          {open === i.id && (
            <div className="mt-3 space-y-2">
              <RequiredNote />
              <label className="block">
                How it was resolved<Req />
                <textarea aria-required="true" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
              </label>
              <button type="button" disabled={!resolution.trim()} onClick={() => resolve(i.id)} className="btn btn-primary disabled:opacity-50">
                Mark resolved
              </button>
            </div>
          )}
        </li>
      ))}
      {error && <p role="alert" className="text-error">{error}</p>}
    </ul>
    {shown.length > 0 && <ClientPager paged={paged} noun="conflicts" singular="conflict" />}
    </>
  );
}
