import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Your SME profile') } };

/** Enrollment start. The conversational profile (C04) and review (C05) are built in M4b. */
export default async function EnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}`)}`);
  const e = me.enrollments.find((x) => x.id === id);
  if (!e) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/home" className="text-sm text-link hover:underline">
        ← Home
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{e.title}</h1>
      <p className="mt-4">Your application is saved. Next, a short guided conversation builds your SME profile for this opportunity.</p>
      <p className="mt-2 text-sm text-fg-muted">The profile conversation opens here soon. Your place is kept.</p>
    </main>
  );
}
