'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

/** M9 (docs/TASK-DRAFTING.md): start from a document, a transcript or an AI interview, then check each drafted section. */
export interface SourceFlag {
  kind: string;
  line: number;
  preview: string;
}
export interface DraftingView {
  sources: { id: string; kind: 'DOCUMENT' | 'TRANSCRIPT'; fileName: string; contentType: string; sizeBytes: number; textChars: number; flags: SourceFlag[]; uploadedAt: string }[];
  interview: {
    turns: { id: string; speaker: 'ASSISTANT' | 'AUTHOR'; questionId: string; content: string; redacted: boolean }[];
    next: { id: string; text: string; options: string[]; multi: boolean; required: boolean; why: string; number: number; total: number } | null;
    answered: number;
    total: number;
    complete: boolean;
  };
  runs: { id: string; section: string | null; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; sections: string[]; model: string | null; problems: string[]; notes: string | null; error: string | null; createdAt: string; finishedAt: string | null }[];
  sections: Record<string, { draftedAt: string; confirmedAt: string | null; editedAfterDraft: boolean }>;
}

/** Loads the drafting state and polls while a draft is being written; reloads the page once a new draft lands. */
export function useDrafting(taskId: string, enabled: boolean) {
  const [view, setView] = useState<DraftingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call<DraftingView>('GET', `/me/tasks/${taskId}/drafting`);
    if (r.ok) setView(r.data);
    else if (r.code !== 'NOT_DRAFTABLE') setError(r.error);
    return r.data;
  }, [taskId]);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  const running = view?.runs.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const v = await load();
      const latest = v?.runs[0];
      if (latest && latest.status === 'SUCCEEDED') {
        // The draft changed the task on the server: reload so the editor starts from it.
        window.location.reload();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [running, load]);
  return { view, setView, load, running, error };
}

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Upload({ taskId, kind, onDone }: { taskId: string; kind: 'DOCUMENT' | 'TRANSCRIPT'; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [declared, setDeclared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  async function send() {
    if (!file) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    // Fields before the file: the server reads them from the stream first.
    fd.append('kind', kind);
    fd.append('declaration', String(declared));
    fd.append('file', file);
    try {
      const res = await fetch(`/api/v1/me/tasks/${taskId}/sources`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? `Upload failed (${res.status})`);
      else {
        setFile(null);
        if (ref.current) ref.current.value = '';
        onDone();
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setPending(false);
  }
  const accept = kind === 'DOCUMENT' ? '.pdf,.docx,.txt' : '.pdf,.docx,.txt,.vtt,.srt';
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <span className="font-medium">{kind === 'DOCUMENT' ? 'Your document' : 'Interview transcript'}</span>
        <span className="block text-xs text-fg-muted">{kind === 'DOCUMENT' ? 'PDF, Word (.docx) or text, up to 10 MB: a procedure you wrote, your notes on a case pattern, public guidance, a training handout.' : 'PDF, Word, text, or captions (.vtt, .srt), up to 10 MB. Speaker names are kept as context.'}</span>
        <input ref={ref} type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1" />
        <span>This file contains no customer data, and I am allowed to share it. I understand that names, numbers and details will be replaced with invented ones.</span>
      </label>
      <button type="button" disabled={!file || !declared || pending} onClick={send} className="btn btn-primary disabled:opacity-50">
        {pending ? 'Uploading…' : 'Upload'}
      </button>
      {error && <p role="alert" className="text-error">{error}</p>}
    </div>
  );
}

function Interview({ taskId, view, onChange }: { taskId: string; view: DraftingView; onChange: (v: DraftingView['interview']) => void }) {
  const q = view.interview.next;
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  async function send(skip = false) {
    if (!q) return;
    setPending(true);
    setError(null);
    const content = [picked.join(', '), text.trim()].filter(Boolean).join('. ');
    const r = await call<DraftingView['interview']>('POST', `/me/tasks/${taskId}/interview/messages`, { clientMessageId: crypto.randomUUID(), questionId: q.id, content, skip });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setPicked([]);
    setText('');
    onChange(r.data!);
  }
  return (
    <div className="space-y-3">
      <ol className="space-y-2" aria-live="polite">
        {view.interview.turns.map((t) => (
          <li key={t.id} className={`flex ${t.speaker === 'AUTHOR' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${t.speaker === 'AUTHOR' ? 'rounded-br-md bg-gradient-to-br from-[#1f64b8] to-[#2a80d0] text-white' : 'card rounded-bl-md'}`}>
              {t.content}
              {t.redacted && <span className="mt-1 block text-xs opacity-80">Part of this answer was removed to protect confidential information.</span>}
            </div>
          </li>
        ))}
      </ol>
      {q ? (
        <form
          className="card space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="pill pill-brand">
              Question {q.number} of {q.total}
            </span>
            {!q.required && <span>optional</span>}
            <button type="button" onClick={() => setWhy(!why)} aria-expanded={why} className="ml-auto text-link underline">
              Why we ask
            </button>
          </div>
          <p className="font-medium">{q.text}</p>
          {why && <p className="text-xs text-fg-muted">{q.why}</p>}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={q.multi ? 'Tap all that apply' : 'Tap one'}>
              {q.options.map((o) => (
                <button key={o} type="button" aria-pressed={picked.includes(o)} className="chip" onClick={() => setPicked(q.multi ? (picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]) : picked.includes(o) ? [] : [o])}>
                  {q.multi && picked.includes(o) ? `${picked.indexOf(o) + 1}. ` : ''}
                  {o}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="interview-answer" className="sr-only">
            Your answer
          </label>
          <textarea id="interview-answer" rows={q.options.length ? 1 : 3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder={q.options.length ? 'Anything to add? (optional)' : 'Type your answer…'} className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm" />
          <p className="text-xs text-warning">Describe the pattern, never a real customer: no names, account or ID numbers.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending || (!text.trim() && !picked.length)} className="btn btn-primary disabled:opacity-50">
              {pending ? 'Saving…' : 'Send'}
            </button>
            {!q.required && (
              <button type="button" disabled={pending} onClick={() => send(true)} className="btn btn-secondary">
                Skip
              </button>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </form>
      ) : (
        <p className="card p-3 text-sm">Interview complete: {view.interview.answered} answers. Draft your task below.</p>
      )}
    </div>
  );
}

type Mode = 'DOCUMENT' | 'TRANSCRIPT' | 'INTERVIEW';
const MODES: { id: Mode | 'BLANK'; title: string; body: string }[] = [
  { id: 'INTERVIEW', title: 'Answer a short interview', body: 'Eight quick questions, mostly taps. The assistant drafts the task from your answers.' },
  { id: 'DOCUMENT', title: 'Start from a document', body: 'A procedure, your notes on a case pattern, public guidance or a training handout.' },
  { id: 'TRANSCRIPT', title: 'Start from an interview transcript', body: 'Someone interviewed you about a case? Upload the transcript or captions.' },
  { id: 'BLANK', title: 'Write it myself', body: 'Go straight to the sections and fill them in by hand.' },
];

/** W00: how to start. Sources and interview can be combined before asking for the draft. */
export function StartPanel(props: { taskId: string; drafting: ReturnType<typeof useDrafting>; onBlank: () => void; beforeDraft: () => Promise<unknown>; readOnly: boolean }) {
  const { view, setView, load, running } = props.drafting;
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  if (!view) return <p className="text-sm text-fg-muted">Loading…</p>;
  const latest = view.runs[0];
  const hasDraft = Object.keys(view.sections).length > 0;
  const canDraft = view.sources.length > 0 || view.interview.answered >= 3;

  async function draftAll() {
    setPending(true);
    setError(null);
    await props.beforeDraft();
    const r = await call('POST', `/me/tasks/${props.taskId}/drafts`, {});
    setPending(false);
    setConfirmReplace(false);
    if (!r.ok) return setError(r.error);
    await load();
  }
  async function remove(id: string) {
    const res = await fetch(`/api/v1/me/tasks/${props.taskId}/sources/${id}`, { method: 'DELETE', headers: { 'idempotency-key': crypto.randomUUID() } });
    if (!res.ok) setError((await res.json().catch(() => null))?.message ?? 'Could not remove the file.');
    await load();
  }

  return (
    <section className="space-y-5" aria-labelledby="w00-h">
      <div>
        <h2 id="w00-h" className="text-lg font-semibold">How do you want to start?</h2>
        <p className="text-sm text-fg-muted">The assistant writes a first draft of every section. You check and confirm each one; nothing is submitted until you do, and a Validator still decides.</p>
      </div>
      {!props.readOnly && (
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => (m.id === 'BLANK' ? props.onBlank() : setMode(m.id))} className={`card-link p-4 text-left ${mode === m.id ? 'ring-2 ring-brand-blue' : ''}`}>
              <span className="block font-semibold">{m.title}</span>
              <span className="mt-1 block text-sm text-fg-muted">{m.body}</span>
            </button>
          ))}
        </div>
      )}

      {mode === 'INTERVIEW' && <Interview taskId={props.taskId} view={view} onChange={(interview) => setView({ ...view, interview })} />}
      {(mode === 'DOCUMENT' || mode === 'TRANSCRIPT') && <Upload key={mode} taskId={props.taskId} kind={mode} onDone={load} />}

      {view.sources.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Your files</h3>
          <ul className="space-y-2 text-sm">
            {view.sources.map((s) => (
              <li key={s.id} className="card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.fileName}</span>
                  <span className="pill">{s.kind === 'DOCUMENT' ? 'Document' : 'Transcript'}</span>
                  <span className="text-xs text-fg-muted">
                    {size(s.sizeBytes)} · {s.textChars.toLocaleString()} characters read
                  </span>
                  {!props.readOnly && (
                    <button type="button" onClick={() => remove(s.id)} className="ml-auto text-link underline">
                      Remove
                    </button>
                  )}
                </div>
                {s.flags.length > 0 && (
                  <div role="status" className="mt-2 rounded-md border border-warning p-2">
                    <p className="font-medium text-warning">This file seems to contain real identifiers. The assistant will not use them, but please check. Remove the file if it holds customer data.</p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {s.flags.map((f, i) => (
                        <li key={i}>
                          Line {f.line} ({f.kind.toLowerCase().replace(/_/g, ' ')}): {f.preview}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!props.readOnly && (
        <div className="card space-y-2 p-4">
          <p className="font-medium">Draft my task</p>
          <p className="text-sm text-fg-muted">
            {canDraft ? `Uses ${view.sources.length} file(s) and ${view.interview.answered} interview answer(s). Takes about a minute; you can leave this page and come back.` : 'Upload a file or answer at least three interview questions first.'}
          </p>
          {running ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-brand-gradient" /> Writing your draft…
            </p>
          ) : hasDraft && !confirmReplace ? (
            <button type="button" disabled={!canDraft || pending} onClick={() => setConfirmReplace(true)} className="btn btn-secondary disabled:opacity-50">
              Draft again
            </button>
          ) : confirmReplace ? (
            <div className="space-y-2 text-sm">
              <p>Drafting again replaces every section you have not confirmed. Confirmed sections stay as they are.</p>
              <div className="flex gap-2">
                <button type="button" onClick={draftAll} disabled={pending} className="btn btn-primary">
                  Replace unconfirmed sections
                </button>
                <button type="button" onClick={() => setConfirmReplace(false)} className="btn btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!canDraft || pending} onClick={draftAll} className="btn btn-primary disabled:opacity-50">
              {pending ? 'Starting…' : 'Draft my task'}
            </button>
          )}
          {latest?.status === 'FAILED' && <p role="alert" className="text-sm text-error">{latest.error}</p>}
          {latest?.status === 'SUCCEEDED' && (latest.notes || latest.problems.length > 0) && (
            <div className="text-sm">
              <p className="font-medium">What the assistant assumed</p>
              {latest.notes && <p className="text-fg-muted">{latest.notes}</p>}
              {latest.problems.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-fg-muted">
                  {latest.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
        </div>
      )}
    </section>
  );
}

/** Shown at the top of a drafted section: check, confirm, or redraft it with an instruction. */
export function SectionDraftBanner(props: { taskId: string; section: string; state: DraftingView['sections'][string] | undefined; running: boolean; readOnly: boolean; onChanged: () => void; beforeDraft: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!props.state) return null;
  const confirmed = !!props.state.confirmedAt;
  async function confirm() {
    setPending(true);
    await props.beforeDraft();
    const r = await call('POST', `/me/tasks/${props.taskId}/sections/${props.section}/confirm`, {});
    setPending(false);
    if (!r.ok) return setError(r.error);
    props.onChanged();
  }
  async function redraft() {
    setPending(true);
    await props.beforeDraft();
    const r = await call('POST', `/me/tasks/${props.taskId}/drafts`, { section: props.section, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    props.onChanged();
  }
  return (
    <div role="status" className={`rounded-md border p-3 text-sm ${confirmed ? 'border-success' : 'border-warning'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`pill ${confirmed ? 'pill-success' : 'pill-warning'}`}>{confirmed ? 'Checked by you' : 'AI draft: check and confirm'}</span>
        <span className="text-xs text-fg-muted">
          Drafted {new Date(props.state.draftedAt).toLocaleString()}
          {props.state.editedAfterDraft ? ' · you have edited it' : ''}
        </span>
        {!props.readOnly && (
          <span className="ml-auto flex gap-2">
            {!confirmed && (
              <button type="button" disabled={pending || props.running} onClick={confirm} className="btn btn-primary disabled:opacity-50">
                I’ve checked this section
              </button>
            )}
            <button type="button" disabled={pending || props.running} onClick={() => setOpen(!open)} aria-expanded={open} className="btn btn-secondary">
              Redraft
            </button>
          </span>
        )}
      </div>
      {!confirmed && <p className="mt-1 text-xs text-fg-muted">Read every field. Fix anything that is wrong or unrealistic. Everything must stay invented.</p>}
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block">
            What should change? (optional)
            <input value={instruction} maxLength={1000} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. make the near match a trustee, not a director" className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          <p className="text-xs text-fg-muted">Redrafting replaces this section{confirmed ? ', and you will need to confirm it again' : ''}.</p>
          <button type="button" disabled={pending} onClick={redraft} className="btn btn-primary">
            Redraft this section
          </button>
        </div>
      )}
      {props.running && <p className="mt-1 text-xs">A draft is being written; this section will update when it finishes.</p>}
      {error && <p role="alert" className="mt-1 text-error">{error}</p>}
    </div>
  );
}
