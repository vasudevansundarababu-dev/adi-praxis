'use client';

import { useEffect, useState } from 'react';
import { mcBrowser, type JudgeView } from '@/lib/mc/browser';

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * LLM judge result (owner decision, 7 Nov 2026): the official per-task score, with points per milestone and the
 * judge's evidence per criterion. Admin only; the API refuses everyone else and SMEs never see it.
 */
export function JudgeResultView({ judge }: { judge: JudgeView | null }) {
  if (!judge) return <p className="text-sm text-fg-muted">No judge result yet. It appears after per-task verification when the template has judged milestones.</p>;
  return (
    <section aria-label="Judge result" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          Judge score <strong className="text-base">{judge.score === null ? '—' : judge.score.toFixed(2)}</strong>
        </span>
        <span className={`pill ${judge.status === 'MEASURED' ? 'pill-success' : 'pill-warning'}`}>{judge.status === 'MEASURED' ? 'Measured' : 'Not measured'}</span>
        <span className="text-fg-muted">
          Model <span className="font-mono">{judge.model}</span>
        </span>
        <span className="text-fg-muted">Cost ${judge.costUsd.toFixed(4)}</span>
      </div>
      {judge.error && (
        <p role="alert" className="text-sm text-error">
          {judge.error}
        </p>
      )}
      {judge.milestones.map((m) => (
        <div key={m.milestoneId} className="card overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="px-3 py-2 text-left text-sm font-medium">
              {m.milestoneId} · {pts(m.pointsEarned)} of {pts(m.pointsPossible)} points · weight {m.weight}
              {m.truncated && <span className="ml-2 text-warning">(deliverable truncated to 60,000 characters)</span>}
            </caption>
            <thead className="bg-surface">
              <tr>
                {['#', 'Criterion', 'Awarded', 'Evidence'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.criteria.map((c) => (
                <tr key={c.num} className="border-t border-line align-top">
                  <td className="px-3 py-1">{c.num}</td>
                  <td className="px-3 py-1">
                    {c.category && <span className="text-fg-muted">{c.category}: </span>}
                    {c.text || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1">
                    {pts(c.awarded)} of {pts(c.points)}
                  </td>
                  <td className="px-3 py-1">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

/** Loads and shows the judge result for one studio task (task store Inspect view). */
export function JudgePanel({ taskId }: { taskId: string }) {
  const [state, setState] = useState<{ judge: JudgeView | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    void mcBrowser.studioTaskJudge(taskId).then((r) => live && setState({ judge: r.data?.judge ?? null, error: r.error }));
    return () => {
      live = false;
    };
  }, [taskId]);
  if (!state) return <p className="text-sm text-fg-muted">Loading the judge result…</p>;
  if (state.error) return <p role="alert" className="text-sm text-error">{state.error}</p>;
  return <JudgeResultView judge={state.judge} />;
}
