import type { ForgeTaskRow, ProjectPersonDto } from '@praxis/shared';
import Link from 'next/link';
import type { SearchParams } from '@/components/pager';
import { smesOf, reviewersOf, type ReviewRoute } from '@/lib/forge-console';
import { PeopleTable } from './people-table';

/** D1: sourced SMEs with no task, and how many tasks are still open. */
export type WithoutTask = { openTasks: number; items: { sourcedPersonId: string; firstName: string; lastName: string; email: string }[] };

/** MVP1 Resource assignments tab (owner, 15 Nov: one screen, no steps): the people assigned, each with their tasks. */
export function ForgePeopleTab({
  projectId,
  reviewRoute,
  requiredWorkers,
  people,
  tasks,
  withoutTask,
}: {
  projectId: string;
  reviewRoute: ReviewRoute;
  requiredWorkers: number | null;
  people: ProjectPersonDto[];
  tasks: Pick<ForgeTaskRow, 'taskId'>[];
  withoutTask?: WithoutTask;
  /** D24: the URL's `?page=`; people and SMEs without a task are paged together, 10 a page (read in the browser by PeopleTable). */
  searchParams?: SearchParams;
}) {
  const smes = smesOf(people).length;
  const revs = reviewersOf(people).length;
  const two = reviewRoute === 'SME_EXPERT_PM';
  // UI standard 3a: the table, its search and its pager (`?page=`) run in the browser over every row fetched here.
  return (
    <section aria-label="Resource assignments">
      <PeopleTable
        projectId={projectId}
        people={people}
        tasks={tasks}
        withoutTask={withoutTask}
        toolbar={
          <>
            <span className="text-sm text-fg-muted" data-people-summary>
              {smes} of {requiredWorkers ?? '—'} SMEs assigned (Required workers){two ? ` · ${revs} reviewer${revs === 1 ? '' : 's'}` : ''}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Link href={`/projects/${projectId}/recruiter`} className="btn btn-secondary">
                Export to Recruiter
              </Link>
              <Link href={`/projects/${projectId}/assign`} className="btn btn-primary">
                Assign
              </Link>
            </span>
          </>
        }
      />
      <p className="mt-2.5 text-xs text-fg-muted">
        {two ? 'Review route Author → Reviewer → PM/Admin: you can assign SMEs and Reviewers.' : 'Review route Author → PM/Admin: you can assign SMEs only. No reviewers on this project.'} Each person
        sees their tasks, including any sent back for rework, when they sign in.
      </p>
    </section>
  );
}
