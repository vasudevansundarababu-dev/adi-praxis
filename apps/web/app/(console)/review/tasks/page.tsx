import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';
import { TaskQueue, type TaskQueueItem } from './task-queue';

export const metadata: Metadata = { title: 'Task reviews' };

/** TASK-KYC R01: tasks awaiting review, flagged items first. Search and the pager (`?page=`) run in the browser (UI standard 3a). */
export default async function TaskReviewQueue() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN' || r === 'PM')) return <NoAccess need="Validators, PMs and Admins" />;
  const { data } = await apiGet<{ items: TaskQueueItem[] }>('/review/tasks');
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Task reviews</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">Submitted tasks for your projects. Likely duplicates and possible real data come first. Admin can decide without a separate reviewer assignment. Declared conflicts still need resolution. On projects with Expert review, assigned Validators see tasks at Expert review and the project&apos;s PM sees tasks at PM approval.</p>
      <p className="mt-2 text-sm">
        <Link href="/review/policy-proposals" className="text-link hover:underline">Policy documents proposed by SMEs</Link>
      </p>
      {items.length === 0 ? <p className="mt-6 text-fg-muted">Nothing is waiting for review.</p> : <TaskQueue items={items} />}
    </div>
  );
}
