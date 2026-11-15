'use client';

import { chapterTime, TASK_HELP_SUGGESTIONS, tutorialKind, type Tutorial } from '@praxis/shared';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';

/**
 * MVP1 step 7 (docs/design/PROJECT-SCREEN-DESIGN.md, "Candidate app for MVP1"): the task page's Tutorial (the video
 * for this task's template, with chapters) and Help (an AI chat about this task and its form only). Help explains and
 * gives examples; it never writes the task and never decides.
 */
type Turn = { role: 'user' | 'assistant'; text: string };
export type AidsFor = 'author' | 'reviewer';

/** The tutorial card: a playable video for .mp4/.webm/.mov, a link for any other address, or a note when none. */
export function TutorialCard({ tutorial, onClose }: { tutorial: Tutorial | null | undefined; onClose?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const kind = tutorialKind(tutorial);
  const seek = (at: number) => {
    if (!video.current) return;
    video.current.currentTime = at;
    void video.current.play()?.catch(() => undefined);
  };
  return (
    <section aria-labelledby="tutorial-card-h" className="card mb-4 p-4">
      <div className="flex items-center gap-3">
        <h2 id="tutorial-card-h" className="text-base font-semibold">
          Tutorial
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-sm text-link hover:underline">
            Close
          </button>
        )}
      </div>
      {kind === 'none' || !tutorial ? (
        <p className="mt-2 text-sm text-fg-muted">No tutorial video for this task yet.</p>
      ) : (
        <>
          {kind === 'video' ? (
            <video ref={video} controls preload="metadata" src={tutorial.videoUrl} className="mt-3 w-full max-w-3xl rounded-md bg-black" aria-label="Tutorial video for this task's template">
              <a href={tutorial.videoUrl} target="_blank" rel="noopener noreferrer">
                Open the tutorial video
              </a>
            </video>
          ) : (
            <p className="mt-2 text-sm">
              <a href={tutorial.videoUrl} target="_blank" rel="noopener noreferrer" className="text-link underline">
                Open the tutorial video
              </a>
            </p>
          )}
          {tutorial.chapters.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-medium">Chapters</h3>
              <ol className="mt-1 space-y-1 text-sm">
                {tutorial.chapters.map((c, i) => (
                  <li key={i}>
                    {kind === 'video' ? (
                      <button type="button" onClick={() => seek(c.at)} className="text-left text-link hover:underline">
                        <span className="font-mono text-xs">{chapterTime(c.at)}</span> {c.title}
                      </button>
                    ) : (
                      <span>
                        <span className="font-mono text-xs">{chapterTime(c.at)}</span> {c.title}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The Help drawer: a note on what it does, suggested questions, the conversation, and a box to ask. */
export function HelpDrawer({ endpoint, kind, onClose }: { endpoint: string; kind: AidsFor; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [turns, pending]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setPending(true);
    setError(null);
    const history = turns.slice(-10);
    setTurns([...turns, { role: 'user', text }]);
    setQuestion('');
    const r = await call<{ answer: string }>('POST', endpoint, { question: text.slice(0, 1000), history });
    setPending(false);
    if (r.ok && r.data) setTurns((t) => [...t, { role: 'assistant', text: r.data!.answer }]);
    else {
      setError(r.status === 429 ? 'You have asked a lot of questions in the last minute. Wait a moment, then try again.' : (r.error ?? 'Help could not answer. Try again.'));
      setTurns((t) => t.slice(0, -1));
      setQuestion(text);
    }
  }

  return (
    <aside role="dialog" aria-labelledby="task-help-h" data-task-help className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-line bg-bg shadow-xl print:hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="task-help-h" className="text-base font-semibold">
          Help for this task
        </h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs">AI</span>
        <button type="button" onClick={onClose} className="ml-auto text-sm text-link hover:underline">
          Close
        </button>
      </header>
      <p className="px-4 pt-3 text-xs text-fg-muted">Answers questions about this task and its form only. It explains and gives examples; you write the task.</p>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'ml-6 rounded-lg bg-primary px-3 py-2 text-on-primary' : 'mr-6 rounded-lg border border-line px-3 py-2'}>
            <p className="sr-only">{t.role === 'user' ? 'You asked:' : 'Help:'}</p>
            <p className="whitespace-pre-wrap">{t.text}</p>
          </div>
        ))}
        {pending && <p className="text-fg-muted">Looking at this task…</p>}
        {error && (
          <p role="alert" className="rounded-md border border-error px-3 py-2">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <ul aria-label="Suggested questions" className="flex flex-wrap gap-2 px-4 pb-2">
        {TASK_HELP_SUGGESTIONS[kind].map((s) => (
          <li key={s}>
            <button type="button" className="chip text-left" disabled={pending} onClick={() => void ask(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="task-help-q" className="sr-only">
          Your question about this task
        </label>
        <input id="task-help-q" ref={input} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this task" className="min-w-0 grow rounded-md border border-line bg-surface px-3 py-1.5 text-fg" />
        <button type="submit" disabled={pending || !question.trim()} className="btn btn-primary disabled:opacity-60">
          Ask
        </button>
      </form>
    </aside>
  );
}

/** The Tutorial button (top of the page) and the floating Help button (D13) for a task or review page, with their card and drawer. */
export function TaskAids({ taskId, kind, tutorial, initial = null }: { taskId: string; kind: AidsFor; tutorial: Tutorial | null | undefined; initial?: 'tutorial' | 'help' | null }) {
  const [showTutorial, setShowTutorial] = useState(initial === 'tutorial');
  const [showHelp, setShowHelp] = useState(initial === 'help');
  const endpoint = kind === 'reviewer' ? `/me/reviews/${taskId}/help` : `/me/tasks/${taskId}/help`;
  return (
    <div className="mb-2">
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" aria-expanded={showTutorial} onClick={() => setShowTutorial((v) => !v)}>
          ▶ Tutorial
        </button>
      </div>
      {/* D13 (owner, 15 Nov 2026): Help floats, so it never scrolls away. Bottom-right, above the sticky Save bar (it never
          covers Save, Submit or a field), keyboard reachable with a focus ring, hidden in print and while the drawer is open. */}
      {!showHelp && (
        <button
          type="button"
          data-help-fab
          aria-expanded={false}
          aria-label="Help for this task"
          onClick={() => setShowHelp(true)}
          className="btn btn-primary fixed bottom-20 right-4 z-40 rounded-full px-4 py-2 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link sm:bottom-24 sm:right-6 print:hidden"
        >
          ? Help
        </button>
      )}
      {showTutorial && (
        <div className="mt-3">
          <TutorialCard tutorial={tutorial} onClose={() => setShowTutorial(false)} />
        </div>
      )}
      {showHelp && <HelpDrawer endpoint={endpoint} kind={kind} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
