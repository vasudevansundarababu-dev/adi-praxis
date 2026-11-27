'use client';

import { matchesQuery, type ForgeHomeDto, type SmeTaskStatus } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { NextStep } from '@/components/ui';
import { AUTHOR_FILTERS, AUTHOR_STATUS_TONE, authorAction, filterAuthorTasks, nextForgeStep, REVIEW_STATUS_TONE } from '@/lib/forge';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** MVP1 Home: the welcome card with the next step, Tasks to review (if any) and Your tasks with a status filter. */
export function ForgeHome({ home, email, initialFilter = '' }: { home: ForgeHomeDto; email: string | null; initialFilter?: SmeTaskStatus | '' }) {
  const [filter, setFilter] = useState<SmeTaskStatus | ''>(initialFilter);
  const [q, setQ] = useState('');
  // UI standard 3a (owner, 26 Nov 2026): every list is paged; a list that can pass 10 rows has a search box.
  const shown = useMemo(() => filterAuthorTasks(home.authorTasks, filter).filter((t) => matchesQuery([t.label, t.projectName], q)), [home.authorTasks, filter, q]);
  const authorPaged = usePagedRows(shown, { param: 'tasksPage', resetKey: `${filter}|${q}` });
  const reviewPaged = usePagedRows(home.reviewTasks, { param: 'reviewPage' });
  const first = home.name?.split(' ')[0];
  const none = home.authorTasks.length === 0 && home.reviewTasks.length === 0;

  if (none) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold">No tasks for this account yet</h1>
        <p className="mt-3 text-sm">
          We couldn&apos;t find tasks for {email ? <strong>{email}</strong> : 'this account'}. Check that you signed in with the email you gave your
          recruitment agency. If you did, your tasks will show here once your project manager assigns them.
        </p>
      </main>
    );
  }

  const next = nextForgeStep(home);
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">Welcome{first ? `, ${first}` : ''}</h1>
        <NextStep title={next.title} body={next.body} href={next.href ?? undefined} cta={next.cta ?? undefined} />
      </section>

      {home.reviewTasks.length > 0 && (
        <section aria-labelledby="review-h">
          <h2 id="review-h" className="text-lg font-semibold">
            Tasks to review <span className="text-sm font-normal text-fg-muted">· you&apos;re the Reviewer on these projects</span>
          </h2>
          <ul className="mt-3 grid gap-2">
            {reviewPaged.items.map((t) => (
              <li key={t.taskId}>
                <Link href={`/reviews/${t.taskId}`} className="card card-link flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.label}</p>
                    <p className="text-xs text-fg-muted">
                      {t.projectName}
                      {t.author ? ` · by ${t.author}` : ''} · {day(t.date)}
                    </p>
                  </div>
                  <span className={`pill ${REVIEW_STATUS_TONE[t.status]}`}>{t.status}</span>
                  <span className="text-sm text-link">{t.status === 'To review' ? 'Review →' : 'View →'}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ClientPager paged={reviewPaged} noun="tasks to review" singular="task to review" />
        </section>
      )}

      {home.authorTasks.length > 0 && (
        <section aria-labelledby="tasks-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="tasks-h" className="text-lg font-semibold">
              Your tasks <span className="text-sm font-normal text-fg-muted">· you&apos;re the author</span>
            </h2>
            <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="sr-only">Search your tasks</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your tasks" className="rounded-md border border-line bg-surface px-2 py-1" />
            </label>
            <label className="text-sm">
              <span className="mr-2 text-fg-muted">Status</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as SmeTaskStatus | '')} className="rounded-md border border-line bg-surface px-2 py-1">
                <option value="">All</option>
                {AUTHOR_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted">
              {q ? (
                <>
                  No matches for &lsquo;{q}&rsquo;.{' '}
                  <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
                    Clear search
                  </button>
                </>
              ) : (
                'No tasks with this status.'
              )}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {authorPaged.items.map((t) => (
                <li key={t.taskId}>
                  <Link href={`/tasks/${t.taskId}`} className="card card-link flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{t.label}</p>
                      <p className="text-xs text-fg-muted">
                        {t.projectName} · {day(t.date)}
                        {t.status === 'Rework' && t.reworkComments > 0 ? ` · ${t.reworkComments} comment${t.reworkComments === 1 ? '' : 's'} to fix` : ''}
                      </p>
                    </div>
                    <span className={`pill ${AUTHOR_STATUS_TONE[t.status]}`}>{t.status}</span>
                    <span className="text-sm text-link">{authorAction(t.status)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ClientPager paged={authorPaged} noun="tasks" singular="task" />
        </section>
      )}
    </main>
  );
}
