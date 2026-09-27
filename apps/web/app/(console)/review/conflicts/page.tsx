import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConflictList } from '@/components/review/conflict-list';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Conflicts' };

export default async function ConflictsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN')) notFound();
  const { data } = await apiGet<{ items: { id: string; candidateName: string | null; enrollmentId: string | null; details: string | null; declaredAt: string }[] }>('/review/conflicts');
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Declared conflicts</h1>
      <p className="mt-1 text-sm text-fg-muted">Conflicts candidates declared during onboarding. They cannot be proposed for work until someone resolves the conflict.</p>
      <ConflictList initial={data?.items ?? []} />
    </div>
  );
}
