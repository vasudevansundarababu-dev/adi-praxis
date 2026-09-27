import type { DomainDto, TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NewDomainForm } from '@/components/templates/new-domain-form';
import { StatusBadge } from '@/components/templates/status-badge';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Templates' };

export default async function TemplatesPage() {
  const user = (await getCurrentUser())!;
  const isAdmin = user.roles.includes('ADMIN');
  const [{ data: templates }, { data: domains }] = await Promise.all([
    apiGet<{ items: TemplateDto[] }>('/templates'),
    apiGet<{ items: DomainDto[] }>('/domains'),
  ]);
  const items = templates?.items ?? [];
  const byDomain = (domains?.items ?? []).map((d) => ({ domain: d, items: items.filter((t) => t.domainId === d.id) }));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Templates</h1>
        {isAdmin && (
          <Link href="/templates/new" className="ml-auto btn btn-primary">
            New template
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {isAdmin
          ? 'Each workflow shows its latest version. Projects can only be created from published templates.'
          : 'Published workflow templates you can create projects from.'}
      </p>

      {byDomain.map(({ domain, items: rows }) =>
        rows.length === 0 && !isAdmin ? null : (
          <section key={domain.id} className="mt-8">
            <h2 className="text-lg font-semibold">{domain.name}</h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-fg-muted">No workflows yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface">
                    <tr>
                      <th className="px-4 py-2 font-medium">Workflow</th>
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">TPT</th>
                      <th className="px-4 py-2 font-medium">Modes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id} className="border-t border-line">
                        <td className="px-4 py-2">
                          <Link href={`/templates/${t.id}`} className="text-link hover:underline">
                            {t.workflowName}
                          </Link>
                        </td>
                        <td className="px-4 py-2">v{t.version}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-4 py-2">{t.defaultTptMinutes ? `${t.defaultTptMinutes} min` : '—'}</td>
                        <td className="px-4 py-2">{t.taskModes.map((m) => m.toLowerCase()).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ),
      )}

      {items.length === 0 && !isAdmin && <p className="mt-8 text-fg-muted">No published templates yet.</p>}
      {isAdmin && <NewDomainForm />}
    </div>
  );
}
