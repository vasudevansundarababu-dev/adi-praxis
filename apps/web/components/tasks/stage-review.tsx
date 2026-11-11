'use client';

import { STAGE_LABELS, type PendingStage } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { Req } from '@/components/required';

/** A comment pinned to a section, graph node or field (authoring v2.1 Wave 2). */
export interface PinnedComment {
  section?: string;
  target?: { kind: 'node' | 'field'; id: string };
  text: string;
}

export interface StageHistoryItem {
  id: string;
  stage: PendingStage;
  decision: 'PASS' | 'ACCEPT' | 'REWORK' | 'REJECT' | 'EDIT';
  by: string;
  version: number;
  at: string;
  reason: string | null;
  material: boolean | null;
  notes: string | null;
  comments: PinnedComment[];
  void: boolean;
}

/** The stage fields of GET /review/tasks/:id. */
export interface StageData {
  reviewRoute: 'SME_PM' | 'SME_EXPERT_PM';
  stage: PendingStage | null;
  currentVersion: number | null;
  viewer: { canExpert: boolean; canPm: boolean; bothResponsibilities: boolean };
  actions: ('PASS' | 'REWORK' | 'REJECT' | 'EDIT' | 'APPROVE')[];
  expertPass: { by: string; version: number; at: string } | null;
  stageHistory: StageHistoryItem[];
  diff: { fromVersion: number; toVersion: number; changes: { path: string; before: unknown; after: unknown }[] } | null;
}

const DECISION_TEXT: Record<StageHistoryItem['decision'], string> = {
  PASS: 'Passed to PM approval',
  ACCEPT: 'Approved',
  REWORK: 'Returned for rework',
  REJECT: 'Rejected',
  EDIT: 'Edited',
};

export const anchorOf = (c: PinnedComment) => [c.section, c.target ? `${c.target.kind} ${c.target.id}` : null].filter(Boolean).join(' · ');
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

/** Current stage, who holds it, the stage history (void decisions marked) and what changed since the last version. */
export function StageSummary({ d, status }: { d: StageData; status: string }) {
  return (
    <section aria-labelledby="stage-h" className="card space-y-3 p-4 text-sm">
      <h2 id="stage-h" className="font-semibold">Review route: SME → Expert review → PM approval</h2>
      <p role="status">
        {status === 'SUBMITTED' && d.stage ? (
          <>
            <span className="font-medium">{d.stage === 'EXPERT_REVIEW' ? 'Review pending: Expert review' : 'Approval pending: PM approval'}</span> · version {d.currentVersion}
            {d.stage === 'PM_APPROVAL' && d.expertPass && ` · passed by ${d.expertPass.by} on version ${d.expertPass.version}`}
          </>
        ) : status === 'REWORK' ? (
          'Back with the author (Authoring).'
        ) : (
          `This task is ${status.toLowerCase()}.`
        )}
      </p>
      {d.viewer.bothResponsibilities && <p className="rounded-md border border-line p-2">You hold both responsibilities on this project, Expert and PM. Each decision is recorded and audited separately under its own responsibility.</p>}
      <div>
        <h3 className="font-medium">Stage history</h3>
        {d.stageHistory.length === 0 ? (
          <p className="text-fg-muted">No stage decisions yet.</p>
        ) : (
          <ol className="mt-1 space-y-1" aria-label="Stage history">
            {d.stageHistory.map((h) => (
              <li key={h.id} className={h.void ? 'text-fg-muted line-through' : ''}>
                <span className="font-medium">v{h.version}</span> · {STAGE_LABELS[h.stage]} · {DECISION_TEXT[h.decision]} by {h.by} · {new Date(h.at).toLocaleString()}
                {h.void && <span className="ml-1 no-underline">(void: the task changed after this decision)</span>}
                {h.decision === 'EDIT' && (
                  <span className="block">
                    Reason: {h.reason}
                    {h.material ? ' · material: the author must reconfirm' : ' · minor'}
                  </span>
                )}
                {h.comments.map((c, i) => (
                  <span key={i} className="block">
                    {anchorOf(c)}: {c.text}
                  </span>
                ))}
                {h.notes && <span className="block text-fg-muted">{h.notes}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      {d.diff && (
        <details open>
          <summary className="cursor-pointer font-medium">
            Changes from version {d.diff.fromVersion} to version {d.diff.toVersion} ({d.diff.changes.length})
          </summary>
          {d.diff.changes.length === 0 ? (
            <p className="text-fg-muted">No content changes.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr>
                  <th scope="col" className="text-left">Field</th>
                  <th scope="col" className="text-left">Before</th>
                  <th scope="col" className="text-left">After</th>
                </tr>
              </thead>
              <tbody>
                {d.diff.changes.map((c) => (
                  <tr key={c.path} className="align-top">
                    <td className="pr-2 font-mono">{c.path}</td>
                    <td className="pr-2">{short(c.before)}</td>
                    <td>{short(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}
    </section>
  );
}

type Action = StageData['actions'][number];
const ACTION_TEXT: Record<Action, string> = {
  PASS: 'Pass to PM approval',
  REWORK: 'Return for rework',
  REJECT: 'Reject',
  EDIT: 'Edit with a reason',
  APPROVE: 'Approve this exact version',
};

/** The decisions this viewer may take at this stage; nothing else is offered. */
export function StageActions({
  d,
  task,
}: {
  d: StageData;
  task: { id: string; revision: number; output: Record<string, unknown> | null; checklist: { key: string; label: string }[]; flaggedDuplicate: boolean; openSlot: boolean; coverageTags: { tags: Record<string, string>; edgeCase: string | null } | null; nodeIds: string[] };
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(d.actions[0] ?? null);
  const [checklist, setChecklist] = useState<Record<string, boolean | undefined>>({});
  const [comments, setComments] = useState<PinnedComment[]>([{ section: 'S1', text: '' }]);
  const [rejectReason, setRejectReason] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [material, setMaterial] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(() => JSON.stringify(task.output ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!d.actions.length || !d.stage) return <p className="text-sm">{d.stage ? `Waiting for ${STAGE_LABELS[d.stage]}; you have no action at this stage.` : 'No review action is open.'}</p>;

  const expert = d.stage === 'EXPERT_REVIEW';
  const answered = task.checklist.every((c) => checklist[c.key] !== undefined);
  const allTrue = task.checklist.every((c) => checklist[c.key] === true);
  const pinned = comments.filter((c) => c.text.trim() && (c.section || c.target?.id));
  let parsed: Record<string, unknown> | null = null;
  if (action === 'EDIT') {
    try {
      parsed = JSON.parse(draft) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  const valid =
    action === 'EDIT'
      ? !!parsed && reason.trim().length >= 5 && material !== null
      : action === 'APPROVE'
        ? true
        : (!expert || answered) && (action !== 'PASS' || allTrue) && (action !== 'REJECT' || !!rejectReason) && (action !== 'REWORK' || pinned.length > 0);

  async function submit() {
    setPending(true);
    setError(null);
    const base = { expectedRevision: task.revision, expectedVersion: d.currentVersion };
    const res =
      action === 'EDIT'
        ? await mutate('POST', `/review/tasks/${task.id}/edit`, { ...base, output: parsed, reason, material })
        : await mutate('POST', `/review/tasks/${task.id}/stage-decision`, {
            ...base,
            stage: d.stage,
            decision: action,
            ...(expert ? { checklist } : {}),
            ...(action === 'REJECT' ? { rejectReason } : {}),
            ...(expert && task.flaggedDuplicate ? { duplicateDecision: action === 'PASS' ? 'ACCEPT_AS_DISTINCT' : action === 'REWORK' ? 'REWORK' : rejectReason === 'DUPLICATE' ? 'REJECT_DUPLICATE' : undefined } : {}),
            ...(action === 'PASS' && task.openSlot && task.coverageTags?.edgeCase ? { confirmedCoverage: { tags: task.coverageTags.tags, edgeCase: task.coverageTags.edgeCase } } : {}),
            comments: action === 'REWORK' ? pinned : [],
            notes: notes || undefined,
          });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push('/review/tasks');
    router.refresh();
  }

  return (
    <aside className="space-y-4 text-sm" aria-label="Stage decision">
      <fieldset className="card space-y-2 p-4">
        <legend className="px-1 font-semibold">
          {STAGE_LABELS[d.stage]} · version {d.currentVersion}
          <Req />
        </legend>
        {d.actions.map((x) => (
          <label key={x} className="flex items-center gap-2">
            <input type="radio" name="stage-action" checked={action === x} onChange={() => setAction(x)} />
            {ACTION_TEXT[x]}
          </label>
        ))}
        {action === 'APPROVE' && d.expertPass && <p className="text-xs text-fg-muted">Approves version {d.currentVersion}, passed by {d.expertPass.by}. Approval writes the task into the Approved Task Dataset (append-only). It does not run a benchmark or send a payment.</p>}
      </fieldset>

      {expert && action !== 'EDIT' && (
        <fieldset className="card p-4">
          <legend className="px-1 font-semibold">
            Checklist
            <Req />
          </legend>
          {task.checklist.map((c) => (
            <div key={c.key} className="mt-2">
              <p>{c.label}</p>
              <div role="radiogroup" aria-label={c.label} aria-required="true" className="flex gap-3">
                <label className="flex items-center gap-1">
                  <input type="radio" name={`s-${c.key}`} checked={checklist[c.key] === true} onChange={() => setChecklist({ ...checklist, [c.key]: true })} /> Yes
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name={`s-${c.key}`} checked={checklist[c.key] === false} onChange={() => setChecklist({ ...checklist, [c.key]: false })} /> No
                </label>
              </div>
            </div>
          ))}
          {action === 'PASS' && answered && !allTrue && <p className="mt-2 text-warning">Every checklist item must be “Yes” to pass to PM approval.</p>}
        </fieldset>
      )}

      {action === 'REWORK' && (
        <fieldset className="card space-y-2 p-4">
          <legend className="px-1 font-semibold">
            Pinned comments
            <Req />
          </legend>
          <p className="text-xs text-fg-muted">Name the defect, the expected correction and the evidence or rule. Pin each comment to a section, a graph node or a field.</p>
          {comments.map((c, i) => {
            const kind = c.target ? c.target.kind : 'section';
            const anchor = c.target ? c.target.id : (c.section ?? '');
            const update = (next: PinnedComment) => setComments(comments.map((x, j) => (j === i ? next : x)));
            return (
              <div key={i} className="space-y-1 rounded-md border border-line p-2">
                <div className="flex gap-2">
                  <label>
                    <span className="sr-only">Pin to</span>
                    <select value={kind} onChange={(e) => update(e.target.value === 'section' ? { section: anchor, text: c.text } : { target: { kind: e.target.value as 'node' | 'field', id: anchor }, text: c.text })} className="rounded-md border border-line bg-surface px-1 py-1">
                      <option value="section">Section</option>
                      <option value="node">Graph node</option>
                      <option value="field">Field</option>
                    </select>
                  </label>
                  <label className="flex-1">
                    <span className="sr-only">Section, node or field id</span>
                    <input list={kind === 'node' ? 'stage-node-ids' : undefined} value={anchor} onChange={(e) => update(kind === 'section' ? { section: e.target.value, text: c.text } : { target: { kind: kind as 'node' | 'field', id: e.target.value }, text: c.text })} className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono" />
                  </label>
                </div>
                <label className="block">
                  <span className="sr-only">Comment</span>
                  <textarea aria-required={i === 0 ? 'true' : undefined} value={c.text} rows={2} onChange={(e) => update({ ...c, text: e.target.value })} className="w-full rounded-md border border-line bg-surface px-2 py-1" />
                </label>
              </div>
            );
          })}
          <datalist id="stage-node-ids">
            {task.nodeIds.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button type="button" onClick={() => setComments([...comments, { section: 'S1', text: '' }])} className="text-link">
            Add a pinned comment
          </button>
        </fieldset>
      )}

      {action === 'REJECT' && (
        <label className="card block p-4">
          Reason
          <Req />
          <select aria-required="true" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1">
            <option value="">Choose…</option>
            <option value="DUPLICATE">Duplicate</option>
            <option value="NOT_REALISTIC">Not realistic</option>
            <option value="INCORRECT">Incorrect</option>
            <option value="REAL_DATA">Contains real data (quarantine)</option>
          </select>
        </label>
      )}

      {action === 'EDIT' && (
        <fieldset className="card space-y-2 p-4">
          <legend className="px-1 font-semibold">Expert edit</legend>
          <p className="text-xs text-fg-muted">Saving creates a new version, re-runs the task checks and voids earlier stage decisions. A material edit returns the task to the author to reconfirm. Any change to the rubric or the reference answer is always material.</p>
          <label className="block">
            Task content (JSON)
            <textarea aria-label="Edited task content" value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs" />
          </label>
          {!parsed && <p className="text-error">The content is not valid JSON.</p>}
          <label className="block">
            Reason for the edit
            <Req />
            <textarea aria-required="true" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
          </label>
          <div role="radiogroup" aria-label="Is the edit material?" aria-required="true" className="space-y-1">
            <label className="flex items-center gap-2">
              <input type="radio" name="material" checked={material === false} onChange={() => setMaterial(false)} /> Minor: wording or presentation only
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="material" checked={material === true} onChange={() => setMaterial(true)} /> Material: changes the case, the reference answer or the rubric (author reconfirms)
            </label>
          </div>
        </fieldset>
      )}

      {action !== 'EDIT' && (
        <label className="card block p-4">
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1" />
        </label>
      )}
      <button type="button" disabled={pending || !valid || !action} onClick={submit} className="btn btn-primary w-full disabled:opacity-50">
        {action ? ACTION_TEXT[action] : 'Choose an action'}
      </button>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </aside>
  );
}
