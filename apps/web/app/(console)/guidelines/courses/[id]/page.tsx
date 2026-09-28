import { TIER_LABELS } from '@praxis/shared';
import type { Metadata } from 'next';
import { CourseModuleCard, DecisionForm } from '@/components/cert/course-review';
import type { CourseDetail } from '@/components/cert/types';
import { NoAccess } from '@/components/no-access';
import { BackLink, fmtDateTime, NotFoundCard, StatePill } from '@/components/supply/ui';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Course review' };

/** Course review per tier (section 7.6). Any module edit sends the course back for approval. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'REVIEWER')) return <NoAccess need="Admins and Validators" />;
  const isAdmin = user.roles.includes('ADMIN');
  const { id } = await params;
  const { data: c } = await apiGet<CourseDetail>(`/courses/${id}`);
  if (!c) return <NotFoundCard what="course" back="/guidelines" backLabel="Back to guidelines" />;
  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/guidelines/versions/${c.versionId}`}>Guidelines version</BackLink>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <StatePill state={c.status} />
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          {TIER_LABELS[c.tier]} course · {c.modules.length} modules · drafted by {c.model ?? 'the model'}
          {c.promptVersion ? ` (prompt ${c.promptVersion})` : ''}
          {c.approvedAt ? ` · approved ${fmtDateTime(c.approvedAt)}` : ''}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-fg-muted">Check each module against the cited guideline sections. Candidates must pass each module’s quiz (80%) before the next unlocks.</p>
      </div>
      <ol className="space-y-4">
        {c.modules.map((m) => (
          <li key={m.id}>
            <CourseModuleCard module={m} canEdit={isAdmin} />
          </li>
        ))}
      </ol>
      {isAdmin && <DecisionForm path={`/courses/${c.id}/decision`} what="course" status={c.status} />}
    </div>
  );
}
