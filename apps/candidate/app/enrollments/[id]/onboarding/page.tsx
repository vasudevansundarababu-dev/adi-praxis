import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { Onboarding } from '@/components/journey/onboarding';
import { api, getMe } from '@/lib/api';
import type { OnboardingView } from '@/lib/journey-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Onboarding') } };

/** C07: a short checklist before any assignment. Nothing is accepted on the candidate's behalf. */
export default async function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}/onboarding`)}`);
  const { status, data } = await api<OnboardingView>(`/me/onboarding?enrollmentId=${id}`);
  if (status === 409) redirect(`/enrollments/${id}/status`);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Onboarding initial={data} />
    </main>
  );
}
