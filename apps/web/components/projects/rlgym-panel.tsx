'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * Project → Benchmark: Export for benchmark / Re-export to the RL Gym, SME needs (merge, send to Studio, reject) and
 * Benchmark review (SME review batches from the RL Gym). AUTHORING-SNAPSHOT 3.1-3.4; AUTHORING-SPEC 1.4-1.6.
 * The RL Gym's suspected cause is shown as a hint only: a person makes every decision.
 */

const ANSWER_LABEL = { accepted: 'accepted by RL Gym', duplicate: 'already in RL Gym (duplicate, unchanged)', rejected: 'rejected by RL Gym', not_answered: 'no answer from RL Gym' } as const;
const OWNER_WORDS: Record<string, string> = { author: 'the author (send it back for rework)', pm: 'the PM', template: 'the template (Studio)', authoring: 'ADI Forge support', rlgym: 'RL Gym' };

export interface RlGymExportState {
  connected: boolean;
  canExport: boolean;
  reason: string | null;
  rlgymTemplate: { id: string; version: number; specSha256: string } | null;
  exported: boolean;
  tasks: { recordId: string; taskId: string; title: string; revision: number | null; inRlGym: boolean; waitingFor: string | null }[];
  runs: { id: string; exportId: string; reason: string; outcome: string; createdAt: string; tasks: unknown[]; notSent: { title: string; code: string; message: string; problems?: { code: string; section: string; field: string | null; owner: string; retryHelps: boolean; message: string }[] }[]; authoringReceiptSha256?: string | null; taskAnswers?: Record<string, 'accepted' | 'duplicate' | 'rejected' | 'not_answered'>; receipt: { new: number; superseding: number; unchanged: number; blocked: { taskId: string; reason: string }[]; replayed: boolean } | null; error: { code: string; message: string } | null }[];
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
  items: { itemId: string; taskId: string; revision: number; episode: Record<string, unknown>; runId?: string | null; scorePass?: number | null; evidenceSha256?: string; decision: { decision: string; verdict?: string | null; scorePass?: number | null; evidenceSha256?: string | null; rationale: string; criterionId: string | null; decidedBy: string; at: string } | null }[];
  /** D-004: who reviews each task's episodes. Absent from older responses. */
  tasks?: ReviewTask[];
}
export interface ReviewerOption {
  smeUserId: string;
  name: string;
  role: 'author' | 'reviewer';
}
export interface ReviewTask {
  taskId: string;
  assignee: ReviewerOption | null;
  eligible: ReviewerOption[];
  /** A decision exists for this task, so its reviewer can no longer change. */
  locked: boolean;
}
const ROLE_LABEL = { author: 'wrote the task', reviewer: 'SME Reviewer' } as const;

const DECISION_LABEL: Record<string, string> = {
  agent_failure: 'Accept: the score stands (agent failure confirmed)',
  task_correction: 'Dispute: the task needs correction',
  rubric_correction: 'Dispute: the rubric needs correction',
  grader_wrong: 'Dispute: the grader is wrong',
  environment_wrong: 'Dispute: the environment is wrong',
  cannot_assess: 'Can’t assess',
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
                {r.taskAnswers && Object.keys(r.taskAnswers).length > 0 && (
                  <ul className="mt-1 list-disc pl-5" aria-label="RL Gym’s answer per task" data-task-answers>
                    {(r.tasks as { taskId: string; title: string; revision: number }[]).map((t) => (
                      <li key={t.taskId} data-answer={r.taskAnswers![t.taskId]}>
                        {t.title} (revision {t.revision}): {ANSWER_LABEL[r.taskAnswers![t.taskId] ?? 'not_answered']}
                      </li>
                    ))}
                  </ul>
                )}
                {r.notSent.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-fg-muted">
                    {r.notSent.map((n, i) => (
                      <li key={i} data-not-sent={n.code}>
                        Not sent: {n.title}
                        {n.problems?.length ? (
                          <ul className="list-[circle] pl-5">
                            {n.problems.map((p, j) => (
                              <li key={j} data-check={p.code}>
                                <span className="font-mono text-xs">{p.code}</span> {p.section}
                                {p.field ? ` · ${p.field}` : ''}: {p.message} To fix: {OWNER_WORDS[p.owner] ?? p.owner}. {p.retryHelps ? 'Trying again may help.' : 'Trying again won’t help until it is fixed.'}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <>: {n.message}</>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {r.authoringReceiptSha256 && (
                  <p className="mt-1 text-xs text-fg-muted">
                    ADI Forge receipt <span className="font-mono">{r.authoringReceiptSha256.slice(0, 16)}</span>
                  </p>
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
                  <input className="input" aria-describedby={`need-${n.id}-hint`} value={summary[n.id] ?? ''} onChange={(e) => setSummary({ ...summary, [n.id]: e.target.value })} />
                  <span id={`need-${n.id}-hint`} className="mt-0.5 text-xs text-fg-muted">
                    {!studioConnected ? 'Studio isn’t connected, so needs can’t be sent yet.' : (summary[n.id] ?? '').trim().length < 3 ? 'Write a short summary (3 characters or more) to send. It becomes the item’s title in Studio’s inbox.' : 'Ready to send.'}
                  </span>
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

/** D-014: the RL Gym sends `score` as a number or as {score, passed, failed_criteria}; show it as words, never "[object Object]". */
export function scoreText(score: unknown): string {
  if (typeof score === 'number') return `Score ${score}`;
  if (!score || typeof score !== 'object') return 'Score —';
  const s = score as { score?: unknown; passed?: unknown; pass_mark?: unknown; failed_criteria?: unknown };
  const parts = [`Score ${typeof s.score === 'number' ? s.score : '—'}${typeof s.pass_mark === 'number' ? ` (pass mark ${s.pass_mark})` : ''}`];
  if (typeof s.passed === 'boolean') parts.push(s.passed ? 'passed' : 'not passed');
  const failed = Array.isArray(s.failed_criteria) ? s.failed_criteria.filter((c): c is string => typeof c === 'string') : [];
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  return parts.join(' · ');
}

/** D-015: the RL Gym's summary as sent; "Failed at …" is built only when no summary came, so it is never repeated. */
export function pathText(path: { summary?: string; failed_node?: string; failed_why?: string }): string {
  if (path.summary) return path.summary;
  if (path.failed_node) return `Failed at ${path.failed_node}${path.failed_why ? ` (${path.failed_why})` : ''}`;
  return '';
}

/** D-013: why Decide is off, under the button. */
const needsCriterion = (decision: string) => decision === 'grader_wrong' || decision === 'rubric_correction';
export function decideHint(connected: boolean, d: { decision: string; rationale: string; criterionId: string }): string {
  if (!connected) return 'RL Gym isn’t connected, so decisions can’t be sent yet.';
  const missing = [!d.rationale.trim() && 'a rationale', needsCriterion(d.decision) && !d.criterionId.trim() && 'the criterion it is about'].filter(Boolean);
  if (missing.length) return `Type ${missing.join(' and ')} to decide.`;
  return 'Ready to decide. A decision is final.';
}
export const canDecide = (connected: boolean, d: { decision: string; rationale: string; criterionId: string }) => connected && !!d.rationale.trim() && (!needsCriterion(d.decision) || !!d.criterionId.trim());

/** D-004: per task of a batch, the SME who reviews its episodes (author or project SME Reviewer). PM and Admin choose. */
export function ReviewerPicker({ projectId, batchRef, task, canAssign }: { projectId: string; batchRef: string; task: ReviewTask; canAssign: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState(task.assignee?.smeUserId ?? task.eligible[0]?.smeUserId ?? '');
  const [error, setError] = useState<string | null>(null);
  const id = `reviewer-${batchRef}-${task.taskId}`;
  const label = (o: ReviewerOption) => `${o.name} (${ROLE_LABEL[o.role]})`;
  async function save() {
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/run-reviews/${batchRef}/assignments`, { taskId: task.taskId, smeUserId: pick });
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span>
        Task <span className="font-mono">{task.taskId.slice(0, 8)}</span>:
      </span>
      {task.assignee ? <span>reviewed by {label(task.assignee)}</span> : <span className="text-warning">no reviewer yet</span>}
      {canAssign && !task.locked && task.eligible.length > 0 && (
        <>
          <label htmlFor={id} className="sr-only">
            Reviewer for task {task.taskId.slice(0, 8)}
          </label>
          <select id={id} className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {task.eligible.map((o) => (
              <option key={o.smeUserId} value={o.smeUserId}>
                {label(o)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" disabled={!pick || pick === task.assignee?.smeUserId} onClick={save}>
            {task.assignee ? 'Change reviewer' : 'Assign reviewer'}
          </button>
        </>
      )}
      {canAssign && !task.locked && task.eligible.length === 0 && <span className="text-fg-muted">No SME can review it: the task has no author and the project has no SME Reviewers.</span>}
      {task.locked && <span className="text-fg-muted">· decided, so the reviewer is fixed</span>}
      <Err text={error} />
    </li>
  );
}

export function BenchmarkReviewPanel({ projectId, batches, connected, canDecide: staffCanDecide = true }: { projectId: string; batches: ReviewBatch[]; connected: boolean; canDecide?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { decision: string; rationale: string; criterionId: string }>>({});
  async function decide(ref: string, item: ReviewBatch['items'][number]) {
    const itemId = item.itemId;
    const d = draft[itemId];
    if (!d) return;
    setError(null);
    // E-007 phase 2: the decision names the score pass and the evidence reviewed; a stale one is refused.
    const res = await mutate('POST', `/projects/${projectId}/run-reviews/${ref}/decisions`, { ...(item.scorePass ? { scorePass: item.scorePass } : {}), decisions: [{ itemId, decision: d.decision, rationale: d.rationale, ...(d.criterionId ? { criterionId: d.criterionId } : {}), ...(item.evidenceSha256 ? { evidenceSha256: item.evidenceSha256 } : {}) }] });
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="benchmark-review" className="rounded-md border border-line p-4">
      <h2 id="benchmark-review" className="text-lg font-semibold">
        Benchmark review
      </h2>
      <p className="text-sm text-fg-muted">Episodes RL Gym sent back for review. Assign each task to the SME who wrote it or to an SME Reviewer on the project; they decide in the SME app. A PM or Admin can also decide here, each with a rationale. “Task needs correction” sends the task back to Rework; the corrected revision goes in the next Re-export.</p>
      {!connected && <p className="mt-2 text-sm">RL Gym isn’t connected yet, so decisions cannot be sent.</p>}
      <Err text={error} />
      {batches.length === 0 && <p className="mt-2 text-sm text-fg-muted">No review batches yet.</p>}
      {batches.map((b) => (
        <div key={b.ref} className="mt-3">
          <h3 className="font-medium">
            Batch <span className="font-mono">{b.batchId}</span>
            {b.runId && <> · run {b.runId}</>} · received {new Date(b.receivedAt).toLocaleString()}
          </h3>
          {b.tasks && b.tasks.length > 0 && (
            <ul className="mt-1 space-y-1" aria-label={`Reviewers for batch ${b.batchId}`}>
              {b.tasks.map((t) => (
                <ReviewerPicker key={t.taskId} projectId={projectId} batchRef={b.ref} task={t} canAssign={staffCanDecide} />
              ))}
            </ul>
          )}
          <ul className="mt-1 space-y-2 text-sm">
            {b.items.map((i) => {
              const e = i.episode;
              const d = draft[i.itemId] ?? { decision: 'agent_failure', rationale: '', criterionId: '' };
              const path = (e.path ?? {}) as { summary?: string; failed_node?: string; failed_why?: string };
              return (
                <li key={i.itemId} className="rounded border border-line p-2">
                  <p>
                    <span className="font-mono text-xs">{i.itemId}</span> · task {i.taskId.slice(0, 8)} r{i.revision} · {scoreText(e.score)} · {String((e.system as { name?: string } | undefined)?.name ?? '')}
                  </p>
                  <p className="text-xs text-fg-muted" data-bound>
                    Reviewing run {i.runId ?? '—'} · score pass {i.scorePass ?? '—'} · evidence <span className="font-mono">{i.evidenceSha256?.slice(0, 16) ?? '—'}</span>
                  </p>
                  {pathText(path) && <p className="text-fg-muted">Path: {pathText(path)}</p>}
                  {typeof e.suspected_cause === 'string' && <p className="text-fg-muted">RL Gym’s hint (not a decision): {e.suspected_cause}</p>}
                  {i.decision ? (
                    <p className="mt-1">
                      Decided: {DECISION_LABEL[i.decision.decision] ?? i.decision.decision} by {i.decision.decidedBy} · {i.decision.rationale}
                    </p>
                  ) : !staffCanDecide ? (
                    <p className="mt-1 text-fg-muted">Not decided yet. A PM, an Admin or the assigned SME decides.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="flex flex-col">
                        <span className="text-xs text-fg-muted">Verdict</span>
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
                      <button type="button" className="btn btn-primary" aria-describedby={`decide-${i.itemId}-hint`} disabled={!canDecide(connected, d)} onClick={() => decide(b.ref, i)}>
                        Decide
                      </button>
                      <span id={`decide-${i.itemId}-hint`} className="basis-full text-xs text-fg-muted">
                        {decideHint(connected, d)}
                      </span>
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
