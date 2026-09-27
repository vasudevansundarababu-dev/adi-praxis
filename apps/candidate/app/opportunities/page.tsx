import type { PublicOpportunityDto } from '@praxis/shared';
import { CONTRIBUTION_ROLE_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { api } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Opportunities') } };

export default async function OpportunitiesPage() {
  const { data } = await api<{ items: PublicOpportunityDto[] }>('/opportunities');
  const items = data?.items ?? [];
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">ADI Praxis for subject-matter experts</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Opportunities</h1>
        <p className="muted mt-2 max-w-xl">Write realistic, fully synthetic tasks from real-world workflows. Pick an area you know well.</p>
      </section>
      {items.length === 0 ? (
        <p className="card p-6 text-fg-muted">There are no open opportunities right now.</p>
      ) : (
        <ul className="grid gap-4">
          {items.map((o) => (
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
    </main>
  );
}
