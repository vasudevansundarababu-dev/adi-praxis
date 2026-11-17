import type { ForgeTaskRow, ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AssignScreen } from '@/components/forge/assign-screen';
import { NoAccess } from '@/components/no-access';
import { apiGet, newFlowOn } from '@/lib/api';
import { taskCodes, type AssignableData } from '@/lib/forge-console';
import { pageParam, queryParam, type SearchParams } from '@/lib/paging';

export const metadata: Metadata = { title: 'Assign people' };

/** MVP1 Assign screen (owner, 15 Nov): a separate screen opened from Resource assignments. */
export default async function AssignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  // D23 + D24: the search (`?q=`) and the page (`?page=`) are applied by the API, over Sourcing profiles and the pool.
  const q = queryParam(sp);
  const query = `?page=${pageParam(sp)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { status, data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (status === 403) return <NoAccess need="PMs and Admins" />;
  if (!project) notFound();
  if (!(await newFlowOn()))
    return (
      <div className="card max-w-xl p-6">
        <p className="text-sm">Direct assignment is part of the new flow, which is switched off. An Admin can switch it on under Admin → Candidate app sign-in.</p>
        <Link href={`/projects/${id}`} className="btn btn-secondary mt-4">
          Back to the project
        </Link>
      </div>
    );
  const [a, t] = await Promise.all([apiGet<AssignableData>(`/projects/${id}/assignable${query}`), apiGet<{ items: ForgeTaskRow[] }>(`/projects/${id}/forge-tasks`)]);
  if (a.status === 403) return <NoAccess need="PMs and Admins" />;
  if (!a.data) return <p className="card p-4 text-sm text-error">The people for this project could not be loaded. Try again.</p>;
  return <AssignScreen projectId={id} projectName={project.name} data={a.data} codes={Object.fromEntries(taskCodes(t.data?.items ?? []))} query={q} searchParams={sp} />;
}
