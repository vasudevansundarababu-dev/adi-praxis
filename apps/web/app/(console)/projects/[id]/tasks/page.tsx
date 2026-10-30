import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InputUpload, InvitesPanel, TaskTable, type InviteRow, type TaskRow } from '@/components/tasks/task-admin';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Tasks and invites' };

export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  const [{ data: tasks }, { data: invites }] = await Promise.all([apiGet<{ tptMinutes: number | null; items: TaskRow[] }>(`/projects/${id}/tasks`), apiGet<{ items: InviteRow[] }>(`/projects/${id}/invites`)]);
  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-link hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Tasks and invites</h1>
      <p className="mt-1 text-sm text-fg-muted">
        TPT is a planning and pay target ({tasks?.tptMinutes ?? '—'} min): tasks never expire on it. Reclaim a stalled task to return it to the queue.
      </p>
      {project.status === 'DRAFT' && project.name.startsWith('SYNTHETIC TEST — ') && <p className="mt-4 rounded-md border border-line p-3 text-sm">This example is an unassigned software test draft. It has no human task approval or reviewed rights clearance. <a className="text-link underline" href={`/api/v1/projects/${id}/synthetic-example`}>Download synthetic draft for Anvil qualification</a>. Staff the project, author and submit the task, then obtain independent review to enter the approved dataset.</p>}
      {project.taskMode === 'ANNOTATION' && <InputUpload projectId={id} />}
      <TaskTable projectId={id} tptMinutes={tasks?.tptMinutes ?? null} initial={tasks?.items ?? []} />
      <InvitesPanel projectId={id} initial={invites?.items ?? []} />
    </div>
  );
}
