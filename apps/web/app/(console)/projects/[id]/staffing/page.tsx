import type { MatchesResponse, ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StaffingBoard } from '@/components/staffing/staffing-board';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Resource assignment' };

const STAFFING_STATUSES = ['READY_FOR_STAFFING', 'STAFFING', 'STAFFED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'];

export default async function StaffingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project || !STAFFING_STATUSES.includes(project.status)) notFound();
  const { data: matches } = await apiGet<MatchesResponse & { warnings: string[] }>(`/projects/${id}/matches`);
  return <StaffingBoard projectId={id} initial={matches!} />;
}
