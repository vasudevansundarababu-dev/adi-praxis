'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AUTHORSHIP_VERSION, AUTHORSHIP_TERMS } from '@praxis/shared';
import type { ConversationProposal, KycTask } from '@praxis/shared';
import { call } from '@/lib/client';
import { CONVERSATION_EXAMPLES } from './conversation-examples';
import { TemplateInstructions } from './template-instructions';
import { InvestigationMap } from './investigation-map';
import type { CheckResult, TaskView } from '@/lib/work-types';
interface View {
  revision: number; output: Record<string, unknown>;
  state: { humanOnly?: boolean; consent?: {version:string}; declaration?: {revision:number}; pending?: { runId: string; proposal: ConversationProposal; problems: string[] }; unresolved?: string[]; needsReview?: boolean; policyLinks?: ConversationProposal['ruleLinks'] };
  messages: Array<{ id: string; speaker: string; content: string }>;
  run: { id: string; status: string; model: string | null; error: string | null } | null;
  policy: { rules: Array<{ rule_version_id: string; title: string; requirement: string; applicability_label: string; sources: unknown[] }> } | null;
}
const phoneQuery = '(max-width: 767px)';
const phoneSnapshot = () => window.matchMedia(phoneQuery).matches;
const subscribePhone = (notify: () => void) => { const m = window.matchMedia(phoneQuery); m.addEventListener('change', notify); return () => m.removeEventListener('change', notify); };
export function ConversationWorkbench({ task, draftAnswer, onDraftChange }: { task: TaskView; draftAnswer?: string; onDraftChange?(text:string):void }) {
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const readOnly = task.readOnly || phone;
  const [view, setView] = useState<View | null>(null), [localAnswer, setLocalAnswer] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const answer = draftAnswer ?? localAnswer;
  const setAnswer = onDraftChange ?? setLocalAnswer;
  const [consentChecked, setConsentChecked] = useState(false), [ownWork, setOwnWork] = useState(false);
  const [originality, setOriginality] = useState<CheckResult | null>(null);
  const [guide, setGuide] = useState(0);
  const [preview, setPreview] = useState<unknown>(null), [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await call<View>('GET', `/me/tasks/${task.id}/conversation`); if (r.ok) setView(r.data); else setError(r.error); }, [task.id]);
  useEffect(() => { void load(); }, [load]);
  const running = view?.run?.status === 'QUEUED' || view?.run?.status === 'RUNNING';
  useEffect(() => { if (!running) return; const timer = setInterval(() => void load(), 2000); return () => clearInterval(timer); }, [running, load]);
  const mutate = async (path: string, body: unknown) => { if (readOnly) return; setBusy(true); setError(null); try { const r = await call('POST', `/me/tasks/${task.id}/conversation/${path}`, body); if (!r.ok) setError(r.error); else { if (path === 'messages') setAnswer(''); await load(); window.dispatchEvent(new Event('praxis:reload-task')); } } finally { setBusy(false); } };
  const consented = view?.state.consent?.version === AUTHORSHIP_VERSION;
  const checkOriginality = async () => { setBusy(true); try { const r = await call<CheckResult>('POST', `/me/tasks/${task.id}/check`, {}); if (r.ok) setOriginality(r.data); else setError(r.error); } finally {setBusy(false);} };
  const current = (view?.output ?? {}) as KycTask;
  const graph = current.solution?.steps ?? [];
  const pending = view?.state.pending;
  const showAgent = async () => { if (preview) return setPreview(null); const r = await call('GET', `/me/tasks/${task.id}/agent-preview`); if (r.ok) setPreview(r.data); else setError(r.error); };
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sample = CONVERSATION_EXAMPLES.find(x => normalize(x.name) === normalize(task.template.workflow));
  const examples = [sample?.scenario ?? `Describe a ${task.template.workflow} case and its central complication.`, `Choose a published project rule and explain its applicability, exception and the investigation step it supports. Do not treat a missing identifier as mandatory without that support.`, sample ? `${sample.evidence}. Finding: ${sample.finding}` : 'State the evidence, proposed check, exact recorded response and remaining uncertainty.', sample?.outcome ?? 'Recommend the evidence-supported next step, rationale and authorised human handoff.', sample ? `Full credit: identify the issue “${sample.finding}” with evidence references. Partial: issue recognised without full support. Zero: issue missed or evidence invented.` : 'Define observable full-credit, partial-credit and failure conditions. Weights total 100; explain critical failures.'];
  const step = graph.find(s => s.id === selected);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Build a case through conversation</h1><p className="text-sm text-fg-muted">{task.template.workflow} · Saved conversation and case memory</p></div><button onClick={() => void showAgent()} className="rounded border border-line px-3 py-2">{preview ? 'Return to authoring' : 'View as agent'}</button></div>
    <TemplateInstructions workflow={task.template.workflow} audience="author" />
    <p className="text-sm text-fg-muted">8 authoring sections · {graph.length} investigation step{graph.length === 1 ? '' : 's'} currently defined</p>
    <p className="text-sm text-fg-muted">Use the shared checks and submission panel below after reviewing your case and rubric.</p>
    {phone && <p role="status" className="rounded border border-line p-3 text-sm">Phone view is read-only. Use a desktop to author or confirm changes.</p>}
    {!consented && <section className="space-y-2 rounded border border-line p-3" aria-label="Human authorship consent"><h2 className="font-semibold">Human-authorship agreement</h2><p className="text-sm">{AUTHORSHIP_TERMS}</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={consentChecked} onChange={e=>setConsentChecked(e.target.checked)} disabled={readOnly || busy} />I agree to these terms.</label><button disabled={!consentChecked || readOnly || busy || !view} onClick={()=>void mutate('consent',{version:AUTHORSHIP_VERSION,accepted:true})} className="rounded border border-line p-2 disabled:opacity-50">Accept authorship terms</button></section>}
    {error && <p role="alert" className="text-error">{error}</p>}
    {preview ? <pre className="whitespace-pre-wrap break-words rounded border border-line p-4 text-sm">{JSON.stringify(preview, null, 2)}</pre> : <div className="grid min-w-0 gap-6 2xl:grid-cols-2">
      <section aria-label="Case authoring conversation" className="min-w-0 space-y-3">
        {!view?.messages.length && <div className="rounded border border-line p-3"><p>What is happening, and what makes this case difficult? Describe the case. I will check your answer against the saved case and approved project policies.</p><details className="mt-2 text-sm"><summary>See an example</summary><p>{task.definition === 'kyc-onboarding-v1' ? 'An applicant wants a current account. Identity and address records use different family names. Tax identifiers have not been supplied. Establish the applicable policy before treating an identifier as mandatory.' : `Describe one ${task.template.workflow} case, the supplied evidence, its contradiction or missing information, and what a good investigator should recommend.`}</p></details></div>}
        {view?.messages.map(m => <div key={m.id} className="rounded border border-line p-3"><b className="text-xs">{m.speaker === 'AUTHOR' ? 'You' : 'Praxis'}</b><p className="whitespace-pre-wrap break-words text-sm">{m.content}</p></div>)}
        <p className="text-xs text-fg-muted">{view?.run?.model?.startsWith('mock') ? 'Local mock mode: no live model generated updates.' : running ? 'Organising your typed answer and checking its source links…' : 'Proposals require your confirmation. The assistant cannot generate your substantive answers.'}</p>
        {view?.run?.error && <p role="alert" className="text-warning">{view.run.error}</p>}
        {pending && <div className="space-y-2 rounded border border-line p-3"><h2 className="font-semibold">Review coordinated changes</h2>{!!pending.proposal.graphOps?.length && <section aria-label="Proposed workflow changes"><h3 className="text-sm font-medium">Workflow changes</h3><ol className="list-decimal space-y-1 pl-5 text-sm">{pending.proposal.graphOps.map((op, i) => <li key={i}>{describeGraphOp(op)}</li>)}</ol></section>}{pending.proposal.changes.map(c => <details key={c.section}><summary>{c.section} — {c.reason}</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(c.value, null, 2)}</pre></details>)}{pending.proposal.ruleLinks.map((l, i) => <p key={i} className="text-xs">{l.stepId} → {l.ruleVersionId}: {l.reason}</p>)}{pending.problems.map((x, i) => <p key={i} className="text-error">{x}</p>)}<div className="flex gap-3"><button disabled={readOnly || busy || !!pending.problems.length} onClick={() => void mutate('decision', { runId: pending.runId, accept: true })} className="rounded border border-line p-2 disabled:opacity-50">Confirm changes</button><button disabled={readOnly || busy} onClick={() => void mutate('decision', { runId: pending.runId, accept: false })} className="rounded border border-line p-2">Discard</button></div></div>}
        <details className="rounded border border-line p-3"><summary>Examples for each authoring section</summary><label className="mt-2 block text-sm">Section<select value={guide} onChange={e => setGuide(Number(e.target.value))} className="mt-1 w-full rounded border border-line bg-surface p-2">{['Describe the case', 'Link project rules', 'Define evidence and checks', 'Give the expected recommendation', 'Write the grading guide'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><p className="my-2 text-sm">{examples[guide]}</p><p className="text-xs text-fg-muted">Read-only teaching example. Write your own case and assessment; do not reproduce this answer.</p><p className="text-xs text-fg-muted">Teaching example only; supply your own content.</p></details>
        <label className="block text-sm">Your answer<textarea value={answer} onChange={e => setAnswer(e.target.value)} maxLength={4000} rows={4} disabled={readOnly || busy || !consented || !!running || !!pending} className="mt-1 w-full rounded border border-line bg-surface p-3 disabled:opacity-50" /></label>
        <button disabled={readOnly || busy || !consented || !!running || !!pending || !answer.trim() || !view} onClick={() => void mutate('messages', { content: answer, expectedRevision: view!.revision })} className="rounded border border-line px-4 py-2 disabled:opacity-50">Send answer</button>
        {!!view?.state.unresolved?.length && <section><h2>Questions still unresolved</h2><ul>{view.state.unresolved.map((x, i) => <li key={i} className="text-warning">• {x}</li>)}</ul></section>}
        {view?.state.needsReview && <label className="flex gap-2 text-sm"><input type="checkbox" checked={ownWork} onChange={e=>setOwnWork(e.target.checked)} disabled={readOnly || busy} />This revision is my own work, no LLM generated the answers, and all sources are authorised.</label>}
        {view?.state.needsReview && <button disabled={!ownWork || busy || readOnly || !!pending || !!view.state.unresolved?.length} onClick={() => void mutate('review', { expectedRevision: view.revision, ownWork: true, noExternalLlm: true, authorisedSources: true })} className="rounded border border-line p-2 disabled:opacity-50">I reviewed the coordinated case, reference and rubric</button>}
        <details className="rounded border border-line p-3"><summary>Originality and similarity review</summary><p className="text-sm">Compare the saved draft with the existing submitted/accepted workflow corpus. This is not internet plagiarism detection or proof of AI use. Similarity signals go to a human reviewer; they do not automatically reject work or release/withhold payment.</p><button disabled={readOnly || busy || !!running || !view} onClick={()=>void checkOriginality()} className="rounded border border-line p-2 disabled:opacity-50">Check saved draft similarity</button>{originality && <p className="text-sm">{originality.similar.length} nearby case(s); {originality.similar.filter(m=>m.flagged).length} flagged for human comparison. No misconduct conclusion is implied.</p>}<p className="text-xs text-fg-muted">You may explain legitimate policy quotations, shared templates or other similarity to the reviewer.</p></details>
        <p className="text-xs text-fg-muted">Grounding and privacy checks are limited. A valid citation does not prove a claim is true. Independent human review and export qualification remain required.</p>
      </section>
      <section className="min-w-0 space-y-4"><h2 className="font-semibold">Live investigation map</h2><p className="text-xs text-fg-muted">Expected investigation, not an execution trace. Dependencies can branch; all steps belong to one executor.</p>
        {!graph.length && <p className="rounded border border-dashed border-line p-4 text-sm">The map appears when you confirm a proposal containing investigation steps.</p>}
        <InvestigationMap steps={graph} selected={selected} onSelect={setSelected} />
        {step && <div className="rounded border border-line p-3"><h3>{step.id} · What this step does</h3><p>{step.why}</p><p className="text-sm">Recorded response: {step.responseId ?? 'Not a tool call'}</p>{(view?.state.policyLinks ?? []).filter(l => l.stepId === step.id).map(l => <p key={l.ruleVersionId}>{l.ruleVersionId}: {l.reason}</p>)}</div>}
        <details><summary>Reference outcome and rubric</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ solution: current.solution, rubric: current.rubric }, null, 2)}</pre></details>
        <details><summary>Approved project rules ({view?.policy?.rules.length ?? 0})</summary>{view?.policy?.rules.map(r => <div className="border-b border-line py-2" key={r.rule_version_id}><b>{r.title}</b><p className="text-sm">{r.requirement}</p><p className="text-xs">{r.applicability_label}</p><details><summary>Source and page/clause</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(r.sources, null, 2)}</pre></details></div>)}{!view?.policy && <p>No published project rules. Ask for policy clarification; do not invent a mandatory requirement.</p>}</details>
      </section>
    </div>}
  </div>;
}

/** A proposed workflow change in plain words, so the SME confirms exactly what changes in the graph. */
export function describeGraphOp(op: NonNullable<ConversationProposal['graphOps']>[number]): string {
  switch (op.op) {
    case 'rename_node': return `Rename step ${op.nodeId} to "${op.label}"`;
    case 'set_instruction': return `Change the instruction of ${op.nodeId} to "${op.instruction}"`;
    case 'add_step_after': return `Add step "${op.label}" after ${op.nodeId}: ${op.instruction}`;
    case 'add_decision_after': return `Add decision "${op.question}" after ${op.nodeId} (${op.yesLabel} / ${op.noLabel}, plus else and unknown routes)`;
    case 'add_human_step_after': return `Add a person in the case, ${op.actorRole}, after ${op.nodeId}: "${op.prompt}"`;
    case 'add_parallel_step': return `Add step "${op.label}" running alongside ${op.nodeId}, joined before the next step`;
    case 'add_correction_loop': return `Add correction loop "${op.label}" from ${op.decisionId} back to ${op.backToNodeId}, at most ${op.maxIterations} times`;
    case 'remove_node': return `Remove step ${op.nodeId}`;
  }
}
