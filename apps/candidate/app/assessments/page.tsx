import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ExpertQueue } from '@/components/cert/expert-queue';
import { api, getMe } from '@/lib/api';
import type { AssessmentItem, ExpertReviewItem } from '@/lib/supply-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Expert reviews') } };

/** M10b, certified Experts only: confirm grades on other candidates' authoring tasks and review new Expert-tier questions. */
export default async function AssessmentsPage() {
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent('/assessments')}`);
  const [a, f] = await Promise.all([api<{ items: AssessmentItem[] }>('/me/assessments'), api<{ items: ExpertReviewItem[] }>('/me/expert-reviews')]);
  if (a.status === 404 && f.status === 404) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href="/certifications" className="text-sm text-link hover:underline">
        ← Certifications
      </Link>
      <section className="hero p-6 sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">Expert reviews</h1>
        <p className="muted mt-2">As a certified Expert you help mark other candidates’ authoring tasks and check new test questions in your domain. Your judgement decides; a model’s suggestion never does.</p>
      </section>
      {a.data && f.data ? <ExpertQueue assessments={a.data.items} families={f.data.items} /> : <p role="alert" className="card p-4 text-sm text-error">We couldn’t load your reviews. Refresh the page to try again.</p>}
    </main>
  );
}
