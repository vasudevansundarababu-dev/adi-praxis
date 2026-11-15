import type { SourcingProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NoAccess } from '@/components/no-access';
import { ImportSheet } from '@/components/sourcing/import-sheet';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Upload assessment sheet · Sourcing' };

export default async function ImportSheetPage({ searchParams }: { searchParams: Promise<{ role?: string; project?: string }> }) {
  const sp = await searchParams;
  const role = sp.role === 'REVIEWER' ? 'REVIEWER' : 'SME';
  const { status, data } = await apiGet<{ items: SourcingProjectDto[] }>('/sourcing/projects');
  if (status === 403) return <NoAccess need="PMs and Admins" />;
  return (
    <div>
      <Link href={`/sourcing/new${role === 'REVIEWER' ? '?role=REVIEWER' : ''}`} className="text-sm text-link hover:underline">
        ← New {role === 'REVIEWER' ? 'Reviewer' : 'SME'} profile
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Upload the recruiter&apos;s assessment sheet</h1>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-fg-muted">Several candidates at once: check the sheet first, then import the valid rows.</p>
      <ImportSheet projects={data?.items ?? []} role={role} initialProjectId={sp.project ?? ''} />
    </div>
  );
}
