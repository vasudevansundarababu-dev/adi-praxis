'use client';

import { useState } from 'react';
import { call } from '@/lib/client';
import type { AssessmentItem, ExpertReviewItem } from '@/lib/supply-types';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';

export function ExpertQueue({ assessments, families }: { assessments: AssessmentItem[]; families: ExpertReviewItem[] }) {
  const [grades, setGrades] = useState(assessments);
  const [fams, setFams] = useState(families);
  return (
    <>
      <section aria-labelledby="grades-h">
        <h2 id="grades-h" className="text-lg font-semibold">
          Authoring tasks to mark
        </h2>
        {grades.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-fg-muted">Nothing to mark right now. New tasks appear here when candidates in your domain submit their test.</p>
        ) : (
          <ul className="mt-3 grid gap-4">
            {grades.map((g) => (
              <li key={`${g.attemptId}:${g.itemId}`}>
                <GradeCard item={g} onDone={() => setGrades((l) => l.filter((x) => !(x.attemptId === g.attemptId && x.itemId === g.itemId)))} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fam-h">
        <h2 id="fam-h" className="text-lg font-semibold">
          New test questions to review
        </h2>
        {fams.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-fg-muted">No question families are waiting for you.</p>
        ) : (
          <ul className="mt-3 grid gap-4">
            {fams.map((f) => (
              <li key={f.id}>
                <FamilyCard family={f} onDone={() => setFams((l) => l.filter((x) => x.id !== f.id))} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function GradeCard({ item, onDone }: { item: AssessmentItem; onDone: () => void }) {
  const [score, setScore] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(score);
  const valid = score !== '' && n >= 0 && n <= 1;
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    const r = await call('POST', `/me/assessments/${item.attemptId}/grades`, { itemId: item.itemId, score: n });
    setPending(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }
  return (
    <form onSubmit={confirm} className="card space-y-3 p-5 text-sm">
      <p className="text-xs text-fg-muted">{item.domain} · candidate details are hidden</p>
      <p className="whitespace-pre-wrap font-medium">{item.stem}</p>
      {item.rubric.length > 0 && (
        <div>
          <p className="text-xs font-semibold">Rubric</p>
          <ul className="mt-1 list-disc pl-5 text-fg-muted">
            {item.rubric.map((r, i) => (
              <li key={i}>
                {r.criterion} <span className="text-xs">(weight {r.weight})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold">The candidate’s answer</p>
        <div className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-line p-3" tabIndex={0} aria-label="Candidate’s answer">
          {typeof item.answer === 'string' ? item.answer || '(no answer)' : JSON.stringify(item.answer)}
        </div>
      </div>
      {item.recommendation && (
        <p className="rounded-md border border-line p-3 text-fg-muted">
          <span className="font-semibold text-fg">Model suggestion (for reference only): </span>
          {Math.round(item.recommendation.score * 100)}%. {item.recommendation.rationale}
        </p>
      )}
      <label className="block">
        Your score, from 0 (not met) to 1 (fully met)
        <input type="number" required min={0} max={1} step={0.05} value={score} onChange={(e) => setScore(e.target.value)} className={`${input} sm:max-w-40`} />
      </label>
      <button type="submit" disabled={pending || !valid} className="btn btn-primary">
        {pending ? 'Saving…' : 'Confirm my score'}
      </button>
      {error && <p role="alert" className="text-error">{error}</p>}
    </form>
  );
}

function FamilyCard({ family: f, onDone }: { family: ExpertReviewItem; onDone: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function approve() {
    setPending(true);
    setError(null);
    const r = await call('POST', `/me/expert-reviews/${f.id}/approve`);
    setPending(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }
  return (
    <div className="card space-y-3 p-5 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="pill">{f.competency.replace(/_/g, ' ')}</span>
        <span className="pill">{f.itemType.toLowerCase().replace(/_/g, ' ')}</span>
        <span className="pill">Guidelines {f.citation}</span>
      </div>
      <p className="whitespace-pre-wrap">{f.stemPattern}</p>
      {f.samples.length > 0 && (
        <div>
          <p className="text-xs font-semibold">Sample questions</p>
          <ol className="mt-1 space-y-2">
            {f.samples.map((s, i) => (
              <li key={i} className="rounded-md border border-line p-3">
                <p className="whitespace-pre-wrap">{s.stem}</p>
                {!!s.content.options?.length && (
                  <ul className="mt-1 list-disc pl-5 text-fg-muted">
                    {s.content.options.map((o, j) => <li key={j}>{o}</li>)}
                  </ul>
                )}
                {!!s.content.steps?.length && (
                  <ol className="mt-1 list-decimal pl-5 text-fg-muted">
                    {s.content.steps.map((st) => <li key={st.id}>{st.text}</li>)}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="text-xs text-fg-muted">Approve only if the questions are accurate, fair and supported by the cited guidelines section. If something is wrong, leave it unapproved and tell your Praxis contact.</p>
      <button type="button" disabled={pending} onClick={approve} className="btn btn-primary">
        {pending ? 'Saving…' : 'Approve this family'}
      </button>
      {error && <p role="alert" className="text-error">{error}</p>}
    </div>
  );
}
