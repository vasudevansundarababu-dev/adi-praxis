import type { DemographicAttributeDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { NewAttributeForm } from '@/components/taxonomy/new-attribute-form';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';
import { AttributeTable } from './attribute-table';

export const metadata: Metadata = { title: 'Demographic taxonomy' };

/** Search and the pager (`?page=`) run in the browser over every attribute fetched here (UI standard 3a). */
export default async function TaxonomyPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) return <NoAccess need="Admins" />;
  const { data } = await apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes');
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Demographic taxonomy</h1>
      <p className="mt-1 text-sm text-fg-muted">The filters PMs can set on a project in step 4 of the wizard.</p>
      <AttributeTable items={data?.items ?? []} />
      <NewAttributeForm />
    </div>
  );
}
