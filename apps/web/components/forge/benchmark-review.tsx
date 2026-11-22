'use client';

import { BENCHMARK_DECISION_LABEL, BENCHMARK_DECISIONS, NEEDS_CRITERION, type BatchDetailDto, type BatchSummaryDto, type BenchmarkDecision, type DecisionDto } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

const Mono = ({ children }: { children: string }) => <code className="font-mono text-xs break-all">{children}</code>;
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** The project's Benchmark review tab: every batch RL Gym sent, with how many items are decided and sent back. */
export function BenchmarkBatchList({ projectId, items, connected }: { projectId: string; items: BatchSummaryDto[]; connected: boolean }) {
  return (
    <section aria-label="Benchmark review">
      <p className="mb-4 max-w-3xl text-sm text-fg-muted">
        RL Gym sends scored runs of this project&apos;s tasks here for review. The project&apos;s Reviewers and its PM decide each item; a decision is final and goes back to RL Gym. &quot;Task needs correction&quot; sends the task
        back to its author as a normal Rework.
      </p>
      {!connected && (
        <p className="card mb-4 p-4 text-sm" data-rlgym-not-connected>
          RL Gym isn’t connected yet, so no review batches can arrive and decisions can’t be sent.
        </p>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Batch</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Run</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Received</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Decided</th>
              <th className="px-4 py-2.5 text-xs font-semibold text-fg-muted">Not sent yet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {items.map((b) => (
              <tr key={b.id} data-batch={b.batchId}>
                <td className="px-4 py-3">
                  <Link href={`/projects/${projectId}/benchmark-reviews/${b.id}`} className="font-semibold text-link hover:underline">
                    {b.batchId}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Mono>{b.runId}</Mono>
                </td>
                <td className="px-4 py-3 font-mono text-xs tabular-nums">{when(b.receivedAt)}</td>
                <td className="px-4 py-3 tabular-nums">
                  {b.decided} of {b.items}
                </td>
                <td className="px-4 py-3 tabular-nums">{b.undelivered}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-fg-muted">
                  No review batches yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One item's decision: the form while undecided, then the final decision with its delivery to RL Gym. */
function DecisionBox({ projectId, reviewId, itemId, criteria, initial, connected }: { projectId: string; reviewId: string; itemId: string; criteria: string[]; initial: DecisionDto | null; connected: boolean }) {
  const [decision, setDecision] = useState<DecisionDto | null>(initial);
  const [choice, setChoice] = useState<BenchmarkDecision | ''>('');
  const [rationale, setRationale] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCriterion = choice !== '' && NEEDS_CRITERION.has(choice);

  async function sendToRlGym(id: string) {
    const res = await mutate<DecisionDto>('POST', `/projects/${projectId}/benchmark-reviews/${reviewId}/decisions/${id}/send`, {});
    if (!res.ok) return setError(res.error);
    setDecision(res.data!);
  }

  if (decision) {
    const d = decision.delivery;
    return (
      <div className="mt-3 rounded-md border border-line p-3 text-sm" data-decided={decision.decision}>
        <p>
          <span className="pill pill-info">{BENCHMARK_DECISION_LABEL[decision.decision]}</span>
          {decision.criterionId && (
            <>
              {' '}
              criterion <Mono>{decision.criterionId}</Mono>
            </>
          )}{' '}
          · {decision.decidedBy} · {when(decision.decidedAt)}
        </p>
        <p className="mt-1">{decision.rationale}</p>
        <p className="mt-2 text-fg-muted" data-delivery={d?.outcome ?? 'none'}>
          {d?.outcome === 'delivered' ? 'Sent to RL Gym' : d ? `Not sent: ${d.error?.code ?? d.outcome} ${d.error?.message ?? ''}` : 'Not sent to RL Gym yet.'}
          {d?.requestId && (
            <>
              {' '}
              · request <Mono>{d.requestId}</Mono>
            </>
          )}
        </p>
        {d?.outcome !== 'delivered' && (
          <button
            type="button"
            className="btn btn-secondary mt-2 disabled:opacity-60"
            disabled={pending || !connected}
            onClick={async () => {
              setPending(true);
              setError(null);
              await sendToRlGym(decision.id);
              setPending(false);
            }}
          >
            {d ? 'Send again' : 'Send to RL Gym'}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-3 rounded-md border border-line p-3 text-sm"
      data-decision-form={itemId}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!choice) return;
        setPending(true);
        setError(null);
        const res = await mutate<DecisionDto>('POST', `/projects/${projectId}/benchmark-reviews/${reviewId}/decisions`, { itemId, decision: choice, rationale, ...(needsCriterion ? { criterionId } : {}) });
        if (!res.ok) {
          setPending(false);
          return setError(res.error);
        }
        setDecision(res.data!);
        if (connected) await sendToRlGym(res.data!.id);
        setPending(false);
      }}
    >
      <fieldset>
        <legend className="font-medium">Your decision (final)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {BENCHMARK_DECISIONS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="radio" name={`decision-${itemId}`} value={k} checked={choice === k} onChange={() => setChoice(k)} />
              {BENCHMARK_DECISION_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      {needsCriterion && (
        <label className="mt-2 block">
          <span className="block font-medium">Criterion</span>
          <select className="mt-1 rounded-md border border-line bg-surface px-2 py-1" value={criterionId} onChange={(e) => setCriterionId(e.target.value)} required>
            <option value="">Choose the criterion…</option>
            {criteria.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="mt-2 block">
        <span className="block font-medium">Why</span>
        <textarea className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} required />
      </label>
      <button type="submit" className="btn btn-primary mt-2 disabled:opacity-60" disabled={pending || !choice || !rationale.trim() || (needsCriterion && !criterionId)}>
        Decide
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </form>
  );
}

/** One scored episode: rubric verdicts, the agent's path and steps, its output and evidence, RL Gym's hint, the decision. */
function Episode({ projectId, reviewId, e, criteria, decision, connected }: { projectId: string; reviewId: string; e: Obj; criteria: string[]; decision: DecisionDto | null; connected: boolean }) {
  const system = (e.system ?? {}) as Obj;
  const path = (e.path ?? {}) as Obj;
  const evidence = (e.evidence ?? {}) as Obj;
  const rows = (Array.isArray(e.criteria) ? e.criteria : []) as Obj[];
  const steps = (Array.isArray(e.timeline) ? e.timeline : []) as Obj[];
  const itemId = str(e.item_id);
  return (
    <article className="card mt-3 p-4" data-item={itemId}>
      <h4 className="font-semibold">
        {str(system.name) || str(system.id) || 'System'} · attempt {str(e.attempt) || '1'} · case <Mono>{str(e.case_id)}</Mono> · score {str(e.score)}
      </h4>
      <table className="mt-2 w-full text-left text-sm" aria-label="Rubric verdicts">
        <thead>
          <tr className="text-xs text-fg-muted">
            <th className="py-1 pr-3">Criterion</th>
            <th className="py-1 pr-3">Verdict</th>
            <th className="py-1 pr-3">Points</th>
            <th className="py-1">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i} className="border-t border-hairline">
              <td className="py-1 pr-3">
                <Mono>{str(c.criterion_id)}</Mono>
              </td>
              <td className="py-1 pr-3">{str(c.verdict)}</td>
              <td className="py-1 pr-3 tabular-nums">{str(c.points)}</td>
              <td className="py-1">{str(c.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm">
        <span className="font-medium">Path:</span> {(Array.isArray(path.order) ? path.order : []).map(str).join(' → ') || '—'}
        {str(path.failed_node) && (
          <>
            {' '}
            · failed at <Mono>{str(path.failed_node)}</Mono>: {str(path.failed_why)}
          </>
        )}
      </p>
      {str(path.summary) && <p className="text-sm text-fg-muted">{str(path.summary)}</p>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">Steps ({steps.length}) and final output</summary>
        <ol className="mt-1 list-decimal pl-5">
          {steps.map((s, i) => (
            <li key={i}>
              <Mono>{str(s.tool)}</Mono> · {str(s.status)} {str(s.node) && <>· node {str(s.node)}</>}
            </li>
          ))}
        </ol>
        <pre className="mt-2 overflow-x-auto rounded-md bg-line/40 p-2 text-xs">{JSON.stringify(e.final_output ?? null, null, 2)}</pre>
      </details>
      <p className="mt-2 text-xs text-fg-muted">
        Evidence: sealed <Mono>{str(evidence.sealed_sha256)}</Mono> · manifest <Mono>{str(evidence.manifest_sha256)}</Mono>
      </p>
      {str(e.suspected_cause) && (
        <p className="mt-2 text-sm" data-hint>
          <span className="pill">RL Gym&apos;s hint</span> {str(e.suspected_cause)}
          {str(e.suspected_cause_source) && <span className="text-fg-muted"> ({str(e.suspected_cause_source)})</span>} — a hint only; you decide.
        </p>
      )}
      <DecisionBox projectId={projectId} reviewId={reviewId} itemId={itemId} criteria={criteria} initial={decision} connected={connected} />
    </article>
  );
}

/** A review batch: its rubric, then each task's episodes with a decision per item. */
export function BenchmarkReviewer({ projectId, batch }: { projectId: string; batch: BatchDetailDto }) {
  const criteria = batch.rubric.map((r) => str(r.criterion_id)).filter(Boolean);
  const byItem = new Map(batch.decisions.map((d) => [d.itemId, d]));
  return (
    <section aria-label="Benchmark review batch">
      <p className="text-sm text-fg-muted">
        Run <Mono>{batch.runId}</Mono> · received {when(batch.receivedAt)} · {batch.decided} of {batch.items} decided
        {batch.scoringPass && <> · scoring pass {str(batch.scoringPass.pass)}</>}
      </p>
      {batch.note && <p className="mt-1 text-sm">{batch.note}</p>}
      {!batch.connected && <p className="mt-2 text-sm">RL Gym isn’t connected yet: decisions are kept here and can be sent once it is.</p>}
      <h3 className="mt-4 font-semibold">Rubric</h3>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {batch.rubric.map((r, i) => (
          <li key={i}>
            <Mono>{str(r.criterion_id)}</Mono> · weight {str(r.weight)}
            {r.is_gate === true && ' · gate'}
            {str(r.skill_group) && ` · ${str(r.skill_group)}`}
          </li>
        ))}
      </ul>
      {batch.tasks.map((t) => (
        <div key={t.taskId} className="mt-6" data-review-task={t.taskId}>
          <h3 className="font-semibold">
            {t.title ?? <Mono>{t.taskId}</Mono>} <span className="text-sm font-normal text-fg-muted">revision {t.revision}</span>
          </h3>
          {t.episodes.map((e) => (
            <Episode key={str(e.item_id)} projectId={projectId} reviewId={batch.id} e={e} criteria={criteria} decision={byItem.get(str(e.item_id)) ?? null} connected={batch.connected} />
          ))}
        </div>
      ))}
    </section>
  );
}
