'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { minutes, TASK_STATUS, type TaskSummary } from '@/lib/work-types';

/** The project's task list (UI standard 3a): open tasks first, searched by brief or status, 10 a page (`?tasksPage=`). */
export function ProjectTaskList({ tasks }: { tasks: TaskSummary[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => tasks.filter((t) => matchesQuery([t.brief ?? 'Task', TASK_STATUS[t.status]], q)), [tasks, q]);
  const paged = usePagedRows(shown, { param: 'tasksPage', resetKey: q });
  if (tasks.length === 0) return null;
  return (
    <>
      <label className="mt-2 block text-sm">
        <span className="sr-only">Search your tasks</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your tasks" className="rounded-md border border-line bg-surface px-2 py-1" />
      </label>
      {shown.length === 0 && (
        <p className="mt-2 text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {paged.items.map((t) => (
          <li key={t.id} className="rounded-md border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/tasks/${t.id}`} className="font-medium text-link hover:underline">
                {t.brief ?? 'Task'}
              </Link>
              <span className={`ml-auto text-xs ${t.status === 'REWORK' ? 'text-warning' : t.status === 'ACCEPTED' ? 'text-success' : 'text-fg-muted'}`}>{TASK_STATUS[t.status]}</span>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {t.isOpenSlot ? 'Open slot · ' : ''}active {minutes(t.activeSeconds)} min{t.submittedAt ? ` · submitted ${new Date(t.submittedAt).toLocaleDateString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {shown.length > 0 && <ClientPager paged={paged} noun="tasks" singular="task" />}
    </>
  );
}
