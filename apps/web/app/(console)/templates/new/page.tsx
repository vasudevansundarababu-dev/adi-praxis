import type { DomainDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NewTemplateForm } from '@/components/templates/new-template-form';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'New template' };

export default async function NewTemplatePage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) notFound();
  const { data } = await apiGet<{ items: DomainDto[] }>('/domains');
  const domains = (data?.items ?? []).filter((d) => d.status === 'ACTIVE');
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">New template</h1>
      <p className="mt-1 text-sm text-fg-muted">Creates a draft. You can fill in the rest and publish it on the next page.</p>
      {domains.length === 0 ? (
        <p className="mt-6">Add a domain on the Templates page first.</p>
      ) : (
        <NewTemplateForm domains={domains} />
      )}
    </div>
  );
}
