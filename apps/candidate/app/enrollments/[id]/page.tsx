import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { Conversation } from '@/components/profile/conversation';
import { api, getMe } from '@/lib/api';
import type { ConversationState } from '@/lib/profile-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Your SME profile') } };

export default async function EnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}`)}`);
  const { data } = await api<ConversationState>(`/me/enrollments/${id}/conversation`);
  if (!data) notFound();
  if (!data.editable) redirect(`/enrollments/${id}/review`);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Conversation initial={data} />
    </main>
  );
}
