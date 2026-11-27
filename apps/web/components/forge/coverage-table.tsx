'use client';

import { matchesQuery, type ForgeTaskRow } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { rowSelector, taskCode, taskName, taskStatusLabel, taskStatusTone } from '@/lib/forge-console';

const TH = 'px-4 py-2.5 text-xs font-semibold text-fg-muted';
const TD = 'px-4 py-3 align-top';

/**
 * The Dashboard's coverage table (UI standard 3a): searched by value, task code, author or status and paged 10 a page
 * (`?page=`); task codes keep their place in the whole list.
 */
export function CoverageTable({ tasks, selector }: { tasks: ForgeTaskRow[]; selector: string }) {
  const [q, setQ] = useState('');
  const shown = useMemo(
    () =>
      tasks
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => matchesQuery([rowSelector(t)?.value ?? taskName(t.label), taskCode(i), t.author?.name, taskStatusLabel(t.status)], q)),
    [tasks, q],
  );
  const coverage = usePagedRows(shown, { resetKey: q });
  return (
    <>
      <div className="mt-7 mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Coverage by {selector}</h2>
        <label className="ml-auto text-sm">
          <span className="sr-only">Search coverage</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coverage" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              <th className={TH}>{selector === 'task' ? 'Slot' : selector.charAt(0).toUpperCase() + selector.slice(1)}</th>
              <th className={TH}>Task</th>
              <th className={TH}>Authored by</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {coverage.items.map(({ t, i }) => (
              <tr key={t.taskId} data-coverage-row>
                <td className={`${TD} font-semibold`}>{rowSelector(t)?.value ?? taskName(t.label)}</td>
                <td className={`${TD} font-mono text-xs`}>{taskCode(i)}</td>
                <td className={TD}>{t.author?.name ?? ''}</td>
                <td className={TD}>
                  <span className={`pill ${taskStatusTone(t.status)}`}>{taskStatusLabel(t.status)}</span>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-fg-muted">
                  This project has no tasks yet.
                </td>
              </tr>
            )}
            {tasks.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-fg-muted">
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
      {shown.length > 0 && <ClientPager paged={coverage} noun="tasks" singular="task" />}
    </>
  );
}
