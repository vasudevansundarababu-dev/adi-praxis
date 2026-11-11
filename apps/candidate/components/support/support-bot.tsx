'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Help for authors (owner, 12 Nov 2026): the console's Support Bot in the SME app (copied from apps/web; keep in step).
 * Support Bot (docs/SUPPORT-BOT.md): a Help button on the SME's task and home screens. It opens a panel where
 * the user asks about the screen — what to enter, which fields are required, the business process. With each question
 * it sends a description of the screen (title, headings, messages, form fields with required flags and options); the
 * API adds the record on screen using the user's own permissions. It explains; it never changes anything.
 */
type Turn = { role: 'user' | 'assistant'; text: string };
type Field = { label: string; name?: string; type: string; required: boolean; value?: string; options?: string[]; help?: string };

const clean = (s: string | null | undefined, max = 200) => (s ?? '').replace(/\s+/g, ' ').replace(/\*\s*\(required\)|\(required\)/gi, '').replace(/\s*\*\s*$/, '').trim().slice(0, max);

function labelOf(el: HTMLElement): string {
  const id = el.getAttribute('id');
  const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const wrap = el.closest('label');
  const text = (lab: Element | null) => {
    if (!lab) return '';
    const copy = lab.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('input,select,textarea,button,.sr-only').forEach((n) => n.remove());
    return clean(copy.textContent);
  };
  return text(byFor) || text(wrap) || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name')) || 'Unlabelled field';
}

const isRequired = (el: HTMLElement) =>
  (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || !!el.closest('label')?.querySelector('.text-error[aria-hidden="true"]');

/** A description of what is on screen, for the bot. Password values are never read. */
function describeScreen(path: string) {
  const main = document.querySelector('main') ?? document.body;
  const fields: Field[] = [];
  const radios = new Map<string, Field>();
  main.querySelectorAll<HTMLElement>('input, select, textarea').forEach((el) => {
    if (el.closest('[data-support-bot]')) return;
    const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'text' : ((el as HTMLInputElement).type || 'text');
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    if (type === 'radio') {
      const name = (el as HTMLInputElement).name || labelOf(el);
      const group = radios.get(name) ?? { label: clean(el.closest('fieldset')?.querySelector('legend')?.textContent) || name, name, type: 'choice', required: false, options: [] };
      group.options!.push(labelOf(el));
      group.required ||= isRequired(el) || el.closest('fieldset')?.querySelector('legend .text-error') !== null;
      if ((el as HTMLInputElement).checked) group.value = labelOf(el);
      radios.set(name, group);
      return;
    }
    const f: Field = { label: labelOf(el), name: el.getAttribute('name') ?? undefined, type, required: isRequired(el) };
    if (type === 'select') f.options = Array.from((el as HTMLSelectElement).options).map((o) => clean(o.textContent)).filter(Boolean).slice(0, 50);
    if (type === 'checkbox') f.value = (el as HTMLInputElement).checked ? 'ticked' : 'not ticked';
    else if (type !== 'password' && type !== 'file') {
      const v = (el as HTMLInputElement).value;
      if (v) f.value = v.slice(0, 500);
    }
    const describedBy = el.getAttribute('aria-describedby');
    const help = describedBy ? document.getElementById(describedBy)?.textContent : el.closest('label')?.querySelector('span.text-xs, .text-fg-muted')?.textContent;
    if (help) f.help = clean(help, 300);
    fields.push(f);
  });
  fields.push(...radios.values());
  return {
    path,
    title: clean(main.querySelector('h1')?.textContent) || clean(document.title),
    headings: Array.from(main.querySelectorAll('h2, h3')).map((h) => clean(h.textContent)).filter(Boolean).slice(0, 20),
    messages: Array.from(main.querySelectorAll('[role="alert"], [role="status"]')).map((m) => clean(m.textContent, 300)).filter(Boolean).slice(0, 10),
    fields: fields.slice(0, 80),
  };
}

const SUGGESTIONS = ['What do I need to fill in on this screen?', 'What happens after I submit this?', 'Why did my task come back to me?', 'How do I propose a policy document?'];

export function SupportBot({ endpoint = '/api/v1/me/support/ask' }: { endpoint?: string }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 2 || pending) return;
    setPending(true);
    setError(null);
    const history = turns.slice(-10);
    setTurns([...turns, { role: 'user', text }]);
    setQuestion('');
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text, history, screen: describeScreen(pathname) }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(res.status === 429 ? 'You have asked a lot of questions in the last minute. Wait a moment, then try again.' : (json?.message ?? 'The Support Bot could not answer. Try again.'));
        setTurns((t) => t.slice(0, -1));
        setQuestion(text);
      } else setTurns((t) => [...t, { role: 'assistant', text: json.answer as string }]);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setTurns((t) => t.slice(0, -1));
      setQuestion(text);
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-support-bot className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 print:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {open && (
        <section role="dialog" aria-label="Support Bot" className="card flex max-h-[min(36rem,80vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden shadow-xl">
          <header className="flex items-start justify-between gap-3 bg-brand-navy px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-semibold">Support Bot</h2>
              <p className="text-xs text-white/75">Ask about this screen or the process. It sees only your own task. It explains; it never writes your answers.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-white/85 hover:bg-white/10" aria-label="Close the Support Bot">
              ✕
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-fg-muted">I explain what each field needs, which ones are required, and what happens next. I can’t change anything or make decisions for you.</p>
                <ul className="space-y-1">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => void ask(s)} className="chip text-left">
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'ml-6 rounded-lg bg-primary px-3 py-2 text-on-primary' : 'mr-6 rounded-lg border border-line px-3 py-2'}>
                <p className="sr-only">{t.role === 'user' ? 'You asked:' : 'Support Bot:'}</p>
                <p className="whitespace-pre-wrap">{t.text}</p>
              </div>
            ))}
            {pending && <p className="text-fg-muted">Looking at this screen…</p>}
            {error && (
              <p role="alert" className="rounded-md border border-error px-3 py-2">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="support-question" className="sr-only">
              Your question
            </label>
            <textarea
              id="support-question"
              ref={inputRef}
              rows={2}
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              placeholder="Ask a question (Enter to send)"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-fg"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">Don’t type passwords or personal data.</p>
              <button type="submit" disabled={pending || question.trim().length < 2} className="btn btn-primary disabled:opacity-60">
                Ask
              </button>
            </div>
          </form>
        </section>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-primary rounded-full px-4 shadow-lg">
        {open ? 'Close help' : 'Help'}
      </button>
    </div>
  );
}
