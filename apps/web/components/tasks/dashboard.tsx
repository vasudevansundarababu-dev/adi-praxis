'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Cell = { tags: Record<string, string>; quota: number; required: boolean; filled: number; working: number; state: 'EMPTY' | 'IN_PROGRESS' | 'FILLED' };
type Edge = { name: string; quota: number; required: boolean; filled: number; working: number; state: Cell['state'] };
export interface DashboardData {
  project: { id: string; name: string; status: string; taskMode: string; tptMinutes: number | null };
  byStatus: Record<string, number>;
  accepted: number;
  target: number;
  complete: boolean;
  tpt: { targetMinutes: number | null; averageActiveMinutes: number | null };
  reworkRate: number;
  experts: { name: string | null; accepted: number; working: number; submitted: number }[];
  updatedAt: string;
  authors?: { distinct: number; minimum: number | null; cap: number | null };
  coverage: { met: boolean; cells: Cell[]; edgeCases: Edge[]; dimensions: { key: string; label: string }[] } | null;
  slots?: Record<string, number>;
  duplicates?: { flagged: number; rejected: number };
  discoveredEdgeCases?: string[];
}

const STATE_STYLE: Record<Cell['state'], string> = { EMPTY: 'border-line text-fg-muted', IN_PROGRESS: 'border-warning', FILLED: 'border-success bg-success/15' };
const STATE_TEXT: Record<Cell['state'], string> = { EMPTY: 'empty', IN_PROGRESS: 'in progress', FILLED: 'filled' };

/** SPEC coverage dashboard: refreshed every 15 seconds so accepted work rolls up in near real time. */
export function Dashboard({ initial }: { initial: DashboardData }) {
  const [d, setD] = useState(initial);
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/v1/projects/${initial.project.id}/dashboard`, { cache: 'no-store' });
      if (res.ok) setD(await res.json());
    }, 15_000);
    return () => clearInterval(t);
  }, [initial.project.id]);
  const label = (k: string) => d.coverage?.dimensions.find((x) => x.key === k)?.label ?? k;
  const pct = d.target ? Math.min(100, Math.round((d.accepted / d.target) * 100)) : 0;
  const cards: [string, React.ReactNode][] = [
    [d.project.taskMode === 'AUTHORING' ? 'Distinct accepted' : 'Accepted', `${d.accepted} / ${d.target}`],
    ...(d.authors ? ([['Distinct authors', `${d.authors.distinct} / ${d.authors.minimum ?? '—'}`]] as [string, string][]) : []),
    ['In review', d.byStatus.SUBMITTED ?? 0],
    ['Rework rate', `${Math.round(d.reworkRate * 100)}%`],
    ['Active time vs TPT', `${d.tpt.averageActiveMinutes ?? '—'} / ${d.tpt.targetMinutes ?? '—'} min`],
  ];
  return (
    <div>
      <Link href={`/projects/${d.project.id}`} className="text-sm text-link hover:underline">
        ← {d.project.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Progress · {d.project.name}</h1>
        <span className="text-xs text-fg-muted" aria-live="polite">
          Updated {new Date(d.updatedAt).toLocaleTimeString()}
        </span>
      </div>
      {d.complete && <p role="status" className="mt-3 rounded-md border border-success p-3 text-sm">Complete: the target and all required coverage are met.</p>}
      <div className="mt-4 h-2 rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Accepted towards target">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(([k, v]) => (
          <div key={k} className="card p-3">
            <dt className="text-sm text-fg-muted">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {d.coverage && (
        <section aria-labelledby="cov-h" className="mt-8">
          <h2 id="cov-h" className="font-semibold">
            Coverage {d.coverage.met ? <span className="text-sm font-normal text-success">· required coverage met</span> : <span className="text-sm font-normal text-warning">· required coverage not yet met</span>}
          </h2>
          {d.coverage.cells.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-medium">Matrix cells</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {d.coverage.cells.map((c, i) => (
                  <li key={i} className={`rounded-md border p-2 text-sm ${STATE_STYLE[c.state]}`}>
                    {Object.entries(c.tags).map(([k, v]) => `${label(k)}: ${v}`).join(' · ')}
                    <span className="block text-xs">
                      {STATE_TEXT[c.state]} · {c.filled}/{c.quota}
                      {c.required ? ' · required' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="mt-4 text-sm font-medium">Edge cases</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {d.coverage.edgeCases.map((e) => (
              <li key={e.name} className={`rounded-full border px-3 py-1 text-sm ${STATE_STYLE[e.state]}`}>
                {e.name} <span className="text-xs">({STATE_TEXT[e.state]} {e.filled}/{e.quota}{e.required ? ', required' : ''})</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg-muted">
            Duplicates flagged {d.duplicates?.flagged ?? 0}, rejected as duplicate {d.duplicates?.rejected ?? 0}. Slots: {Object.entries(d.slots ?? {}).map(([k, v]) => `${k.toLowerCase().replace(/_/g, ' ')} ${v}`).join(', ')}.
          </p>
          {(d.discoveredEdgeCases?.length ?? 0) > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-medium">New edge cases from open slots</span> (candidates for the template catalog): {d.discoveredEdgeCases!.join(', ')}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="exp-h" className="mt-8">
        <h2 id="exp-h" className="font-semibold">Tasks per expert{d.authors?.cap ? ` (cap ${d.authors.cap})` : ''}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-fg-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Expert</th>
                <th className="px-2 py-2 font-medium">Accepted</th>
                <th className="px-2 py-2 font-medium">In review</th>
                <th className="px-2 py-2 font-medium">Working</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.experts.map((e, i) => (
                <tr key={i}>
                  <td className="px-2 py-2">{e.name ?? 'Expert'}</td>
                  <td className="px-2 py-2 tabular-nums">{e.accepted}</td>
                  <td className="px-2 py-2 tabular-nums">{e.submitted}</td>
                  <td className="px-2 py-2 tabular-nums">{e.working}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.experts.length === 0 && <p className="mt-2 text-sm text-fg-muted">No expert has tasks yet.</p>}
        </div>
      </section>
    </div>
  );
}
