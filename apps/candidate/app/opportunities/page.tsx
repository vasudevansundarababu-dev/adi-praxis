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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Opportunities</h1>
      {items.length === 0 ? (
        <p className="mt-6 text-fg-muted">There are no open opportunities right now.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((o) => (
            <li key={o.id} className="rounded-lg border border-line bg-surface p-4">
              <Link href={`/opportunities/${o.id}`} className="text-lg font-semibold text-link hover:underline">
                {o.brief.title}
              </Link>
              <p className="mt-1 text-sm text-fg-muted">
                {o.brief.domain} · {o.brief.specialty} · {o.brief.contributionRoles.map((r) => CONTRIBUTION_ROLE_LABELS[r]).join(', ')}
              </p>
              <p className="mt-2 line-clamp-3 text-sm">{o.brief.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
