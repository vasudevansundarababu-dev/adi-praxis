'use client';

import { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { AUTHORSHIP_VERSION, exportStatusLine } from '@praxis/shared';
import { ProfileDiagnostic, ProfileEditor, profileRouteFor } from './profile-editor';
import { call } from '@/lib/client';
import { AuthoringConsent } from './authoring-controls';
import { InvestigationMap } from './investigation-map';
import { WorkflowGraphPanel } from './workflow-graph-panel';
import { TemplateInstructions } from './template-instructions';
import { TypedAnswerBoundary } from './typed-answer-boundary';
import { ConversationWorkbench } from './conversation-workbench';

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
  if (readOnly && state.kind !== 'error' && state.kind !== 'conflict') return <span className="rounded-full border border-line px-2 py-0.5 text-xs">Read-only</span>;
  const text =
    state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved ${new Date(state.at!).toLocaleTimeString()}` : state.kind === 'conflict' ? state.message ?? 'Changed in another window: reload to continue' : state.kind === 'error' ? state.message : 'All changes save automatically';
  return (
    <span aria-live="polite" className={`text-xs ${state.kind === 'error' || state.kind === 'conflict' ? 'text-error' : 'text-fg-muted'}`}>
      {text}
    </span>
  );
}

/** Opens the right editor for the task: the KYC workbench, the generic authoring editor, or the annotation form. */
export function TaskPage({ task }: { task: TaskView }) {
  const phone=useSyncExternalStore(notify=>{const m=window.matchMedia('(max-width:767px)');m.addEventListener('change',notify);return()=>m.removeEventListener('change',notify);},()=>window.matchMedia('(max-width:767px)').matches,()=>false);
  const [current,setCurrent]=useState(task),[editor,setEditor]=useState<'CLASSIC'|'CHATBOT'>(task.authoringWorkspace?.view ?? (task.effectiveAuthoringExperience==='CLASSIC'?'CLASSIC':'CHATBOT'));
  const [draftAnswer,setDraftAnswer]=useState(task.authoringWorkspace?.answer??''),[switching,setSwitching]=useState(false),[switchError,setSwitchError]=useState(''),[consented,setConsented]=useState(!task.authoringExperience);
  const currentRef=useRef(current);currentRef.current=current;
  const draftRef=useRef(draftAnswer);draftRef.current=draftAnswer;
  const prefQueue=useRef<Promise<boolean>>(Promise.resolve(true));
  const mode=task.effectiveAuthoringExperience??'BOTH';
  const allowedEditor=mode==='BOTH'?editor:mode;
  const refresh=async()=>{const r=await call<TaskView>('GET',`/me/tasks/${task.id}`);if(r.ok&&r.data){setCurrent(r.data);currentRef.current=r.data;}return r.ok;};
  const persist=async(view:'CLASSIC'|'CHATBOT',answer:string)=>{prefQueue.current=prefQueue.current.then(async()=>{const r=await call('POST',`/me/tasks/${task.id}/authoring-workspace`,{view,answer});if(!r.ok)setSwitchError(r.error??'Could not save workspace');return r.ok;});return prefQueue.current;};
  useEffect(()=>{if(task.taskType!=='AUTHORING')return;// A slow load-time read must never undo an acceptance made meanwhile: it can only confirm consent, not withdraw it.
    void call<{state:{consent?:{version:string}}}>('GET',`/me/tasks/${task.id}/conversation`).then(r=>{if(r.ok&&r.data){const given=r.data.state.consent?.version===AUTHORSHIP_VERSION;setConsented(c=>c||given);}});
    if(mode==='BOTH'&&!task.authoringWorkspace){setEditor(new URLSearchParams(window.location.search).get('editor')==='form'?'CLASSIC':'CHATBOT');}
  },[task.id]);
  useEffect(()=>{const load=()=>{void refresh();};const saved=(e:Event)=>{const d=(e as CustomEvent).detail;if(d.taskId===task.id&&d.output)setCurrent(t=>({...t,output:d.output,revision:d.revision}));};window.addEventListener('praxis:reload-task',load);window.addEventListener('praxis:task-saved',saved);return()=>{window.removeEventListener('praxis:reload-task',load);window.removeEventListener('praxis:task-saved',saved);};},[task.id]);
  useEffect(()=>{if(task.taskType!=='AUTHORING'||current.readOnly||!consented)return;const timer=setTimeout(()=>void persist(allowedEditor,draftAnswer),700);return()=>clearTimeout(timer);},[draftAnswer,allowedEditor,consented]);
  const flushAll=async()=>{const saves:Promise<boolean>[]=[];window.dispatchEvent(new CustomEvent('praxis:flush',{detail:{saves}}));if(!(await Promise.all(saves)).every(Boolean))return false;return refresh();};
  const switchView=async(next:'CLASSIC'|'CHATBOT')=>{if(mode!=='BOTH'||switching||next===allowedEditor)return;setSwitching(true);setSwitchError('');try{if(!await flushAll()){setSwitchError('Your changes could not be saved. Remain here and retry.');return;}if(!current.readOnly&&!await persist(next,draftRef.current))return;setEditor(next);}finally{setSwitching(false);}};
  const detailed=allowedEditor==='CLASSIC';
  const visibleTask={...current,readOnly:current.readOnly||phone};
  const steps=(current.output as {solution?:{steps?:import('@praxis/shared').KycStep[]}}|null)?.solution?.steps??[];
  const [agentPreview,setAgentPreview]=useState<unknown>(null),[selectedStep,setSelectedStep]=useState<string|null>(null);
  const router = useRouter();
  const done = () => router.push(`/projects/${task.projectId}?submitted=${task.id}`);
  return (
    <div>
      <Link href={`/projects/${task.projectId}`} data-save-before-leaving className="text-sm text-link hover:underline">
        ← {task.projectName}
      </Link>
      <p className="mt-1 text-xs text-fg-muted">
        {current.phase?.label ?? TASK_STATUS[task.status]}{task.agentMode ? ` · ${task.agentMode === 'SINGLE' ? 'Single agent' : 'Multi agent'}` : ''} · time target {task.tptMinutes ?? '—'} min · active so far {minutes(task.activeSeconds)} min. The time target is for planning and pay; your task never expires.
      </p>
      {task.exportStatus && <p className={`mt-1 text-xs ${task.exportStatus.status === 'blocked' ? 'text-warning' : 'text-fg-muted'}`}>{exportStatusLine(task.status === 'ACCEPTED' ? 'Approved' : TASK_STATUS[task.status], task.exportStatus)}</p>}
      {task.status === 'REJECTED' && task.review && (
        <p role="status" className="mt-3 rounded-md border border-line p-3 text-sm">
          This task was not accepted ({task.review.rejectReason?.toLowerCase().replace(/_/g, ' ')}). {task.review.notes}
        </p>
      )}
      {task.taskType==='AUTHORING'&&mode==='BOTH'&&<div className="mt-4 flex flex-wrap gap-2" aria-label="Authoring view"><button disabled={switching} aria-pressed={detailed} onClick={()=>void switchView('CLASSIC')} className="rounded border border-line p-2">Classic</button><button disabled={switching} aria-pressed={!detailed} onClick={()=>void switchView('CHATBOT')} className="rounded border border-line p-2">Chatbot</button><span className="self-center text-xs text-fg-muted">Same task, rubric and validation</span></div>}
      {switchError&&<p role="alert" className="text-error">{switchError}</p>}
      {task.taskType==='AUTHORING'&&task.authoringExperience&&!consented&&!current.readOnly?<AuthoringConsent taskId={task.id} readOnly={phone} onReady={()=>{setConsented(true);void refresh();}}/>:<TypedAnswerBoundary enabled={task.taskType === 'AUTHORING'}><div className="mt-4" key={allowedEditor}>
        {agentPreview!=null && <section className="space-y-3"><button className="rounded border border-line p-2" onClick={()=>setAgentPreview(null)}>Return to authoring</button><pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(agentPreview,null,2)}</pre></section>}<div hidden={agentPreview!=null}>
        {task.taskType === 'AUTHORING' && !detailed ? <><ConversationWorkbench task={visibleTask} draftAnswer={draftAnswer} onDraftChange={setDraftAnswer}/>{!visibleTask.readOnly&&<SubmitPanel taskId={task.id} flush={flushAll} revision={()=>currentRef.current.revision} onSubmitted={done}/>}</> : current.definition === 'kyc-onboarding-v1' ? <KycWorkbench task={visibleTask} onSubmitted={done} /> : current.taskType === 'ANNOTATION' ? <AnnotationTask task={visibleTask} onSubmitted={done} /> : <ProfileOrGeneric task={visibleTask} onSubmitted={done} />}
        {task.taskType==='AUTHORING'&&<WorkflowGraphPanel taskId={task.id} graph={(current.output as {workflowGraph?:unknown}|null)?.workflowGraph??null} startingGraph={task.startingGraph??null} agentMode={task.agentMode??'SINGLE'} editable={detailed&&!visibleTask.readOnly}/>}
        {task.taskType==='AUTHORING'&&detailed&&<section className="mt-6 space-y-3"><TemplateInstructions workflow={task.template.workflow} audience="author"/>{steps.length>0&&<h2>Investigation map · {steps.length} steps</h2>}{steps.length>0&&<InvestigationMap steps={steps} selected={selectedStep} onSelect={setSelectedStep}/>}{steps.filter(s=>s.id===selectedStep).map(s=><div key={s.id} className="rounded border border-line p-3"><h3>{s.id}</h3><p>{s.why}</p><p>{s.expectedResult}</p></div>)}<button className="rounded border border-line p-2" onClick={async()=>{if(!await flushAll()){setSwitchError('Your changes could not be saved. Retry before opening the agent view.');return;}const r=await call<{task:unknown}>('GET',`/me/tasks/${task.id}/agent-preview`);if(r.ok&&r.data)setAgentPreview(r.data.task);}}>View as agent</button>{agentPreview!=null&&<pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(agentPreview,null,2)}</pre>}</section>}
        </div>
      </div></TypedAnswerBoundary>}

    </div>
  );
}

/** A registered template profile opens the Classic profile editor; everything else keeps the generic editor. */
function ProfileOrGeneric({ task, onSubmitted }: { task: TaskView; onSubmitted: () => void }) {
  const route = profileRouteFor(task);
  if (route?.kind === 'editor') return <ProfileEditor task={task} profile={route.profile} onSubmitted={onSubmitted} />;
  if (route?.kind === 'diagnostic') return <ProfileDiagnostic workflow={route.workflow} problems={route.problems} />;
  return <GenericAuthoring task={task} onSubmitted={onSubmitted} />;
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
        {!task.authoringExperience && !value.praxisContract && <button type="button" className="text-sm text-link underline" onClick={() => startContract(false)}>Start a synthetic executable marketing example</button>}
        {!task.authoringExperience && !value.praxisContract && <button type="button" className="ml-3 text-sm text-link underline" onClick={() => startContract(true)}>Start a staged synthetic marketing example</button>}
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
