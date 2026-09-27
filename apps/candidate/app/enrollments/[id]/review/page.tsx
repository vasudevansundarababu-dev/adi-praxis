import { identityEligible } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { Review } from '@/components/profile/review';
import { api, getMe } from '@/lib/api';
import type { ConversationState } from '@/lib/profile-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Review your profile') } };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}/review`)}`);
  const { data } = await api<ConversationState>(`/me/enrollments/${id}/conversation`);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Review initial={data} identityLabel={me.identityLabel} identityEligible={identityEligible(me.identityStatus)} />
    </main>
  );
}
