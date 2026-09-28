import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LicenceForm } from '@/components/cert/licence-form';
import { api, getMe } from '@/lib/api';
import { CERT_STATE, fmtDate, fmtDateTime, type CertificationCard } from '@/lib/supply-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Certifications') } };

/** M10b: the certifications a selected candidate needs, each with the one next thing to do. */
export default async function CertificationsPage() {
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent('/certifications')}`);
  const { status, data } = await api<{ items: CertificationCard[] }>('/me/certifications');
  if (status === 404) notFound();
  const items = data?.items ?? [];
  const expert = items.some((c) => c.tier === 'EXPERT' && c.state === 'PASSED');
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">Certifications</h1>
        <p className="muted mt-2">Each role has a short course on its guidelines, then a timed test. Pass it to start receiving work at that level.</p>
      </section>

      {!data && <p role="alert" className="card p-4 text-sm text-error">We couldn’t load your certifications. Refresh the page to try again.</p>}
      {data && items.length === 0 && (
        <p className="card p-5 text-sm text-fg-muted">
          You have no certifications yet. One opens here after a person selects you for a role that needs it. You can follow your applications on your{' '}
          <Link href="/home" className="text-link underline">
            home page
          </Link>
          .
        </p>
      )}

      <ul className="grid gap-4">
        {items.map((c) => (
          <li key={c.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-fg-muted">{c.domain}</p>
                <h2 className="text-lg font-semibold">{c.tierLabel} certification</h2>
              </div>
              <span className={`pill ${CERT_STATE[c.state][1]}`}>{CERT_STATE[c.state][0]}</span>
            </div>
            <CertNext c={c} />
            {c.licenceRequired && <LicenceForm certificationId={c.id} status={c.licenceStatus ?? 'NOT_SUBMITTED'} />}
          </li>
        ))}
      </ul>

      {expert && (
        <section className="card p-5">
          <h2 className="font-semibold">For certified Experts</h2>
          <p className="mt-1 text-sm text-fg-muted">Help confirm other candidates’ written answers and review new test questions in your domain.</p>
          <Link href="/assessments" className="mt-3 inline-block btn btn-secondary">
            Open Expert reviews →
          </Link>
        </section>
      )}
    </main>
  );
}

function CertNext({ c }: { c: CertificationCard }) {
  const course = `/certifications/${c.id}`;
  const test = `/certifications/${c.id}/test`;
  const wait = c.retakeAvailableAt && new Date(c.retakeAvailableAt) > new Date();
  const [body, href, cta]: [string, string | null, string | null] = (() => {
    switch (c.state) {
      case 'NOT_STARTED':
        return ['Start with the course. Modules open one after another, each with a short quiz.', course, 'Start the course'];
      case 'IN_TRAINING':
        return ['Pick up where you left off. The test opens when you finish the last module.', course, 'Continue the course'];
      case 'TEST_READY':
        return ['You finished the course. Before the test you take a quick selfie check.', test, 'Go to the test'];
      case 'IN_TEST':
        return ['Your test is in progress. Your answers are saved as you go.', test, 'Continue the test'];
      case 'RETAKE_AVAILABLE':
        return wait ? [`You can retake the test from ${fmtDateTime(c.retakeAvailableAt!)}. Use the time to revisit the course.`, test, 'See your last result'] : ['You can retake the test now. Each attempt has new questions.', test, 'Retake the test'];
      case 'PASSED':
        return [`Certified${c.issuedAt ? ` on ${fmtDate(c.issuedAt)}` : ''}${c.expiresAt ? `, valid until ${fmtDate(c.expiresAt)}` : ''}.`, course, 'Review the course'];
      case 'REVIEW_REQUIRED':
        return [`A person is reviewing your certification${c.reviewReason ? `: ${c.reviewReason}` : '.'} We’ll let you know the outcome; there’s nothing you need to do now.`, test, 'See your result'];
      case 'NOT_CERTIFIED':
        return ['A person reviewed your attempts and decided not to certify you this time.', test, 'See your result'];
      case 'EXPIRED':
        return ['This certificate has expired. A new certification will open when you are selected for a role that needs it.', null, null];
    }
  })();
  return (
    <div className="mt-3 text-sm">
      <p className="text-fg-muted">{body}</p>
      {href && cta && (
        <Link href={href} className="mt-3 inline-block btn btn-primary">
          {cta} →
        </Link>
      )}
    </div>
  );
}
