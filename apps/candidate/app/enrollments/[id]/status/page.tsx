import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { StatusActions } from '@/components/journey/status-actions';
import { api, getMe } from '@/lib/api';
import type { EnrollmentStatusView } from '@/lib/journey-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Application status') } };

/** C06: where the application stands. Explanations appear only after a person has decided. */
export default async function StatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}/status`)}`);
  const { data: s } = await api<EnrollmentStatusView>(`/me/enrollments/${id}/status`);
  if (!s) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/home" className="text-sm text-link hover:underline">
        ← Home
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{s.title}</h1>
      <section aria-live="polite" className="mt-6 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-fg-muted">Status</p>
        <p className="text-lg font-semibold">{s.statusText}</p>
        {s.message && <p className="mt-3 whitespace-pre-wrap">{s.message}</p>}
        {s.informationRequest && (
          <p className="mt-3 rounded-md border border-line p-3">
            <span className="font-medium">What we need: </span>
            {s.informationRequest}
          </p>
        )}
        {['SUBMITTED', 'REVIEW_PENDING', 'REVIEW_REQUESTED'].includes(s.status) && (
          <p className="mt-3 text-sm text-fg-muted">A person reviews every application. We’ll email you when there’s a decision. There’s nothing you need to do now.</p>
        )}
      </section>

      {s.scope && (
        <section className="mt-6 rounded-lg border border-line p-4 text-sm">
          <h2 className="font-semibold">Your approved scope</h2>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[10rem_1fr]">
            <dt className="text-fg-muted">Domain</dt>
            <dd>{[s.scope.domain, s.scope.specialty].filter(Boolean).join(' · ')}</dd>
            <dt className="text-fg-muted">Jurisdictions</dt>
            <dd>{s.scope.jurisdictions.join(', ') || '—'}</dd>
            <dt className="text-fg-muted">Task roles</dt>
            <dd>{s.scope.contributionRoles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')}</dd>
          </dl>
          {s.onboardingStatus !== 'COMPLETE' ? (
            <Link href={`/enrollments/${s.id}/onboarding`} className="mt-4 inline-block rounded-md bg-primary px-4 py-2 font-medium text-on-primary">
              {s.onboardingStatus === 'NOT_STARTED' ? 'Start onboarding' : 'Continue onboarding'}
            </Link>
          ) : (
            <p className="mt-3 text-success">Onboarding complete. Assignments will appear on your home page when there is suitable work.</p>
          )}
        </section>
      )}

      <p className="mt-6 text-sm">
        <Link href={`/enrollments/${s.id}/review`} className="text-link underline">
          View the profile you submitted
        </Link>
      </p>
      <StatusActions id={s.id} canAmend={s.canAmend} canRequestReview={s.canRequestReview} canWithdraw={s.canWithdraw} />
    </main>
  );
}
