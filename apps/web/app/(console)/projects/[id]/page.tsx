import type { DemographicAttributeDto, JobDescriptionDto, ProjectDto, TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForgeProjectPage } from '@/components/forge/project-page';
import type { ExportState } from '@/components/projects/export-panel';
import { ProjectSummary } from '@/components/projects/summary';
import { ProjectWizard } from '@/components/projects/wizard';
import { apiGet, getCurrentUser, newFlowOn } from '@/lib/api';
import { projectTab } from '@/lib/forge-console';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await apiGet<ProjectDto>(`/projects/${(await params).id}`);
  return { title: data?.name ?? 'Project' };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  // MVP1 (owner, 15 Nov): with the new flow on, a submitted project opens on the four-tab page.
  if (project.status !== 'DRAFT' && (await newFlowOn())) {
    const sp = await searchParams;
    return <ForgeProjectPage project={project} tab={projectTab(sp.tab)} searchParams={sp} />;
  }

  const [t, a, j, own] = await Promise.all([
    apiGet<{ items: TemplateDto[] }>('/templates?view=offerable'),
    apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes'),
    apiGet<{ items: JobDescriptionDto[] }>('/job-descriptions'),
    apiGet<TemplateDto>(`/templates/${project.templateId}`),
  ]);
  const attributes = a.data?.items ?? [];
  const jobDescriptions = j.data?.items ?? [];

  if (project.status !== 'DRAFT') {
    const { data: reviewers } = await apiGet<{ items: { userId: string; name: string; email: string }[]; available: { userId: string; name: string; email: string }[] }>(`/projects/${id}/reviewers`);
    const { data: exportState } = await apiGet<ExportState>(`/projects/${id}/export`);
    return <ProjectSummary project={project} template={own.data} attributes={attributes} jobDescriptions={jobDescriptions} reviewers={(await getCurrentUser())?.roles.includes('ADMIN') ? null : reviewers} exportState={exportState ?? null} />;
  }
  // A draft may reference a template that is no longer offered; keep it selectable so the PM sees why submit fails.
  const templates = t.data?.items ?? [];
  if (own.data && !templates.some((x) => x.id === own.data!.id)) templates.push(own.data);
  return <ProjectWizard templates={templates} attributes={attributes} jobDescriptions={jobDescriptions} project={project} />;
}
