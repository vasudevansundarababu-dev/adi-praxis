import type { EdgeCase } from '../benchmark';
import { ChecksPanel, type ChecksView } from './benchmark-checks';

/** Review → Decision: the task's checks, read-only (AUTHORING-SPEC 2.3), with the SME's values beside their blocks. */
export interface TaskChecksDto {
  checks: ChecksView | null;
  edgeCase: EdgeCase | null;
  complexity: string | null;
  archetype: string | null;
  slots: Record<string, string | number>;
  extraStateChecks: { table: string; row: string; column: string; op: string; value: unknown }[];
}

export function TaskChecks({ data }: { data: TaskChecksDto }) {
  if (!data.checks && !data.edgeCase && !data.complexity && !data.archetype) return null;
  return (
    <section aria-labelledby="task-checks" className="mb-6 rounded-lg border border-line p-4">
      <h2 id="task-checks" className="text-lg font-semibold">
        Checks
      </h2>
      <p className="text-sm">
        Complexity {data.complexity ?? '—'} · Archetype {data.edgeCase?.archetype ?? data.archetype ?? '—'}
        {data.edgeCase && (
          <>
            {' '}
            · Focus on edge case <span className="font-mono">{data.edgeCase.tag}</span>
          </>
        )}
      </p>
      {Object.keys(data.slots).length > 0 && (
        <p className="mt-1 text-sm">
          Expected results:{' '}
          {Object.entries(data.slots)
            .map(([k, v]) => `${k} = ${String(v)}`)
            .join(' · ')}
        </p>
      )}
      <div className="mt-3">
        <ChecksPanel checks={data.checks} values={data.slots} extraStateChecks={data.extraStateChecks} />
      </div>
    </section>
  );
}
