import type { CampaignDto, MatchesResponse, ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CampaignPanel } from '@/components/staffing/campaign-panel';
import { StaffingBoard } from '@/components/staffing/staffing-board';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Resource assignment' };

const STAFFING_STATUSES = ['READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'];

export default async function StaffingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project || !STAFFING_STATUSES.includes(project.status)) notFound();
  const [{ data: matches }, { data: campaigns }, { data: opportunity }] = await Promise.all([
    apiGet<MatchesResponse & { warnings: string[] }>(`/projects/${id}/matches`),
    apiGet<{ items: CampaignDto[] }>(`/projects/${id}/campaigns`),
    apiGet<{ status: string }>(`/projects/${id}/opportunity`),
  ]);
  return (
    <>
      <StaffingBoard projectId={id} initial={matches!} />
      <CampaignPanel
        projectId={id}
        initial={campaigns?.items ?? []}
        opportunityPublished={opportunity?.status === 'PUBLISHED'}
        staffing={project.status === 'STAFFING' || project.status === 'READY_FOR_STAFFING'}
      />
    </>
  );
}
