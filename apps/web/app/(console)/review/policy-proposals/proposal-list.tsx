'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { ProposalReview, type ProposalRow } from '@/components/policy/proposal-review';

/**
 * The policy proposal cards (UI standard 3a): searched by title, project, proposer, issuer or file, 10 a page (`?page=`).
 * Each card holds an unsaved decision form, so cards off the page or outside the search are hidden, never unmounted.
 */
export function ProposalList({ items }: { items: ProposalRow[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((p) => matchesQuery([p.title, p.projectName, p.proposer, p.issuer, p.fileName, p.jurisdiction], q)), [items, q]);
  const paged = usePagedRows(shown, { resetKey: q });
  const visible = new Set(paged.items.map((p) => p.id));
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Search policy proposals</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policy proposals" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      {shown.length === 0 && (
        <p className="mt-4 text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      )}
      <div className="mt-4 space-y-4">
        {items.map((p) => (
          <div key={p.id} hidden={!visible.has(p.id)}>
            <ProposalReview p={p} />
          </div>
        ))}
      </div>
      {shown.length > 0 && <ClientPager paged={paged} noun="proposals" singular="proposal" />}
    </>
  );
}
