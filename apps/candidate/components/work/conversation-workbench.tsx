'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ConversationProposal, KycTask } from '@praxis/shared';
import { call } from '@/lib/client';
import { CONVERSATION_EXAMPLES } from './conversation-examples';
import { InvestigationMap } from './investigation-map';
import type { TaskView } from '@/lib/work-types';
interface View {
  revision: number; output: Record<string, unknown>;
  state: { pending?: { runId: string; proposal: ConversationProposal; problems: string[] }; unresolved?: string[]; needsReview?: boolean; policyLinks?: ConversationProposal['ruleLinks'] };
  messages: Array<{ id: string; speaker: string; content: string }>;
  run: { id: string; status: string; model: string | null; error: string | null } | null;
  policy: { rules: Array<{ rule_version_id: string; title: string; requirement: string; applicability_label: string; sources: unknown[] }> } | null;
}
export function ConversationWorkbench({ task }: { task: TaskView }) {
  const [view, setView] = useState<View | null>(null), [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState(0);
  const [preview, setPreview] = useState<unknown>(null), [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await call<View>('GET', `/me/tasks/${task.id}/conversation`); if (r.ok) setView(r.data); else setError(r.error); }, [task.id]);
  useEffect(() => { void load(); }, [load]);
  const running = view?.run?.status === 'QUEUED' || view?.run?.status === 'RUNNING';
  useEffect(() => { if (!running) return; const timer = setInterval(() => void load(), 2000); return () => clearInterval(timer); }, [running, load]);
  const mutate = async (path: string, body: unknown) => { setBusy(true); setError(null); try { const r = await call('POST', `/me/tasks/${task.id}/conversation/${path}`, body); if (!r.ok) setError(r.error); else { if (path === 'messages') setAnswer(''); await load(); } } finally { setBusy(false); } };
  const current = (view?.output ?? {}) as KycTask;
  const graph = current.solution?.steps ?? [];
  const pending = view?.state.pending;
  const showAgent = async () => { if (preview) return setPreview(null); const r = await call('GET', `/me/tasks/${task.id}/agent-preview`); if (r.ok) setPreview(r.data); else setError(r.error); };
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sample = CONVERSATION_EXAMPLES.find(x => normalize(x.name) === normalize(task.template.workflow));
  const examples = [sample?.scenario ?? `Describe a fictional ${task.template.workflow} case and its central complication.`, `Choose a published project rule and explain its applicability, exception and the investigation step it supports. Do not treat a missing identifier as mandatory without that support.`, sample ? `${sample.evidence}. Finding: ${sample.finding}` : 'State the evidence, proposed check, exact recorded response and remaining uncertainty.', sample?.outcome ?? 'Recommend the evidence-supported next step, rationale and authorised human handoff.', sample ? `Full credit: identify the issue “${sample.finding}” with evidence references. Partial: issue recognised without full support. Zero: issue missed or evidence invented.` : 'Define observable full-credit, partial-credit and failure conditions. Weights total 100; explain critical failures.'];
  const step = graph.find(s => s.id === selected);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Build a case through conversation</h1><p className="text-sm text-fg-muted">{task.template.workflow} · One executor · Saved conversation and case memory</p></div><button onClick={() => void showAgent()} className="rounded border border-line px-3 py-2">{preview ? 'Return to authoring' : 'View as agent'}</button></div>
    <a href="?editor=form" data-save-before-leaving className="text-sm text-link underline">Open detailed editor, rubric and submission checks</a>
    {error && <p role="alert" className="text-error">{error}</p>}
    {preview ? <pre className="whitespace-pre-wrap break-words rounded border border-line p-4 text-sm">{JSON.stringify(preview, null, 2)}</pre> : <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label="Case authoring conversation" className="space-y-3">
        {!view?.messages.length && <div className="rounded border border-line p-3"><p>What is happening, and what makes this case difficult? Describe an invented example. I will check your answer against the saved case and approved project policies.</p><details className="mt-2 text-sm"><summary>See an example</summary><p>{task.definition === 'kyc-onboarding-v1' ? 'An invented applicant wants a current account. Identity and address records use different family names. Tax identifiers have not been supplied. Establish the applicable policy before treating an identifier as mandatory.' : `Describe one ${task.template.workflow} case, the supplied evidence, its contradiction or missing information, and what a good investigator should recommend.`}</p></details></div>}
        {view?.messages.map(m => <div key={m.id} className="rounded border border-line p-3"><b className="text-xs">{m.speaker === 'AUTHOR' ? 'You' : 'Praxis'}</b><p className="whitespace-pre-wrap break-words text-sm">{m.content}</p></div>)}
        <p className="text-xs text-fg-muted">{view?.run?.model?.startsWith('mock') ? 'Local mock mode: no live model generated updates.' : running ? 'Preparing a coordinated proposal… If interrupted, no model call is automatically repeated.' : 'Proposals require your confirmation. AI output is not an approved task.'}</p>
        {view?.run?.error && <p role="alert" className="text-warning">{view.run.error}</p>}
        {pending && <div className="space-y-2 rounded border border-line p-3"><h2 className="font-semibold">Review coordinated changes</h2>{pending.proposal.changes.map(c => <details key={c.section}><summary>{c.section} — {c.reason}</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(c.value, null, 2)}</pre></details>)}{pending.proposal.ruleLinks.map((l, i) => <p key={i} className="text-xs">{l.stepId} → {l.ruleVersionId}: {l.reason}</p>)}{pending.problems.map((x, i) => <p key={i} className="text-error">{x}</p>)}<div className="flex gap-3"><button disabled={task.readOnly || busy || !!pending.problems.length} onClick={() => void mutate('decision', { runId: pending.runId, accept: true })} className="rounded border border-line p-2 disabled:opacity-50">Confirm changes</button><button disabled={task.readOnly || busy} onClick={() => void mutate('decision', { runId: pending.runId, accept: false })} className="rounded border border-line p-2">Discard</button></div></div>}
        <details className="rounded border border-line p-3"><summary>Examples for each authoring section</summary><label className="mt-2 block text-sm">Section<select value={guide} onChange={e => setGuide(Number(e.target.value))} className="mt-1 w-full rounded border border-line bg-surface p-2">{['Describe the case', 'Link project rules', 'Define evidence and checks', 'Give the expected recommendation', 'Write the grading guide'].map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label><p className="my-2 text-sm">{examples[guide]}</p><button disabled={task.readOnly || busy || !!running || !!pending} onClick={() => setAnswer(examples[guide]!)} className="rounded border border-line p-2 disabled:opacity-50">Use as starting answer</button><p className="text-xs text-fg-muted">Illustrative draft, not accepted policy or a benchmark answer. Edit before sending.</p></details>
        <label className="block text-sm">Your answer<textarea value={answer} onChange={e => setAnswer(e.target.value)} maxLength={4000} rows={4} disabled={task.readOnly || busy || !!running || !!pending} className="mt-1 w-full rounded border border-line bg-surface p-3 disabled:opacity-50" /></label>
        <button disabled={task.readOnly || busy || !!running || !!pending || !answer.trim() || !view} onClick={() => void mutate('messages', { content: answer, expectedRevision: view!.revision })} className="rounded border border-line px-4 py-2 disabled:opacity-50">Send answer</button>
        {!!view?.state.unresolved?.length && <section><h2>Questions still unresolved</h2><ul>{view.state.unresolved.map((x, i) => <li key={i} className="text-warning">• {x}</li>)}</ul></section>}
        {view?.state.needsReview && <button disabled={busy || task.readOnly || !!pending || !!view.state.unresolved?.length} onClick={() => void mutate('review', { expectedRevision: view.revision })} className="rounded border border-line p-2 disabled:opacity-50">I reviewed the coordinated case, reference and rubric</button>}
        <p className="text-xs text-fg-muted">Grounding and privacy checks are limited. A valid citation does not prove a claim is true. Independent human review and export qualification remain required.</p>
      </section>
      <section className="space-y-4"><h2 className="font-semibold">Live investigation map</h2><p className="text-xs text-fg-muted">Expected investigation, not an execution trace. Dependencies can branch; all steps belong to one executor.</p>
        {!graph.length && <p className="rounded border border-dashed border-line p-4 text-sm">The map appears when you confirm a proposal containing investigation steps.</p>}
        <InvestigationMap steps={graph} selected={selected} onSelect={setSelected} />
        {step && <div className="rounded border border-line p-3"><h3>{step.id} · What this step does</h3><p>{step.why}</p><p className="text-sm">Recorded response: {step.responseId ?? 'Not a tool call'}</p>{(view?.state.policyLinks ?? []).filter(l => l.stepId === step.id).map(l => <p key={l.ruleVersionId}>{l.ruleVersionId}: {l.reason}</p>)}</div>}
        <details><summary>Reference outcome and rubric</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify({ solution: current.solution, rubric: current.rubric }, null, 2)}</pre></details>
        <details><summary>Approved project rules ({view?.policy?.rules.length ?? 0})</summary>{view?.policy?.rules.map(r => <div className="border-b border-line py-2" key={r.rule_version_id}><b>{r.title}</b><p className="text-sm">{r.requirement}</p><p className="text-xs">{r.applicability_label}</p><details><summary>Source and page/clause</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(r.sources, null, 2)}</pre></details></div>)}{!view?.policy && <p>No published project rules. Ask for policy clarification; do not invent a mandatory requirement.</p>}</details>
      </section>
    </div>}
  </div>;
}
