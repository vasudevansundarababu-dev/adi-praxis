import type { PublicOpportunityDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { api } from '@/lib/api';
import { OpportunityList } from './opportunity-list';

export const metadata: Metadata = { title: { absolute: pageTitle('Opportunities') } };

export default async function OpportunitiesPage() {
  const { data } = await api<{ items: PublicOpportunityDto[] }>('/opportunities');
  const items = data?.items ?? [];
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">ADI Forge for subject-matter experts</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Opportunities</h1>
        <p className="muted mt-2 max-w-xl">Write realistic, fully synthetic tasks from real-world workflows. Pick an area you know well.</p>
      </section>
      {items.length === 0 ? <p className="card p-6 text-fg-muted">There are no open opportunities right now.</p> : <OpportunityList items={items} />}
    </main>
  );
}
