import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TermsEditor, type TermsItem } from '@/components/terms/terms-editor';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Contributor terms' };

export default async function TermsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) notFound();
  const { data } = await apiGet<{ items: TermsItem[] }>('/terms');
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Contributor terms</h1>
      <p className="mt-1 text-sm text-fg-muted">
        The documents experts accept during onboarding. Publishing creates a new version; experts must accept it before their next assignment. Placeholder text blocks onboarding in production.
      </p>
      <TermsEditor items={data?.items ?? []} />
    </div>
  );
}
