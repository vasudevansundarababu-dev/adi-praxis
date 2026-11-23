'use client';

import { archetypePlain, complexityPlain, edgeCaseOptionLabel, type AllowedCheck, type EdgeCase, type ExtraStateCheck, type VerifierSlot } from '@praxis/shared';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/client';

/**
 * Tasks → Author, beside the workbench (AUTHORING-SPEC 1.4, 2.3): the edge case this task focuses on, the Expected
 * results and Add a state check (only when the template takes expected values from SMEs), and Raise a need. Complexity
 * and Archetype are the template's S1 pick lists, so the workbench's own fields show them. Saved on their own, so the
 * workbench and its AI assist are unchanged. Nothing here is shown to the agent.
 */
interface View {
  edgeCases: EdgeCase[];
  sliceLists: { complexity: string[]; archetype: string[] };
  expectedValuesFrom: 'case_reference' | 'sme' | null;
  slots: VerifierSlot[];
  allowedChecks: AllowedCheck[];
  value: { edgeCase: string | null; slots: Record<string, string | number>; extraStateChecks: ExtraStateCheck[]; version: number };
  editable: boolean;
  needs: { id: string; kind: string; state: string; studioItemId: string | null; studioState: string | null; rejectReason: string | null; createdAt: string; content: Record<string, unknown> }[];
}

const NEED_STATE: Record<string, string> = { open: 'With your PM', merged: 'Merged with a similar need', sent: 'Sent to Studio', rejected: 'Not sent' };

export function BenchmarkFields({ taskId }: { taskId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [edgeCase, setEdgeCase] = useState<string>('');
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<ExtraStateCheck[]>([]);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [raising, setRaising] = useState(false);
  const [need, setNeed] = useState({ context: '', twist: '', expectedOutcome: '', complexity: '', archetype: '' });

  const load = useCallback(async () => {
    const res = await call<View>('GET', `/me/tasks/${taskId}/benchmark`);
    if (!res.ok || !res.data) return;
    setView(res.data);
    setEdgeCase(res.data.value.edgeCase ?? '');
    setSlots(Object.fromEntries(Object.entries(res.data.value.slots).map(([k, v]) => [k, String(v)])));
    setChecks(res.data.value.extraStateChecks);
  }, [taskId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view || (!view.edgeCases.length && !view.slots.length && !view.sliceLists.archetype.length)) return null;
  const sme = view.expectedValuesFrom === 'sme';
  const focused = view.edgeCases.find((e) => e.tag === edgeCase) ?? null;

  async function save() {
    setMessage(null);
    const body = { edgeCase: edgeCase || null, slots: Object.fromEntries(Object.entries(slots).filter(([, v]) => v !== '').map(([k, v]) => [k, view!.slots.find((s) => s.id === k)?.type === 'number' ? Number(v) : v])), extraStateChecks: checks, expectedVersion: view!.value.version };
    const res = await call<{ version: number }>('PUT', `/me/tasks/${taskId}/benchmark`, body);
    if (!res.ok) return setMessage({ kind: 'error', text: res.error ?? 'Could not save.' });
    setMessage({ kind: 'ok', text: 'Saved.' });
    await load();
  }

  async function raise() {
    setMessage(null);
    const res = await call('POST', `/me/tasks/${taskId}/needs`, { kind: 'new_case_kind', ...need });
    if (!res.ok) return setMessage({ kind: 'error', text: res.error ?? 'Could not send the need.' });
    setRaising(false);
    setNeed({ context: '', twist: '', expectedOutcome: '', complexity: '', archetype: '' });
    setMessage({ kind: 'ok', text: 'Sent to your PM. They decide whether it goes to Studio.' });
    await load();
  }

  const fieldsOf = (c: ExtraStateCheck) => view.allowedChecks.find((a) => a.table === c.table && a.row === c.row);
  return (
    <section aria-labelledby="benchmark-fields" className="mb-6 rounded-lg border border-line p-4">
      <h2 id="benchmark-fields" className="text-lg font-semibold">
        Benchmark
      </h2>
      <p className="text-sm text-fg-muted">Set Complexity and Archetype in section S1. These fields go to reviewers and RL Gym only; the agent never sees them.</p>

      <label className="mt-3 flex max-w-xl flex-col text-sm">
        <span className="font-medium">Focus on edge case (optional)</span>
        <select className="input" value={edgeCase} disabled={!view.editable} onChange={(e) => setEdgeCase(e.target.value)}>
          <option value="">None</option>
          {view.edgeCases.map((e) => (
            <option key={e.tag} value={e.tag}>
              {edgeCaseOptionLabel(e)}
            </option>
          ))}
        </select>
      </label>
      {focused && (
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          {focused.context} {focused.twist} This task’s Archetype becomes “{archetypePlain(focused.archetype) ?? '—'}”; its Complexity is “{complexityPlain(focused.complexity)?.name ?? '—'}” unless you set another in S1.
        </p>
      )}

      {sme && (
        <fieldset className="mt-4">
          <legend className="font-medium">Expected results</legend>
          <div className="mt-2 grid max-w-3xl gap-3 sm:grid-cols-2">
            {view.slots.map((s) => (
              <label key={s.id} className="flex flex-col text-sm">
                <span>
                  {s.label}
                  {s.required && <span aria-hidden="true"> *</span>}
                </span>
                {s.choices.length ? (
                  <select className="input" required={s.required} disabled={!view.editable} value={slots[s.id] ?? ''} onChange={(e) => setSlots({ ...slots, [s.id]: e.target.value })}>
                    <option value="">Choose…</option>
                    {s.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" type={s.type === 'number' ? 'number' : 'text'} required={s.required} disabled={!view.editable} value={slots[s.id] ?? ''} onChange={(e) => setSlots({ ...slots, [s.id]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
          <h3 className="mt-4 text-sm font-medium">Add a state check (optional)</h3>
          {checks.map((c, i) => {
            const allowed = fieldsOf(c);
            const field = allowed?.fields[c.column];
            const set = (patch: Partial<ExtraStateCheck>) => setChecks(checks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
                <label className="flex flex-col">
                  <span>Table</span>
                  <select className="input" value={`${c.table}|${c.row}`} disabled={!view.editable} onChange={(e) => { const [table, row] = e.target.value.split('|'); const a = view.allowedChecks.find((x) => x.table === table && x.row === row)!; set({ table: a.table, row: a.row, column: Object.keys(a.fields)[0]!, op: a.ops[0] as ExtraStateCheck['op'], value: '' }); }}>
                    {view.allowedChecks.map((a) => (
                      <option key={`${a.table}|${a.row}`} value={`${a.table}|${a.row}`}>
                        {a.table} ({a.row === 'case' ? 'this case' : 'any row'})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col">
                  <span>Field</span>
                  <select className="input" value={c.column} disabled={!view.editable} onChange={(e) => set({ column: e.target.value, value: '' })}>
                    {Object.keys(allowed?.fields ?? {}).map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col">
                  <span>Operator</span>
                  <select className="input" value={c.op} disabled={!view.editable} onChange={(e) => set({ op: e.target.value as ExtraStateCheck['op'] })}>
                    {(allowed?.ops ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col">
                  <span>Value</span>
                  {Array.isArray(field) ? (
                    <select className="input" value={String(c.value)} disabled={!view.editable} onChange={(e) => set({ value: e.target.value })}>
                      <option value="">Choose…</option>
                      {field.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input" type={field === 'number' ? 'number' : 'text'} value={String(c.value)} disabled={!view.editable} onChange={(e) => set({ value: field === 'number' ? Number(e.target.value) : e.target.value })} />
                  )}
                </label>
                <button type="button" className="btn btn-secondary" disabled={!view.editable} onClick={() => setChecks(checks.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            );
          })}
          {view.allowedChecks.length > 0 && view.editable && (
            <button type="button" className="btn btn-secondary mt-2" onClick={() => { const a = view.allowedChecks[0]!; setChecks([...checks, { table: a.table, row: a.row, column: Object.keys(a.fields)[0]!, op: a.ops[0] as ExtraStateCheck['op'], value: '' }]); }}>
              Add a state check
            </button>
          )}
        </fieldset>
      )}

      {view.editable && (
        <button type="button" className="btn btn-primary mt-4" onClick={save}>
          Save benchmark fields
        </button>
      )}

      <div className="mt-6">
        <h3 className="font-medium">Raise a need</h3>
        <p className="text-sm text-fg-muted">Found a situation the template does not cover? Describe it in four parts. It goes to your PM, who decides whether to send it to Studio.</p>
        {!raising ? (
          <button type="button" className="btn btn-secondary mt-2" onClick={() => setRaising(true)}>
            Raise an edge case
          </button>
        ) : (
          <div className="mt-2 grid max-w-3xl gap-3 text-sm">
            <label className="flex flex-col">
              <span>1 · Scenario context: who the customer is and what they ask for</span>
              <textarea className="input" rows={2} value={need.context} onChange={(e) => setNeed({ ...need, context: e.target.value })} />
            </label>
            <label className="flex flex-col">
              <span>2 · Edge-case twist: the anomaly, conflict or missing record</span>
              <textarea className="input" rows={2} value={need.twist} onChange={(e) => setNeed({ ...need, twist: e.target.value })} />
            </label>
            <label className="flex flex-col">
              <span>3 · Expected outcome and rationale: the exact decision and why</span>
              <textarea className="input" rows={2} value={need.expectedOutcome} onChange={(e) => setNeed({ ...need, expectedOutcome: e.target.value })} />
            </label>
            <div className="flex flex-wrap gap-3">
              {(['complexity', 'archetype'] as const).map((k) => (
                <label key={k} className="flex flex-col">
                  <span>4 · {k === 'complexity' ? 'Complexity' : 'Archetype'}</span>
                  {view.sliceLists[k].length ? (
                    <select className="input" value={need[k]} onChange={(e) => setNeed({ ...need, [k]: e.target.value })}>
                      <option value="">Choose…</option>
                      {view.sliceLists[k].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input" value={need[k]} onChange={(e) => setNeed({ ...need, [k]: e.target.value })} />
                  )}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" onClick={raise}>
                Send to SME needs
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setRaising(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {view.needs.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {view.needs.map((n) => (
              <li key={n.id}>
                {n.kind === 'new_case_kind' ? 'New edge case' : 'More data'} · {NEED_STATE[n.state] ?? n.state}
                {n.studioItemId && (n.kind === 'new_case_kind' ? ` · Waiting for new case kind ${n.studioItemId}` : ` · Studio item ${n.studioItemId}`)}
                {n.studioState && ` (${n.studioState})`}
                {n.rejectReason && ` · ${n.rejectReason}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
