import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { McHeader } from '@/components/templates/mc-header';
import { TaskStore } from '@/components/templates/tasks/task-store';
import { getCurrentUser } from '@/lib/api';
import { mcServer } from '@/lib/mc/server';

export const metadata: Metadata = { title: 'Tasks DB & JSON' };

/** Task store (PRD §5.4, S4-11, S4-12). Admin only, like its header shortcut (S1-14); SMEs see their own tasks in the studio. */
export default async function TaskStorePage() {
  const user = await getCurrentUser();
  if (!user?.roles.includes('ADMIN')) notFound();
  const { data, status } = await mcServer.studioTasks();
  return (
    <div>
      <McHeader isAdmin />
      <h1 className="mt-4 text-2xl font-semibold">Tasks DB &amp; JSON</h1>
      {data ? (
        <TaskStore tasks={data.items} />
      ) : (
        <p role="alert" className="mt-6 text-error">
          Could not load the task store ({status}). Try again in a moment.
        </p>
      )}
    </div>
  );
}
