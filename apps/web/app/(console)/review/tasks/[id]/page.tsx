import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskReview, type TaskReviewData } from '@/components/tasks/task-review';
import { JudgeResultView } from '@/components/templates/tasks/judge-panel';
import { apiGet } from '@/lib/api';
import type { JudgeView } from '@/lib/mc/browser';

export const metadata: Metadata = { title: 'Review task' };

export default async function TaskReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, data } = await apiGet<TaskReviewData>(`/review/tasks/${id}`);
  if (status === 403) {
    return (
      <div className="max-w-2xl">
        <Link href="/review/tasks" className="text-sm text-link hover:underline">← Task reviews</Link>
        <p role="alert" className="mt-4 rounded-md border border-warning p-3 text-sm">You cannot review this task: you wrote it, or you declared a conflict with its author.</p>
      </div>
    );
  }
  if (!data) notFound();
  // Studio tasks only: the post-commit LLM judge result (Admin only; the API refuses everyone else).
  const judge = await apiGet<{ judge: JudgeView | null }>(`/review/tasks/${id}/judge`);
  return (
    <>
      <TaskReview data={data} />
      {judge.data?.judge && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold">LLM judge</h2>
          <JudgeResultView judge={judge.data.judge} />
        </section>
      )}
    </>
  );
}
