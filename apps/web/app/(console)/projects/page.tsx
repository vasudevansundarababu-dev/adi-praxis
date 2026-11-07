import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const user = (await getCurrentUser())!;
  const { data } = await apiGet<{ items: ProjectDto[] }>('/projects');
  const items = data?.items ?? [];
  const isAdmin = user.roles.includes('ADMIN');
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {user.roles.some((r) => r === 'ADMIN' || r === 'PM') && (
          <Link href="/projects/new" className="ml-auto btn btn-primary">
            New project
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-muted">{isAdmin ? 'All projects.' : 'Projects you own.'}</p>
      {items.length === 0 ? (
        <p className="mt-8 text-fg-muted">No projects yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto card">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Workflow</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Required workers</th>
                {isAdmin && <th className="px-4 py-2 font-medium">Owner</th>}
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link href={`/projects/${p.id}`} className="text-link hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {p.workflowName} <span className="text-fg-muted">v{p.templateVersion}</span>
                  </td>
                  <td className="px-4 py-2">
                    <ProjectStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2">{p.requiredWorkers ?? '—'}</td>
                  {isAdmin && <td className="px-4 py-2">{p.ownerName}</td>}
                  <td className="px-4 py-2">{new Date(p.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
