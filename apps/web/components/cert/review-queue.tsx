'use client';

import { roleLabel } from '@praxis/shared';
import { useState } from 'react';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import { fmtDateTime, humanize } from '@/components/supply/ui';
import { Req, RequiredNote } from '@/components/required';

export interface GradeItemDto {
  finalized?: boolean;
  itemId: string;
  itemType?: string;
  stem?: string;
  rubric: { criterion: string; weight: number }[];
  answer: unknown;
  recommendation?: { score: number; rationale: string; model: string };
  confirmations: { by: string; kind: string; role?: string; score: number; at: string }[];
  required: number;
}

export interface QueueCert {
  id: string;
  smeUserId: string;
  tier: string;
  domain: string;
  state: string;
  reviewReason: string | null;
  attemptsUsed: number;
  licenceStatus: string | null;
  licence: { number?: string; issuingBody?: string; fileName?: string; submittedAt?: string } | null;
}

export interface QueueResponse {
  grading: { attemptId: string; certificationId: string; tier: string; domain: string; submittedAt: string | null; items: GradeItemDto[] }[];
  certifications: QueueCert[];
}

const answerText = (a: unknown) => (typeof a === 'string' ? a : a == null ? '' : JSON.stringify(a, null, 2));

/** One written answer: question, rubric, the answer, the model's recommendation (clearly labelled), and your grade. */
export function GradeItem({ attemptId, item: i, n, userId, isAdmin = false }: { isAdmin?: boolean; attemptId: string; item: GradeItemDto; n: number; userId: string }) {
  const a = useAction();
  const [score, setScore] = useState('');
  const mine = isAdmin ? !!i.finalized : i.confirmations.some((c) => c.by === userId);
  const value = Number(score);
  const valid = score.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 1;
  return (
    <article className="rounded-md border border-line p-3 text-sm">
      <p className="text-xs font-medium text-fg-muted">
        Answer {n} · {humanize(i.itemType ?? 'written')} · {i.confirmations.length} of {i.required} confirmation{i.required === 1 ? '' : 's'}
      </p>
      {i.stem && <p className="mt-1 whitespace-pre-line font-medium">{i.stem}</p>}
      {i.rubric.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-fg-muted">Rubric</p>
          <ul className="list-disc pl-5 text-xs">
            {i.rubric.map((r) => (
              <li key={r.criterion}>
                {r.criterion} (weight {r.weight})
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2">
        <p className="text-xs font-medium text-fg-muted">Candidate’s answer</p>
        <p className="mt-1 whitespace-pre-line rounded-md bg-surface p-2">{answerText(i.answer) || <span className="text-fg-muted">No answer was given.</span>}</p>
      </div>
      {i.recommendation && (
        <div className="mt-2 rounded-md border border-line p-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="pill pill-info">Recommendation — you decide</span>
            <span className="font-semibold tabular-nums">{i.recommendation.score.toFixed(2)}</span>
            <span className="text-xs text-fg-muted">from {i.recommendation.model}</span>
          </p>
          <p className="mt-1 text-fg-muted">{i.recommendation.rationale}</p>
        </div>
      )}
      {i.confirmations.length > 0 && (
        <ul className="mt-2 text-xs text-fg-muted">
          {i.confirmations.map((c) => (
            <li key={`${c.by}${c.at}`}>
              Confirmed {c.score.toFixed(2)} by {c.by === userId ? 'you' : c.role ? roleLabel(c.role) : 'a reviewer'} · {fmtDateTime(c.at)}
            </li>
          ))}
        </ul>
      )}
      {mine ? (
        <p className="mt-2 text-xs text-fg-muted">You confirmed this grade. {i.confirmations.length < i.required ? 'A legacy confirmation is pending. Admin can finalize directly.' : ''}</p>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await a.run('POST', `/test-attempts/${attemptId}/grades`, { itemId: i.itemId, score: value }, { success: 'Grade confirmed.' });
            if (res.ok) setScore('');
          }}
        >
          <RequiredNote className="w-full" />
          <label className="block">
            Your grade (0 to 1)
            <Req />
            <input required type="number" min={0} max={1} step={0.05} value={score} onChange={(e) => setScore(e.target.value)} className="mt-1 block w-28 rounded-md border border-line bg-surface px-2 py-1.5" />
          </label>
          {i.recommendation && (
            <button type="button" onClick={() => setScore(String(i.recommendation!.score))} className="text-link">
              Start from the recommendation
            </button>
          )}
          <button type="submit" disabled={a.pending || !valid} className="btn btn-primary">
            Confirm grade
          </button>
        </form>
      )}
      <div className="mt-2">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </article>
  );
}

const DECISIONS = [
  ['CERTIFY', 'Certify'],
  ['ALLOW_RETAKE', 'Allow another retake'],
  ['NOT_CERTIFIED', 'Not certified'],
] as const;

/** Certify, allow a retake or decide "not certified", always with a reason. */
export function CertificationDecision({ id, licenceBlocking }: { id: string; licenceBlocking: boolean }) {
  const a = useAction();
  const [decision, setDecision] = useState<(typeof DECISIONS)[number][0]>('ALLOW_RETAKE');
  const [reason, setReason] = useState('');
  return (
    <form
      className="mt-3 space-y-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run('POST', `/certifications/${id}/decision`, { decision, reason: reason.trim() }, { success: 'Decision recorded. The candidate is told.' });
      }}
    >
      <RequiredNote />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">
          Decision
          <Req />
        </legend>
        {DECISIONS.map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input required type="radio" name={`decision-${id}`} checked={decision === v} onChange={() => setDecision(v)} disabled={v === 'CERTIFY' && licenceBlocking} />
            {label}
          </label>
        ))}
      </fieldset>
      {licenceBlocking && <p className="text-xs text-fg-muted">Confirm the professional licence before certifying.</p>}
      <label className="block">
        Reason (task-related, shared with the candidate)
        <Req />
        <textarea required minLength={5} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
      </label>
      <button type="submit" disabled={a.pending || reason.trim().length < 5 || (decision === 'CERTIFY' && licenceBlocking)} className="btn btn-primary">
        Record decision
      </button>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </form>
  );
}

/** A healthcare Expert's licence: number, issuing body and the certificate file. Opening the file is audited. */
export function LicenceCheck({ cert: c }: { cert: QueueCert }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const l = c.licence ?? {};
  return (
    <article className="card p-4 text-sm">
      <p className="font-semibold">
        {humanize(c.tier)} · {c.domain}
      </p>
      <dl className="mt-2 grid gap-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-fg-muted">Licence number</dt>
        <dd className="font-mono">{l.number ?? '—'}</dd>
        <dt className="text-fg-muted">Issuing body</dt>
        <dd>{l.issuingBody ?? '—'}</dd>
        <dt className="text-fg-muted">Submitted</dt>
        <dd>{fmtDateTime(l.submittedAt)}</dd>
        <dt className="text-fg-muted">Certificate</dt>
        <dd>
          <a href={`/api/v1/certifications/${c.id}/licence-file`} className="text-link hover:underline">
            Open {l.fileName ?? 'file'}
          </a>{' '}
          <span className="text-xs text-fg-muted">(opening it is recorded in the audit log)</span>
        </dd>
      </dl>
      <p className="mt-2 text-xs text-fg-muted">If this candidate has already passed the test, confirming the licence certifies them.</p>
      <RequiredNote className="mt-2" />
      <label className="mt-3 block">
        Note (what you checked)
        <Req />
        <input aria-required="true" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Checked the number against the issuing body’s public register." className={input} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={a.pending || note.trim().length < 3} onClick={() => a.run('POST', `/certifications/${c.id}/licence-decision`, { confirm: true, note: note.trim() }, { success: 'Licence confirmed.' })} className="btn btn-primary">
          Confirm licence
        </button>
        <button type="button" disabled={a.pending || note.trim().length < 3} onClick={() => a.run('POST', `/certifications/${c.id}/licence-decision`, { confirm: false, note: note.trim() }, { success: 'Licence rejected.' })} className="btn btn-secondary">
          Reject licence
        </button>
      </div>
      <div className="mt-2">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </article>
  );
}
