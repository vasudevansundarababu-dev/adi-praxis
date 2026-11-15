import type { SourcedPersonDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { NoAccess } from '@/components/no-access';
import { SourcingList } from '@/components/sourcing/sourcing-list';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Sourcing' };

/** Sourcing (owner, 15 Nov): profiles sent by recruitment agencies, uploaded by a PM or Admin, per project and role. */
export default async function SourcingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === 'REVIEWER' ? 'REVIEWER' : 'SME';
  const { status, data } = await apiGet<{ items: SourcedPersonDto[] }>('/sourcing/people');
  if (status === 403) return <NoAccess need="PMs and Admins" />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sourcing</h1>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-fg-muted">
        Profiles sent by recruitment agencies, uploaded by a PM or Admin. Each profile is for one project and role, and is offered on that project&apos;s Assign screen.
      </p>
      {data ? <SourcingList items={data.items} initialTab={tab} /> : <p className="card p-4 text-sm text-error">Sourcing could not be loaded. Try again.</p>}
    </div>
  );
}
