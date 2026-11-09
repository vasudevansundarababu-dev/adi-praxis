import type { DemographicAttributeDto, JobDescriptionDto, TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { ProjectWizard } from '@/components/projects/wizard';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'New project' };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ templateId?: string }> }) {
  const { templateId } = await searchParams;
  const user = (await getCurrentUser())!;
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'PM')) return <NoAccess need="Admins" />;
  const [t, a, j] = await Promise.all([
    apiGet<{ items: TemplateDto[] }>('/templates?view=offerable'),
    apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes'),
    apiGet<{ items: JobDescriptionDto[] }>('/job-descriptions'),
  ]);
  return (
    // "Create project" on the Templates directory pre-selects its template (S1-15).
    <ProjectWizard templates={preselect(t.data?.items ?? [], templateId)} attributes={a.data?.items ?? []} jobDescriptions={j.data?.items ?? []} project={null} />
  );
}

function preselect(templates: TemplateDto[], id: string | undefined): TemplateDto[] {
  const chosen = templates.find((t) => t.id === id);
  return chosen ? [chosen, ...templates.filter((t) => t !== chosen)] : templates;
}
