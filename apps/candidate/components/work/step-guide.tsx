'use client';

import { followUpsOf, stepToolWarnings, toolOptionLabel, type ProcedureStep, type StepFollowUp, type StepToolWarning } from '@praxis/shared';
import { useState } from 'react';
import { call } from '@/lib/client';

/**
 * D-016 (owner, 23 Nov 2026): the procedure (S5 steps) with the owner's tool guide.
 * - Each step's Tool is picked by purpose ("Screen an applicant — screening.check").
 * - What happens only when a check finds a problem is a conditional follow-up on that step ("If …: finding.write →
 *   specialist.refer"), never the step's main tool.
 * - The SME can write the procedure in their own words and have it drafted into steps, then review and apply them.
 * - Warnings (never blocking) flag a step whose words do not fit its tool, referral or findings as a main tool, and a
 *   missing final recommendation.
 */

type Tool = { id: string; label: string };
const button = 'rounded-md border border-line px-2 py-1 text-xs hover:border-link';

/** One step's conditional follow-ups: "If <condition>: tool → tool". */
export function StepFollowUps({ step, index, tools, onChange }: { step: Record<string, unknown>; index: number; tools: Tool[]; onChange: (followUps: StepFollowUp[]) => void }) {
  const list = Array.isArray(step.followUps) ? (step.followUps as StepFollowUp[]) : [];
  const set = (j: number, patch: Partial<StepFollowUp>) => onChange(list.map((f, k) => (k === j ? { ...f, ...patch } : f)));
  const base = `step-${index}-fu`;
  return (
    <div className="sm:col-span-2" data-step-follow-ups={index}>
      <p className="text-sm font-medium">Conditional follow-ups</p>
      <p className="text-xs text-fg-muted">What the agent does only when this step finds a problem, for example “If either applicant has an unresolved match: record the finding, then refer the case.”</p>
      <ul className="mt-2 space-y-2">
        {list.map((f, j) => (
          <li key={j} className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2">
            <label className="flex min-w-[14rem] flex-1 flex-col text-xs">
              <span className="text-fg-muted">If</span>
              <input id={`${base}-${j}-if`} className="input" value={f.if ?? ''} placeholder="either applicant has an unresolved match" onChange={(e) => set(j, { if: e.target.value })} />
            </label>
            {[0, 1].map((k) => (
              <label key={k} className="flex flex-col text-xs">
                <span className="text-fg-muted">{k === 0 ? 'Then' : 'And then'}</span>
                <select
                  className="input"
                  value={f.tools?.[k] ?? ''}
                  onChange={(e) => {
                    const next = [...(f.tools ?? [])];
                    next[k] = e.target.value;
                    set(j, { tools: next.filter((t, x) => t || x < k) });
                  }}
                >
                  <option value="">{k === 0 ? 'Choose a tool' : 'Nothing more'}</option>
                  {tools.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" className={button} aria-label={`Remove follow-up ${j + 1} of step ${index + 1}`} onClick={() => onChange(list.filter((_, k) => k !== j))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${button} mt-2`} onClick={() => onChange([...list, { if: '', tools: [] }])}>
        Add a conditional follow-up
      </button>
    </div>
  );
}

/** The warnings for one step, with a one-click fix where the guide names the right tool. */
export function StepWarnings({ warnings, onUseTool }: { warnings: StepToolWarning[]; onUseTool: (tool: string) => void }) {
  if (!warnings.length) return null;
  return (
    <ul className="sm:col-span-2 space-y-1 rounded-md border border-warning/60 bg-warning/10 p-2 text-xs" aria-label="Tool guide warnings">
      {warnings.map((w, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2">
          <span>{w.message}</span>
          {w.suggest && (
            <button type="button" className={button} onClick={() => onUseTool(w.suggest!)}>
              Use {w.suggest}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Warnings for the whole procedure (by step), from the shared guide. */
export const procedureWarnings = (steps: unknown, tools: Tool[] | null) => stepToolWarnings(steps, tools ? tools.map((t) => t.id) : null);

/** A step as the proposal shows it: "1. Screen both joint applicants. — Screen an applicant — screening.check". */
function ProposedStep({ s, i }: { s: ProcedureStep; i: number }) {
  return (
    <li>
      <span className="font-medium">
        {i + 1}. {s.action}
      </span>
      <span className="block text-xs text-fg-muted">Tool: {s.tool ? toolOptionLabel(s.tool) : 'none'}</span>
      {followUpsOf(s).map((f, j) => (
        <span key={j} className="block text-xs text-fg-muted">
          {f.if ? `If ${f.if}: ` : 'Then: '}
          {f.tools.join(' → ')}
        </span>
      ))}
    </li>
  );
}

/** "Write it in your own words": the SME's business sentences → proposed steps, applied only when the SME says so. */
export function ProcedureTranslator({ taskId, hasSteps, onApply }: { taskId: string; hasSteps: boolean; onApply: (steps: ProcedureStep[], mode: 'replace' | 'append') => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ steps: ProcedureStep[]; warnings: StepToolWarning[] } | null>(null);
  async function draft() {
    setBusy(true);
    setError(null);
    const res = await call<{ steps: ProcedureStep[]; warnings: StepToolWarning[] }>('POST', `/me/tasks/${taskId}/steps/translate`, { text });
    setBusy(false);
    if (!res.ok || !res.data) return setError(res.error ?? 'The steps could not be drafted. Try again, or add the steps yourself.');
    setProposal(res.data);
  }
  const apply = (mode: 'replace' | 'append') => {
    if (!proposal) return;
    onApply(proposal.steps, mode);
    setProposal(null);
  };
  return (
    <details className="mt-2 rounded-md border border-line p-3" data-procedure-translator>
      <summary className="cursor-pointer text-sm font-medium text-link">Write the procedure in your own words</summary>
      <p className="mt-1 text-xs text-fg-muted">
        Describe what an analyst does, in business language. For example: “Screen both joint applicants. If either has an unresolved match, record the finding and refer the case according to policy. Submit the final recommendation with the evidence.” The steps are drafted with the template’s tools for you to review and edit; nothing changes until you apply them.
      </p>
      <label htmlFor={`translate-${taskId}`} className="sr-only">
        Procedure in your own words
      </label>
      <textarea id={`translate-${taskId}`} className="input mt-2 w-full" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary" disabled={busy || text.trim().length < 10} onClick={draft}>
          {busy ? 'Drafting…' : 'Draft the steps'}
        </button>
        {text.trim().length < 10 && <span className="text-xs text-fg-muted">Write at least a sentence to draft the steps.</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {proposal && (
        <div className="mt-3 rounded-md border border-line p-3" aria-label="Drafted steps">
          <p className="text-sm font-medium">Drafted steps (not applied yet)</p>
          <ol className="mt-2 space-y-2 text-sm">
            {proposal.steps.map((s, i) => (
              <ProposedStep key={i} s={s} i={i} />
            ))}
          </ol>
          {proposal.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-warning">
              {proposal.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => apply(hasSteps ? 'replace' : 'append')}>
              {hasSteps ? 'Replace my steps with these' : 'Use these steps'}
            </button>
            {hasSteps && (
              <button type="button" className="btn btn-secondary" onClick={() => apply('append')}>
                Add after my steps
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

/** A read-only task: the step's follow-ups as text. */
export function FollowUpsText({ step }: { step: Record<string, unknown> }) {
  const list = followUpsOf(step);
  if (!list.length) return null;
  return (
    <ul className="sm:col-span-2 text-xs text-fg-muted" aria-label="Conditional follow-ups">
      {list.map((f, j) => (
        <li key={j}>
          {f.if ? `If ${f.if}: ` : 'Then: '}
          {f.tools.join(' → ')}
        </li>
      ))}
    </ul>
  );
}
