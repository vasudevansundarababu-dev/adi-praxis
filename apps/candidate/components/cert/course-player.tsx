'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { call } from '@/lib/client';
import type { CourseModule, CourseView, ModuleResult } from '@/lib/supply-types';

/** Course player: a module list (locked ones greyed out) and the open module with its examples, practice and quiz. */
export function CoursePlayer({ initial }: { initial: CourseView }) {
  const [course, setCourse] = useState(initial);
  const firstOpen = initial.modules.find((m) => !m.locked && !m.completed) ?? initial.modules.find((m) => !m.locked) ?? initial.modules[0];
  const [openId, setOpenId] = useState(firstOpen?.id ?? null);
  const done = course.modules.filter((m) => m.completed).length;
  const current = course.modules.find((m) => m.id === openId) ?? null;
  const testReady = ['TEST_READY', 'RETAKE_AVAILABLE', 'IN_TEST'].includes(course.state);

  async function reload(moveNext: boolean) {
    const r = await call<CourseView>('GET', `/me/certifications/${course.certificationId}/course`);
    if (!r.ok) return;
    setCourse(r.data!);
    if (moveNext) {
      const next = r.data!.modules.find((m) => !m.locked && !m.completed);
      if (next) setOpenId(next.id);
    }
  }

  return (
    <div className="mt-3">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{course.tierLabel} certification</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{course.title}</h1>
        <p className="muted mt-2 text-sm">
          {done} of {course.modules.length} modules done. Your progress is saved; you can stop and come back at any time.
        </p>
        <div className="mt-3 h-2 rounded-full bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={course.modules.length} aria-valuenow={done} aria-label="Course progress">
          <div className="h-2 rounded-full bg-white" style={{ width: `${course.modules.length ? (done / course.modules.length) * 100 : 0}%` }} />
        </div>
        {testReady && (
          <Link href={`/certifications/${course.certificationId}/test`} className="mt-5 btn bg-white text-brand-navy shadow-lg hover:bg-white/90">
            {course.state === 'IN_TEST' ? 'Continue the test' : 'Go to the test'} →
          </Link>
        )}
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-[16rem_1fr]">
        <nav aria-label="Modules">
          <ol className="space-y-2">
            {course.modules.map((m, n) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={m.locked}
                  onClick={() => setOpenId(m.id)}
                  aria-current={m.id === openId ? 'step' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-55 ${m.id === openId ? 'border-focus' : 'border-line'}`}
                >
                  <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${m.completed ? 'bg-success text-on-primary' : 'border border-line'}`}>
                    {m.completed ? '✓' : n + 1}
                  </span>
                  <span className="min-w-0 flex-1">{m.title}</span>
                  <span className="sr-only">{m.completed ? '(done)' : m.locked ? '(locked: finish the module before it first)' : ''}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        {current && !current.locked ? (
          <ModuleView key={current.id} certificationId={course.certificationId} module={current} onPassed={() => reload(true)} />
        ) : (
          <p className="card p-5 text-sm text-fg-muted">Finish the modules in order. The next one opens when you pass the quiz at the end of the one before.</p>
        )}
      </div>
    </div>
  );
}

function ModuleView({ certificationId, module: m, onPassed }: { certificationId: string; module: CourseModule; onPassed: () => void }) {
  const quiz = m.quiz ?? [];
  const [answers, setAnswers] = useState<(number | null)[]>(quiz.map(() => null));
  const [result, setResult] = useState<ModuleResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (answers.some((a) => a === null)) return setError('Answer every question, then check your answers.');
    setPending(true);
    setError(null);
    const r = await call<ModuleResult>('POST', `/me/certifications/${certificationId}/modules/${m.id}/complete`, { answers });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data!);
  }

  return (
    <article className="min-w-0 space-y-5">
      <h2 className="text-xl font-semibold">{m.title}</h2>
      {m.explanation && <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.explanation}</div>}
      {!!m.citations?.length && <p className="text-xs text-fg-muted">Guidelines sections: {m.citations.join(', ')}</p>}

      {(!!m.goodExamples?.length || !!m.badExamples?.length) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!!m.goodExamples?.length && (
            <section className="card p-4">
              <h3 className="font-semibold text-success">Good examples</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {m.goodExamples.map((x, i) => <li key={i} className="whitespace-pre-wrap">{x}</li>)}
              </ul>
            </section>
          )}
          {!!m.badExamples?.length && (
            <section className="card p-4">
              <h3 className="font-semibold text-warning">Examples to avoid</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {m.badExamples.map((x, i) => <li key={i} className="whitespace-pre-wrap">{x}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {!!m.practice?.length && (
        <section className="card p-4">
          <h3 className="font-semibold">Practice</h3>
          <p className="mt-1 text-xs text-fg-muted">Try each one yourself first, then compare. Practice doesn’t count towards anything.</p>
          <ul className="mt-3 space-y-3 text-sm">
            {m.practice.map((p, i) => (
              <li key={i}>
                <p className="whitespace-pre-wrap">{p.prompt}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-link">Show a model answer</summary>
                  <p className="mt-1 whitespace-pre-wrap">{p.answer}</p>
                  {p.feedback && <p className="mt-1 whitespace-pre-wrap text-fg-muted">{p.feedback}</p>}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      {m.completed ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">You passed this module’s quiz.</p>
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-4 text-sm">
          <div>
            <h3 className="font-semibold">Quiz</h3>
            <p className="mt-1 text-xs text-fg-muted">Get at least 80% right to finish the module. You can try again straight away.</p>
            {quiz.length > 0 && <RequiredNote className="mt-1" />}
          </div>
          {quiz.map((q, qi) => (
            <fieldset key={qi} disabled={pending || !!result?.passed}>
              <legend className="font-medium">
                {qi + 1}. {q.question}
                <Req />
              </legend>
              <div className="mt-2 space-y-1">
                {q.options.map((o, oi) => (
                  <label key={oi} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`q${qi}`}
                      required
                      checked={answers[qi] === oi}
                      onChange={() => {
                        setAnswers(answers.map((a, j) => (j === qi ? oi : a)));
                        if (result && !result.passed) setResult(null);
                      }}
                      className="mt-1"
                    />
                    {o}
                  </label>
                ))}
              </div>
              {result && result.feedback[qi] && (
                <p className={`mt-2 ${result.feedback[qi] === 'Correct.' ? 'text-success' : 'text-warning'}`}>{result.feedback[qi]}</p>
              )}
            </fieldset>
          ))}
          {result?.passed ? (
            <div role="status" className="rounded-md border border-success p-3">
              <p>Well done: you passed this module.</p>
              <button type="button" onClick={onPassed} className="mt-3 btn btn-primary">
                {result.state === 'TEST_READY' ? 'Finish the course' : 'Next module'} →
              </button>
            </div>
          ) : (
            <>
              {result && <p role="status" className="text-warning">Not quite: read the feedback above, change your answers and try again.</p>}
              <button type="submit" disabled={pending || answers.some((a) => a === null)} className="btn btn-primary">
                {pending ? 'Checking…' : 'Check my answers'}
              </button>
            </>
          )}
          {error && <p role="alert" className="text-error">{error}</p>}
        </form>
      )}
    </article>
  );
}
