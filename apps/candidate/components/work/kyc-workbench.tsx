'use client';

import {
  KYC_DISPOSITIONS,
  KYC_EXAMPLE_TASK,
  KYC_PARTY_ROLES,
  KYC_RESPONSE_KINDS,
  KYC_RISK,
  KYC_SECTIONS,
  KYC_SEVERITY,
  KYC_TOOLS,
  KYC_TRIGGERS,
  kycChecks,
  syntheticGenerator,
  type KycDocument,
  type KycParty,
  type KycStep,
  type KycTask,
  type KycToolResponse,
} from '@praxis/shared';
import { useMemo, useState } from 'react';
import type { TaskView } from '@/lib/work-types';
import { SubmitPanel } from './submit-panel';
import { SaveIndicator } from './task-page';
import { useAutosave } from './use-autosave';

const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 disabled:opacity-70';
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const nextId = (prefix: string, ids: string[]) => {
  let n = 1;
  while (ids.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

function Field(p: { label: string; value: string | number | undefined; onChange: (v: string) => void; type?: string; disabled?: boolean; hint?: string }) {
  return (
    <label className="block text-sm">
      {p.label}
      <input type={p.type ?? 'text'} value={p.value ?? ''} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} className={input} />
      {p.hint && <span className="mt-0.5 block text-xs text-fg-muted">{p.hint}</span>}
    </label>
  );
}
function Area(p: { label: string; value: string | undefined; onChange: (v: string) => void; disabled?: boolean; rows?: number }) {
  return (
    <label className="block text-sm">
      {p.label}
      <textarea value={p.value ?? ''} disabled={p.disabled} rows={p.rows ?? 3} onChange={(e) => p.onChange(e.target.value)} className={input} />
    </label>
  );
}
function Pick(p: { label: string; value: string | undefined; options: readonly string[]; onChange: (v: string) => void; disabled?: boolean; format?: (v: string) => string }) {
  return (
    <label className="block text-sm">
      {p.label}
      <select value={p.value ?? ''} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} className={input}>
        <option value="">Choose…</option>
        {p.options.map((o) => (
          <option key={o} value={o}>
            {p.format ? p.format(o) : label(o)}
          </option>
        ))}
      </select>
    </label>
  );
}
/** A comma-separated list edited as text. */
function ListField(p: { label: string; value: string[] | undefined; onChange: (v: string[]) => void; disabled?: boolean; hint?: string }) {
  const [text, setText] = useState((p.value ?? []).join('; '));
  return (
    <Field label={p.label} value={text} disabled={p.disabled} hint={p.hint ?? 'Separate items with semicolons'} onChange={(v) => {
      setText(v);
      p.onChange(v.split(';').map((x) => x.trim()).filter(Boolean));
    }} />
  );
}
function MultiPick(p: { label: string; value: string[] | undefined; options: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const v = p.value ?? [];
  return (
    <fieldset className="text-sm">
      <legend>{p.label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {p.options.length === 0 && <span className="text-fg-muted">None yet</span>}
        {p.options.map((o) => (
          <label key={o} className="flex items-center gap-1 rounded border border-line px-2 py-0.5">
            <input type="checkbox" disabled={p.disabled} checked={v.includes(o)} onChange={(e) => p.onChange(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Rows<T>(p: { title: string; items: T[]; onChange: (items: T[]) => void; make: () => T; render: (item: T, set: (next: T) => void) => React.ReactNode; itemLabel: (item: T) => string; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">{p.title}</h3>
      {p.items.map((it, i) => (
        <div key={i} className="rounded-md border border-line p-3">
          <div className="mb-2 flex items-center">
            <span className="text-sm font-medium">{p.itemLabel(it)}</span>
            {!p.disabled && (
              <button type="button" onClick={() => p.onChange(p.items.filter((_, j) => j !== i))} className="ml-auto text-sm text-link" aria-label={`Remove ${p.itemLabel(it)}`}>
                Remove
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">{p.render(it, (next) => p.onChange(p.items.map((x, j) => (j === i ? next : x))))}</div>
        </div>
      ))}
      {!p.disabled && (
        <button type="button" onClick={() => p.onChange([...p.items, p.make()])} className="btn btn-secondary">
          Add {p.title.toLowerCase().replace(/s$/, '')}
        </button>
      )}
    </div>
  );
}

/** TASK-KYC section 4: the guided author workbench W01 to W06, with autosave and a progress rail. Desktop-first. */
export function KycWorkbench({ task, onSubmitted }: { task: TaskView; onSubmitted: () => void }) {
  const slot = task.input.slot ?? null;
  const { value, update, currentRevision, state, flush } = useAutosave<KycTask & Record<string, unknown>>(task.id, (task.output ?? { header: {} }) as KycTask & Record<string, unknown>, task.revision, task.readOnly);
  const [section, setSection] = useState<string>('W01');
  const [sample, setSample] = useState<{ source: string; output: KycTask | null } | null>(null);
  const ro = task.readOnly;
  const gen = useMemo(() => syntheticGenerator(`${task.id}:${Date.now()}`), [task.id]);
  const checks = useMemo(() => kycChecks(value, slot ? { edgeCase: slot.edgeCase, isOpen: slot.isOpen } : null), [value, slot]);
  const sectionOk = (id: string) => checks.filter((c) => c.section === id).every((c) => c.ok || c.severity === 'warning');
  const set = <K extends keyof KycTask>(k: K, v: NonNullable<KycTask[K]>) => update((prev) => ({ ...prev, [k]: { ...((prev[k] as object) ?? {}), ...v } }));
  const t = value;
  const parties = t.customerFile?.parties ?? [];
  const docs = t.evidence?.documents ?? [];
  const tools = t.environment?.tools ?? [];
  const responses = t.environment?.responses ?? [];
  const steps = t.solution?.steps ?? [];
  const pinned = (task.review?.comments ?? []).filter((c) => c.section === section);

  async function loadSample() {
    const res = await fetch(`/api/v1/me/tasks/${task.id}/sample`);
    const body = res.ok ? await res.json() : null;
    setSample(body?.output ? { source: 'An accepted task from a different cell', output: body.output } : { source: 'The worked example from the task guide (all data invented)', output: KYC_EXAMPLE_TASK });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t.header?.title || 'New KYC task'}</h1>
        <SaveIndicator state={state} readOnly={ro} />
      </div>
      <p className="text-sm text-fg-muted">{slot?.brief}</p>
      <p className="mt-2 rounded-md border border-line p-2 text-xs text-fg-muted md:hidden">The workbench is designed for a larger screen. On a phone it is read-only.</p>

      <div className="mt-4 grid gap-6 md:grid-cols-[13rem_1fr]">
        <nav aria-label="Workbench sections" className="md:sticky md:top-4 md:self-start">
          <ol className="flex gap-2 overflow-x-auto md:flex-col">
            {KYC_SECTIONS.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? 'step' : undefined} className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm md:whitespace-normal ${section === s.id ? 'bg-surface font-semibold' : ''}`}>
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.id === 'W06' ? 'bg-line' : sectionOk(s.id) ? 'bg-success' : 'bg-warning'}`} />
                  {s.id} {s.title}
                  <span className="sr-only">{s.id !== 'W06' && (sectionOk(s.id) ? ' (passes checks)' : ' (needs attention)')}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
        <fieldset disabled={ro} className="min-w-0 space-y-4 max-md:pointer-events-none">
          {task.review && task.status === 'REWORK' && section === 'W01' && (
            <div role="status" className="rounded-md border border-warning p-3 text-sm">
              <p className="font-medium">The reviewer asked for changes</p>
              {task.review.notes && <p className="mt-1">{task.review.notes}</p>}
              <ul className="mt-1 list-disc pl-5">
                {task.review.comments.map((c, i) => (
                  <li key={i}>
                    <button type="button" className="text-link underline" onClick={() => setSection(c.section)}>
                      {c.section}
                    </button>
                    : {c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pinned.length > 0 && section !== 'W01' && (
            <ul role="status" className="rounded-md border border-warning p-3 text-sm">
              {pinned.map((c, i) => (
                <li key={i}>Reviewer: {c.text}</li>
              ))}
            </ul>
          )}

          {section === 'W01' && (
            <section className="space-y-4">
              <div className="rounded-md border border-line p-3 text-sm">
                <p className="font-medium">Your slot</p>
                <p>{slot?.brief}</p>
                <dl className="mt-2 grid gap-1 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-fg-muted">Primary work</dt>
                  <dd>{task.template.primaryWork}</dd>
                  <dt className="text-fg-muted">Verification</dt>
                  <dd>{task.template.verificationCriteria}</dd>
                  <dt className="text-fg-muted">Human gate</dt>
                  <dd>{task.template.humanGate}</dd>
                  <dt className="text-fg-muted">Tools</dt>
                  <dd>{KYC_TOOLS.map((x) => x.label).join(', ')}</dd>
                </dl>
                <p className="mt-2 text-xs text-fg-muted">Everything must be invented. Never use real customers, colleagues, employers or documents.</p>
              </div>
              {(slot?.isOpen || (slot && !slot.isOpen && Object.keys(slot.tags).length === 0)) && (
                <div className="rounded-md border border-line p-3">
                  <p className="text-sm font-medium">{slot.isOpen ? 'Open slot: tag your case first' : 'Choose the other coverage tags for your case'}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {task.template.coverageDimensions.filter((d) => d.values.length && !slot.tags[d.key]).map((d) => (
                      <Pick key={d.key} label={d.label} value={t.header?.coverageTags?.[d.key]} options={d.values} format={(v) => v} onChange={(v) => set('header', { coverageTags: { ...(t.header?.coverageTags ?? {}), [d.key]: v } })} />
                    ))}
                    {slot.isOpen && <Field label="Name the edge case this task tests" value={t.header?.edgeCase} onChange={(v) => set('header', { edgeCase: v })} />}
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title" value={t.header?.title} onChange={(v) => set('header', { title: v })} />
                <Pick label="Difficulty (1 easy to 5 hard)" value={t.header?.difficulty ? String(t.header.difficulty) : ''} options={['1', '2', '3', '4', '5']} format={(v) => v} onChange={(v) => set('header', { difficulty: Number(v) })} />
                <Field label="Jurisdiction" value={t.header?.jurisdiction} onChange={(v) => set('header', { jurisdiction: v })} />
                <Field label="Language" value={t.header?.language} onChange={(v) => set('header', { language: v })} hint="e.g. en" />
                <Field label="Estimated steps" type="number" value={t.header?.estimatedSteps} onChange={(v) => set('header', { estimatedSteps: Number(v) })} />
              </div>
              <button type="button" onClick={loadSample} className="text-sm text-link underline">
                See an example task
              </button>
              {sample?.output && (
                <details open className="rounded-md border border-line p-3 text-sm">
                  <summary className="cursor-pointer">{sample.source}</summary>
                  <p className="mt-2 font-medium">{sample.output.header?.title}</p>
                  <p>{sample.output.scenario?.businessContext}</p>
                  <p className="mt-1 text-fg-muted">
                    {(sample.output.solution?.steps ?? []).length} steps · {(sample.output.solution?.findings ?? []).length} findings · disposition {label(sample.output.solution?.disposition ?? '')}
                  </p>
                </details>
              )}
            </section>
          )}

          {section === 'W02' && (
            <section className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Pick label="Trigger" value={t.scenario?.trigger} options={KYC_TRIGGERS} onChange={(v) => set('scenario', { trigger: v })} />
                <Field label="Customer type" value={t.scenario?.customerType ?? slot?.tags.customer_type} onChange={(v) => set('scenario', { customerType: v })} />
                <Field label="Product" value={t.scenario?.product} onChange={(v) => set('scenario', { product: v })} />
                <Field label="Channel" value={t.scenario?.channel ?? slot?.tags.channel} onChange={(v) => set('scenario', { channel: v })} />
              </div>
              <Area label="Business context (what the agent is told at the start)" value={t.scenario?.businessContext} onChange={(v) => set('scenario', { businessContext: v })} />
              <Rows<KycParty>
                title="Parties"
                items={parties}
                disabled={ro}
                itemLabel={(p) => `${p.id} ${p.name || ''}`}
                make={() => {
                  const person = parties.length > 0;
                  const name = person ? gen.personName() : gen.companyName();
                  return person
                    ? { id: nextId('P', parties.map((x) => x.id)), role: 'DIRECTOR', kind: 'PERSON', name, dateOfBirth: gen.dateOfBirth(), addresses: [gen.address()], identifiers: [{ type: 'Passport', value: gen.passportNumber() }] }
                    : { id: nextId('P', parties.map((x) => x.id)), role: 'CUSTOMER', kind: 'ENTITY', name, incorporationDate: gen.incorporationDate(), addresses: [gen.address()], identifiers: [{ type: 'Company number', value: gen.companyNumber() }] };
                }}
                onChange={(parties) => set('customerFile', { parties })}
                render={(p, setP) => (
                  <>
                    <Pick label="Role" value={p.role} options={KYC_PARTY_ROLES} onChange={(role) => setP({ ...p, role })} />
                    <Pick label="Kind" value={p.kind} options={['PERSON', 'ENTITY']} onChange={(kind) => setP({ ...p, kind: kind as KycParty['kind'] })} />
                    <Field label="Name (synthetic)" value={p.name} onChange={(name) => setP({ ...p, name })} />
                    {p.kind === 'PERSON' ? (
                      <Field label="Date of birth" type="date" value={p.dateOfBirth} onChange={(dateOfBirth) => setP({ ...p, dateOfBirth })} />
                    ) : (
                      <Field label="Incorporation date" type="date" value={p.incorporationDate} onChange={(incorporationDate) => setP({ ...p, incorporationDate })} />
                    )}
                    <Field label={p.kind === 'PERSON' ? 'Nationality' : 'Country of incorporation'} value={p.kind === 'PERSON' ? p.nationality : p.incorporationCountry} onChange={(v) => setP(p.kind === 'PERSON' ? { ...p, nationality: v } : { ...p, incorporationCountry: v })} />
                    <ListField label="Addresses" value={p.addresses} onChange={(addresses) => setP({ ...p, addresses })} />
                    <ListField label="Identifiers (type: value)" value={(p.identifiers ?? []).map((i) => `${i.type}: ${i.value}`)} hint="e.g. Passport: SYN-P1234567; use the generator’s SYN- formats" onChange={(v) => setP({ ...p, identifiers: v.map((x) => ({ type: x.split(':')[0]!.trim(), value: x.split(':').slice(1).join(':').trim() })) })} />
                    <button type="button" className="self-end text-sm text-link underline" onClick={() => setP({ ...p, name: p.kind === 'PERSON' ? gen.personName() : gen.companyName(), addresses: [gen.address()] })}>
                      Generate synthetic name and address
                    </button>
                  </>
                )}
              />
              <Rows<{ ownerId: string; ownedId: string; percent: number }>
                title="Ownership links"
                items={t.customerFile?.ownership ?? []}
                disabled={ro}
                itemLabel={(o) => `${o.ownerId || '?'} owns ${o.percent || 0}% of ${o.ownedId || '?'}`}
                make={() => ({ ownerId: '', ownedId: '', percent: 0 })}
                onChange={(ownership) => set('customerFile', { ownership })}
                render={(o, setO) => (
                  <>
                    <Pick label="Owner" value={o.ownerId} options={parties.map((p) => p.id)} format={(v) => `${v} ${parties.find((p) => p.id === v)?.name ?? ''}`} onChange={(ownerId) => setO({ ...o, ownerId })} />
                    <Pick label="Owns" value={o.ownedId} options={parties.filter((p) => p.kind === 'ENTITY').map((p) => p.id)} format={(v) => `${v} ${parties.find((p) => p.id === v)?.name ?? ''}`} onChange={(ownedId) => setO({ ...o, ownedId })} />
                    <Field label="Percent" type="number" value={o.percent} onChange={(v) => setO({ ...o, percent: Number(v) })} />
                  </>
                )}
              />
              <Area label="Stated purpose" value={t.customerFile?.statedPurpose} onChange={(statedPurpose) => set('customerFile', { statedPurpose })} rows={2} />
              <Area label="Expected activity" value={t.customerFile?.expectedActivity} onChange={(expectedActivity) => set('customerFile', { expectedActivity })} rows={2} />
            </section>
          )}

          {section === 'W03' && (
            <section className="space-y-4">
              <Rows<KycDocument>
                title="Documents"
                items={docs}
                disabled={ro}
                itemLabel={(d) => `${d.id} ${d.type || ''}`}
                make={() => ({ id: nextId('D', docs.map((x) => x.id)), type: '', defects: [] })}
                onChange={(documents) => set('evidence', { documents })}
                render={(d, setD) => (
                  <>
                    <Field label="Type" value={d.type} onChange={(type) => setD({ ...d, type })} />
                    <Field label="Issuer" value={d.issuer} onChange={(issuer) => setD({ ...d, issuer })} />
                    <Pick label="Belongs to" value={d.partyId} options={parties.map((p) => p.id)} format={(v) => `${v} ${parties.find((p) => p.id === v)?.name ?? ''}`} onChange={(partyId) => setD({ ...d, partyId })} />
                    <Field label="Issue date" type="date" value={d.issueDate} onChange={(issueDate) => setD({ ...d, issueDate })} />
                    <Field label="Expiry date" type="date" value={d.expiryDate} onChange={(expiryDate) => setD({ ...d, expiryDate })} />
                    <ListField label="Extracted fields (name: value)" value={(d.fields ?? []).map((f) => `${f.name}: ${f.value}`)} onChange={(v) => setD({ ...d, fields: v.map((x) => ({ name: x.split(':')[0]!.trim(), value: x.split(':').slice(1).join(':').trim() })) })} />
                    <ListField label="Deliberate defects" value={d.defects} hint="e.g. Expired; Name differs from passport" onChange={(defects) => setD({ ...d, defects })} />
                  </>
                )}
              />
              <MultiPick label="Tools available to the agent" value={tools} options={KYC_TOOLS.map((x) => x.key)} onChange={(v) => set('environment', { tools: v })} />
              <Rows<KycToolResponse>
                title="Tool responses"
                items={responses}
                disabled={ro}
                itemLabel={(r) => `${r.id} ${r.tool ? label(r.tool) : ''}`}
                make={() => ({ id: nextId('R', responses.map((x) => x.id)), tool: tools[0] ?? '', input: '', kind: 'DATA', response: '' })}
                onChange={(responses) => set('environment', { responses })}
                render={(r, setR) => (
                  <>
                    <Pick label="Tool" value={r.tool} options={tools} onChange={(tool) => setR({ ...r, tool })} />
                    <Pick label="Result kind" value={r.kind} options={KYC_RESPONSE_KINDS} onChange={(kind) => setR({ ...r, kind })} />
                    <Field label="Input" value={r.input} onChange={(v) => setR({ ...r, input: v })} />
                    <Area label="Response the environment returns" value={r.response} onChange={(response) => setR({ ...r, response })} rows={2} />
                  </>
                )}
              />
              {steps.some((s) => s.action === 'TOOL' && !responses.some((r) => r.id === s.responseId)) && <p className="text-sm text-warning">A tool used in the reference trajectory has no defined response yet.</p>}
              <Rows<{ id: string; text: string }>
                title="Policy rules"
                items={t.policy?.rules ?? []}
                disabled={ro}
                itemLabel={(r) => r.id}
                make={() => ({ id: nextId('PR', (t.policy?.rules ?? []).map((x) => x.id)), text: '' })}
                onChange={(rules) => set('policy', { rules })}
                render={(r, setR) => <Area label="Synthetic policy the agent must follow" value={r.text} onChange={(text) => setR({ ...r, text })} rows={2} />}
              />
            </section>
          )}

          {section === 'W04' && (
            <section className="space-y-4">
              <Rows<KycStep>
                title="Steps"
                items={steps}
                disabled={ro}
                itemLabel={(s) => `${s.id} ${s.action === 'TOOL' ? label(s.tool ?? 'tool') : 'reasoning'}`}
                make={() => ({ id: nextId('S', steps.map((x) => x.id)), action: 'TOOL', expectedResult: '', why: '', dependsOn: [] })}
                onChange={(steps) => set('solution', { steps })}
                render={(s, setS) => (
                  <>
                    <Pick label="Action" value={s.action} options={['TOOL', 'REASONING']} onChange={(action) => setS({ ...s, action: action as KycStep['action'] })} />
                    {s.action === 'TOOL' && (
                      <>
                        <Pick label="Tool" value={s.tool} options={tools} onChange={(tool) => setS({ ...s, tool })} />
                        <Pick label="Response it gets" value={s.responseId} options={responses.filter((r) => r.tool === s.tool).map((r) => r.id)} format={(v) => v} onChange={(responseId) => setS({ ...s, responseId })} />
                        <Field label="Input" value={s.input} onChange={(v) => setS({ ...s, input: v })} />
                      </>
                    )}
                    <Area label="Expected result" value={s.expectedResult} onChange={(expectedResult) => setS({ ...s, expectedResult })} rows={2} />
                    <Area label="Why it matters" value={s.why} onChange={(why) => setS({ ...s, why })} rows={2} />
                    <MultiPick label="Depends on" value={s.dependsOn} options={steps.map((x) => x.id).filter((x) => x !== s.id)} onChange={(dependsOn) => setS({ ...s, dependsOn })} />
                  </>
                )}
              />
              <Rows<{ id: string; description: string; evidenceRefs?: string[]; severity?: string }>
                title="Findings"
                items={t.solution?.findings ?? []}
                disabled={ro}
                itemLabel={(f) => f.id}
                make={() => ({ id: nextId('F', (t.solution?.findings ?? []).map((x) => x.id)), description: '', evidenceRefs: [], severity: 'MEDIUM' })}
                onChange={(findings) => set('solution', { findings })}
                render={(f, setF) => (
                  <>
                    <Area label="Gap or discrepancy" value={f.description} onChange={(description) => setF({ ...f, description })} rows={2} />
                    <Pick label="Severity" value={f.severity} options={KYC_SEVERITY} onChange={(severity) => setF({ ...f, severity })} />
                    <MultiPick label="Cites evidence" value={f.evidenceRefs} options={[...docs.map((d) => d.id), ...responses.map((r) => r.id)]} onChange={(evidenceRefs) => setF({ ...f, evidenceRefs })} />
                  </>
                )}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Pick label="Disposition (the agent recommends)" value={t.solution?.disposition} options={KYC_DISPOSITIONS} onChange={(disposition) => set('solution', { disposition })} />
                <Pick label="Risk rating" value={t.solution?.riskRating} options={KYC_RISK} onChange={(riskRating) => set('solution', { riskRating })} />
              </div>
              <ListField label="Risk factors" value={t.solution?.riskFactors} onChange={(riskFactors) => set('solution', { riskFactors })} />
              <ListField label="Requests to the customer" value={t.solution?.requestsToCustomer} onChange={(requestsToCustomer) => set('solution', { requestsToCustomer })} />
              <Area label="Rationale (grounded only in the task’s evidence)" value={t.solution?.rationale} onChange={(rationale) => set('solution', { rationale })} />
              <Area label="Hand-off to a human (required for approve, reject or high risk)" value={t.solution?.humanHandoff} onChange={(humanHandoff) => set('solution', { humanHandoff })} rows={2} />
            </section>
          )}

          {section === 'W05' && (
            <section className="space-y-4">
              <Rows<{ id: string; name: string; weight: number; passCondition: string; critical?: boolean }>
                title="Criteria"
                items={t.rubric?.criteria ?? []}
                disabled={ro}
                itemLabel={(c) => `${c.id} · ${c.weight || 0}%`}
                make={() => ({ id: nextId('C', (t.rubric?.criteria ?? []).map((x) => x.id)), name: '', weight: 0, passCondition: '' })}
                onChange={(criteria) => set('rubric', { criteria })}
                render={(c, setC) => (
                  <>
                    <Field label="Name" value={c.name} onChange={(name) => setC({ ...c, name })} />
                    <Field label="Weight" type="number" value={c.weight} onChange={(v) => setC({ ...c, weight: Number(v) })} />
                    <Area label="Pass condition (testable against the trajectory or outcome)" value={c.passCondition} onChange={(passCondition) => setC({ ...c, passCondition })} rows={2} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!c.critical} onChange={(e) => setC({ ...c, critical: e.target.checked })} /> Critical
                    </label>
                  </>
                )}
              />
              <p className="text-sm text-fg-muted">Weights total {(t.rubric?.criteria ?? []).reduce((n, c) => n + (Number(c.weight) || 0), 0)} of 100.</p>
              <Rows<{ description: string; caughtBy?: string }>
                title="Common errors"
                items={t.rubric?.commonErrors ?? []}
                disabled={ro}
                itemLabel={(e) => e.description.slice(0, 40) || 'Error'}
                make={() => ({ description: '' })}
                onChange={(commonErrors) => set('rubric', { commonErrors })}
                render={(e, setE) => (
                  <>
                    <Area label="A plausible wrong path" value={e.description} onChange={(description) => setE({ ...e, description })} rows={2} />
                    <Pick label="Caught by criterion" value={e.caughtBy} options={(t.rubric?.criteria ?? []).map((c) => c.id)} format={(v) => v} onChange={(caughtBy) => setE({ ...e, caughtBy })} />
                  </>
                )}
              />
              <ListField label="Acceptable variations" value={t.rubric?.acceptableVariations} onChange={(acceptableVariations) => set('rubric', { acceptableVariations })} />
            </section>
          )}

          {section !== 'W06' && (
            <ul className="space-y-1 text-sm" aria-label={`${section} checks`}>
              {checks.filter((c) => c.section === section).map((c) => (
                <li key={c.id} className={c.ok ? 'text-success' : 'text-warning'}>
                  {c.ok ? '✓' : '•'} {c.message}
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        {/* W06 sits in the same column as the other sections (outside the fieldset so its own controls stay usable). */}
        {section === 'W06' && !ro && <SubmitPanel taskId={task.id} flush={flush} revision={currentRevision} onSubmitted={onSubmitted} onGoTo={setSection} />}
        {section === 'W06' && ro && <p>This task is read-only.</p>}
        </div>
      </div>
    </div>
  );
}
