import type { DirectoryRowDto, ExecutionMode, TemplateDirectoryResponse } from '@praxis/shared';

export const MODE_LABELS: Record<ExecutionMode, string> = {
  HERMETIC_MCP: 'Hermetic MCP',
  HERMETIC_GRAPH: 'Hermetic Graph',
  HERMETIC_SQL: 'Hermetic SQL',
};

type DirectoryStatus = DirectoryRowDto['status'];
export const STATUS_PILLS: Record<DirectoryStatus, { label: string; tone: string }> = {
  ACTIVE: { label: 'Active', tone: 'pill-success' },
  VERIFIED: { label: 'Verified', tone: 'pill-brand' },
  GENERATING: { label: 'Generating', tone: 'pill-warning' },
  PUBLISHED: { label: 'Published', tone: 'pill-info' },
  DRAFT: { label: 'Draft', tone: '' },
  RETIRED: { label: 'Retired', tone: 'line-through' },
};

export const versionLabel = (v: number) => `v${v}`;

/**
 * S1-08: "45m (12 Wks)"; minutes alone when there is no horizon label; "—" when unknown. Seeded blueprints store the
 * full "45m (12 Wks)" in tpt_label, so that wrapper is removed first, as the API's tptLabel() does (DEF-1).
 */
export function tptText(minutes: number | null, label: string): string {
  if (minutes === null) return '—';
  const horizon = label.trim().replace(/^\d+\s*m\s*\((.*)\)$/, '$1').trim();
  return horizon ? `${minutes}m (${horizon})` : `${minutes}m`;
}

export const modesText = (modes: ExecutionMode[]) => (modes.length ? modes.map((m) => MODE_LABELS[m]).join(', ') : '—');

/** S1-02: the domain filter kept in `?domain=`; an unknown id falls back to All. */
export function filterDomains(data: TemplateDirectoryResponse, domainId: string | undefined) {
  const selected = data.domains.find((d) => d.domainId === domainId) ? domainId! : null;
  return { selected, domains: selected ? data.domains.filter((d) => d.domainId === selected) : data.domains };
}

export const directoryHref = (domainId: string | null) => (domainId ? `/templates?domain=${encodeURIComponent(domainId)}` : '/templates');
