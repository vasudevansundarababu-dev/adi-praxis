import type { TemplateStatus } from '@praxis/shared';

const STYLES: Record<TemplateStatus, string> = {
  DRAFT: 'border-line text-fg-muted',
  PUBLISHED: 'border-brand-teal text-fg',
  RETIRED: 'border-line text-fg-muted line-through',
};
const LABELS: Record<TemplateStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' };

export function StatusBadge({ status }: { status: TemplateStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${STYLES[status]}`}>{LABELS[status]}</span>;
}
