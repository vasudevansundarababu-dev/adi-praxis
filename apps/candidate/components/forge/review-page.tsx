'use client';

import { getFieldValue, isArrayType, itemFieldsOf, type ForgeComment, type ItemField, type ReviewerTaskStatus, type SectionKey, type TemplateProfile } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { call } from '@/lib/client';
import { commentsToSend, REVIEW_STATUS_TONE, reviewDecisionProblem, reviewGroups, type ReviewGroup } from '@/lib/forge';

/** GET /me/reviews/:taskId (MVP1 step 2). */
export interface ReviewView {
  taskId: string;
  label: string;
  slotLabel: string;
  project: { id: string; name: string };
  author: string | null;
  status: ReviewerTaskStatus | null;
  taskStatus: string;
  template: { workflow: string; profileId: string | null; profile: TemplateProfile | null };
  output: Record<string, unknown> | null;
  version: number | null;
  coverageTags: { tags: Record<string, string>; edgeCase: string | null } | null;
  myDecisions: { id: string; decision: string; comments: ForgeComment[] | null; notes: string | null; version: number | null; at: string }[];
  canDecide: boolean;
  expectedVersion: number | null;
  expectedRevision: number;
  flaggedDuplicate: boolean;
  confirmCoverage: boolean;
}

/** One authored value, read-only: text as written, lists one per line, repeated records with their own fields. */
function Value({ field, value }: { field: ItemField; value: unknown }) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return <p className="text-sm text-fg-muted">Not given</p>;
  if (isArrayType(field.type) && Array.isArray(value)) {
    const subs = itemFieldsOf(field);
    return (
      <ol className="mt-1 space-y-2">
        {(value as Record<string, unknown>[]).map((item, i) => (
          <li key={i} className="rounded-md border border-line p-2">
            <p className="text-xs font-semibold">
              {field.itemLabel ?? 'Item'} {i + 1}
              {typeof item?.id === 'string' && item.id ? ` · ${item.id}` : ''}
            </p>
            <dl className="mt-1 space-y-1">
              {subs.map((s) => (
                <div key={s.key}>
                  <dt className="text-xs text-fg-muted">{s.label}</dt>
                  <dd>
                    <Value field={s} value={item?.[s.key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    );
  }
  if (Array.isArray(value)) return <p className="whitespace-pre-wrap break-words text-sm">{value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n')}</p>;
  if (typeof value === 'boolean') return <p className="text-sm">{value ? 'Yes' : 'No'}</p>;
  if (typeof value === 'object') return <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre>;
  const label = field.options?.find((o) => o.value === value)?.label;
  return <p className="whitespace-pre-wrap break-words text-sm">{label ?? String(value)}</p>;
}

function CommentBox({ group, value, onChange, disabled }: { group: ReviewGroup; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const id = `rc-${group.key}`;
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-medium">
        Comment on {group.key.replace('-', '–')} (optional)
      </label>
      <textarea id={id} data-comment-section={group.key} rows={2} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" placeholder="What should the author change here?" />
    </div>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** MVP1 Review page: the authored form read-only, a comment box under each section, Send back for rework or Approve. */
export function ReviewPage({ initial }: { initial: ReviewView }) {
  const [view, setView] = useState(initial);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const [duplicateOk, setDuplicateOk] = useState(false);
  const [coverageOk, setCoverageOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const profile = view.template.profile;
  const groups: ReviewGroup[] = profile ? reviewGroups(profile) : [{ key: 'General', heading: 'The authored task', sections: [] }];
  const needsCoverage = view.confirmCoverage && !!view.coverageTags?.edgeCase;
  const disabled = !view.canDecide || pending;

  async function decide(decision: 'PASS' | 'REWORK') {
    const problem = reviewDecisionProblem(decision, boxes, { needsDuplicate: view.flaggedDuplicate, duplicateConfirmed: duplicateOk, needsCoverage, coverageConfirmed: coverageOk });
    if (problem) return setError(problem);
    if (view.expectedVersion === null) return setError('There is no submitted version to review yet.');
    setPending(true);
    setError(null);
    const res = await call('POST', `/me/reviews/${view.taskId}/decision`, {
      decision,
      expectedVersion: view.expectedVersion,
      expectedRevision: view.expectedRevision,
      comments: commentsToSend(boxes),
      ...(view.flaggedDuplicate ? { duplicateDecision: decision === 'PASS' ? 'ACCEPT_AS_DISTINCT' : 'REWORK' } : {}),
      ...(decision === 'PASS' && needsCoverage ? { confirmedCoverage: { tags: view.coverageTags!.tags, edgeCase: view.coverageTags!.edgeCase! } } : {}),
    });
    if (!res.ok) {
      setPending(false);
      return setError(res.code === 'STALE_STAGE_DECISION' || res.code === 'STALE_REVISION' ? 'This task changed since you opened it. Reload the page to see the latest version.' : res.error);
    }
    const fresh = await call<ReviewView>('GET', `/me/reviews/${view.taskId}`);
    setPending(false);
    if (fresh.ok && fresh.data) setView(fresh.data);
    else setView({ ...view, canDecide: false, status: decision === 'PASS' ? 'Approved' : 'Sent back' });
    setBoxes({});
  }

  const latest = view.myDecisions.at(-1);
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/home" className="text-sm text-link hover:underline">
        ← Your tasks
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{view.label}</h1>
        {view.status && <span className={`pill ${REVIEW_STATUS_TONE[view.status]}`}>{view.status}</span>}
      </div>
      <p className="text-sm text-fg-muted">
        {view.project.name}
        {view.author ? ` · by ${view.author}` : ''}
        {view.version ? ` · version ${view.version}` : ''}
      </p>

      {!view.canDecide && latest && (
        <p role="status" className="mt-4 rounded-md border border-line p-3 text-sm" data-review-outcome>
          {latest.decision === 'PASS'
            ? `You approved version ${latest.version ?? ''} on ${when(latest.at)}. It is with the project manager for final acceptance.`
            : `You sent version ${latest.version ?? ''} back for rework on ${when(latest.at)}. It returns here when the author resubmits.`}
        </p>
      )}
      {!view.canDecide && !latest && <p className="mt-4 rounded-md border border-line p-3 text-sm">This task is not waiting for your review.</p>}

      {view.output === null ? (
        <p className="mt-6 text-sm text-fg-muted">Nothing has been submitted yet.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`rg-${g.key}`} className="card p-4" data-review-group={g.key}>
              <h2 id={`rg-${g.key}`} className="text-lg font-semibold">
                {g.heading}
              </h2>
              {profile ? (
                g.sections.map((key) => {
                  const s = profile.sections.find((x) => x.key === key)!;
                  return (
                    <div key={key} className="mt-3 space-y-2">
                      {g.sections.length > 1 && <h3 className="text-sm font-semibold text-fg-muted">{s.key} · {s.title}</h3>}
                      <dl className="space-y-2">
                        {s.fields.map((f) => (
                          <div key={f.key}>
                            <dt className="text-xs font-medium text-fg-muted">{f.label}</dt>
                            <dd>
                              <Value field={f} value={getFieldValue(profile, view.output, s.key as SectionKey, f)} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                })
              ) : (
                <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{JSON.stringify(view.output, null, 2)}</pre>
              )}
              {view.canDecide && <CommentBox group={g} value={boxes[g.key] ?? ''} onChange={(v) => setBoxes((b) => ({ ...b, [g.key]: v }))} disabled={disabled} />}
            </section>
          ))}
        </div>
      )}

      {view.canDecide && view.output !== null && (
        <section aria-labelledby="decide-h" className="card mt-6 space-y-3 p-4">
          <h2 id="decide-h" className="text-lg font-semibold">
            Your review
          </h2>
          <p className="text-sm text-fg-muted">Add a comment under any section that needs work. Send it back for rework, or approve it for the project manager&apos;s final acceptance.</p>
          {view.flaggedDuplicate && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={duplicateOk} onChange={(e) => setDuplicateOk(e.target.checked)} className="mt-1" />
              <span>This task looks like an existing one. I checked: it is distinct (needed to approve).</span>
            </label>
          )}
          {needsCoverage && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={coverageOk} onChange={(e) => setCoverageOk(e.target.checked)} className="mt-1" />
              <span>
                I confirm the coverage this task fills: {Object.entries(view.coverageTags!.tags).map(([k, v]) => `${k} ${v}`).join(', ')} · edge case {view.coverageTags!.edgeCase} (needed to approve).
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => void decide('REWORK')} className="btn btn-secondary">
              Send back for rework
            </button>
            <button type="button" disabled={pending} onClick={() => void decide('PASS')} className="btn btn-primary">
              Approve
            </button>
          </div>
          <p className="text-xs text-fg-muted">Rework goes back to the author with your comments. Approve sends it to the project manager or Admin to accept and export.</p>
        </section>
      )}

      {view.myDecisions.length > 0 && (
        <section aria-labelledby="prior-h" className="mt-6">
          <h2 id="prior-h" className="text-lg font-semibold">
            Your earlier decisions
          </h2>
          <ul className="mt-2 space-y-2">
            {[...view.myDecisions].reverse().map((d) => (
              <li key={d.id} className="card p-3 text-sm">
                <p className="font-medium">
                  {d.decision === 'PASS' ? 'Approved' : d.decision === 'REWORK' ? 'Sent back for rework' : d.decision} · version {d.version ?? '—'} · {when(d.at)}
                </p>
                {(d.comments ?? []).map((c, i) => (
                  <p key={i} className="mt-1">
                    <span className="font-mono text-xs">{c.section}</span> {c.text}
                  </p>
                ))}
                {d.notes && <p className="mt-1 text-fg-muted">{d.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
