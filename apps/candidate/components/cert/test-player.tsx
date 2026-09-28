'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';
import type { Answer, AttemptInProgress, TestItem } from '@/lib/supply-types';

type IntegrityType = 'PASTE' | 'BLUR' | 'FOCUS' | 'VISIBILITY_HIDDEN' | 'VISIBILITY_VISIBLE' | 'FULLSCREEN_EXIT';
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'closed';

const WRITTEN = ['JUSTIFICATION', 'CRITIQUE', 'AUTHORING'];
const CHOICE = ['SINGLE_CHOICE', 'SEVERITY', 'LABEL'];

/** Whether an item counts as answered (an empty flag list on a trajectory review is a real answer: "no problems"). */
export function isAnswered(item: TestItem, a: Answer | undefined): boolean {
  if (a === undefined) return false;
  if (item.itemType === 'TRAJECTORY_REVIEW' || item.itemType === 'ORDERING') return Array.isArray(a);
  return Array.isArray(a) ? a.length > 0 : a.trim().length > 0;
}

function fmtRemaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * The timed test: one question at a time with a question map, autosave (1.5 s after a change, retried every 10 s while
 * offline), integrity events (paste, focus and visibility changes) logged in batches, and submission with a
 * confirmation. At the deadline it saves and submits by itself.
 */
export function TestPlayer({ attempt, tierLabel, domain, onSubmitted }: { attempt: AttemptInProgress; tierLabel: string; domain: string; onSubmitted: () => Promise<void> | void }) {
  const items = attempt.items;
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => ({ ...(attempt.answers ?? {}) }));
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => !isAnswered(i, attempt.answers?.[i.id]))));
  const [save, setSave] = useState<SaveState>('idle');
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsaved = useRef<Record<string, Answer>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const events = useRef<{ type: IntegrityType; at: string }[]>([]);
  const done = useRef(false);
  const deadline = new Date(attempt.deadlineAt).getTime();
  const remaining = deadline - now;
  const item = items[index]!;
  const answeredCount = items.filter((i) => isAnswered(i, answers[i.id])).length;

  // ── Autosave ──
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const batch = unsaved.current;
    if (!Object.keys(batch).length) return true;
    unsaved.current = {};
    setSave('saving');
    const r = await call<{ saved: number }>('PUT', `/me/test-attempts/${attempt.attemptId}/answers`, { answers: batch });
    if (r.ok) {
      setSave(Object.keys(unsaved.current).length ? 'idle' : 'saved');
      return true;
    }
    if (r.code === 'TIME_UP' || r.code === 'SUBMITTED') {
      setSave('closed');
      return false;
    }
    unsaved.current = { ...batch, ...unsaved.current };
    setSave('error');
    return false;
  }, [attempt.attemptId]);

  const setAnswer = useCallback(
    (id: string, v: Answer) => {
      if (done.current) return;
      setAnswers((a) => ({ ...a, [id]: v }));
      unsaved.current[id] = v;
      setSave('idle');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 1500);
    },
    [flush],
  );

  useEffect(() => {
    if (save !== 'error') return;
    const t = setTimeout(() => void flush(), 10_000);
    return () => clearTimeout(t);
  }, [save, flush]);

  // ── Integrity events: logged for reviewers, never used alone to fail anyone ──
  const flushEvents = useCallback(async () => {
    if (!events.current.length) return;
    const batch = events.current.splice(0, 50);
    const r = await call('POST', `/me/test-attempts/${attempt.attemptId}/integrity`, { events: batch });
    if (!r.ok && r.status !== 409 && r.status !== 404) events.current = [...batch, ...events.current].slice(-200);
  }, [attempt.attemptId]);

  useEffect(() => {
    const log = (type: IntegrityType) => {
      if (!done.current) events.current.push({ type, at: new Date().toISOString() });
    };
    let wasFullscreen = !!document.fullscreenElement;
    const onPaste = () => log('PASTE');
    const onBlur = () => log('BLUR');
    const onFocus = () => log('FOCUS');
    const onVisibility = () => log(document.visibilityState === 'hidden' ? 'VISIBILITY_HIDDEN' : 'VISIBILITY_VISIBLE');
    const onFullscreen = () => {
      if (wasFullscreen && !document.fullscreenElement) log('FULLSCREEN_EXIT');
      wasFullscreen = !!document.fullscreenElement;
    };
    document.addEventListener('paste', onPaste);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    const t = setInterval(() => void flushEvents(), 5000);
    return () => {
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearInterval(t);
    };
  }, [flushEvents]);

  // Warn before leaving with unsaved answers.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!done.current && Object.keys(unsaved.current).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ── Submission ──
  const submit = useCallback(
    async (auto: boolean) => {
      if (done.current) return;
      done.current = true;
      setSubmitting(true);
      setError(null);
      await flush();
      await flushEvents();
      const r = await call('POST', `/me/test-attempts/${attempt.attemptId}/submit`);
      if (r.ok || r.code === 'SUBMITTED') {
        await onSubmitted();
        return;
      }
      done.current = false;
      setSubmitting(false);
      setError(auto ? `Time is up, but we couldn’t submit just now (${r.error}). Your saved answers will be marked automatically; you can also press Submit again.` : (r.error ?? 'We couldn’t submit your test. Check your connection and press Submit again.'));
    },
    [attempt.attemptId, flush, flushEvents, onSubmitted],
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (remaining <= 0 && !done.current) void submit(true);
  }, [remaining, submit]);

  const low = remaining < 5 * 60_000;
  const saveText: Record<SaveState, string> = { idle: Object.keys(unsaved.current).length ? 'Unsaved changes' : '', saving: 'Saving…', saved: 'All answers saved', error: 'Offline: your answers are kept here and will save when you reconnect', closed: 'Time is up: answers can no longer be changed' };

  return (
    <div className="mt-3">
      <div className="sticky top-14 z-10 -mx-4 border-b border-hairline bg-bg/95 px-4 py-3 backdrop-blur sm:top-16">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <p className="font-semibold">
            {tierLabel} test <span className="font-normal text-fg-muted">· {domain}</span>
          </p>
          <p role="timer" aria-label="Time left" className={`ml-auto font-mono text-base font-semibold ${low ? 'text-warning' : ''}`}>
            {fmtRemaining(remaining)}
            <span className="sr-only"> left</span>
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
          <span>
            {answeredCount} of {items.length} answered
          </span>
          <span aria-live="polite" className={save === 'error' ? 'text-warning' : ''}>
            {saveText[save]}
          </span>
        </div>
      </div>

      <p className="mt-4 rounded-md border border-line p-3 text-xs text-fg-muted">
        Pasting text and leaving this page are logged for the reviewers. They never fail anyone on their own. Work on your own and keep this page open until you submit.
      </p>

      <div className="mt-5 grid gap-6 md:grid-cols-[1fr_13rem]">
        <section aria-labelledby={`q-${item.id}`} className="card min-w-0 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Question {item.number} of {items.length}
          </p>
          <h2 id={`q-${item.id}`} className="mt-2 whitespace-pre-wrap font-medium leading-relaxed">
            {item.stem}
          </h2>
          <div className="mt-4 text-sm">
            <ItemInput key={item.id} item={item} value={answers[item.id]} disabled={submitting || save === 'closed'} onChange={(v) => setAnswer(item.id, v)} />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="btn btn-secondary">
              ← Previous
            </button>
            {index < items.length - 1 ? (
              <button type="button" onClick={() => setIndex(index + 1)} className="btn btn-primary">
                Next →
              </button>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="btn btn-primary">
                Review and submit
              </button>
            )}
          </div>
        </section>

        <nav aria-label="Questions" className="text-sm">
          <p className="font-medium">Questions</p>
          <ol className="mt-2 grid grid-cols-6 gap-1.5 md:grid-cols-5">
            {items.map((i, n) => {
              const a = isAnswered(i, answers[i.id]);
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(n)}
                    aria-current={n === index ? 'step' : undefined}
                    aria-label={`Question ${i.number}${a ? ', answered' : ', not answered'}`}
                    className={`h-9 w-full rounded-md border text-xs font-semibold ${n === index ? 'border-focus' : 'border-line'} ${a ? 'bg-primary/15' : ''}`}
                  >
                    {i.number}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-fg-muted">Shaded: answered.</p>
          <button type="button" onClick={() => setConfirming(true)} className="mt-4 w-full btn btn-secondary">
            Submit test
          </button>
        </nav>
      </div>

      {confirming && (
        <div role="alertdialog" aria-labelledby="confirm-h" aria-describedby="confirm-d" className="mt-6 rounded-lg border border-warning p-4 text-sm">
          <h2 id="confirm-h" className="font-semibold">
            Submit your test?
          </h2>
          <p id="confirm-d" className="mt-1">
            You have answered {answeredCount} of {items.length} questions.{answeredCount < items.length ? ' Unanswered questions score nothing.' : ''} You can’t change your answers after you submit.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={submitting} onClick={() => void submit(false)} className="btn btn-primary">
              {submitting ? 'Submitting…' : 'Yes, submit my test'}
            </button>
            <button type="button" disabled={submitting} onClick={() => setConfirming(false)} className="btn btn-secondary">
              Keep working
            </button>
          </div>
        </div>
      )}
      {submitting && !confirming && <p aria-live="polite" className="mt-6 text-sm">{remaining <= 0 ? 'Time is up. Submitting your saved answers…' : 'Submitting…'}</p>}
      {error && (
        <p role="alert" className="mt-4 text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function ItemInput({ item, value, disabled, onChange }: { item: TestItem; value: Answer | undefined; disabled: boolean; onChange: (v: Answer) => void }) {
  const t = item.itemType;
  const options = item.content.options ?? [];
  const steps = item.content.steps ?? [];

  if (CHOICE.includes(t))
    return (
      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose one answer</legend>
        <p className="mb-2 text-xs text-fg-muted">Choose one.</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <label key={i} className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input type="radio" name={item.id} checked={value === o} onChange={() => onChange(o)} className="mt-1" />
              <span className="whitespace-pre-wrap">{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );

  if (t === 'MULTI_CHOICE') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset disabled={disabled}>
        <legend className="sr-only">Choose all that apply</legend>
        <p className="mb-2 text-xs text-fg-muted">Choose all that apply.</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <label key={i} className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" checked={picked.includes(o)} onChange={(e) => onChange(options.filter((x) => (x === o ? e.target.checked : picked.includes(x))))} className="mt-1" />
              <span className="whitespace-pre-wrap">{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (t === 'ORDERING') return <Ordering item={item} value={value} disabled={disabled} onChange={onChange} />;

  if (t === 'TRAJECTORY_REVIEW') {
    const flagged = Array.isArray(value) ? value : null;
    return (
      <fieldset disabled={disabled}>
        <legend className="sr-only">Flag the steps that break the guidelines</legend>
        <p className="mb-2 text-xs text-fg-muted">Tick every step that breaks the guidelines. If none do, say so below.</p>
        <ol className="space-y-2">
          {steps.map((s, n) => (
            <li key={s.id}>
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="checkbox" checked={!!flagged?.includes(s.id)} onChange={(e) => onChange(steps.filter((x) => (x.id === s.id ? e.target.checked : !!flagged?.includes(x.id))).map((x) => x.id))} className="mt-1" />
                <span className="min-w-0">
                  <span className="font-semibold">Step {n + 1}. </span>
                  <span className="whitespace-pre-wrap">{s.text}</span>
                </span>
              </label>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => onChange([])} aria-pressed={flagged !== null && flagged.length === 0} className="mt-3 chip">
          No step breaks the guidelines
        </button>
      </fieldset>
    );
  }

  if (WRITTEN.includes(t)) {
    const rubric = item.content.rubric ?? [];
    return (
      <div>
        {rubric.length > 0 && (
          <div className="mb-3 rounded-md border border-line p-3">
            <p className="text-xs font-semibold">What a good answer covers</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
              {rubric.map((r, i) => <li key={i}>{r.criterion}</li>)}
            </ul>
          </div>
        )}
        <label className="block">
          <span className="text-xs text-fg-muted">{t === 'AUTHORING' ? 'Write your task here. A person marks it against the guidelines.' : 'Write your answer. A person confirms the mark.'}</span>
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value.slice(0, 20_000))}
            disabled={disabled}
            rows={t === 'AUTHORING' ? 16 : 8}
            maxLength={20_000}
            className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5"
          />
        </label>
        <p className="mt-1 text-right text-xs text-fg-muted">{typeof value === 'string' ? value.length : 0} / 20,000</p>
      </div>
    );
  }

  return <p className="text-fg-muted">This question type can’t be shown. Move on to the next question; a person will look at it.</p>;
}

/** Ordering: up/down buttons (keyboard accessible). The answer is the step texts in the chosen order. */
function Ordering({ item, value, disabled, onChange }: { item: TestItem; value: Answer | undefined; disabled: boolean; onChange: (v: Answer) => void }) {
  const texts = (item.content.steps ?? []).map((s) => s.text);
  const saved = Array.isArray(value) && value.length === texts.length && value.every((v) => texts.includes(v)) ? value : null;
  const [order, setOrder] = useState<string[]>(saved ?? texts);
  const [announce, setAnnounce] = useState('');
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    onChange(next);
    setAnnounce(`Moved to position ${j + 1} of ${order.length}.`);
  };
  return (
    <div>
      <p className="mb-2 text-xs text-fg-muted">Put the steps in the right order using the Up and Down buttons.</p>
      <ol className="space-y-2">
        {order.map((text, i) => (
          <li key={text} className="flex items-start gap-3 rounded-lg border border-line p-3">
            <span className="w-6 shrink-0 font-semibold">{i + 1}.</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
            <span className="flex shrink-0 flex-col gap-1 sm:flex-row">
              <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`} className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40">
                ↑ Up
              </button>
              <button type="button" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`} className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40">
                ↓ Down
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {!saved && (
        <button type="button" disabled={disabled} onClick={() => onChange(order)} className="mt-3 chip">
          This order is my answer
        </button>
      )}
    </div>
  );
}
