import type { RubricView } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ReviewPage, type ReviewView } from '@/components/forge/review-page';
import { TaskAids } from '@/components/forge/task-aids';
import { TaskChecks, type TaskChecksDto } from '@praxis/shared/ui/task-checks';
import { getForgeSettings, getMeSafe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Review') } };

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** MVP1: the Reviewer's page for one task (the authored form read-only, a comment box under each section). */
export default async function ReviewRoute({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  if (!(await getMeSafe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/reviews/${taskId}`)}`);
  if (!(await getForgeSettings()).newFlow) redirect('/home');
  const res = await fetch(`${API_BASE}/api/v1/me/reviews/${taskId}`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  const body = (await res.json().catch(() => null)) as (ReviewView & { error?: string }) | null;
  if (res.status === 409 && body?.error === 'TERMS_REQUIRED') redirect('/welcome');
  if (!res.ok || !body) notFound();
  // The rubric's internal details (RUBRIC_RECOMMENDATIONS_ENABLED); a 404 when the flag is off shows nothing extra.
  const rub = await fetch(`${API_BASE}/api/v1/me/reviews/${taskId}/rubric`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  const rubric = rub.ok ? ((await rub.json()) as RubricView) : null;
  // Studio's verifier checks for this task, read-only (AUTHORING-SPEC 2.3).
  const chk = await fetch(`${API_BASE}/api/v1/me/reviews/${taskId}/benchmark-checks`, { headers: { cookie: (await cookies()).toString() }, cache: 'no-store' });
  const checks = chk.ok ? ((await chk.json()) as TaskChecksDto) : null;
  return (
    <>
      <div className="mx-auto max-w-4xl px-4 pt-6">
        <TaskAids taskId={body.taskId} kind="reviewer" tutorial={body.tutorial ?? null} />
        {checks && <TaskChecks data={checks} />}
      </div>
      {/* D17: room at the end so the floating Help mascot never covers the last content. */}
      <div className="pb-36">
        <ReviewPage initial={body} rubric={rubric} />
      </div>
    </>
  );
}
