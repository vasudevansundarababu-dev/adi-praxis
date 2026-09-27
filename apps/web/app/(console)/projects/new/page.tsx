import type { DemographicAttributeDto, JobDescriptionDto, TemplateDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { ProjectWizard } from '@/components/projects/wizard';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'New project' };

export default async function NewProjectPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('PM')) return <NoAccess need="PMs" />;
  const [t, a, j] = await Promise.all([
    apiGet<{ items: TemplateDto[] }>('/templates?view=offerable'),
    apiGet<{ items: DemographicAttributeDto[] }>('/demographic-attributes'),
    apiGet<{ items: JobDescriptionDto[] }>('/job-descriptions'),
  ]);
  return (
    <ProjectWizard templates={t.data?.items ?? []} attributes={a.data?.items ?? []} jobDescriptions={j.data?.items ?? []} project={null} />
  );
}
