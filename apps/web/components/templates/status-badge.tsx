import type { TemplateStatus } from '@praxis/shared';

const STYLES: Record<TemplateStatus, string> = { DRAFT: '', PUBLISHED: 'pill-success', RETIRED: 'line-through' };
const LABELS: Record<TemplateStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' };

export function StatusBadge({ status }: { status: TemplateStatus }) {
  return <span className={`pill ${STYLES[status]}`}>{LABELS[status]}</span>;
}
