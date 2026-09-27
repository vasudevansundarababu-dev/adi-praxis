import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { StatusActions } from '@/components/journey/status-actions';
import { Journey, StatusPill } from '@/components/ui';
import { api, getMe } from '@/lib/api';
import type { EnrollmentStatusView } from '@/lib/journey-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Application status') } };

/** C06: where the application stands. Explanations appear only after a person has decided. */
export default async function StatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/enrollments/${id}/status`)}`);
  const { data: s } = await api<EnrollmentStatusView>(`/me/enrollments/${id}/status`);
  if (!s) notFound();
  const stage = s.status === 'SELECTED' ? (s.onboardingStatus === 'COMPLETE' ? 4 : 3) : s.status === 'DRAFT' ? 1 : 2;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/home" className="text-sm text-link hover:underline">
        ← Home
      </Link>
      <section aria-live="polite" className="hero mt-3 p-6 sm:p-8">
        <p className="muted text-sm">Your application</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{s.title}</h1>
        <Journey current={stage} className="mt-5" />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusPill status={s.status} />
          <p className="text-lg font-semibold">{s.statusText}</p>
        </div>
        {s.message && <p className="mt-3 whitespace-pre-wrap">{s.message}</p>}
        {s.informationRequest && (
          <p className="mt-3 rounded-xl bg-white/10 p-3">
            <span className="font-semibold">What we need: </span>
            {s.informationRequest}
          </p>
        )}
        {['SUBMITTED', 'REVIEW_PENDING', 'REVIEW_REQUESTED'].includes(s.status) && (
          <p className="muted mt-3 text-sm">A person reviews every application. We’ll let you know when there’s a decision; there’s nothing you need to do now.</p>
        )}
      </section>

      {s.scope && (
        <section className="mt-6 card p-4 text-sm">
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
            <Link href={`/enrollments/${s.id}/onboarding`} className="mt-4 inline-block btn btn-primary">
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
