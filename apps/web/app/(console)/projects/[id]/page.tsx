import type { DemographicAttributeDto, JobDescriptionDto, ProjectDto, TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectSummary } from '@/components/projects/summary';
import { ProjectWizard } from '@/components/projects/wizard';
import { apiGet } from '@/lib/api';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { data } = await apiGet<ProjectDto>(`/projects/${(await params).id}`);
  return { title: data?.name ?? 'Project' };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();

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
    return <ProjectSummary project={project} template={own.data} attributes={attributes} jobDescriptions={jobDescriptions} reviewers={reviewers} />;
  }
  // A draft may reference a template that is no longer offered; keep it selectable so the PM sees why submit fails.
  const templates = t.data?.items ?? [];
  if (own.data && !templates.some((x) => x.id === own.data!.id)) templates.push(own.data);
  return <ProjectWizard templates={templates} attributes={attributes} jobDescriptions={jobDescriptions} project={project} />;
}
