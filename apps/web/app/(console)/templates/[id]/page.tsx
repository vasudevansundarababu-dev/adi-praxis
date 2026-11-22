import type { JobDescriptionDto, TemplateDto, TutorialRunsResponse } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BlueprintSummary } from '@/components/templates/compiler/blueprint-summary';
import { MetaCompiler } from '@/components/templates/compiler/meta-compiler';
import { AnvilReadinessBadge, type AnvilReadiness } from '@/components/templates/anvil-readiness';
import { TemplateBenchmarkPanel, type TemplateBenchmarkDto } from '@/components/templates/benchmark-panel';
import { McHeader } from '@/components/templates/mc-header';
import { StatusBadge } from '@/components/templates/status-badge';
import { TemplateActions, type FormOption } from '@/components/templates/template-actions';
import { TutorialSettings } from '@/components/templates/tutorial-settings';
import { TutorialVideoPanel } from '@/components/templates/tutorial-video-panel';
import { apiGet, getCurrentUser } from '@/lib/api';
import { mcServer } from '@/lib/mc/server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await mcServer.template((await params).id);
  return { title: data ? `${data.workflowName} v${data.version}` : 'Template' };
}

/** Earlier version of the same workflow, or the variant source: what "Reset to factory" restores. */
function factoryOf(t: TemplateDto, versions: TemplateDto[], variantOfId: string | null): string | null {
  if (variantOfId) return variantOfId;
  const earlier = versions.filter((v) => v.version < t.version).sort((a, b) => b.version - a.version)[0];
  return earlier?.id ?? null;
}

/** Screen 2 for Admins (PRD §5.2); read-only blueprint summary for PMs (S1-15). */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const isAdmin = user.roles.includes('ADMIN');
  const [{ data: t }, { data: bp }, { data: anvil }, { data: benchmark }] = await Promise.all([mcServer.template(id), mcServer.blueprint(id), apiGet<AnvilReadiness>(`/templates/${id}/anvil`), apiGet<TemplateBenchmarkDto>(`/templates/${id}/benchmark`)]);
  if (!t || !bp) notFound();

  const heading = (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold">{t.workflowName}</h1>
      <span className="text-fg-muted">v{t.version}</span>
      <StatusBadge status={t.status} />
      <span className="text-sm text-fg-muted">{t.domainName}</span>
      {anvil && <AnvilReadinessBadge r={anvil} />}
    </div>
  );

  if (!isAdmin) {
    return (
      <div>
        <McHeader isAdmin={false} active={{ workflowName: t.workflowName, version: t.version }} />
        {heading}
        <TutorialSettings template={t} canEdit={false} />
        <BlueprintSummary bp={bp.blueprint} templateId={t.id} />
        {benchmark && <TemplateBenchmarkPanel b={benchmark} />}
      </div>
    );
  }

  const [versions, presets, directory, jds, forms, tutorialRuns] = await Promise.all([
    mcServer.versions(id).then((r) => r.data?.items ?? []),
    mcServer.presets(t.domainId).then((r) => r.data?.items ?? []),
    mcServer.directory().then((r) => r.data),
    apiGet<{ items: JobDescriptionDto[] }>('/job-descriptions').then((r) => r.data?.items ?? []),
    apiGet<{ items: FormOption[] }>(`/template-profiles?workflow=${encodeURIComponent(t.workflowName)}`).then((r) => r.data?.items),
    apiGet<TutorialRunsResponse>(`/templates/${id}/tutorial/runs`).then((r) => r.data),
  ]);
  const switcher = (directory?.domains ?? []).flatMap((d) => d.rows.map((r) => ({ id: r.templateId, label: `${d.domainName} // ${r.workflowName} (v${r.version})` })));
  if (!switcher.some((o) => o.id === t.id)) switcher.unshift({ id: t.id, label: `${t.domainName} // ${t.workflowName} (v${t.version})` });
  const draft = versions.find((v) => v.status === 'DRAFT' && v.id !== t.id);

  return (
    <div>
      <McHeader isAdmin active={{ workflowName: t.workflowName, version: t.version }} />
      {heading}
      {/* keyed on updatedAt so stale action errors clear after a save */}
      <TemplateActions key={t.updatedAt} template={t} hasDraft={versions.some((v) => v.status === 'DRAFT')} forms={forms} />
      {versions.length > 1 && (
        <nav aria-label="Version history" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Versions:</span>
          {versions.map((v) =>
            v.id === t.id ? (
              <span key={v.id} aria-current="page" className="font-semibold">
                v{v.version}
              </span>
            ) : (
              <Link key={v.id} href={`/templates/${v.id}`} className="text-link hover:underline">
                v{v.version}
              </Link>
            ),
          )}
        </nav>
      )}
      <TutorialSettings key={`tutorial:${t.updatedAt}`} template={t} canEdit />
      {tutorialRuns && <TutorialVideoPanel templateId={t.id} initial={tutorialRuns} />}
      {benchmark && <TemplateBenchmarkPanel b={benchmark} />}
      <div className="mt-4">
        <MetaCompiler
          key={`${t.id}:${bp.blueprintRevision}`}
          initial={bp}
          template={{ id: t.id, workflowName: t.workflowName, domainName: t.domainName, version: t.version, status: t.status }}
          switcher={switcher}
          presets={presets}
          jobDescriptions={jds.map((j) => ({ id: j.id, title: j.title }))}
          factoryId={factoryOf(t, versions, bp.variantOfId)}
          draftId={draft?.id ?? null}
          anvil={anvil?.definition ?? null}
        />
      </div>
    </div>
  );
}
