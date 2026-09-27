'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

type Step = { index: number; action: string; tool?: string; input?: unknown; output?: unknown; thought?: string };
type Source = { id: string; workflow: string; input: unknown; output: Record<string, unknown>; coverageTags: unknown; contentHash: string };
export interface RlReviewData {
  id: string;
  status: string;
  revision: number;
  claimedByMe: boolean;
  claimedBy: string | null;
  request: { rlRunId: string; rlTaskId: string; priority: number; dueBy: string | null; rubricId: string | null };
  rubric: { id: string | null; text: string | null };
  sources: Source[];
  evalResults: { metric: string; score?: number; passed: boolean; details?: string }[];
  trajectory: Step[] | null;
  trajectoryUrl: string | null;
  reasonCodes: { code: string; label: string }[];
  result: null | { verdict: string; comments: { text: string; trajectoryStep?: number; reasonCode?: string }[]; review_submitted_at: string; delivery: { status: string; attempts: number; deliveredAt: string | null; lastError: string | null } | null };
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** FLOW 4 review screen: original approved task, trajectory step by step, and the eval results, side by side. */
export function RlReview({ data: d }: { data: RlReviewData }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<'PASS' | 'FAIL' | 'NEEDS_EXPERT'>('PASS');
  const [metrics, setMetrics] = useState(d.evalResults.map((e) => ({ metric: e.metric, agree: true, comment: '' })));
  const [comments, setComments] = useState<{ text: string; trajectoryStep?: number; reasonCode?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editable = d.status === 'IN_PROGRESS' && d.claimedByMe;
  const missing = metrics.filter((m) => !m.agree && !m.comment.trim()).length > 0 || (verdict === 'FAIL' && comments.filter((c) => c.text.trim()).length === 0);

  async function run(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const res = await mutate('POST', path, body);
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  const pin = (step?: number) => setComments([...comments, { text: '', trajectoryStep: step }]);

  return (
    <div>
      <Link href="/review/rl" className="text-sm text-link hover:underline">← RL reviews</Link>
      <h1 className="mt-2 text-2xl font-semibold">{d.request.rlRunId} / {d.request.rlTaskId}</h1>
      <p className="text-sm text-fg-muted">Priority {d.request.priority}{d.request.dueBy ? ` · due ${new Date(d.request.dueBy).toLocaleString()}` : ''} · rubric: {d.rubric.id ?? 'template verification criteria'}</p>
      {d.rubric.text && <p className="mt-2 max-w-4xl text-sm"><span className="font-medium">Verification criteria: </span>{d.rubric.text}</p>}
      {d.status === 'CREATED' && (
        <button type="button" disabled={pending} onClick={() => run(`/review/rl/${d.id}/claim`, {})} className="mt-4 btn btn-primary disabled:opacity-60">
          Claim this review
        </button>
      )}
      {d.status === 'IN_PROGRESS' && !d.claimedByMe && <p className="mt-4 text-sm text-warning">Another reviewer is working on this.</p>}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <section aria-labelledby="src-h" className="min-w-0 card p-3 text-sm">
          <h2 id="src-h" className="font-semibold">Original approved task</h2>
          {d.sources.map((s) => (
            <details key={s.id} open className="mt-2">
              <summary className="cursor-pointer">{s.workflow} · <span className="font-mono text-xs">{s.contentHash.slice(0, 12)}</span></summary>
              <pre className="mt-1 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-line p-2 text-xs">{show({ input: s.input, output: s.output })}</pre>
            </details>
          ))}
        </section>
        <section aria-labelledby="traj-h" className="min-w-0 card p-3 text-sm">
          <h2 id="traj-h" className="font-semibold">Trajectory</h2>
          {d.trajectoryUrl && (
            <p className="mt-2">
              Large trajectory: <a href={d.trajectoryUrl} target="_blank" rel="noreferrer noopener" className="text-link underline">open the signed link</a>
            </p>
          )}
          <ol className="mt-2 space-y-2">
            {(d.trajectory ?? []).map((s) => (
              <li key={s.index} className="rounded border border-line p-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Step {s.index}</span>
                  <span>{s.action}</span>
                  {editable && (
                    <button type="button" onClick={() => pin(s.index)} className="ml-auto text-xs text-link">
                      Comment on this step
                    </button>
                  )}
                </div>
                {s.thought && <p className="mt-1 text-fg-muted">{s.thought}</p>}
                {s.tool && <p className="mt-1 text-xs">Tool: {s.tool}</p>}
                {s.input !== undefined && <pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs">in: {show(s.input)}</pre>}
                {s.output !== undefined && <pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs">out: {show(s.output)}</pre>}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="eval-h" className="min-w-0 card p-3 text-sm">
          <h2 id="eval-h" className="font-semibold">Automated evals</h2>
          <ul className="mt-2 space-y-3">
            {d.evalResults.map((e, i) => (
              <li key={e.metric}>
                <p>
                  <span className="font-medium">{e.metric}</span> · <span className={e.passed ? 'text-success' : 'text-error'}>{e.passed ? 'passed' : 'failed'}</span>
                  {e.score !== undefined ? ` · ${e.score}` : ''}
                </p>
                {e.details && <p className="text-fg-muted">{e.details}</p>}
                {editable && (
                  <fieldset className="mt-1">
                    <legend className="sr-only">Your view on {e.metric}</legend>
                    <label className="mr-3 inline-flex items-center gap-1">
                      <input type="radio" name={`m-${i}`} checked={metrics[i]!.agree} onChange={() => setMetrics(metrics.map((m, j) => (j === i ? { ...m, agree: true } : m)))} /> Agree
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input type="radio" name={`m-${i}`} checked={!metrics[i]!.agree} onChange={() => setMetrics(metrics.map((m, j) => (j === i ? { ...m, agree: false } : m)))} /> Disagree
                    </label>
                    {!metrics[i]!.agree && (
                      <label className="mt-1 block">
                        Why (required)
                        <input value={metrics[i]!.comment} onChange={(ev) => setMetrics(metrics.map((m, j) => (j === i ? { ...m, comment: ev.target.value } : m)))} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
                      </label>
                    )}
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editable && (
        <section aria-labelledby="verdict-h" className="mt-6 max-w-3xl space-y-3 card p-4 text-sm">
          <h2 id="verdict-h" className="font-semibold">Verdict</h2>
          <div className="flex gap-4">
            {(['PASS', 'FAIL', 'NEEDS_EXPERT'] as const).map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input type="radio" name="verdict" checked={verdict === v} onChange={() => setVerdict(v)} /> {v === 'NEEDS_EXPERT' ? 'Needs an expert' : v.toLowerCase()}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            {comments.map((c, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded border border-line p-2">
                <span className="text-xs">{c.trajectoryStep !== undefined ? `Step ${c.trajectoryStep}` : 'General'}</span>
                <label className="min-w-60 flex-1">
                  <span className="sr-only">Comment</span>
                  <input value={c.text} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="What went wrong, and where" className="w-full rounded-md border border-line bg-surface px-2 py-1" />
                </label>
                <label>
                  <span className="sr-only">Reason code</span>
                  <select value={c.reasonCode ?? ''} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, reasonCode: e.target.value || undefined } : x)))} className="rounded-md border border-line bg-surface px-2 py-1">
                    <option value="">No reason code</option>
                    {d.reasonCodes.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setComments(comments.filter((_, j) => j !== i))} className="text-link">Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => pin()} className="text-link">Add a general comment</button>
          </div>
          {verdict === 'FAIL' && comments.length === 0 && <p className="text-warning">A FAIL needs at least one comment.</p>}
          <button
            type="button"
            disabled={pending || missing}
            onClick={() => run(`/review/rl/${d.id}/verdict`, { expectedRevision: d.revision, verdict, metricVerdicts: metrics.map((m) => ({ metric: m.metric, agree: m.agree, ...(m.comment.trim() ? { comment: m.comment } : {}) })), comments: comments.filter((c) => c.text.trim()) })}
            className="btn btn-primary disabled:opacity-50"
          >
            Submit verdict
          </button>
          <p className="text-xs text-fg-muted">The verdict is recorded permanently (append-only) and sent to RL Gym.</p>
        </section>
      )}

      {d.result && (
        <section className="mt-6 max-w-3xl card p-4 text-sm">
          <h2 className="font-semibold">Verdict: {d.result.verdict.toLowerCase().replace('_', ' ')}</h2>
          <ul className="mt-1 list-disc pl-5">
            {d.result.comments.map((c, i) => (
              <li key={i}>{c.trajectoryStep !== undefined ? `Step ${c.trajectoryStep}: ` : ''}{c.text}{c.reasonCode ? ` (${c.reasonCode})` : ''}</li>
            ))}
          </ul>
          <p className="mt-2 text-fg-muted">
            Delivery to RL Gym: {d.result.delivery ? `${d.result.delivery.status.toLowerCase().replace('_', ' ')}${d.result.delivery.deliveredAt ? ` at ${new Date(d.result.delivery.deliveredAt).toLocaleString()}` : ''} · ${d.result.delivery.attempts} attempt(s)` : 'pending'}
            {d.result.delivery?.lastError && d.result.delivery.status !== 'DELIVERED' ? ` · last error: ${d.result.delivery.lastError}` : ''}
          </p>
        </section>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
    </div>
  );
}
