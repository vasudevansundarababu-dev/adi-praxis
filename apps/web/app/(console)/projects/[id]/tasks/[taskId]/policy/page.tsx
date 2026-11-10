import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskPolicy, type TaskPolicyData } from '@/components/policy/task-policy';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Task policy' };

export default async function TaskPolicyPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const { status, data } = await apiGet<TaskPolicyData>(`/tasks/${taskId}/policy`);
  if (status === 404 || !data) notFound();
  return (
    <div>
      <Link href={`/projects/${id}/tasks`} className="text-sm text-link hover:underline">
        ← Tasks and invites
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Task policy</h1>
      <TaskPolicy projectId={id} taskId={taskId} data={data} />
    </div>
  );
}
