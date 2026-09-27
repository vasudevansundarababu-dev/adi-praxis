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
  const endRef = useRef<HTMLDivElement>(null);
  const q = state.nextQuestion;

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
          <li key={t.id} className={`flex ${t.speaker === 'CANDIDATE' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${t.speaker === 'CANDIDATE' ? 'bg-primary text-on-primary' : t.speaker === 'SYSTEM' ? 'border border-warning' : 'bg-surface'}`}>
              {t.content}
              {t.redacted && <span className="mt-1 block text-xs opacity-80">Part of this message was removed to protect confidential information.</span>}
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      {failed && (
        <button type="button" disabled={pending} onClick={async () => { setPending(true); const r = await retryMessage(state.enrollment.id, failed.clientMessageId); setPending(false); if (r.ok) setState(r.data); else setError(r.message); }} className="mt-3 self-start rounded-md border border-line px-3 py-1.5 text-sm">
          Retry my last answer
        </button>
      )}

      {state.editable && q ? (
        <form
          className="sticky bottom-0 mt-4 space-y-2 border-t border-line bg-bg pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ content: text.trim() });
          }}
        >
          <p className="text-xs text-fg-muted">
            {q.section}
            {q.required ? '' : ' · optional'} ·{' '}
            <button type="button" onClick={() => setShowWhy(!showWhy)} className="text-link underline" aria-expanded={showWhy}>
              Why we ask
            </button>
          </p>
          {showWhy && <p className="text-xs">{q.why}</p>}
          {q.sensitive && <p className="text-xs text-warning">Use a generic or synthetic example. No customer names, account or ID numbers.</p>}
          <label htmlFor="answer" className="sr-only">Your answer</label>
          <textarea id="answer" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" placeholder="Type your answer…" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending || !text.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-60">
              {pending ? 'Saving…' : 'Send'}
            </button>
            <button type="button" disabled={pending} onClick={() => send({ quickReply: 'DONT_KNOW' })} className="rounded-md border border-line px-3 py-2 text-sm">I don’t know</button>
            <button type="button" disabled={pending} onClick={() => send({ quickReply: 'CANNOT_DISCLOSE' })} className="rounded-md border border-line px-3 py-2 text-sm">I can’t disclose</button>
            {!q.required && <button type="button" disabled={pending} onClick={() => send({ quickReply: 'SKIP' })} className="rounded-md border border-line px-3 py-2 text-sm">Skip</button>}
          </div>
        </form>
      ) : state.editable ? (
        <div className="mt-4 rounded-md border border-success p-3 text-sm">
          All questions are covered. <Link href={`/enrollments/${state.enrollment.id}/review`} className="text-link underline">Review and submit your profile</Link>.
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-line p-3 text-sm">This profile was submitted and can no longer be changed here.</p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </section>
  );

  const covered = state.questions.filter((x) => x.covered).length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Your SME profile: {state.enrollment.title}</h1>
        <span className="text-sm text-fg-muted">{covered} of {state.questions.length} topics covered · saved automatically</span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-surface"><div className="h-1 rounded-full bg-brand-gradient" style={{ width: `${(covered / Math.max(1, state.questions.length)) * 100}%` }} /></div>
      <nav className="mt-3 flex gap-4 text-sm">
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
