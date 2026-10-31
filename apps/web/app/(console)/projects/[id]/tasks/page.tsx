import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InputUpload, InvitesPanel, SyntheticDraftPanel, TaskTable, type InviteRow, type TaskRow } from '@/components/tasks/task-admin';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Tasks and invites' };

export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  const [{ data: tasks }, { data: invites }] = await Promise.all([apiGet<{ tptMinutes: number | null; items: TaskRow[]; syntheticDraftCanCreate: boolean; syntheticDraftAvailable: boolean }>(`/projects/${id}/tasks`), apiGet<{ items: InviteRow[] }>(`/projects/${id}/invites`)]);
  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-link hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Tasks and invites</h1>
      <p className="mt-1 text-sm text-fg-muted">
        TPT is a planning and pay target ({tasks?.tptMinutes ?? '—'} min): tasks never expire on it. Reclaim a stalled task to return it to the queue.
      </p>
      <SyntheticDraftPanel projectId={id} canCreate={tasks?.syntheticDraftCanCreate ?? false} available={tasks?.syntheticDraftAvailable ?? false} />
      {project.taskMode === 'ANNOTATION' && <InputUpload projectId={id} />}
      <TaskTable projectId={id} tptMinutes={tasks?.tptMinutes ?? null} initial={tasks?.items ?? []} />
      <InvitesPanel projectId={id} initial={invites?.items ?? []} />
    </div>
  );
}
