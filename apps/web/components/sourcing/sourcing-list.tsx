'use client';

import type { SourcedPersonDto, SourcedRole } from '@praxis/shared';
import Link from 'next/link';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useState } from 'react';
import { ClientPager } from '@/components/pager';

const TH = 'px-3 py-2 font-medium';
const TD = 'px-3 py-2 align-top';

export const ROLE_LABEL: Record<SourcedRole, string> = { SME: 'SME', REVIEWER: 'Reviewer' };

/**
 * Sourcing list (owner, 15 Nov): a search term matches name, email, role, skills or project across SMEs and Reviewers;
 * with no term the chosen tab's people show.
 */
export function filterSourced(items: SourcedPersonDto[], tab: SourcedRole, q: string): SourcedPersonDto[] {
  const term = q.trim().toLowerCase();
  if (!term) return items.filter((p) => p.role === tab);
  return items.filter((p) =>
    [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.email, p.role, ROLE_LABEL[p.role], p.projectName, ...p.projectSkills].some((v) => v.toLowerCase().includes(term)),
  );
}

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function SourcingList({ items, initialTab = 'SME', initialQuery = '' }: { items: SourcedPersonDto[]; initialTab?: SourcedRole; initialQuery?: string }) {
  const [tab, setTab] = useState<SourcedRole>(initialTab);
  const [q, setQ] = useState(initialQuery);
  const rows = filterSourced(items, tab, q);
  // D24: 10 people a page, the page in the URL; a new search or tab goes back to page 1.
  const paged = usePagedRows(rows, { resetKey: `${tab}|${q.trim()}` });
  const searching = q.trim().length > 0;
  const kind = ROLE_LABEL[tab];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="People" className="inline-flex overflow-hidden rounded-xl border border-line bg-surface">
          {(['SME', 'REVIEWER'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={!searching && tab === r}
              onClick={() => {
                setTab(r);
                setQ('');
              }}
              className={`px-4 py-1.5 text-sm ${!searching && tab === r ? 'bg-brand-navy font-semibold text-white' : 'text-fg-muted hover:text-fg'}`}
            >
              {r === 'SME' ? 'SMEs' : 'Reviewers'}
            </button>
          ))}
        </div>
        <div role="search" className="ml-auto">
          <label htmlFor="sourcing-q" className="sr-only">
            Search name, email, role, skill or project
          </label>
          <input
            id="sourcing-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, role or skill"
            className="w-72 rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
          />
        </div>
        <Link href={tab === 'REVIEWER' ? '/sourcing/new?role=REVIEWER' : '/sourcing/new'} className="btn btn-primary">
          New
        </Link>
      </div>
      {tab === 'REVIEWER' && !searching && <p className="mt-3 text-xs text-fg-muted">Reviewers can be added only to projects whose review route has a Reviewer step.</p>}
      {searching && (
        <p className="mt-3 text-xs text-fg-muted" aria-live="polite">
          {rows.length} {rows.length === 1 ? 'result' : 'results'} across SMEs and Reviewers
        </p>
      )}
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-fg-muted">
            <tr>
              <th className={TH}>First name</th>
              <th className={TH}>Last name</th>
              <th className={TH}>Email</th>
              <th className={TH}>Role</th>
              <th className={TH}>Project</th>
              <th className={TH}>Skills (from the project)</th>
              <th className={TH}>Submitted by</th>
              <th className={TH}>Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {paged.items.map((p) => (
              <tr key={p.id} data-person={p.id}>
                <td className={TD}>{p.firstName}</td>
                <td className={TD}>{p.lastName}</td>
                <td className={TD}>{p.email}</td>
                <td className={TD}>
                  <span className={`pill ${p.role === 'REVIEWER' ? 'pill-brand' : 'pill-info'}`}>{ROLE_LABEL[p.role]}</span>
                </td>
                <td className={TD}>{p.projectName}</td>
                <td className={TD}>{p.projectSkills.join(', ') || '—'}</td>
                <td className={TD}>{p.submittedBy || '—'}</td>
                <td className={`${TD} whitespace-nowrap font-mono text-xs tabular-nums`}>{fmtDay(p.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-fg-muted">
                  {searching ? 'No one matches this search.' : `No ${kind} profiles yet. Use New to upload one from a recruitment agency.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <ClientPager paged={paged} noun="people" singular="person" />}
      <p className="mt-3 text-xs text-fg-muted">
        Each upload creates a profile in the {kind} table. The email is the person&apos;s Google sign-in to the candidate app, for SMEs and Reviewers alike. A duplicate email
        on the same project is flagged, not added.
      </p>
    </div>
  );
}
