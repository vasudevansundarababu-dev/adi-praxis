'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';

/**
 * E-001 §6b (owner, 24 Nov 2026), SME app → Edge-case outcomes: the variants a PM sent this SME in one batch. For each,
 * the SME confirms the expected outcome (decision, why, evidence to cite), says the variant is wrong or doesn't count,
 * or says they can't decide. Submitting writes the batch to Studio (or sends it for the second check, when asked).
 * Outcomes are reference answers for the graders: never shown to the agent.
 */
export interface OutcomeField {
  name: string;
  label: string;
  help: string;
  required: boolean;
  allowedValues: string[] | null;
  suggestedValues?: string[];
}
export interface Answer {
  verdict: 'confirm' | 'reject' | 'cannot_decide';
  decision?: string;
  fields?: Record<string, string>;
  rationale: string;
  evidence?: string[];
}
export interface OutcomeItem {
  id: string;
  familyName: string;
  variantId: string;
  name: string;
  description: string;
  boundary: string | null;
  proposedOutcome: { decision?: string | null; fields?: Record<string, string>; rationale?: string; evidence?: string[]; writtenBy?: string } | null;
  answer: Answer | null;
  answeredAt: string | null;
}
export interface OutcomeBatchView {
  id: string;
  requestId: string;
  answerer: 'admin' | 'sme';
  assigneeSmeUserId: string | null;
  secondCheck: boolean;
  note: string | null;
  dueBy: string | null;
  state: 'open' | 'awaiting_check' | 'sent' | 'send_failed';
  sentAt: string | null;
  sendError: string | null;
  items: OutcomeItem[];
}
export type MyOutcomeBatch = OutcomeBatchView & { projectName: string; outcomeFields: OutcomeField[] };

const STATE_LABEL = { open: 'Being answered', awaiting_check: 'Waiting for the second check', sent: 'Written to Studio', send_failed: 'Studio did not take it: send again' } as const;
const VERDICT_LABEL = { confirm: 'Confirm the outcome', reject: 'Wrong, or doesn’t count', cannot_decide: 'Can’t decide' } as const;

/** The form state for one answer, prefilled from the answer on record or the outcome carried over. */
export function draftOf(item: Pick<OutcomeItem, 'answer' | 'proposedOutcome'>) {
  const a = item.answer;
  const p = item.proposedOutcome;
  return {
    verdict: (a?.verdict ?? 'confirm') as Answer['verdict'],
    decision: a?.decision ?? p?.decision ?? '',
    fields: { ...(p?.fields ?? {}), ...(a?.fields ?? {}) } as Record<string, string>,
    rationale: a?.rationale ?? p?.rationale ?? '',
    evidence: (a?.evidence ?? p?.evidence ?? []).join('\n'),
  };
}
export type Draft = ReturnType<typeof draftOf>;

/** The request body for a draft. */
export function answerBody(d: Draft, fields: OutcomeField[]): Answer {
  if (d.verdict !== 'confirm') return { verdict: d.verdict, rationale: d.rationale.trim() };
  const decisionField = fields.find((f) => f.required)?.name;
  const other = Object.fromEntries(Object.entries(d.fields).filter(([k, v]) => k !== decisionField && v.trim()));
  return { verdict: 'confirm', decision: d.decision.trim(), fields: other, rationale: d.rationale.trim(), evidence: d.evidence.split('\n').map((x) => x.trim()).filter(Boolean) };
}

export function AnswerForm({ item, fields, editable, onSave }: { item: OutcomeItem; fields: OutcomeField[]; editable: boolean; onSave: (body: Answer) => Promise<string | null> }) {
  const [d, setD] = useState<Draft>(draftOf(item));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const decisionField = fields.find((f) => f.required) ?? null;
  const set = (patch: Partial<Draft>) => {
    setD({ ...d, ...patch });
    setMsg(null);
  };
  const id = (k: string) => `oc-${item.id}-${k}`;
  return (
    <div className="mt-2 space-y-2" data-outcome-item={item.variantId}>
      <fieldset>
        <legend className="text-xs text-fg-muted">Your answer</legend>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(VERDICT_LABEL) as Answer['verdict'][]).map((v) => (
            <label key={v} className="flex items-center gap-1">
              <input type="radio" name={id('verdict')} checked={d.verdict === v} disabled={!editable} onChange={() => set({ verdict: v })} />
              {VERDICT_LABEL[v]}
            </label>
          ))}
        </div>
      </fieldset>
      {d.verdict === 'confirm' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label htmlFor={id('decision')} className="flex flex-col">
            <span className="text-xs text-fg-muted">{decisionField?.label ?? 'Decision'} *</span>
            {decisionField?.allowedValues ? (
              <select id={id('decision')} className="input" value={d.decision} disabled={!editable} onChange={(e) => set({ decision: e.target.value })}>
                <option value="">Choose…</option>
                {decisionField.allowedValues.map((v) => (
                  <option key={v} value={v}>
                    {v.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            ) : (
              <input id={id('decision')} className="input" value={d.decision} disabled={!editable} onChange={(e) => set({ decision: e.target.value })} />
            )}
          </label>
          {fields
            .filter((f) => !f.required)
            .map((f) => (
              <label key={f.name} htmlFor={id(f.name)} className="flex flex-col">
                <span className="text-xs text-fg-muted">
                  {f.label} (optional){f.help ? ` · ${f.help}` : ''}
                </span>
                {f.allowedValues ? (
                  <select id={id(f.name)} className="input" value={d.fields[f.name] ?? ''} disabled={!editable} onChange={(e) => set({ fields: { ...d.fields, [f.name]: e.target.value } })}>
                    <option value="">—</option>
                    {f.allowedValues.map((v) => (
                      <option key={v} value={v}>
                        {v.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input id={id(f.name)} className="input" list={f.suggestedValues?.length ? id(`${f.name}-hints`) : undefined} value={d.fields[f.name] ?? ''} disabled={!editable} onChange={(e) => set({ fields: { ...d.fields, [f.name]: e.target.value } })} />
                    {!!f.suggestedValues?.length && (
                      <datalist id={id(`${f.name}-hints`)}>
                        {f.suggestedValues.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    )}
                  </>
                )}
              </label>
            ))}
        </div>
      )}
      <label htmlFor={id('rationale')} className="flex flex-col">
        <span className="text-xs text-fg-muted">{d.verdict === 'confirm' ? 'Why this is the right outcome *' : d.verdict === 'reject' ? 'Why this variant is wrong or doesn’t count *' : 'What you would need to decide *'}</span>
        <textarea id={id('rationale')} rows={2} className="input" value={d.rationale} disabled={!editable} onChange={(e) => set({ rationale: e.target.value })} />
      </label>
      {d.verdict === 'confirm' && (
        <label htmlFor={id('evidence')} className="flex flex-col">
          <span className="text-xs text-fg-muted">Evidence the analyst should cite * (one per line)</span>
          <textarea id={id('evidence')} rows={2} className="input" value={d.evidence} disabled={!editable} onChange={(e) => set({ evidence: e.target.value })} placeholder="For example: the passport’s expiry date (document.read)" />
        </label>
      )}
      {editable && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const err = await onSave(answerBody(d, fields));
              setMsg(err ? { kind: 'error', text: err } : { kind: 'ok', text: 'Saved.' });
            }}
          >
            Save answer
          </button>
          {msg && (
            <span role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${msg.kind === 'error' ? 'text-error' : 'text-fg-muted'}`}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function EdgeOutcomes({ batches }: { batches: MyOutcomeBatch[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!batches.length) return <p className="card p-5 text-sm text-fg-muted">No edge-case outcomes are waiting for you.</p>;
  async function submit(id: string) {
    setError(null);
    const res = await call('POST', `/me/edge-outcomes/${id}/submit`, {});
    if (!res.ok) return setError(res.error ?? 'The batch was not submitted. Try again.');
    router.refresh();
  }
  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {batches.map((b) => {
        const answered = b.items.filter((i) => i.answer).length;
        const open = b.state === 'open';
        return (
          <section key={b.id} aria-labelledby={`ob-${b.id}`} className="card p-4 text-sm" data-outcome-batch={b.state}>
            <h2 id={`ob-${b.id}`} className="font-semibold">
              {b.projectName} · {b.items.length} variant{b.items.length === 1 ? '' : 's'} · {STATE_LABEL[b.state]}
            </h2>
            <p className="text-xs text-fg-muted">
              {answered} of {b.items.length} answered{b.dueBy ? ` · due ${b.dueBy}` : ''}
              {b.secondCheck ? ' · another person checks your answers before they are used' : ''}
            </p>
            {b.note && <p className="mt-1">{b.note}</p>}
            <ul className="mt-3 space-y-3">
              {b.items.map((i) => (
                <li key={i.id} className="border-t border-line pt-2">
                  <p>
                    <strong>{i.familyName}</strong> · {i.name}
                    {i.boundary ? ` (boundary: ${i.boundary})` : ''}
                  </p>
                  {i.description && <p className="text-xs text-fg-muted">{i.description}</p>}
                  {i.proposedOutcome && !i.answer && <p className="text-xs text-fg-muted">An outcome is already on record: confirm it, or change it.</p>}
                  <AnswerForm item={i} fields={b.outcomeFields} editable={open} onSave={async (body) => { const r = await call('PUT', `/me/edge-outcomes/${b.id}/items/${i.id}`, body); if (!r.ok) return r.error ?? 'Not saved.'; router.refresh(); return null; }} />
                </li>
              ))}
            </ul>
            {open && (
              <button type="button" className="btn btn-primary mt-3" disabled={answered < b.items.length} onClick={() => void submit(b.id)}>
                {b.secondCheck ? 'Submit for the second check' : 'Submit the batch'}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
