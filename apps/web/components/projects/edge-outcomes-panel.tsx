'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * E-001 §6b (owner, 24 Nov 2026), Project → Benchmark: edge-case variants waiting for an expected outcome. The PM sends
 * them in one batch to one SME (to protect SME time), or answers them as Admin acting for an SME (the owner confirms the
 * migrated outcomes this way). A second check by another person is optional per batch. The batch is written to Studio
 * whole when it is answered (and checked, if asked). Outcomes are reference answers: never shown to the agent.
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
export interface EdgeOutcomesState {
  catalog: { source: 'catalog' | 'template'; fallbackReason: string | null; environmentKey: string | null; revision: number | null; outcomeFields: OutcomeField[] };
  waiting: { familyId: string; familyName: string; variantId: string; name: string; boundary: string | null; migrated: boolean; inBatch: boolean }[];
  people: { smeUserId: string; name: string }[];
  batches: OutcomeBatchView[];
}

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

export function EdgeOutcomesPanel({ projectId, state }: { projectId: string; state: EdgeOutcomesState }) {
  const router = useRouter();
  const free = state.waiting.filter((w) => !w.inBatch);
  const [picked, setPicked] = useState<Set<string>>(new Set(free.map((w) => w.variantId)));
  const [answerer, setAnswerer] = useState<'admin' | 'sme'>('admin');
  const [sme, setSme] = useState(state.people[0]?.smeUserId ?? '');
  const [secondCheck, setSecondCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = state.catalog.outcomeFields;

  async function makeBatch() {
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/edge-outcomes/batches`, { variantIds: [...picked], answerer, ...(answerer === 'sme' ? { smeUserId: sme } : {}), secondCheck });
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  async function send(batchId: string) {
    setError(null);
    const res = await mutate('POST', `/projects/${projectId}/edge-outcomes/batches/${batchId}/send`, {});
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <section aria-labelledby="edge-outcomes" className="rounded-md border border-line p-4" data-edge-outcomes>
      <h2 id="edge-outcomes" className="text-lg font-semibold">
        Edge-case outcomes
      </h2>
      <p className="text-sm text-fg-muted">
        Each edge-case variant needs an expected outcome from a person before its cases count. Send the waiting ones in one batch to one SME, or answer them yourself as Admin. Outcomes go to Studio and the graders; the agent never sees them.
      </p>
      {state.catalog.source !== 'catalog' && <p className="mt-2 text-sm">{state.catalog.fallbackReason}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {state.catalog.source === 'catalog' && (
        <div className="mt-3">
          <h3 className="font-medium">Waiting for an outcome</h3>
          {state.waiting.length === 0 ? (
            <p className="text-sm text-fg-muted">None: every variant has an outcome confirmed by a person.</p>
          ) : (
            <>
              <ul className="mt-1 space-y-1 text-sm">
                {state.waiting.map((w) => (
                  <li key={w.variantId}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" disabled={w.inBatch} checked={!w.inBatch && picked.has(w.variantId)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(w.variantId); else n.delete(w.variantId); setPicked(n); }} />
                      <span>
                        {w.familyName} · {w.name}
                        {w.boundary ? ` (boundary: ${w.boundary})` : ''}
                        {w.migrated && <span className="text-fg-muted"> · outcome carried over: confirm or change it</span>}
                        {w.inBatch && <span className="text-fg-muted"> · already in a batch</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {free.length > 0 && (
                <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
                  <fieldset>
                    <legend className="text-xs text-fg-muted">Who answers</legend>
                    <label className="mr-3">
                      <input type="radio" name="oc-answerer" checked={answerer === 'admin'} onChange={() => setAnswerer('admin')} /> I answer as Admin, for an SME
                    </label>
                    <label>
                      <input type="radio" name="oc-answerer" checked={answerer === 'sme'} disabled={!state.people.length} onChange={() => setAnswerer('sme')} /> An SME on this project
                    </label>
                  </fieldset>
                  {answerer === 'sme' && (
                    <label htmlFor="oc-sme" className="flex flex-col">
                      <span className="text-xs text-fg-muted">SME</span>
                      <select id="oc-sme" className="input" value={sme} onChange={(e) => setSme(e.target.value)}>
                        {state.people.map((p) => (
                          <option key={p.smeUserId} value={p.smeUserId}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={secondCheck} onChange={(e) => setSecondCheck(e.target.checked)} /> Second check by another person
                  </label>
                  <button type="button" className="btn btn-primary" disabled={!picked.size} onClick={() => void makeBatch()}>
                    Make a batch of {picked.size}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {state.batches.map((b) => {
        const answered = b.items.filter((i) => i.answer).length;
        const mine = b.answerer === 'admin' && b.state === 'open';
        return (
          <div key={b.id} className="mt-4 rounded border border-line p-3 text-sm" data-outcome-batch={b.state}>
            <h3 className="font-medium">
              Batch <span className="font-mono">{b.requestId}</span> · {b.answerer === 'admin' ? 'answered as Admin' : 'sent to an SME'} · {STATE_LABEL[b.state]} · {answered} of {b.items.length} answered
              {b.secondCheck ? ' · second check' : ''}
            </h3>
            {b.sendError && <p className="text-error">{b.sendError}</p>}
            <ul className="mt-2 space-y-3">
              {b.items.map((i) => (
                <li key={i.id} className="border-t border-line pt-2">
                  <p>
                    <strong>{i.familyName}</strong> · {i.name}
                    {i.boundary ? ` (boundary: ${i.boundary})` : ''}
                  </p>
                  {i.description && <p className="text-xs text-fg-muted">{i.description}</p>}
                  <AnswerForm item={i} fields={fields} editable={mine} onSave={async (body) => { const r = await mutate('PUT', `/projects/${projectId}/edge-outcomes/batches/${b.id}/items/${i.id}`, body); if (!r.ok) return r.error; router.refresh(); return null; }} />
                </li>
              ))}
            </ul>
            {(mine || b.state === 'awaiting_check' || b.state === 'send_failed') && (
              <button type="button" className="btn btn-primary mt-3" disabled={mine && answered < b.items.length} onClick={() => void send(b.id)}>
                {b.state === 'awaiting_check' ? 'Check and write to Studio' : b.state === 'send_failed' ? 'Send to Studio again' : b.secondCheck ? 'Submit for the second check' : 'Write to Studio'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
