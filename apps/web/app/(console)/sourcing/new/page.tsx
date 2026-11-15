import type { SourcingProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess } from '@/components/no-access';
import { NewPersonForm } from '@/components/sourcing/new-person-form';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'New profile · Sourcing' };

export default async function NewSourcedPersonPage({ searchParams }: { searchParams: Promise<{ role?: string; project?: string }> }) {
  const sp = await searchParams;
  const role = sp.role === 'REVIEWER' ? 'REVIEWER' : 'SME';
  const { status, data } = await apiGet<{ items: SourcingProjectDto[] }>('/sourcing/projects');
  if (status === 403) return <NoAccess need="PMs and Admins" />;
  return (
    <div>
      <Link href={role === 'REVIEWER' ? '/sourcing?tab=REVIEWER' : '/sourcing'} className="text-sm text-link hover:underline">
        ← Sourcing
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New {role === 'REVIEWER' ? 'Reviewer' : 'SME'} profile</h1>
      <p className="mt-1 mb-5 text-sm text-fg-muted">From a recruitment agency. Required: project, first name, last name and email.</p>
      <NewPersonForm projects={data?.items ?? []} role={role} initialProjectId={sp.project ?? ''} />
    </div>
  );
}
