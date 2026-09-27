import type { ProjectFigures, TaskMode } from '@praxis/shared';

const fmt = (n: number | null, digits = 0) => (n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits }));

/** Live computed fields (SPEC FLOW 1). Uses the same function the API freezes on submit. */
export function FiguresPanel({
  figures: f,
  taskMode,
  currency,
  requiredSlots,
}: {
  figures: ProjectFigures;
  taskMode: TaskMode;
  currency: string | null;
  requiredSlots: number | null;
}) {
  const rows: [string, string][] = [
    [taskMode === 'AUTHORING' ? 'Distinct tasks' : 'Tasks', fmt(f.tasks)],
    ...(taskMode === 'AUTHORING' ? ([['Required authors', fmt(f.requiredAuthors)]] as [string, string][]) : []),
    ...(taskMode === 'AUTHORING' && requiredSlots ? ([['Required coverage slots', fmt(requiredSlots)]] as [string, string][]) : []),
    ['Total effort', f.totalEffortHours === null ? '—' : `${fmt(f.totalEffortHours, 1)} h`],
    ['Working days', fmt(f.workingDays)],
    ['Required workers', fmt(f.requiredWorkers)],
    ['Labour budget', f.labourBudget === null ? '—' : `${fmt(f.labourBudget, 2)} ${currency ?? ''}`.trim()],
  ];
  return (
    <aside aria-label="Computed figures" className="h-fit rounded-lg border border-line bg-surface p-4 lg:sticky lg:top-4">
      <h2 className="font-semibold">Estimates</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {f.warnings.map((w) => (
        <p key={w} role="status" className="mt-3 text-sm text-warning">
          {w}
        </p>
      ))}
      <p className="mt-3 text-xs text-fg-muted">Working days count Monday to Friday. Budget = tasks × wage per task.</p>
    </aside>
  );
}
