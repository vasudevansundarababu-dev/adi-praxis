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
  const tone = status === 'DRAFT' || status === 'CANCELLED' ? 'border-line text-fg-muted' : 'border-brand-teal text-fg';
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>{LABELS[status]}</span>;
}
