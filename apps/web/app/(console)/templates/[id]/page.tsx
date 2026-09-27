import type { TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/templates/status-badge';
import { TemplateActions } from '@/components/templates/template-actions';
import { TemplateEditor } from '@/components/templates/template-editor';
import { TemplateView } from '@/components/templates/template-view';
import { apiGet, getCurrentUser } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await apiGet<TemplateDto>(`/templates/${(await params).id}`);
  return { title: data ? `${data.workflowName} v${data.version}` : 'Template' };
}

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const isAdmin = user.roles.includes('ADMIN');
  const { data: t } = await apiGet<TemplateDto>(`/templates/${id}`);
  if (!t) notFound();
  const versions = isAdmin ? ((await apiGet<{ items: TemplateDto[] }>(`/templates/${id}/versions`)).data?.items ?? []) : [];
  const hasDraft = versions.some((v) => v.status === 'DRAFT');

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
      <div>
        <Link href="/templates" className="text-sm text-link hover:underline">
          ← Templates
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{t.workflowName}</h1>
          <span className="text-fg-muted">v{t.version}</span>
          <StatusBadge status={t.status} />
        </div>
        <p className="mt-1 text-sm text-fg-muted">{t.domainName}</p>

        {/* keyed on updatedAt so stale action errors clear after a save */}
        {isAdmin && <TemplateActions key={t.updatedAt} template={t} hasDraft={hasDraft} />}

        <div className="mt-6">
          {isAdmin && t.status === 'DRAFT' ? <TemplateEditor template={t} /> : <TemplateView template={t} />}
        </div>
      </div>

      {isAdmin && versions.length > 0 && (
        <aside aria-label="Version history">
          <h2 className="font-semibold">Versions</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                {v.id === t.id ? (
                  <span className="font-medium">v{v.version}</span>
                ) : (
                  <Link href={`/templates/${v.id}`} className="text-link hover:underline">
                    v{v.version}
                  </Link>
                )}
                <StatusBadge status={v.status} />
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
