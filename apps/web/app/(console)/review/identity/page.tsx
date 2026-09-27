import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IdentityReviewList } from '@/components/review/identity-review';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Identity reviews' };

export default async function IdentityReviewPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN')) notFound();
  const { data } = await apiGet<{ items: { smeUserId: string; displayName: string | null; reason: string | null; requestedAt: string }[] }>('/review/identity');
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Identity reviews</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Candidates who could not use the automated check. Use the approved alternative process; this platform never stores identity images or ID numbers.
      </p>
      <IdentityReviewList initial={data?.items ?? []} />
    </div>
  );
}
