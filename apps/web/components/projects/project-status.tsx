import type { ProjectStatus } from '@praxis/shared';

const LABELS: Record<ProjectStatus, string> = {
  DRAFT: 'Draft',
  READY_FOR_STAFFING: 'Ready for staffing',
  STAFFING: 'Staffing',
  STAFFED: 'Staffed',
  IN_PROGRESS: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const projectStatusLabel = (s: ProjectStatus) => LABELS[s];

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const tone: Record<ProjectStatus, string> = { DRAFT: '', READY_FOR_STAFFING: 'pill-info', STAFFING: 'pill-warning', STAFFED: 'pill-brand', IN_PROGRESS: 'pill-info', PAUSED: 'pill-warning', COMPLETED: 'pill-success', CANCELLED: '' };
  return <span className={`pill ${tone[status]}`}>{LABELS[status]}</span>;
}
