import { identityEligible } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Home') } };

const ENROLLMENT_LABELS: Record<string, string> = {
  DRAFT: 'Profile in progress',
  SUBMITTED: 'Submitted',
  NEEDS_INFORMATION: 'More information requested',
  REVIEW_PENDING: 'Review in progress',
  SELECTED: 'Selected for this pool',
  NOT_SELECTED: 'Not selected for this pool',
  REVIEW_REQUESTED: 'Review requested',
  WITHDRAWN: 'Withdrawn',
};

/** Candidate home: identity status, next step and applications (C08 grows in M4c). */
export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  const eligible = identityEligible(me.identityStatus);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Welcome{me.displayName ? `, ${me.displayName}` : ''}</h1>
      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-fg-muted">Identity</p>
        <p className="font-semibold">{me.identityLabel}</p>
        {!eligible && (
          <Link href="/verify" className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary">
            {me.identityStatus === 'NOT_STARTED' ? 'Verify your identity' : 'Check verification'}
          </Link>
        )}
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Your applications</h2>
        {me.enrollments.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            None yet. <Link href="/opportunities" className="text-link underline">Browse opportunities</Link>.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {me.enrollments.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-md border border-line p-3 text-sm">
                <Link href={`/enrollments/${e.id}`} className="text-link hover:underline">
                  {e.title}
                </Link>
                <span className="text-fg-muted">{ENROLLMENT_LABELS[e.status] ?? e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
