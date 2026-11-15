import type { ForgeTaskRow, ProjectPersonDto } from '@praxis/shared';
import Link from 'next/link';
import { smesOf, reviewersOf, taskCodes, taskStatusLabel, taskStatusTone, type ReviewRoute } from '@/lib/forge-console';
import { TD, TH } from './project-shell';

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
}) {
  const codes = taskCodes(tasks);
  const smes = smesOf(people).length;
  const revs = reviewersOf(people).length;
  const two = reviewRoute === 'SME_EXPERT_PM';
  return (
    <section aria-label="Resource assignments">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
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
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              <th className={TH}>First name</th>
              <th className={TH}>Last name</th>
              <th className={TH}>Email</th>
              <th className={TH}>Role</th>
              <th className={TH}>Status</th>
              <th className={TH}>Task ID</th>
              <th className={TH}>Task status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {people.map((p) => (
              <tr key={p.sourcedPersonId} data-person={p.sourcedPersonId}>
                <td className={TD}>{p.firstName}</td>
                <td className={TD}>{p.lastName}</td>
                <td className={`${TD} font-mono text-xs`}>{p.email}</td>
                <td className={TD}>
                  <span className={`pill ${p.role === 'REVIEWER' ? 'pill-brand' : 'pill-info'}`}>{p.role === 'REVIEWER' ? 'Reviewer' : 'SME'}</span>
                </td>
                <td className={TD}>
                  <span className="pill pill-success">Assigned</span>
                </td>
                <td className={`${TD} font-mono text-xs`}>
                  {p.tasks.length
                    ? p.tasks.map((t) => (
                        <div key={t.taskId}>
                          <Link href={`/projects/${projectId}/tasks/${t.taskId}/review`} className="text-link hover:underline">
                            {codes.get(t.taskId) ?? t.label}
                          </Link>
                        </div>
                      ))
                    : p.role === 'SME' && withoutTask
                      ? withoutTask.openTasks === 0
                        ? 'No open task left'
                        : 'No task yet'
                      : '—'}
                </td>
                <td className={TD}>
                  {p.tasks.length
                    ? p.tasks.map((t) => (
                        <div key={t.taskId}>
                          <span className={`pill ${taskStatusTone(t.status)}`}>{taskStatusLabel(t.status)}</span>
                        </div>
                      ))
                    : '—'}
                </td>
              </tr>
            ))}
            {(withoutTask?.items ?? []).map((p) => (
              <tr key={p.sourcedPersonId} data-person={p.sourcedPersonId} data-without-task>
                <td className={TD}>{p.firstName}</td>
                <td className={TD}>{p.lastName}</td>
                <td className={`${TD} font-mono text-xs`}>{p.email}</td>
                <td className={TD}>
                  <span className="pill pill-info">SME</span>
                </td>
                <td className={TD}>
                  <span className="pill pill-warning">No task</span>
                </td>
                <td className={TD} colSpan={2}>
                  {withoutTask!.openTasks === 0 ? 'No open task left: every task is assigned.' : 'Not assigned yet. Use Assign.'}
                </td>
              </tr>
            ))}
            {people.length === 0 && !(withoutTask?.items.length) && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-fg-muted">
                  No one assigned yet. Use Assign.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-xs text-fg-muted">
        {two ? 'Review route Author → Reviewer → PM/Admin: you can assign SMEs and Reviewers.' : 'Review route Author → PM/Admin: you can assign SMEs only. No reviewers on this project.'} Each person
        sees their tasks, including any sent back for rework, when they sign in.
      </p>
    </section>
  );
}
