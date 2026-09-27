import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'RL reviews' };

type Item = { id: string; rlRunId: string; rlTaskId: string; workflow: string; projectName: string; priority: number; dueBy: string | null; failedEvals: number; status: string; claimedBy: string | null; receivedAt: string };

/** FLOW 4 queue: one review per RL task, highest priority and earliest due first. */
export default async function RlQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'REVIEWER' || r === 'ADMIN')) notFound();
  const done = (await searchParams).status === 'DONE';
  const { data } = await apiGet<{ items: Item[] }>(`/review/rl?status=${done ? 'DONE' : 'OPEN'}`);
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-2xl font-semibold">RL reviews</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">Results from RL Gym that need a human verdict. Check the trajectory against the original approved task; comment on every failure and every disagreement with an automated eval.</p>
      <nav aria-label="Filter" className="mt-4 flex gap-2 text-sm">
        <Link href="/review/rl" aria-current={!done ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${!done ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>Open</Link>
        <Link href="/review/rl?status=DONE" aria-current={done ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${done ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>Completed</Link>
      </nav>
      {items.length === 0 ? (
        <p className="mt-6 text-fg-muted">Nothing here.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className="px-2 py-2 font-medium">RL task</th>
                <th className="px-2 py-2 font-medium">Workflow</th>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="px-2 py-2 font-medium">Due</th>
                <th className="px-2 py-2 font-medium">Failed evals</th>
                <th className="px-2 py-2 font-medium">Reviewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="px-2 py-2">
                    <Link href={`/review/rl/${t.id}`} className="font-medium text-link hover:underline">{t.rlRunId} / {t.rlTaskId}</Link>
                  </td>
                  <td className="px-2 py-2">{t.workflow}<span className="block text-xs text-fg-muted">{t.projectName}</span></td>
                  <td className="px-2 py-2 tabular-nums">{t.priority}</td>
                  <td className="px-2 py-2">{t.dueBy ? new Date(t.dueBy).toLocaleString() : '—'}</td>
                  <td className="px-2 py-2 tabular-nums">{t.failedEvals}</td>
                  <td className="px-2 py-2">{t.claimedBy ?? (t.status === 'CREATED' ? 'Unclaimed' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
