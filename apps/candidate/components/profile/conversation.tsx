'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadState, retryMessage, sendMessage, startConversation } from '@/lib/profile-client';
import type { ConversationState } from '@/lib/profile-types';
import { ProfilePanel } from './profile-panel';

/** C04 — conversational profile: one focused question at a time, with the structured profile alongside. */
export function Conversation({ initial }: { initial: ConversationState }) {
  const [state, setState] = useState(initial);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [tab, setTab] = useState<'chat' | 'profile'>('chat');
  const [picked, setPicked] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const q = state.nextQuestion;
  const total = state.questions.length;
  const covered = state.questions.filter((x) => x.covered).length;
  const asked = covered + 1;

  // Enrollments started before the conversation existed are started on first visit.
  useEffect(() => {
    if (!state.session && state.editable) void startConversation(state.enrollment.id).then((r) => r.ok && setState(r.data));
  }, [state.session, state.editable, state.enrollment.id]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [state.turns.length]);

  async function send(body: { content?: string; quickReply?: string }) {
    if (!state.session) return;
    setPending(true);
    setError(null);
    // The id is created once per message, so a network retry is deduplicated by the server (CF-15).
    const r = await sendMessage(state.enrollment.id, { clientMessageId: crypto.randomUUID(), questionId: q?.id ?? null, expectedRevision: state.session.revision, ...body });
    setPending(false);
    if (r.ok) {
      setState(r.data);
      if (body.content) setText('');
      setPicked([]);
      return;
    }
    if (r.code === 'STALE_REVISION') {
      const fresh = await loadState(state.enrollment.id);
      if (fresh.ok) setState(fresh.data);
      setError('Your profile was updated in another tab or window. The latest version is shown; your unsent text is kept below.');
    } else setError(r.message);
  }

  const failed = [...state.turns].reverse().find((t) => t.speaker === 'CANDIDATE' && t.extractionStatus === 'FAILED');

  const chat = (
    <section aria-label="Conversation" className="flex min-h-[60vh] flex-col">
      <ol className="flex-1 space-y-3" aria-live="polite">
        {state.turns.map((t) => (
          <li key={t.id} className={`flex items-end gap-2 ${t.speaker === 'CANDIDATE' ? 'justify-end' : 'justify-start'}`}>
            {t.speaker !== 'CANDIDATE' && <span aria-hidden className="mb-1 h-7 w-7 shrink-0 rounded-full bg-brand-gradient" />}
            <div className={`max-w-[85%] whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${t.speaker === 'CANDIDATE' ? 'rounded-2xl rounded-br-md bg-gradient-to-br from-[#1f64b8] to-[#2a80d0] text-white' : t.speaker === 'SYSTEM' ? 'rounded-2xl border border-warning' : 'card rounded-2xl rounded-bl-md'}`}>
              {t.content}
              {t.redacted && <span className="mt-1 block text-xs opacity-80">Part of this message was removed to protect confidential information.</span>}
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      {failed && (
        <button type="button" disabled={pending} onClick={async () => { setPending(true); const r = await retryMessage(state.enrollment.id, failed.clientMessageId); setPending(false); if (r.ok) setState(r.data); else setError(r.message); }} className="mt-3 self-start btn btn-secondary">
          Retry my last answer
        </button>
      )}

      {state.editable && q ? (
        <form
          className="card sticky bottom-3 mt-5 space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const answer = [picked.join(', '), text.trim()].filter(Boolean).join('. ');
            if (answer) void send({ content: answer });
          }}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="pill pill-brand">Question {Math.min(asked, total)} of {total}</span>
            <span>{q.section}{q.required ? '' : ' · optional'}</span>
            <button type="button" onClick={() => setShowWhy(!showWhy)} className="ml-auto text-link underline" aria-expanded={showWhy}>
              Why we ask
            </button>
          </div>
          {showWhy && <p className="text-xs text-fg-muted">{q.why}</p>}
          {q.sensitive && <p className="text-xs text-warning">Keep it general: no customer names, account or ID numbers.</p>}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tap all that apply">
              {q.options.map((o) => (
                <button key={o} type="button" aria-pressed={picked.includes(o)} onClick={() => setPicked(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])} className="chip">
                  {o}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="answer" className="sr-only">Your answer</label>
          <textarea id="answer" rows={q.options.length ? 1 : 3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-[15px]" placeholder={q.options.length ? 'Anything else? (optional)' : 'Type your answer…'} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending || (!text.trim() && picked.length === 0)} className="btn btn-primary">
              {pending ? 'Saving…' : 'Send'}
            </button>
            <button type="button" disabled={pending} onClick={() => send({ quickReply: 'DONT_KNOW' })} className="btn btn-secondary">I don’t know</button>
            <button type="button" disabled={pending} onClick={() => send({ quickReply: 'CANNOT_DISCLOSE' })} className="btn btn-secondary">I can’t say</button>
            {!q.required && <button type="button" disabled={pending} onClick={() => send({ quickReply: 'SKIP' })} className="btn btn-secondary">Skip</button>}
          </div>
        </form>
      ) : state.editable ? (
        <div className="card mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="font-medium">All done. Check your answers and submit.</p>
          <Link href={`/enrollments/${state.enrollment.id}/review`} className="btn btn-primary">Review and submit →</Link>
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-line p-3 text-sm">This profile was submitted and can no longer be changed here.</p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </section>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-sm text-fg-muted">Your SME profile</p>
          <h1 className="text-2xl font-bold tracking-tight">{state.enrollment.title}</h1>
        </div>
        <span className="pill pill-info ml-auto">{covered} of {total} answered · saves automatically</span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-surface"><div className="h-2 rounded-full bg-brand-gradient transition-all" style={{ width: `${(covered / Math.max(1, total)) * 100}%` }} /></div>
      <nav className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href={`/enrollments/${state.enrollment.id}/form`} className="text-link underline">Prefer a form? Answer the same questions here</Link>
        <Link href={`/enrollments/${state.enrollment.id}/review`} className="text-link underline">Review and submit</Link>
      </nav>

      <div className="mt-4 flex gap-2 lg:hidden" role="tablist">
        {(['chat', 'profile'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`rounded-full border px-3 py-1 text-sm ${tab === t ? 'border-brand-blue' : 'border-line text-fg-muted'}`}>
            {t === 'chat' ? 'Chat' : `Your SME profile${state.readiness.unconfirmed.length ? ` (${state.readiness.unconfirmed.length} to confirm)` : ''}`}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className={tab === 'chat' ? '' : 'hidden lg:block'}>{chat}</div>
        <aside aria-label="Your SME profile" className={`${tab === 'profile' ? '' : 'hidden lg:block'} lg:max-h-[80vh] lg:overflow-y-auto`}>
          <ProfilePanel state={state} onChange={setState} readOnly={!state.editable} />
        </aside>
      </div>
    </div>
  );
}
