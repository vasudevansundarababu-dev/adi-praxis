'use client';

import { useState } from 'react';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import type { CourseDetail, QuizQuestion } from './types';

type Module = CourseDetail['modules'][number];

/** One module: explanation, good and bad examples, quiz (answers marked), practice and citations. */
export function CourseModuleCard({ module: m, canEdit }: { module: Module; canEdit: boolean }) {
  const a = useAction();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [explanation, setExplanation] = useState(m.explanation);
  const [quiz, setQuiz] = useState(JSON.stringify(m.quiz, null, 2));
  const [quizError, setQuizError] = useState<string | null>(null);

  async function save() {
    let parsed: QuizQuestion[];
    try {
      parsed = JSON.parse(quiz) as QuizQuestion[];
      if (!Array.isArray(parsed)) throw new Error();
    } catch {
      return setQuizError('The quiz is not valid JSON. Each question needs question, options, answerIndex, feedback and citation.');
    }
    setQuizError(null);
    const res = await a.run('PATCH', `/course-modules/${m.id}`, { title: title.trim(), explanation: explanation.trim(), quiz: parsed }, { success: 'Module saved. The course needs approval again.' });
    if (res.ok) setEditing(false);
  }

  return (
    <article className="card p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-semibold">
          {m.position}. {m.title}
        </h2>
        <span className="text-xs text-fg-muted">Cites {m.citations.join(', ')}</span>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-link">
            Edit module
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
          </label>
          <label className="block">
            Explanation
            <textarea rows={8} value={explanation} onChange={(e) => setExplanation(e.target.value)} className={input} />
          </label>
          <label className="block">
            Quiz (JSON)
            <textarea rows={10} value={quiz} onChange={(e) => setQuiz(e.target.value)} className={`${input} font-mono text-xs`} spellCheck={false} />
          </label>
          {quizError && (
            <p role="alert" className="text-error">
              {quizError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={a.pending} onClick={save} className="btn btn-primary">
              Save module
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-line">{m.explanation}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="font-medium text-success">Good examples</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">{m.goodExamples.length ? m.goodExamples.map((x) => <li key={x}>{x}</li>) : <li className="text-fg-muted">None</li>}</ul>
            </div>
            <div>
              <h3 className="font-medium text-error">Bad examples</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">{m.badExamples.length ? m.badExamples.map((x) => <li key={x}>{x}</li>) : <li className="text-fg-muted">None</li>}</ul>
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">Quiz ({m.quiz.length} questions)</summary>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              {m.quiz.map((q, i) => (
                <li key={i}>
                  <p>{q.question}</p>
                  <ul className="mt-1 space-y-0.5">
                    {q.options.map((o, j) => (
                      <li key={j} className={j === q.answerIndex ? 'font-semibold text-success' : 'text-fg-muted'}>
                        {j === q.answerIndex ? '✓ ' : '○ '}
                        {o}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-fg-muted">
                    Feedback: {q.feedback} · cites {q.citation}
                  </p>
                </li>
              ))}
            </ol>
          </details>
          {m.practice.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">Practice ({m.practice.length})</summary>
              <ul className="mt-2 space-y-2">
                {m.practice.map((p, i) => (
                  <li key={i} className="rounded-md border border-line p-2">
                    <p>{p.prompt}</p>
                    <p className="mt-1 text-xs">
                      <span className="font-medium">Answer:</span> {p.answer}
                    </p>
                    <p className="text-xs text-fg-muted">{p.feedback}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="mt-2">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </article>
  );
}

/** Approve or reject a generated course or blueprint, with an optional note for the audit log. */
export function DecisionForm({ path, what, status }: { path: string; what: string; status: string }) {
  const a = useAction();
  const [note, setNote] = useState('');
  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Your decision on this {what}</h2>
      <p className="text-fg-muted">Currently {status.toLowerCase()}. Rejecting keeps it out of the test until it is regenerated or edited and approved.</p>
      <label className="block">
        Note (optional, kept in the audit log)
        <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={a.pending || status === 'APPROVED'} onClick={() => a.run('POST', path, { decision: 'APPROVE', note: note.trim() }, { success: `The ${what} is approved.` })} className="btn btn-primary">
          Approve {what}
        </button>
        <button type="button" disabled={a.pending || status === 'REJECTED'} onClick={() => a.run('POST', path, { decision: 'REJECT', note: note.trim() }, { success: `The ${what} is rejected.` })} className="btn btn-secondary">
          Reject
        </button>
      </div>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </section>
  );
}
