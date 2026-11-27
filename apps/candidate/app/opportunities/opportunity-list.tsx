'use client';

import { CONTRIBUTION_ROLE_LABELS, matchesQuery, type PublicOpportunityDto } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';

/** The open opportunity cards (UI standard 3a): searched by title, domain, specialty or summary, 10 a page (`?page=`). */
export function OpportunityList({ items }: { items: PublicOpportunityDto[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((o) => matchesQuery([o.brief.title, o.brief.domain, o.brief.specialty, o.brief.summary], q)), [items, q]);
  const paged = usePagedRows(shown, { resetKey: q });
  return (
    <section aria-label="Open opportunities" className="space-y-4">
      <label className="block text-sm">
        <span className="sr-only">Search opportunities</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search opportunities" className="rounded-md border border-line bg-surface px-2 py-1" />
      </label>
      {shown.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      ) : (
        <ul className="grid gap-4">
          {paged.items.map((o) => (
            <li key={o.id}>
              <Link href={`/opportunities/${o.id}`} className="card card-link block p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{o.brief.title}</h2>
                  <span className="pill pill-success">Open</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="pill pill-info">{o.brief.domain}</span>
                  {o.brief.specialty && <span className="pill pill-brand">{o.brief.specialty}</span>}
                  {o.brief.contributionRoles.map((r) => (
                    <span key={r} className="pill">{CONTRIBUTION_ROLE_LABELS[r]}</span>
                  ))}
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-fg-muted">{o.brief.summary}</p>
                <p className="mt-3 text-sm font-semibold text-link">View details →</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <ClientPager paged={paged} noun="opportunities" singular="opportunity" />}
    </section>
  );
}
