'use client';

import Link from 'next/link';
import { ContractEditor, newSyntheticContract } from './contract-editor';
import { useRouter } from 'next/navigation';
import { Req, RequiredNote } from '@/components/required';
import type { TaskView } from '@/lib/work-types';
import { minutes, TASK_STATUS } from '@/lib/work-types';
import { KycWorkbench } from './kyc-workbench';
import { SubmitPanel } from './submit-panel';
import { useAutosave, type SaveState } from './use-autosave';

export function SaveIndicator({ state, readOnly }: { state: SaveState; readOnly: boolean }) {
  if (readOnly) return <span className="rounded-full border border-line px-2 py-0.5 text-xs">Read-only</span>;
  const text =
    state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved ${new Date(state.at!).toLocaleTimeString()}` : state.kind === 'conflict' ? 'Changed in another window: reload to continue' : state.kind === 'error' ? state.message : 'All changes save automatically';
  return (
    <span aria-live="polite" className={`text-xs ${state.kind === 'error' || state.kind === 'conflict' ? 'text-error' : 'text-fg-muted'}`}>
      {text}
    </span>
  );
}

/** Opens the right editor for the task: the KYC workbench, the generic authoring editor, or the annotation form. */
export function TaskPage({ task }: { task: TaskView }) {
  const router = useRouter();
  const done = () => router.push(`/projects/${task.projectId}?submitted=${task.id}`);
  return (
    <div>
      <Link href={`/projects/${task.projectId}`} className="text-sm text-link hover:underline">
        ← {task.projectName}
      </Link>
      <p className="mt-1 text-xs text-fg-muted">
        {TASK_STATUS[task.status]} · time target {task.tptMinutes ?? '—'} min · active so far {minutes(task.activeSeconds)} min. The time target is for planning and pay; your task never expires.
      </p>
      {task.status === 'REJECTED' && task.review && (
        <p role="status" className="mt-3 rounded-md border border-line p-3 text-sm">
          This task was not accepted ({task.review.rejectReason?.toLowerCase().replace(/_/g, ' ')}). {task.review.notes}
        </p>
      )}
      <div className="mt-4">
        {task.definition === 'kyc-onboarding-v1' ? <KycWorkbench task={task} onSubmitted={done} /> : task.taskType === 'ANNOTATION' ? <AnnotationTask task={task} onSubmitted={done} /> : <GenericAuthoring task={task} onSubmitted={done} />}
      </div>
    </div>
  );
}

/** Workflows without their own task definition (a separate spec) get a plain authoring editor. */
function GenericAuthoring({ task, onSubmitted }: { task: TaskView; onSubmitted: () => void }) {
  const slot = task.input.slot;
  type Out = { header: { title?: string; coverageTags?: Record<string, string>; edgeCase?: string }; body?: string } & Record<string, unknown>;
  const { value, update, currentRevision, state, flush } = useAutosave<Out>(task.id, (task.output as Out) ?? { header: {} }, task.revision, task.readOnly);
  const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';
  const startContract = (staged: boolean) => { const c = newSyntheticContract(staged); update({ ...value, header: { ...value.header, title: c.title }, praxisContract: c }); };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{value.header?.title || 'New task'}</h1>
        <SaveIndicator state={state} readOnly={task.readOnly} />
      </div>
      <p className="rounded-md border border-line p-3 text-sm">{slot?.brief}</p>
      {task.review?.comments.map((c, i) => (
        <p key={i} role="status" className="text-sm text-warning">
          Reviewer: {c.text}
        </p>
      ))}
      {slot?.isOpen && !task.readOnly && <RequiredNote />}
      <fieldset disabled={task.readOnly} className="space-y-3">
        <label className="block text-sm">
          Title
          <input readOnly={!!value.praxisContract} value={value.header?.title ?? ''} onChange={(e) => update({ ...value, header: { ...value.header, title: e.target.value } })} className={input} />
        </label>
        {slot?.isOpen && (
          <div className="grid gap-2 sm:grid-cols-2">
            {task.template.coverageDimensions.filter((d) => d.values.length).map((d) => (
              <label key={d.key} className="block text-sm">
                {d.label}
                <select value={value.header.coverageTags?.[d.key] ?? ''} onChange={(e) => update({ ...value, header: { ...value.header, coverageTags: { ...(value.header.coverageTags ?? {}), [d.key]: e.target.value } } })} className={input}>
                  <option value="">Choose…</option>
                  {d.values.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="block text-sm">
              Edge case this task tests
              <Req />
              <input aria-required="true" value={value.header.edgeCase ?? ''} onChange={(e) => update({ ...value, header: { ...value.header, edgeCase: e.target.value } })} className={input} />
            </label>
          </div>
        )}
        {!value.praxisContract && <button type="button" className="text-sm text-link underline" onClick={() => startContract(false)}>Start a synthetic executable marketing example</button>}
        {!value.praxisContract && <button type="button" className="ml-3 text-sm text-link underline" onClick={() => startContract(true)}>Start a staged synthetic marketing example</button>}
        {!!value.praxisContract && <ContractEditor value={value.praxisContract as Record<string, unknown>} onChange={(praxisContract) => update({ ...value, header: { ...value.header, title: String(praxisContract.title ?? '') }, praxisContract })} />}
        <label className="block text-sm">
          {value.praxisContract ? 'Author notes (excluded from the executable export)' : 'The task (scenario, inputs, expected steps, evidence, decision and how to verify it)'}
          <textarea value={value.body ?? ''} rows={14} onChange={(e) => update({ ...value, body: e.target.value })} className={input} />
        </label>
      </fieldset>
      {!task.readOnly && <SubmitPanel taskId={task.id} flush={flush} revision={currentRevision} onSubmitted={onSubmitted} />}
    </div>
  );
}

/** Annotation: the input as given, and a form from the template's collection schema (free text when it has none). */
function AnnotationTask({ task, onSubmitted }: { task: TaskView; onSubmitted: () => void }) {
  const props = task.template.collectionSchema?.properties ?? { answer: { type: 'string', title: 'Your answer' } };
  // The template's collection schema lists its required answers; a yes/no checkbox always has a value, so it is not marked.
  const required = new Set((task.template.collectionSchema?.required ?? []).filter((k) => k in props && props[k]?.type !== 'boolean'));
  const { value, update, currentRevision, state, flush } = useAutosave<Record<string, unknown>>(task.id, task.output ?? {}, task.revision, task.readOnly);
  const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5';
  const { slot: _slot, ...data } = task.input;
  void _slot;
  return (
    <div className="grid max-w-5xl gap-6 md:grid-cols-2">
      <section aria-labelledby="input-h">
        <h1 id="input-h" className="text-xl font-semibold">Input</h1>
        <dl className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="whitespace-pre-wrap break-words">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="output-h" className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 id="output-h" className="text-xl font-semibold">Your work</h2>
          <SaveIndicator state={state} readOnly={task.readOnly} />
        </div>
        {required.size > 0 && !task.readOnly && <RequiredNote />}
        <fieldset disabled={task.readOnly} className="space-y-3">
          {Object.entries(props).map(([k, def]) => (
            <label key={k} className="block text-sm">
              {def.title ?? k}
              {required.has(k) && <Req />}
              {def.enum ? (
                <select aria-required={required.has(k) || undefined} value={String(value[k] ?? '')} onChange={(e) => update({ ...value, [k]: e.target.value })} className={input}>
                  <option value="">Choose…</option>
                  {def.enum.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : def.type === 'boolean' ? (
                <input type="checkbox" checked={!!value[k]} onChange={(e) => update({ ...value, [k]: e.target.checked })} className="ml-2" />
              ) : def.type === 'number' || def.type === 'integer' ? (
                <input type="number" aria-required={required.has(k) || undefined} value={String(value[k] ?? '')} onChange={(e) => update({ ...value, [k]: e.target.value === '' ? null : Number(e.target.value) })} className={input} />
              ) : (
                <textarea aria-required={required.has(k) || undefined} value={String(value[k] ?? '')} rows={4} onChange={(e) => update({ ...value, [k]: e.target.value })} className={input} />
              )}
              {def.description && <span className="block text-xs text-fg-muted">{def.description}</span>}
            </label>
          ))}
        </fieldset>
        {!task.readOnly && <SubmitPanel taskId={task.id} flush={flush} revision={currentRevision} onSubmitted={onSubmitted} declaration="My work adds no real personal, customer or confidential information." />}
      </section>
    </div>
  );
}
