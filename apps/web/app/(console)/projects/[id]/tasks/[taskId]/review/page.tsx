import type { ForgeTaskRow, ProjectPersonDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ForgeTaskPage, type ForgeTaskView } from '@/components/forge/task-page';
import type { ExportState } from '@/components/projects/export-panel';
import { NoAccess } from '@/components/no-access';
import { apiGet, newFlowOn } from '@/lib/api';
import { taskCodes } from '@/lib/forge-console';

export const metadata: Metadata = { title: 'Task' };

/** MVP1 task page (owner, 15 Nov): every task name on the Tasks tab opens it. */
export default async function ForgeTaskReviewPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  if (!(await newFlowOn()))
    return (
      <div className="card max-w-xl p-6">
        <p className="text-sm">The task page is part of the new flow, which is switched off. Review tasks from Task reviews.</p>
        <Link href={`/projects/${id}`} className="btn btn-secondary mt-4">
          Back to the project
        </Link>
      </div>
    );
  const [v, list, people, exp] = await Promise.all([
    apiGet<ForgeTaskView>(`/projects/${id}/forge-tasks/${taskId}`),
    apiGet<{ items: ForgeTaskRow[] }>(`/projects/${id}/forge-tasks`),
    apiGet<{ items: ProjectPersonDto[] }>(`/projects/${id}/people`),
    apiGet<ExportState>(`/projects/${id}/export`),
  ]);
  if (v.status === 403) return <NoAccess need="PMs and Admins" />;
  if (!v.data) notFound();
  const code = taskCodes(list.data?.items ?? []).get(taskId) ?? 'Task';
  return <ForgeTaskPage code={code} view={v.data} people={people.data?.items ?? []} exportState={exp.data} />;
}
