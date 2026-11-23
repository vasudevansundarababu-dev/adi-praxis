import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { RunReviews } from '@/components/forge/run-reviews';
import { api, getMe } from '@/lib/api';
import type { AssignedReview } from '@/lib/run-review';

export const metadata: Metadata = { title: { absolute: pageTitle('Run reviews') } };

/** D-004: RL Gym run results assigned to this SME to verify. */
export default async function RunReviewsPage() {
  if (!(await getMe())) redirect('/sign-in');
  const { data } = await api<{ items: AssignedReview[] }>('/me/run-reviews');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Run reviews</h1>
      <p className="max-w-3xl text-sm text-fg-muted">
        The benchmark ran your tasks and sent these episodes back for a person to check. Decide each one with a rationale. “Task needs correction” sends the task back to you in Rework; the corrected version is approved and sent again.
      </p>
      {data ? <RunReviews reviews={data.items} /> : <p className="card p-5 text-sm text-error">Run reviews could not be loaded. Reload the page to try again.</p>}
    </div>
  );
}
