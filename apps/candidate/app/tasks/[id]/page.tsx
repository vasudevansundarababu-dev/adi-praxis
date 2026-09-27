import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { TaskPage } from '@/components/work/task-page';
import { api, getMe } from '@/lib/api';
import type { TaskView } from '@/lib/work-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Task') } };

export default async function TaskRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/tasks/${id}`)}`);
  const { data } = await api<TaskView>(`/me/tasks/${id}`);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <TaskPage task={data} />
    </main>
  );
}
