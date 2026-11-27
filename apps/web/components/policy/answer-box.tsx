'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { ANSWER_FIELD_LABEL, ANSWER_FIELD_TARGET, answersTo, openChanges, PAUSED_TEXT, type AnswerDto, type RuleAids } from './answer-logic';
import { jumpToField } from './fix-nav';

const day = (s: string) => new Date(s).toISOString().slice(0, 16).replace('T', ' ');

/**
 * Owner and Jose, 27 Nov 2026: "We can answer the question in a text box. Use AI to decipher the answer and fill the
 * fields." Under an open question in the Status block: a plain answer box, saved exactly as typed with who and when;
 * and, when the AI answer switch is on, "Fill from my answer", which shows the AI's proposed changes before → after with
 * Accept, Reject and Show field. Nothing changes on the rule until the reviewer accepts; accepting is an ordinary edit,
 * so the checks (the condition's source quote, approval in the review queue) stay as they are.
 */
export function AnswerBox({ projectId, ruleId, contentHash, question, answers, aids, readOnly = false }: { projectId: string; ruleId: string; contentHash: string; question: string; answers: readonly AnswerDto[]; aids: RuleAids; readOnly?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'save' | 'fill' | 'accept' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const mine = answersTo(answers, question);

  async function send(fill: boolean) {
    if (!text.trim()) return setMsg({ kind: 'error', text: 'Type your answer first.' });
    setBusy(fill ? 'fill' : 'save');
    setMsg(null);
    const r = await mutate<AnswerDto>('POST', `/projects/${projectId}/policy/rules/${ruleId}/answers`, { expectedContentHash: contentHash, question, answer: text, fill });
    setBusy(null);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Your answer was not saved. Try again.' });
    setText('');
    const a = r.data;
    setMsg({ kind: 'ok', text: a?.aiStatus === 'proposed' ? 'Answer saved. Check the proposed changes below, then accept the ones that are right.' : a?.aiMessage ? `Answer saved. ${a.aiMessage}` : 'Answer saved.' });
    router.refresh();
  }

  async function accept(a: AnswerDto, fields: string[]) {
    setBusy('accept');
    setMsg(null);
    const r = await mutate('POST', `/projects/${projectId}/policy/answers/${a.id}/accept`, { expectedContentHash: contentHash, fields });
    setBusy(null);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Not saved.' });
    setMsg({ kind: 'ok', text: `Saved: ${fields.map((f) => ANSWER_FIELD_LABEL[f] ?? f).join(', ')}. The rule is a new draft; the checks run again.` });
    router.refresh();
  }

  return (
    <div className="mt-2 rounded border border-line bg-bg p-3 text-sm" data-answer-box>
      {mine.length > 0 && (
        <ul className="mb-2 space-y-2" aria-label="Answers so far">
          {mine.map((a) => {
            const pending = openChanges(a, rejected);
            return (
              <li key={a.id} className="rounded border border-line bg-surface p-2" data-answer={a.id}>
                <p className="text-xs text-fg-muted">
                  ✓ Answered by {a.answeredBy}, {day(a.answeredAt)} UTC
                </p>
                <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-2">{a.answer}</blockquote>
                {a.aiMessage && <p className="mt-1 text-xs text-warning">{a.aiMessage}</p>}
                {a.changes.length > 0 && (
                  <ul className="mt-2 space-y-1" aria-label="Proposed changes">
                    {a.changes.map((c) => {
                      const done = a.accepted.includes(c.field);
                      const no = rejected.has(`${a.id}:${c.field}`);
                      return (
                        <li key={c.field} className={`rounded px-2 py-1 ${done ? 'bg-success/10' : no ? 'opacity-60' : 'bg-warning/10'}`} data-change={c.field}>
                          <span className="font-medium">{ANSWER_FIELD_LABEL[c.field] ?? c.field}:</span> <span className="line-through">{c.before}</span> → <strong>{c.after}</strong>
                          {c.reason && <span className="text-xs text-fg-muted"> ({c.reason})</span>}
                          <span className="ml-2 inline-flex gap-2 text-xs">
                            {done ? (
                              <span className="text-success">Accepted</span>
                            ) : no ? (
                              <span>Rejected</span>
                            ) : readOnly ? (
                              <span className="text-fg-muted">Not accepted</span>
                            ) : (
                              <>
                                <button type="button" className="text-link hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => void accept(a, [c.field])}>
                                  Accept
                                </button>
                                <button type="button" className="text-link hover:underline" onClick={() => setRejected(new Set(rejected).add(`${a.id}:${c.field}`))}>
                                  Reject
                                </button>
                              </>
                            )}
                            {ANSWER_FIELD_TARGET[c.field] && (
                              <button type="button" className="text-link hover:underline" onClick={() => void jumpToField(ANSWER_FIELD_TARGET[c.field]!)}>
                                Show field
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!readOnly && pending.length > 1 && (
                  <button type="button" className="btn btn-secondary mt-2 disabled:opacity-50" disabled={!!busy} onClick={() => void accept(a, pending.map((c) => c.field))}>
                    Accept all ({pending.length})
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
      <>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{mine.length ? 'Add to your answer' : 'Your answer'}</span>
        <textarea rows={2} maxLength={4000} className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: Mobile licences are fine for both branch and remote." />
        <span className="text-xs text-fg-muted">Saved exactly as you type it, with your name and the time.</span>
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary disabled:opacity-50" disabled={!!busy || !text.trim()} onClick={() => void send(false)}>
          {busy === 'save' ? 'Saving…' : 'Save answer'}
        </button>
        {aids.aiAnswer &&
          (aids.aiPaused ? (
            <span className="text-xs text-warning" data-ai-paused>
              {PAUSED_TEXT}
            </span>
          ) : (
            <button type="button" className="btn btn-primary disabled:opacity-50" disabled={!!busy || !text.trim()} onClick={() => void send(true)}>
              {busy === 'fill' ? 'Reading your answer…' : 'Fill from my answer (AI)'}
            </button>
          ))}
      </div>
      </>
      )}
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${msg.kind === 'error' ? 'text-error' : ''}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
