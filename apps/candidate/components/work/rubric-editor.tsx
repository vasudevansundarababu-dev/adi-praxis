'use client';

import {
  newItem,
  RUBRIC_APPLICABILITY_LABELS,
  rubricToFinish,
  type ApplicabilityKind,
  type ItemField,
  type RubricCriterionView,
  type RubricView,
  type SaveCriterionRequest,
  type ToFinish,
  type ViewLink,
} from '@praxis/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The simplified rubric editor (owner specs "Simplified Rubric Editor" and "Rubric recommendations", D8, D9; mockup
 * docs/design/mockups/sme-task-form.html). The S7 values (name, scoring text, whole-task failure flag) are the task's
 * own fields and save through the ordinary autosave. Everything else here is internal to ADI Forge and saved through
 * the rubric API; RL Gym does not receive it yet. AI suggestions are labelled; a person decides.
 */

const input = 'mt-1 w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-sm';
const btn = 'rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50';
const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold';
const PILL = { ok: `${pill} bg-success/15 text-success`, warn: `${pill} bg-warning/15 text-warning`, info: `${pill} bg-link/15 text-link`, err: `${pill} bg-error/15 text-error`, ai: `${pill} bg-purple-500/15 text-purple-400`, mute: `${pill} bg-line text-fg-muted` };

async function send<T>(method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: T | null; message: string | null }> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  return { ok: res.ok, data: res.ok ? data : null, message: res.ok ? null : (data?.message ?? 'Something went wrong. Try again.') };
}

/** Loads the rubric view; `initial` lets the page (and tests) render it before any request. */
export function useRubricView(taskId: string, initial: RubricView | null = null, readOnlyUrl?: string, enabled = true) {
  const [view, setView] = useState<RubricView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch(readOnlyUrl ?? `/api/v1/me/tasks/${taskId}/rubric`);
    if (!res.ok) return setError('The rubric could not be loaded. Reload the page.');
    setError(null);
    setView((await res.json()) as RubricView);
  }, [taskId, readOnlyUrl]);
  useEffect(() => {
    if (!initial && enabled) void reload();
  }, [initial, reload, enabled]);
  return { view, error, reload, setError };
}

interface Props {
  taskId: string;
  field: ItemField;
  value: unknown;
  onChange: (items: Record<string, unknown>[]) => void;
  view: RubricView;
  reload: () => Promise<void>;
  readOnly: boolean;
  onOpenSource: (link: ViewLink) => void;
  /** Criteria shown expanded at first (tests and deep links). */
  initialOpen?: string[];
}

const asItems = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);

export function RubricEditor({ taskId, field, value, onChange, view, reload, readOnly, onOpenSource, initialOpen = [] }: Props) {
  const items = asItems(value);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(initialOpen.map((id) => [id, true])));
  const [appl, setAppl] = useState<RubricCriterionView | null>(null);
  const [aiScoring, setAiScoring] = useState<Record<string, Record<string, string>>>({});
  const todo = useMemo(() => rubricToFinish(view, items), [view, items]);
  const seeded = useRef(false);
  const ran = useRef(false);
  const base = `/api/v1/me/tasks/${taskId}/rubric`;

  // D8: the template's criteria are listed with its defaults; D9: the template evaluator is filled in. Applied once,
  // through the ordinary autosave (existing values are never changed except the read-only evaluator fields).
  useEffect(() => {
    if (readOnly || seeded.current || !view.seed) return;
    seeded.current = true;
    // Merge into what is on screen (never replace it): missing template criteria are added; existing items keep every
    // value except the read-only evaluator fields, which come from the template.
    const seed = view.seed;
    const have = new Set(items.map((i) => i.id));
    const kept = items.map((i) => {
      const s = seed.find((x) => x.id === i.id);
      return s && (s.evaluatorKind !== i.evaluatorKind || s.evaluatorVersion !== i.evaluatorVersion) ? { ...i, evaluatorKind: s.evaluatorKind, evaluatorVersion: s.evaluatorVersion } : i;
    });
    const added = seed.filter((s) => !have.has(s.id));
    if (added.length || kept.some((k, n) => k !== items[n])) onChange([...kept, ...added]);
  }, [readOnly, view.seed, onChange, items]);
  // The first visit derives suggestions from the task (no model) so links keep a snapshot of their sources.
  useEffect(() => {
    if (readOnly || ran.current || view.run) return;
    ran.current = true;
    void send('POST', `${base}/runs`, { mode: 'DERIVED' }).then(() => reload());
  }, [readOnly, view.run, base, reload]);
  useEffect(() => {
    if (view.aiEnabled && view.run?.mode === 'AI') void fetch(`${base}/ai-scoring`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setAiScoring(d.items));
  }, [view.aiEnabled, view.run, base]);

  const setItem = (id: string, patch: Record<string, unknown>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const saveDetail = async (c: { id: string; annotationVersion: number }, body: Omit<SaveCriterionRequest, 'expectedVersion'>) => {
    const r = await send('PUT', `${base}/criteria/${encodeURIComponent(c.id)}`, { expectedVersion: c.annotationVersion, ...body });
    if (!r.ok) setMsg(r.message);
    await reload();
  };
  const refresh = async (mode: 'DERIVED' | 'AI') => {
    setBusy(true);
    const r = await send<{ reused: boolean }>('POST', `${base}/runs`, { mode });
    setBusy(false);
    setMsg(r.ok ? (r.data?.reused ? 'Suggestions are up to date. Your edits are kept.' : 'Suggestions refreshed. Your edits are kept.') : r.message);
    await reload();
  };

  const covered = `${view.coverage.covered} of ${view.coverage.total} required items covered`;
  const scale = view.template.scoreKeys.map((k) => `${k.label} ${k.points}`).join(' · ');
  return (
    <div className="min-w-0 space-y-4" data-rubric-editor>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{field.label}</p>
          <p className="text-xs text-fg-muted">
            {view.criteria.length} criteria{view.template.fixedSet ? ' from the template' : ''}, scored {scale}.
          </p>
        </div>
        <span className={view.coverage.gaps.length ? PILL.warn : PILL.ok}>Coverage: {covered}</span>
        <span className={todo.length ? PILL.warn : PILL.ok} data-to-finish-count>
          {todo.length} to finish
        </span>
        {!readOnly && (
          <>
            <button type="button" className={btn} disabled={busy} onClick={() => refresh('DERIVED')}>
              Refresh suggestions
            </button>
            {view.aiEnabled && (
              <button type="button" className={btn} disabled={busy} onClick={() => refresh('AI')}>
                Suggest wording (AI)
              </button>
            )}
          </>
        )}
      </div>
      {msg && (
        <p role="status" className="text-sm text-fg-muted">
          {msg}
        </p>
      )}
      <p className="text-xs text-fg-muted">What should the agent do, Derived from, When does this apply, the whole-task failure condition and the evidence are kept in ADI Forge. RL Gym doesn’t receive them yet.</p>

      <SourcesCard taskId={taskId} view={view} readOnly={readOnly} reload={reload} onOpenSource={onOpenSource} />

      {todo.length > 0 && <ToFinishList todo={todo} onJump={(id) => setOpen((o) => ({ ...o, [id]: true }))} />}

      <ol className="space-y-3">
        {view.criteria.map((c) => {
          const item = items.find((i) => i.id === c.id) ?? { id: c.id };
          const isOpen = open[c.id] ?? false;
          return (
            <li key={c.id} id={`rubric-${c.id}`} className="min-w-0 overflow-hidden rounded-md border border-line" data-criterion={c.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}>
                <span className="font-mono text-xs text-fg-muted">{c.id}</span>
                <strong className="text-sm">{String(item.name ?? '') || c.id}</strong>
                <ApplicabilityPill kind={c.details.applicability.kind} />
                {item.critical === true && <span className={PILL.err}>Whole-task failure</span>}
                {c.sourceChanged && <span className={PILL.warn}>Source changed — check rubric</span>}
                {c.needs.length > 0 && <span className={PILL.warn}>Source link needed</span>}
                {!c.exportable && <span className={PILL.mute}>Internal only · not sent to RL Gym</span>}
                {c.defaults ? c.changedFromDefault.length ? <span className={PILL.info}>Edited</span> : <span className={PILL.mute}>Template default</span> : null}
                <span className="ml-auto text-xs text-fg-muted">{isOpen ? 'Close' : 'Open'}</span>
              </button>
              {isOpen && (
                <CriterionBody
                  c={c}
                  item={item}
                  view={view}
                  readOnly={readOnly}
                  aiScoring={aiScoring[c.id] ?? {}}
                  setItem={(p) => setItem(c.id, p)}
                  saveDetail={(b) => saveDetail(c, b)}
                  keep={async () => {
                    const r = await send('POST', `${base}/criteria/${encodeURIComponent(c.id)}/keep`, { expectedVersion: c.annotationVersion });
                    if (!r.ok) setMsg(r.message);
                    await reload();
                  }}
                  restore={async (version) => {
                    const r = await send<{ item: Record<string, unknown> | null }>('POST', `${base}/criteria/${encodeURIComponent(c.id)}/restore`, { submissionVersion: version });
                    if (!r.ok) return setMsg(r.message);
                    if (r.data?.item) setItem(c.id, r.data.item);
                    setMsg(`Restored ${c.id} as saved in version ${version}.`);
                    await reload();
                  }}
                  remove={!view.template.fixedSet ? () => onChange(items.filter((i) => i.id !== c.id)) : null}
                  onChangeApplicability={() => setAppl(c)}
                  onOpenSource={onOpenSource}
                />
              )}
            </li>
          );
        })}
      </ol>

      {!readOnly && !view.template.fixedSet && (
        <button type="button" className={btn} onClick={() => onChange([...items, newItem(field, items)])}>
          Add a custom criterion
        </button>
      )}

      {view.additions.length > 0 && (
        <section className="space-y-2" aria-labelledby="rubric-additions-h">
          <h3 id="rubric-additions-h" className="text-sm font-semibold">
            Suggested additions
          </h3>
          {view.additions.map((a) => (
            <div key={a.id} className="rounded-md border border-dashed border-line p-3 text-sm" data-addition={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                <strong>{a.name}</strong>
                {a.ai && <span className={PILL.ai}>AI suggestion</span>}
                {a.internalOnly && <span className={PILL.mute}>Internal only · not sent to RL Gym</span>}
                <span className={PILL.warn}>Evaluation setup needed</span>
                {a.status === 'KEPT' && <span className={PILL.info}>Kept as a note</span>}
              </div>
              <p className="mt-1">{a.details.assesses}</p>
              <p className="mt-1 text-xs text-fg-muted">{a.details.why} This template’s criteria are fixed, so an addition stays in ADI Forge and RL Gym doesn’t score it.</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.links.map((l) => (
                  <LinkChip key={l.target} link={l} onOpen={onOpenSource} />
                ))}
              </div>
              {!readOnly && a.status === 'SUGGESTED' && (
                <div className="mt-2 flex gap-2">
                  {(['KEEP', 'DISMISS'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={btn}
                      onClick={async () => {
                        const r = await send('POST', `${base}/additions/${encodeURIComponent(a.id)}/decision`, { decision: d, expectedVersion: a.annotationVersion });
                        if (!r.ok) setMsg(r.message);
                        await reload();
                      }}
                    >
                      {d === 'KEEP' ? 'Keep as internal note' : 'Dismiss'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {appl && (
        <ApplicabilityDialog
          c={appl}
          onCancel={() => setAppl(null)}
          onSave={async (a) => {
            await saveDetail(appl, { applicability: a });
            setAppl(null);
          }}
        />
      )}
    </div>
  );
}

function ApplicabilityPill({ kind }: { kind: ApplicabilityKind }) {
  const cls = kind === 'UNSET' || kind === 'UNKNOWN' ? PILL.warn : kind === 'REQUIRED' ? PILL.ok : PILL.info;
  return <span className={cls}>{RUBRIC_APPLICABILITY_LABELS[kind]}</span>;
}

export function LinkChip({ link, onOpen }: { link: ViewLink; onOpen: (l: ViewLink) => void }) {
  return (
    <button type="button" onClick={() => onOpen(link)} className={`rounded-md border px-2 py-0.5 text-xs ${link.state === 'OK' ? 'border-line' : 'border-warning text-warning'}`} data-link={link.target}>
      {link.label}
      {link.state === 'CHANGED' && ' · changed'}
      {link.state === 'REMOVED' && ' · removed'}
    </button>
  );
}

function ToFinishList({ todo, onJump }: { todo: ToFinish[]; onJump: (id: string) => void }) {
  return (
    <details className="rounded-md border border-warning/60 p-3 text-sm" data-to-finish>
      <summary className="cursor-pointer font-medium">Still to finish ({todo.length}). Saving never waits for these; submit runs the same checks as before.</summary>
      <ul className="mt-2 space-y-1">
        {todo.map((t, i) => (
          <li key={i}>
            {t.criterionId ? (
              <a
                href={`#rubric-${t.criterionId}`}
                className="text-link underline"
                onClick={() => onJump(t.criterionId!)}
              >
                {t.criterionId}
              </a>
            ) : (
              <span className="text-fg-muted">Coverage</span>
            )}
            : {t.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CriterionBody(p: {
  c: RubricCriterionView;
  item: Record<string, unknown>;
  view: RubricView;
  readOnly: boolean;
  aiScoring: Record<string, string>;
  setItem: (patch: Record<string, unknown>) => void;
  saveDetail: (b: Omit<SaveCriterionRequest, 'expectedVersion'>) => Promise<void>;
  keep: () => Promise<void>;
  restore: (version: number) => Promise<void>;
  remove: (() => void) | null;
  onChangeApplicability: () => void;
  onOpenSource: (l: ViewLink) => void;
}) {
  const { c, item, view, readOnly } = p;
  const d = c.defaults;
  const ai = (f: string) => c.aiFields.includes(f) && <span className={PILL.ai}>AI suggestion</span>;
  const wtf = c.details.wholeTaskFailure;
  const changed = c.links.filter((l) => l.state !== 'OK');
  const [restoreTo, setRestoreTo] = useState(view.history[0]?.version ?? 0);
  return (
    <div className="space-y-4 border-t border-line px-3 py-3 text-sm">
      {c.sourceChanged && (
        <div role="status" className="rounded-md border border-warning bg-warning/10 p-3">
          <p className="font-semibold text-warning">Source changed — check rubric</p>
          <p className="mt-1">These sources changed after this criterion was linked to them. Nothing here was changed for you.</p>
          <ul className="mt-1 space-y-1">
            {changed.map((l) => (
              <li key={l.target}>
                <strong>{l.label}</strong>
                {l.state === 'REMOVED' ? ' no longer exists.' : (
                  <span className="block text-xs text-fg-muted">
                    Linked text: “{l.excerpt}” · now: “{l.currentExcerpt}”
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <button type="button" className={`${btn} mt-2`} onClick={p.keep}>
              Reviewed, keep as is
            </button>
          )}
        </div>
      )}

      <Field label="Criterion name" note={d?.name ? (item.name !== d.name ? 'Edited' : 'From template') : 'From criterion ID'}>
        <input className={input} disabled={readOnly} value={String(item.name ?? '')} onChange={(e) => p.setItem({ name: e.target.value })} aria-label="Criterion name" />
        {d?.name && item.name !== d.name && !readOnly && (
          <button type="button" className="text-xs text-link underline" onClick={() => p.setItem({ name: d.name })}>
            Reset to template
          </button>
        )}
      </Field>

      <Field label="What should the agent do?" extra={ai('assesses')}>
        <BlurText disabled={readOnly} value={c.details.assesses} onCommit={(v) => p.saveDetail({ assesses: v })} label="What should the agent do?" />
      </Field>

      <Field label="Derived from" note="Linked automatically · nothing to maintain">
        <div className="flex flex-wrap gap-1">
          {c.links.map((l) => (
            <LinkChip key={l.target} link={l} onOpen={p.onOpenSource} />
          ))}
          {c.needs.map((n) => (
            <a key={n} href="#rubric-sources" className="rounded-md border border-dashed border-warning px-2 py-0.5 text-xs text-warning">
              Source link needed · {n} · add a source
            </a>
          ))}
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {[c.details.stepLabel, c.details.roleLabel, c.details.skill].filter(Boolean).join(' → ')} → this criterion
        </p>
        <p className="text-xs text-fg-muted">Why suggested: {c.details.why}</p>
        {c.details.unresolved.map((u) => (
          <p key={u} className="text-xs text-warning">
            {u}
          </p>
        ))}
      </Field>

      <Field label="When does this apply?">
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1">{c.details.applicability.condition || <em className="text-fg-muted">Not set yet.</em>}</p>
          <ApplicabilityPill kind={c.details.applicability.kind} />
          {!readOnly && (
            <button type="button" className={btn} onClick={p.onChangeApplicability}>
              Change
            </button>
          )}
        </div>
        {c.details.applicability.exceptions && <p className="text-xs text-fg-muted">Exception: {c.details.applicability.exceptions}</p>}
        {c.details.applicability.kind !== 'REQUIRED' && <p className="text-xs text-fg-muted">When it doesn’t apply: Not applicable, never full marks. When the run doesn’t show whether it applies: Unknown. Missing evidence isn’t the same as wrong behaviour.</p>}
        {c.proposed.applicability !== undefined && <p className="text-xs text-link">A refreshed suggestion differs from your wording; yours is kept.</p>}
      </Field>

      <Field label="How should we score it?" note={`Template scale: ${view.template.scoreKeys.map((k) => `${k.label} ${k.points}`).join(' · ')}`}>
        <div className="grid gap-3 sm:grid-cols-3">
          {view.template.scoreKeys.map((k) => {
            const dv = d?.[k.key];
            const v = String(item[k.key] ?? '');
            const suggestion = p.aiScoring[k.key];
            return (
              <label key={k.key} className="block text-xs text-fg-muted">
                <span className="font-semibold text-fg">
                  {k.label} · {k.points}
                </span>
                <textarea className={input} rows={3} disabled={readOnly} value={v} onChange={(e) => p.setItem({ [k.key]: e.target.value })} />
                {dv !== undefined && (v === dv ? <span>Template default</span> : (
                  <span>
                    Edited{' '}
                    {!readOnly && (
                      <button type="button" className="text-link underline" onClick={() => p.setItem({ [k.key]: dv })}>
                        Reset to template
                      </button>
                    )}
                  </span>
                ))}
                {!v.trim() && suggestion && !readOnly && (
                  <span className="mt-1 block">
                    <span className={PILL.ai}>AI suggestion</span> {suggestion}{' '}
                    <button type="button" className="text-link underline" onClick={() => p.setItem({ [k.key]: suggestion })}>
                      Use suggestion
                    </button>
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Whole-task failure">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={item.critical === true}
            onChange={(e) => {
              p.setItem({ critical: e.target.checked });
              if (e.target.checked && !wtf) void p.saveDetail({ wholeTaskFailure: { condition: d?.criticalCondition ?? '', kind: view.template.criterionFailureSupported ? 'FAIL_OF_CRITERION' : 'OTHER_BEHAVIOUR' } });
            }}
          />
          Make this a whole-task failure when…
        </label>
        {item.critical === true && (
          <div className="mt-2 space-y-1">
            <BlurText disabled={readOnly} value={wtf?.condition ?? ''} onCommit={(v) => p.saveDetail({ wholeTaskFailure: { condition: v, kind: wtf?.kind ?? 'FAIL_OF_CRITERION' } })} label="Whole-task failure condition" placeholder="Describe exactly what fails the whole task" />
            {!(wtf?.condition ?? '').trim() && <p className="text-xs text-warning">Write the condition. A ticked box alone isn’t enough.</p>}
            {(['FAIL_OF_CRITERION', 'OTHER_BEHAVIOUR'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2 text-xs">
                <input type="radio" name={`wtf-${c.id}`} disabled={readOnly} checked={(wtf?.kind ?? 'FAIL_OF_CRITERION') === k} onChange={() => p.saveDetail({ wholeTaskFailure: { condition: wtf?.condition ?? '', kind: k } })} />
                {k === 'FAIL_OF_CRITERION' ? (
                  <span>
                    It’s what a <strong>Fail</strong> on this criterion means {view.template.criterionFailureSupported && <span className={PILL.ok}>Supported</span>}
                  </span>
                ) : (
                  <span>It’s a specific behaviour that a Fail on this criterion doesn’t cover</span>
                )}
              </label>
            ))}
            {(wtf?.kind === 'OTHER_BEHAVIOUR' || !view.template.criterionFailureSupported) && (
              <p role="status" className="rounded-md border border-warning p-2 text-xs">
                <strong className="text-warning">Evaluation setup needed.</strong> This template can’t apply that condition yet. It’s kept as a note in ADI Forge; nothing new is sent to RL Gym.
              </p>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-fg-muted">{view.template.wholeTaskRule}</p>
      </Field>

      <Field label="What evidence should support the score?" extra={ai('evidenceRequired')}>
        <BlurText disabled={readOnly} value={c.details.evidenceRequired} onCommit={(v) => p.saveDetail({ evidenceRequired: v })} label="What evidence should support the score?" />
      </Field>

      <Field label="How it will be checked">
        {c.howChecked.text ? <p>{c.howChecked.text}</p> : <p className="font-semibold text-warning">Evaluation setup needed.</p>}
      </Field>

      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 font-medium">Technical grading settings · From template</summary>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 px-3 pb-3 text-xs sm:grid-cols-[12rem_1fr]">
          {c.technical.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-fg-muted">{r.label}</dt>
              <dd>
                <span className="font-mono">{r.value}</span> <span className="text-fg-muted">· {r.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="px-3 pb-3 text-xs text-fg-muted">Read-only. These come from the template and can’t be typed here. A mapping here doesn’t mean the evaluator is ready in RL Gym.</p>
      </details>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {view.history.length > 0 && (
            <>
              <label className="text-xs text-fg-muted">
                Restore from saved version{' '}
                <select className="rounded-md border border-line bg-surface px-1 py-0.5" value={restoreTo} onChange={(e) => setRestoreTo(Number(e.target.value))}>
                  {view.history.map((h) => (
                    <option key={h.version} value={h.version}>
                      Version {h.version}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={btn} onClick={() => p.restore(restoreTo)}>
                Restore
              </button>
            </>
          )}
          {p.remove && (
            <button type="button" className={`${btn} ml-auto`} onClick={p.remove}>
              Remove criterion
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, note, extra, children }: { label: string; note?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
        {label}
        {note && <span className="text-xs font-normal text-fg-muted">{note}</span>}
        {extra}
      </p>
      {children}
    </div>
  );
}

/** A textarea that saves when it loses focus (the internal fields save through the rubric API, not autosave). */
function BlurText({ value, onCommit, disabled, label, placeholder }: { value: string; onCommit: (v: string) => void; disabled: boolean; label: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea aria-label={label} className={input} rows={2} disabled={disabled} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} />;
}

function ApplicabilityDialog({ c, onCancel, onSave }: { c: RubricCriterionView; onCancel: () => void; onSave: (a: RubricCriterionView['details']['applicability']) => Promise<void> }) {
  const [kind, setKind] = useState<ApplicabilityKind>(c.details.applicability.kind === 'UNSET' || c.details.applicability.kind === 'UNKNOWN' ? 'REQUIRED' : c.details.applicability.kind);
  const [condition, setCondition] = useState(c.details.applicability.condition);
  const [exceptions, setExceptions] = useState(c.details.applicability.exceptions);
  const KINDS: [ApplicabilityKind, string, string][] = [
    ['REQUIRED', 'Required throughout this workflow', 'Assessed on every application this task covers.'],
    ['REQUIRED_WHEN', 'Required only when a condition applies', 'If the condition doesn’t apply, the result is Not applicable, never full marks. If the run doesn’t show whether it applies, it’s Unknown.'],
    ['PERMITTED_OPTION', 'A permitted option', 'The agent may choose this route. Its conditions are assessed only when it’s chosen; it’s never compulsory.'],
    ['OTHER_ROLE', 'Belongs to a human officer or another role', 'Assessed as “the agent routes it correctly”, never as the agent exercising that authority.'],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="appl-h" className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-xl border border-line bg-surface p-5 text-sm">
        <h2 id="appl-h" className="text-lg font-semibold">
          When does this apply?
        </h2>
        <p className="font-mono text-xs text-fg-muted">{c.id}</p>
        <fieldset className="mt-2 space-y-2">
          <legend className="sr-only">Kind</legend>
          {KINDS.map(([k, t, h]) => (
            <label key={k} className="flex items-start gap-2">
              <input type="radio" name="appl-kind" checked={kind === k} onChange={() => setKind(k)} className="mt-1" />
              <span>
                <strong>{t}</strong>
                <span className="block text-xs text-fg-muted">{h}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="mt-3 block">
          Condition
          <textarea className={input} rows={2} value={condition} onChange={(e) => setCondition(e.target.value)} />
        </label>
        <label className="mt-2 block">
          Exceptions (optional)
          <textarea className={input} rows={2} value={exceptions} onChange={(e) => setExceptions(e.target.value)} />
        </label>
        <p className="mt-2 text-xs text-fg-muted">Product and state come from each application RL Gym runs, never from the example state.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave({ kind, condition, exceptions })}>
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Sources used for this task": real checkboxes, ticked from what the task uses; add another from a list of names. */
function SourcesCard({ taskId, view, readOnly, reload, onOpenSource }: { taskId: string; view: RubricView; readOnly: boolean; reload: () => Promise<void>; onOpenSource: (l: ViewLink) => void }) {
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  void onOpenSource;
  const save = async (ticked: string[], added: string[]) => {
    const r = await send('PUT', `/api/v1/me/tasks/${taskId}/rubric/sources`, { expectedVersion: view.sources.version, ticked, added });
    setErr(r.ok ? null : r.message);
    await reload();
  };
  const tickedRefs = view.sources.items.filter((i) => i.ticked).map((i) => i.ref);
  return (
    <section id="rubric-sources" aria-labelledby="rubric-sources-h" className="rounded-md border border-line p-3">
      <h3 id="rubric-sources-h" className="text-sm font-semibold">
        Sources used for this task
      </h3>
      <p className="text-xs text-fg-muted">Ticked for you from what this task already uses. Untick a source the task didn’t use, or add another. The criteria link to the ticked sources automatically.</p>
      <ul className="mt-2 space-y-1">
        {view.sources.items.map((s) => (
          <li key={s.ref}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={readOnly} checked={s.ticked} onChange={(e) => save(e.target.checked ? [...tickedRefs, s.ref] : tickedRefs.filter((r) => r !== s.ref), [])} />
              <span>
                {s.label}
                <span className="block text-xs text-fg-muted">
                  {s.detail}
                  {s.origin === 'ADDED' ? ' · added by you' : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <>
          <button type="button" className={`${btn} mt-2`} disabled={!view.sources.available.length} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            Add another source
          </button>
          {adding && (
            <ul className="mt-2 rounded-md border border-line">
              {view.sources.available.map((a) => (
                <li key={a.ref}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-line/40"
                    onClick={async () => {
                      setAdding(false);
                      await save([...tickedRefs, a.ref], [a.ref]);
                    }}
                  >
                    {a.label}
                    <span className="block text-xs text-fg-muted">{a.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && (
        <p role="alert" className="mt-1 text-sm text-error">
          {err}
        </p>
      )}
    </section>
  );
}

/** The source passage of a link, with its section and version (opened from any "Derived from" chip). */
export function SourcePanel({ link, onClose, onOpenInForm }: { link: ViewLink; onClose: () => void; onOpenInForm: ((l: ViewLink) => void) | null }) {
  const where = [link.section && link.field ? `${link.section} › ${link.field}` : null, link.itemPath ?? null, link.ruleKey ? `rule ${link.ruleKey}` : null].filter(Boolean).join(' · ');
  const version = [link.taskRevision !== undefined ? `task revision ${link.taskRevision}` : null, link.templateVersion !== undefined ? `template v${link.templateVersion}` : null, link.ruleVersionId ? 'published rule version' : null].filter(Boolean).join(' · ');
  return (
    <aside role="dialog" aria-labelledby="src-h" className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="src-h" className="text-sm font-semibold">
          {link.label}
        </h2>
        <button type="button" className="ml-auto text-sm text-link underline" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="space-y-2 overflow-auto p-4 text-sm">
        {where && <p className="text-xs text-fg-muted">{where}</p>}
        <p className="text-xs">
          <span className={PILL.info}>{version || 'version recorded with the link'}</span>
        </p>
        <blockquote className="rounded-r-md border-l-4 border-link bg-line/30 px-3 py-2">{link.excerpt}</blockquote>
        {link.state === 'CHANGED' && (
          <p className="text-warning">
            Now: <span className="text-fg">{link.currentExcerpt}</span>
          </p>
        )}
        <p className="text-xs text-fg-muted">This is the passage the link was based on. It’s kept with the link, so a later change is detected.</p>
        {onOpenInForm && link.section && (
          <button type="button" className={btn} onClick={() => onOpenInForm(link)}>
            Open in the form
          </button>
        )}
      </div>
    </aside>
  );
}
