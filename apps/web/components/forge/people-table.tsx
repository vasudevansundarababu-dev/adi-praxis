'use client';

import { matchesQuery, type ForgeTaskRow, type ProjectPersonDto } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { ClientPager } from '@/components/pager';
import { taskCodes, taskStatusLabel, taskStatusTone } from '@/lib/forge-console';

const TH = 'px-4 py-2.5 text-xs font-semibold text-fg-muted';
const TD = 'px-4 py-3 align-top';

type Without = { openTasks: number; items: { sourcedPersonId: string; firstName: string; lastName: string; email: string }[] };

/**
 * The Resource assignments table (UI standard 3a): people and SMEs without a task together, searched by name or email and
 * paged 10 a page (`?page=`). The toolbar (summary and buttons) comes from the server tab and sits right of the search.
 */
export function PeopleTable({ projectId, people, tasks, withoutTask, toolbar }: { projectId: string; people: ProjectPersonDto[]; tasks: Pick<ForgeTaskRow, 'taskId'>[]; withoutTask?: Without; toolbar?: ReactNode }) {
  const [q, setQ] = useState('');
  const codes = useMemo(() => taskCodes(tasks), [tasks]);
  const all = useMemo(() => [...people.map((p) => ({ kind: 'person' as const, p })), ...(withoutTask?.items ?? []).map((w) => ({ kind: 'without' as const, w }))], [people, withoutTask]);
  const shown = useMemo(
    () =>
      all.filter((r) =>
        r.kind === 'person'
          ? matchesQuery([r.p.firstName, r.p.lastName, r.p.email, r.p.role === 'REVIEWER' ? 'Reviewer' : 'SME', ...r.p.tasks.map((t) => codes.get(t.taskId) ?? t.label)], q)
          : matchesQuery([r.w.firstName, r.w.lastName, r.w.email, 'SME'], q),
      ),
    [all, codes, q],
  );
  const paged = usePagedRows(shown, { resetKey: q });
  const pagePeople = paged.items.flatMap((r) => (r.kind === 'person' ? [r.p] : []));
  const pageWithout = paged.items.flatMap((r) => (r.kind === 'without' ? [r.w] : []));
  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <label className="text-sm">
          <span className="sr-only">Search people</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
        {toolbar}
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
            {pagePeople.map((p) => (
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
            {pageWithout.map((p) => (
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
            {all.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-fg-muted">
                  No one assigned yet. Use Assign.
                </td>
              </tr>
            )}
            {all.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-fg-muted">
                  No matches for &lsquo;{q}&rsquo;.{' '}
                  <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
                    Clear search
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > 0 && <ClientPager paged={paged} noun="people" singular="person" />}
    </>
  );
}
