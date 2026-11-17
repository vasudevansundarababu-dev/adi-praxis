import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProjectStatusBadge } from '@/components/projects/project-status';
import { UrlPager } from '@/components/pager';
import { TableSearch } from '@/components/search/table-search';
import { apiGet, getCurrentUser } from '@/lib/api';
import { pageParam, queryParam, type SearchParams } from '@/lib/paging';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = (await getCurrentUser())!;
  // D24: paged by the API (10 a page), filtered by the search bar's `?q=` across every project.
  const q = queryParam(sp);
  const { data } = await apiGet<{ items: ProjectDto[]; page?: number; total?: number }>(`/projects?page=${pageParam(sp)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const items = data?.items ?? [];
  const total = data?.total ?? items.length;
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
      {items.length === 0 && !q ? (
        <p className="mt-8 text-fg-muted">No projects yet.</p>
      ) : (
        <div className="mt-6">
        <TableSearch type="projects" label="Search projects" placeholder="Search projects by name, workflow or what they are about" syncUrl initialQuery={q} />
        <div className="overflow-x-auto card" data-search-scope="projects">
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
                <tr key={p.id} data-search-id={p.id} className="border-t border-line">
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
              {items.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} role="status" className="px-4 py-6 text-center text-fg-muted">
                    No projects match &ldquo;{q}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <UrlPager searchParams={sp} page={data?.page ?? 1} total={total} shown={items.length} noun="projects" singular="project" />
        </div>
      )}
    </div>
  );
}
