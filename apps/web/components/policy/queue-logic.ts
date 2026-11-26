/**
 * D-092 (owner, 26 Nov 2026): the review queue as a table a PM can work through. Pure helpers (tested): the filters
 * (document, next action, jurisdiction, status, text), their options with counts, the rules ready to confirm within the
 * current filter, and the rule-page link that opens the field for the next action.
 */
export interface QueueNextAction {
  code: string;
  label: string;
  focus: string | null;
}
export interface QueueTableRow {
  ruleId: string;
  ruleKey: string;
  title: string;
  state: string;
  contentHash: string;
  jurisdiction: string | null;
  documents: { id: string; title: string }[];
  nextAction: QueueNextAction;
  flags: { code: string; message: string }[];
  /** Facts the rule's condition names (the fact filter; the Policy page's fact list links here). */
  facts: string[];
}
export interface QueueFilters {
  documentId: string;
  action: string;
  jurisdiction: string;
  status: string;
  /** A fact id: rules whose condition names it. */
  fact: string;
  q: string;
}
export const NO_FILTERS: QueueFilters = { documentId: '', action: '', jurisdiction: '', status: '', fact: '', q: '' };
/** The jurisdiction filter's value for rows with none. */
export const NO_JURISDICTION = '__none__';

export const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', NEEDS_DEFINITION: 'Needs definition' };

export function filterQueue<T extends QueueTableRow>(rows: readonly T[], f: QueueFilters): T[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.documentId || r.documents.some((d) => d.id === f.documentId)) &&
      (!f.action || r.nextAction.code === f.action) &&
      (!f.jurisdiction || (f.jurisdiction === NO_JURISDICTION ? !r.jurisdiction : r.jurisdiction === f.jurisdiction)) &&
      (!f.status || r.state === f.status) &&
      (!f.fact || r.facts.includes(f.fact)) &&
      (!q || r.ruleKey.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)),
  );
}

/** Options for a filter, with how many rows each has, in first-seen order (next actions keep the queue's fixed order). */
export function filterOptions(rows: readonly QueueTableRow[]) {
  const count = <K extends string>(pairs: [K, string][]) => {
    const m = new Map<K, { value: K; label: string; count: number }>();
    for (const [value, label] of pairs) m.set(value, { value, label, count: (m.get(value)?.count ?? 0) + 1 });
    return [...m.values()];
  };
  return {
    documents: count(rows.flatMap((r) => r.documents.map((d) => [d.id, d.title] as [string, string]))).sort((a, b) => a.label.localeCompare(b.label)),
    actions: count(rows.map((r) => [r.nextAction.code, r.nextAction.label] as [string, string])),
    jurisdictions: count(rows.map((r) => [r.jurisdiction ?? NO_JURISDICTION, r.jurisdiction ?? 'None set'] as [string, string])).sort((a, b) => a.label.localeCompare(b.label)),
    statuses: count(rows.map((r) => [r.state, STATUS_LABEL[r.state] ?? r.state] as [string, string])),
  };
}

/** The rows "Confirm all ready" sends: unflagged rows within the current filter. The server checks each one again. */
export const readyRows = <T extends QueueTableRow>(rows: readonly T[]) => rows.filter((r) => r.flags.length === 0 && r.nextAction.code === 'ready');

/** The rule page, opened at the field for the row's next action. */
export const ruleHref = (projectId: string, r: Pick<QueueTableRow, 'ruleId' | 'nextAction'>) => `/projects/${projectId}/policy/rules/${r.ruleId}${r.nextAction.focus ? `?focus=${encodeURIComponent(r.nextAction.focus)}` : ''}`;
