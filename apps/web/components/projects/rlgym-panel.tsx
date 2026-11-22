'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * Project → Benchmark: Export for benchmark / Re-export to the RL Gym, SME needs (merge, send to Studio, reject) and
 * Benchmark review (SME review batches from the RL Gym). AUTHORING-SNAPSHOT 3.1-3.4; AUTHORING-SPEC 1.4-1.6.
 * The RL Gym's suspected cause is shown as a hint only: a person makes every decision.
 */

export interface RlGymExportState {
  connected: boolean;
  canExport: boolean;
  reason: string | null;
  rlgymTemplate: { id: string; version: number; specSha256: string } | null;
  exported: boolean;
  tasks: { recordId: string; taskId: string; title: string; revision: number | null; inRlGym: boolean; waitingFor: string | null }[];
  runs: { id: string; exportId: string; reason: string; outcome: string; createdAt: string; tasks: unknown[]; notSent: { title: string; code: string; message: string }[]; receipt: { new: number; superseding: number; unchanged: number; blocked: { taskId: string; reason: string }[]; replayed: boolean } | null; error: { code: string; message: string } | null }[];
}
export interface NeedRow {
  id: string;
  taskId: string;
  taskTitle: string | null;
  kind: 'new_case_kind' | 'more_data';
  content: Record<string, unknown>;
  state: string;
  mergedIntoId: string | null;
  rejectReason: string | null;
  summary: string | null;
  studioItemId: string | null;
  studioState: string | null;
  createdAt: string;
}
export interface ReviewBatch {
  ref: string;
  batchId: string;
  runId: string | null;
  receivedAt: string;
  note: unknown;
  items: { itemId: string; taskId: string; revision: number; episode: Record<string, unknown>; decision: { decision: string; rationale: string; criterionId: string | null; decidedBy: string; at: string } | null }[];
}

const DECISION_LABEL: Record<string, string> = {
  agent_failure: 'Agent failure confirmed',
  task_correction: 'Task needs correction',
  rubric_correction: 'Rubric needs correction',
  grader_wrong: 'Grader is wrong',
  environment_wrong: 'Environment is wrong',
};

function Err({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="mt-2 text-sm text-error">
      {text}
    </p>
  ) : null;
}

export function RlGymExportPanel({ projectId, initial }: { projectId: string; initial: RlGymExportState }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = initial;
  async function exportNow() {
    setPending(true);
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/rlgym-exports`, {});
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="rlgym-export" className="rounded-md border border-line p-4">
      <h2 id="rlgym-export" className="text-lg font-semibold">
        Export to RL Gym
      </h2>
      <p className="text-sm text-fg-muted">
        Sends the approved tasks so far to RL Gym Evaluation. RL Gym recognises unchanged tasks; corrected tasks supersede their earlier revision.
        {s.rlgymTemplate && (
          <>
            {' '}
            Template in RL Gym: <span className="font-mono">{s.rlgymTemplate.id}</span> v{s.rlgymTemplate.version}.
          </>
        )}
      </p>
      {!s.connected && <p className="mt-2 text-sm">RL Gym isn’t connected yet.</p>}
      <button type="button" className="btn btn-primary mt-3" disabled={!s.canExport || pending} onClick={exportNow}>
        {pending ? 'Sending…' : s.exported ? 'Re-export' : 'Export for benchmark'}
      </button>
      {s.reason && <p className="mt-2 text-sm text-fg-muted">{s.reason}</p>}
      <Err text={error} />
      {s.tasks.length > 0 && (
        <table className="mt-4 w-full text-left text-sm">
          <caption className="sr-only">Approved tasks</caption>
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Task</th>
              <th scope="col" className="py-1 pr-3 font-medium">Revision</th>
              <th scope="col" className="py-1 font-medium">RL Gym</th>
            </tr>
          </thead>
          <tbody>
            {s.tasks.map((t) => (
              <tr key={t.recordId} className="border-t border-line">
                <td className="py-1 pr-3">{t.title}</td>
                <td className="py-1 pr-3">{t.revision ?? '—'}</td>
                <td className="py-1">{t.waitingFor ? `Waiting for new case kind ${t.waitingFor}` : t.inRlGym ? 'In RL Gym' : 'Not sent'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.runs.length > 0 && (
        <div className="mt-4">
          <h3 className="font-medium">Export history</h3>
          <ul className="mt-1 space-y-2 text-sm">
            {s.runs.map((r) => (
              <li key={r.id} className="rounded border border-line p-2">
                <span className="font-mono text-xs">{r.exportId}</span> · {new Date(r.createdAt).toLocaleString()} · {r.reason} ·{' '}
                {r.outcome === 'received' && r.receipt
                  ? `RL Gym receipt: ${r.receipt.new} imported, ${r.receipt.superseding} superseding, ${r.receipt.unchanged} unchanged, ${r.receipt.blocked.length} blocked${r.receipt.replayed ? ' (replayed)' : ''}`
                  : `${r.outcome === 'rejected' ? 'Refused by RL Gym' : 'RL Gym unavailable'}: ${r.error?.message ?? ''}`}
                {r.notSent.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-fg-muted">
                    {r.notSent.map((n, i) => (
                      <li key={i}>
                        Not sent: {n.title}: {n.message}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function needText(n: NeedRow) {
  const c = n.content;
  if (n.kind === 'new_case_kind') return `${String(c.context ?? '')} · Twist: ${String(c.twist ?? '')} · Expected: ${String(c.expectedOutcome ?? '')} · ${String(c.complexity ?? '')}, ${String(c.archetype ?? '')}`;
  return `More data for ${String(c.edgeCase ?? '')}: ${String(c.howMany ?? '')} more cases. ${String(c.why ?? '')}`;
}

export function SmeNeedsPanel({ projectId, needs, studioConnected }: { projectId: string; needs: NeedRow[]; studioConnected: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [into, setInto] = useState<Record<string, string>>({});
  async function act(path: string, body: object) {
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/needs/${path}`, body);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  const open = needs.filter((n) => n.state === 'open');
  return (
    <section aria-labelledby="sme-needs" className="rounded-md border border-line p-4">
      <h2 id="sme-needs" className="text-lg font-semibold">
        SME needs
      </h2>
      <p className="text-sm text-fg-muted">New edge cases and More data needs raised by SMEs. Merge duplicates, send them to Studio’s next-version inbox, or reject with a reason that goes back to the SME.</p>
      {!studioConnected && <p className="mt-2 text-sm">Studio isn’t connected yet.</p>}
      <Err text={error} />
      {needs.length === 0 && <p className="mt-2 text-sm text-fg-muted">No needs yet.</p>}
      <ul className="mt-3 space-y-3">
        {needs.map((n) => (
          <li key={n.id} className="rounded border border-line p-3 text-sm">
            <p className="font-medium">
              {n.kind === 'new_case_kind' ? 'New edge case' : 'More data'} · {n.taskTitle ?? n.taskId.slice(0, 8)} · {n.state}
              {n.studioItemId && ` · Studio ${n.studioItemId}${n.studioState ? ` (${n.studioState})` : ''}`}
            </p>
            <p className="mt-1">{needText(n)}</p>
            {n.rejectReason && <p className="mt-1 text-fg-muted">Rejected: {n.rejectReason}</p>}
            {n.state === 'open' && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col">
                  <span className="text-xs text-fg-muted">Summary for Studio</span>
                  <input className="input" value={summary[n.id] ?? ''} onChange={(e) => setSummary({ ...summary, [n.id]: e.target.value })} />
                </label>
                <button type="button" className="btn btn-primary" disabled={!studioConnected || (summary[n.id] ?? '').trim().length < 3} onClick={() => act(`${n.id}/send`, { summary: summary[n.id] })}>
                  Send to Studio
                </button>
                {open.filter((o) => o.id !== n.id && o.kind === n.kind).length > 0 && (
                  <>
                    <label className="flex flex-col">
                      <span className="text-xs text-fg-muted">Duplicate of</span>
                      <select className="input" value={into[n.id] ?? ''} onChange={(e) => setInto({ ...into, [n.id]: e.target.value })}>
                        <option value="">Choose…</option>
                        {open
                          .filter((o) => o.id !== n.id && o.kind === n.kind)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.taskTitle ?? o.id.slice(0, 8)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button type="button" className="btn btn-secondary" disabled={!into[n.id]} onClick={() => act(`${n.id}/merge`, { intoId: into[n.id] })}>
                      Merge
                    </button>
                  </>
                )}
                <label className="flex flex-col">
                  <span className="text-xs text-fg-muted">Reason</span>
                  <input className="input" value={reason[n.id] ?? ''} onChange={(e) => setReason({ ...reason, [n.id]: e.target.value })} />
                </label>
                <button type="button" className="btn btn-secondary" disabled={(reason[n.id] ?? '').trim().length < 3} onClick={() => act(`${n.id}/reject`, { reason: reason[n.id] })}>
                  Reject
                </button>
              </div>
            )}
            {n.state === 'sent' && studioConnected && (
              <button type="button" className="btn btn-secondary mt-2" onClick={() => act(`${n.id}/refresh`, {})}>
                Check Studio status
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BenchmarkReviewPanel({ projectId, batches, connected }: { projectId: string; batches: ReviewBatch[]; connected: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { decision: string; rationale: string; criterionId: string }>>({});
  async function decide(ref: string, itemId: string) {
    const d = draft[itemId];
    if (!d) return;
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/run-reviews/${ref}/decisions`, { decisions: [{ itemId, decision: d.decision, rationale: d.rationale, ...(d.criterionId ? { criterionId: d.criterionId } : {}) }] });
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="benchmark-review" className="rounded-md border border-line p-4">
      <h2 id="benchmark-review" className="text-lg font-semibold">
        Benchmark review
      </h2>
      <p className="text-sm text-fg-muted">Episodes RL Gym sent back for review. Decide each one with a rationale. “Task needs correction” sends the task back to Rework; the corrected revision goes in the next Re-export.</p>
      {!connected && <p className="mt-2 text-sm">RL Gym isn’t connected yet, so decisions cannot be sent.</p>}
      <Err text={error} />
      {batches.length === 0 && <p className="mt-2 text-sm text-fg-muted">No review batches yet.</p>}
      {batches.map((b) => (
        <div key={b.ref} className="mt-3">
          <h3 className="font-medium">
            Batch <span className="font-mono">{b.batchId}</span>
            {b.runId && <> · run {b.runId}</>} · received {new Date(b.receivedAt).toLocaleString()}
          </h3>
          <ul className="mt-1 space-y-2 text-sm">
            {b.items.map((i) => {
              const e = i.episode;
              const d = draft[i.itemId] ?? { decision: 'agent_failure', rationale: '', criterionId: '' };
              const path = (e.path ?? {}) as { summary?: string; failed_node?: string; failed_why?: string };
              return (
                <li key={i.itemId} className="rounded border border-line p-2">
                  <p>
                    <span className="font-mono text-xs">{i.itemId}</span> · task {i.taskId.slice(0, 8)} r{i.revision} · score {String(e.score ?? '—')} · {String((e.system as { name?: string } | undefined)?.name ?? '')}
                  </p>
                  {(path.summary || path.failed_node) && (
                    <p className="text-fg-muted">
                      Path: {path.summary ?? ''} {path.failed_node ? `· failed at ${path.failed_node}${path.failed_why ? ` (${path.failed_why})` : ''}` : ''}
                    </p>
                  )}
                  {typeof e.suspected_cause === 'string' && <p className="text-fg-muted">RL Gym’s hint (not a decision): {e.suspected_cause}</p>}
                  {i.decision ? (
                    <p className="mt-1">
                      Decided: {DECISION_LABEL[i.decision.decision] ?? i.decision.decision} by {i.decision.decidedBy} · {i.decision.rationale}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="flex flex-col">
                        <span className="text-xs text-fg-muted">Decision</span>
                        <select className="input" value={d.decision} onChange={(ev) => setDraft({ ...draft, [i.itemId]: { ...d, decision: ev.target.value } })}>
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
                          <input className="input" value={d.criterionId} onChange={(ev) => setDraft({ ...draft, [i.itemId]: { ...d, criterionId: ev.target.value } })} />
                        </label>
                      )}
                      <label className="flex flex-1 flex-col">
                        <span className="text-xs text-fg-muted">Rationale</span>
                        <input className="input" value={d.rationale} onChange={(ev) => setDraft({ ...draft, [i.itemId]: { ...d, rationale: ev.target.value } })} />
                      </label>
                      <button type="button" className="btn btn-primary" disabled={!connected || !d.rationale.trim()} onClick={() => decide(b.ref, i.itemId)}>
                        Decide
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
