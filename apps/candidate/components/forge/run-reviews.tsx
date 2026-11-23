'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';
import { canDecide, decideHint, DECISION_LABEL, pathText, scoreText, type AssignedReview } from '@/lib/run-review';

/**
 * D-004 (owner, 23 Nov 2026): RL Gym run results a PM or Admin asked this SME to verify (as the task's author or an SME
 * Reviewer on the project). Each episode gets a final decision with a rationale; the RL Gym's hint is never a decision.
 */
export function RunReviews({ reviews }: { reviews: AssignedReview[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { decision: string; rationale: string; criterionId: string }>>({});
  async function decide(ref: string, itemId: string) {
    const d = draft[itemId];
    if (!d) return;
    setError(null);
    const res = await call('POST', `/me/run-reviews/${ref}/decisions`, { decisions: [{ itemId, decision: d.decision, rationale: d.rationale, ...(d.criterionId ? { criterionId: d.criterionId } : {}) }] });
    if (!res.ok) return setError(res.error ?? 'The decision was not sent. Try again.');
    router.refresh();
  }
  if (!reviews.length) return <p className="card p-5 text-sm text-fg-muted">No run reviews are assigned to you right now.</p>;
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {reviews.map((b) => (
        <section key={b.ref} aria-labelledby={`rr-${b.ref}`} className="card p-4">
          <h2 id={`rr-${b.ref}`} className="font-semibold">
            {b.projectName} · batch <span className="font-mono">{b.batchId}</span>
            {b.runId && <> · run {b.runId}</>}
          </h2>
          <p className="text-xs text-fg-muted">Received {new Date(b.receivedAt).toLocaleString()}</p>
          <ul className="mt-3 space-y-3 text-sm">
            {b.items.map((i) => {
              const e = i.episode;
              const d = draft[i.itemId] ?? { decision: 'agent_failure', rationale: '', criterionId: '' };
              const set = (patch: Partial<typeof d>) => setDraft({ ...draft, [i.itemId]: { ...d, ...patch } });
              const path = pathText((e.path ?? {}) as { summary?: string; failed_node?: string; failed_why?: string });
              const hint = `hint-${i.itemId}`;
              return (
                <li key={i.itemId} className="rounded-md border border-line p-3">
                  <p>
                    <span className="font-mono text-xs">{i.itemId}</span> · task {i.taskId.slice(0, 8)} r{i.revision} · {scoreText(e.score)}
                  </p>
                  {path && <p className="text-fg-muted">Path: {path}</p>}
                  {typeof e.suspected_cause === 'string' && <p className="text-fg-muted">RL Gym’s hint (not a decision): {e.suspected_cause}</p>}
                  {i.decision ? (
                    <p className="mt-1">
                      Decided: {DECISION_LABEL[i.decision.decision] ?? i.decision.decision} by {i.decision.decidedBy} · {i.decision.rationale}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="flex flex-col">
                        <span className="text-xs text-fg-muted">Decision</span>
                        <select className="input" value={d.decision} onChange={(ev) => set({ decision: ev.target.value })}>
                          {Object.entries(DECISION_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(d.decision === 'grader_wrong' || d.decision === 'rubric_correction') && (
                        <label className="flex flex-col">
                          <span className="text-xs text-fg-muted">Criterion</span>
                          <input className="input" value={d.criterionId} onChange={(ev) => set({ criterionId: ev.target.value })} />
                        </label>
                      )}
                      <label className="flex flex-1 flex-col">
                        <span className="text-xs text-fg-muted">Rationale</span>
                        <input className="input" value={d.rationale} onChange={(ev) => set({ rationale: ev.target.value })} />
                      </label>
                      <button type="button" className="btn btn-primary" aria-describedby={hint} disabled={!canDecide(d)} onClick={() => decide(b.ref, i.itemId)}>
                        Decide
                      </button>
                      <span id={hint} className="basis-full text-xs text-fg-muted">
                        {decideHint(d)}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
