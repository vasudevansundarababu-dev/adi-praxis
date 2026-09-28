import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'Task reviews' };

type Item = { id: string; projectName: string; workflow: string; taskType: string; brief: string | null; author: string | null; submittedAt: string | null; reworkCount: number; flaggedDuplicate: boolean; dataFlags: number };

/** TASK-KYC R01: tasks awaiting review, flagged items first. */
export default async function TaskReviewQueue() {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN')) return <NoAccess need="Validators and Admins" />;
  const { data } = await apiGet<{ items: Item[] }>('/review/tasks');
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">Task reviews</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">Submitted tasks for your projects. Likely duplicates and possible real data come first. You never see your own tasks or those of an expert you declared a conflict with.</p>
      {items.length === 0 ? (
        <p className="mt-6 text-fg-muted">Nothing is waiting for review.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((t) => (
            <li key={t.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/review/tasks/${t.id}`} className="font-medium text-link hover:underline">
                  {t.brief ?? `${t.taskType.toLowerCase()} task`}
                </Link>
                {t.flaggedDuplicate && <span className="rounded-full border border-warning px-2 text-xs text-warning">Likely duplicate</span>}
                {t.dataFlags > 0 && <span className="rounded-full border border-warning px-2 text-xs text-warning">Data flags {t.dataFlags}</span>}
                {t.reworkCount > 0 && <span className="rounded-full border border-line px-2 text-xs">Resubmitted ×{t.reworkCount}</span>}
              </div>
              <p className="mt-1 text-fg-muted">
                {t.projectName} · {t.workflow} · {t.author ?? 'Expert'} · {t.submittedAt ? new Date(t.submittedAt).toLocaleString() : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
