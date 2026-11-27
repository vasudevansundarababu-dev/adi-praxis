'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';

export type TaskQueueItem = { id: string; projectName: string; workflow: string; taskType: string; brief: string | null; author: string | null; submittedAt: string | null; reworkCount: number; flaggedDuplicate: boolean; dataFlags: number; reviewRoute?: 'SME_PM' | 'SME_EXPERT_PM'; stage?: 'EXPERT_REVIEW' | 'PM_APPROVAL' | null };

/** The task review queue (UI standard 3a): every fetched task, searched by brief, project, workflow or author, 10 a page (`?page=`). */
export function TaskQueue({ items }: { items: TaskQueueItem[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((t) => matchesQuery([t.brief ?? `${t.taskType.toLowerCase()} task`, t.projectName, t.workflow, t.author ?? 'Expert'], q)), [items, q]);
  const paged = usePagedRows(shown, { resetKey: q });
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Search task reviews</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search task reviews" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {paged.items.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/review/tasks/${t.id}`} className="font-medium text-link hover:underline">
                  {t.brief ?? `${t.taskType.toLowerCase()} task`}
                </Link>
                {t.flaggedDuplicate && <span className="rounded-full border border-warning px-2 text-xs text-warning">Likely duplicate</span>}
                {t.dataFlags > 0 && <span className="rounded-full border border-warning px-2 text-xs text-warning">Data flags {t.dataFlags}</span>}
                {t.reviewRoute === 'SME_EXPERT_PM' && t.stage && <span className="rounded-full border border-line px-2 text-xs">{t.stage === 'EXPERT_REVIEW' ? 'Expert review' : 'PM approval'}</span>}
                {t.reworkCount > 0 && <span className="rounded-full border border-line px-2 text-xs">Resubmitted ×{t.reworkCount}</span>}
              </div>
              <p className="mt-1 text-fg-muted">
                {t.projectName} · {t.workflow} · {t.author ?? 'Expert'} · {t.submittedAt ? new Date(t.submittedAt).toLocaleString() : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <ClientPager paged={paged} noun="tasks" singular="task" />}
    </>
  );
}
