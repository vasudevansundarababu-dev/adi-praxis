'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
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
  async function decide(ref: string, item: AssignedReview['items'][number]) {
    const itemId = item.itemId;
    const d = draft[itemId];
    if (!d) return;
    setError(null);
    // E-007 phase 2: the decision names the score pass and the evidence reviewed; a stale one is refused.
    const res = await call('POST', `/me/run-reviews/${ref}/decisions`, { ...(item.scorePass ? { scorePass: item.scorePass } : {}), decisions: [{ itemId, decision: d.decision, rationale: d.rationale, ...(d.criterionId ? { criterionId: d.criterionId } : {}), ...(item.evidenceSha256 ? { evidenceSha256: item.evidenceSha256 } : {}) }] });
    if (!res.ok) return setError(res.error ?? 'The decision was not sent. Try again.');
    router.refresh();
  }
  // UI standard 3a: batches are searched and paged 10 a page; a batch off the page or outside the search is hidden, never
  // unmounted, and each batch is collapsible and open by default. Items inside a batch are never paged.
  const [q, setQ] = useState('');
  const shown = useMemo(() => reviews.filter((b) => matchesQuery([b.projectName, b.batchId, b.runId, ...b.items.map((i) => i.itemId)], q)), [reviews, q]);
  const paged = usePagedRows(shown, { param: 'batchesPage', resetKey: q });
  const visible = new Set(paged.items.map((b) => b.ref));
  if (!reviews.length) return <p className="card p-5 text-sm text-fg-muted">No run reviews are assigned to you right now.</p>;
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {reviews.length > 1 && (
        <label className="block text-sm">
          <span className="sr-only">Search run reviews</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search run reviews" className="rounded-md border border-line bg-surface px-2 py-1" />
        </label>
      )}
      {shown.length === 0 && (
        <p className="text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      )}
      {reviews.map((b) => (
        <section key={b.ref} aria-labelledby={`rr-${b.ref}`} className="card p-4" hidden={!visible.has(b.ref)}>
          <details open>
          <summary className="cursor-pointer">
          <h2 id={`rr-${b.ref}`} className="inline font-semibold">
            {b.projectName} · batch <span className="font-mono">{b.batchId}</span>
            {b.runId && <> · run {b.runId}</>}
          </h2>
          </summary>
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
                  <p className="text-xs text-fg-muted" data-bound>
                    Reviewing run {i.runId ?? '—'} · score pass {i.scorePass ?? '—'} · evidence <span className="font-mono">{i.evidenceSha256?.slice(0, 16) ?? '—'}</span>
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
                        <span className="text-xs text-fg-muted">Your verdict</span>
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
                      <button type="button" className="btn btn-primary" aria-describedby={hint} disabled={!canDecide(d)} onClick={() => decide(b.ref, i)}>
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
          </details>
        </section>
      ))}
      {shown.length > 0 && <ClientPager paged={paged} noun="batches" singular="batch" />}
    </div>
  );
}
