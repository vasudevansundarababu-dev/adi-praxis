'use client';

import type { CustomField, ElicitationPresetDto } from '@praxis/shared';
import { useId, useState } from 'react';
import type { ProposeFieldResult } from '@/lib/mc/browser';
import { inputClass } from './inputs';

export interface AssistantProps {
  presets: ElicitationPresetDto[];
  disabled: boolean;
  stageLabel: string;
  propose: (prompt: string) => Promise<{ ok: boolean; data: ProposeFieldResult | null; error: string | null }>;
  /** Problems the proposal would have if added to the active stage (same rules as a manual field). */
  check: (field: CustomField) => string[];
  onInsertPreset: (field: CustomField) => void;
  onAccept: (field: CustomField) => void;
  onEdit: (field: CustomField) => void;
  onManual: () => void;
  initialResult?: ProposeFieldResult | null;
}

/** S2-14: Guided Elicitation Assistant. Presets insert a field; free text gets an AI proposal the Admin accepts, edits or discards (D7). */
export function ElicitationAssistant({ presets, disabled, stageLabel, propose, check, onInsertPreset, onAccept, onEdit, onManual, initialResult = null }: AssistantProps) {
  const uid = useId();
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProposeFieldResult | null>(initialResult);
  const [error, setError] = useState<string | null>(null);
  const proposal = result?.proposal ?? null;
  const problems = proposal ? [...(result?.problems ?? []), ...check(proposal)] : [];

  async function apply() {
    setPending(true);
    setError(null);
    const r = await propose(prompt);
    setPending(false);
    if (!r.ok || !r.data) return setError(r.error ?? 'The assistant could not answer.');
    setResult(r.data);
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="card p-4">
      <h3 id={`${uid}-h`} className="font-semibold">
        Guided Elicitation Assistant
      </h3>
      <p className="text-xs text-fg-muted">Adds to: {stageLabel}</p>
      {presets.length > 0 && (
        <ul aria-label="Presets" className="mt-2 flex flex-wrap gap-2">
          {presets.filter((p) => p.active).map((p) => (
            <li key={p.id}>
              <button type="button" disabled={disabled} className="chip text-xs disabled:opacity-50" onClick={() => onInsertPreset(p.field)}>
                + {p.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) void apply();
        }}
      >
        <label htmlFor={`${uid}-prompt`} className="text-sm font-medium">
          Describe a parameter in plain words
        </label>
        <textarea id={`${uid}-prompt`} rows={2} value={prompt} disabled={disabled} placeholder="e.g. Holiday CPM multiplier around 1.8" onChange={(e) => setPrompt(e.target.value)} className={inputClass} />
        <button type="submit" disabled={disabled || pending || !prompt.trim()} className="btn btn-secondary mt-2 !py-1.5 text-sm">
          {pending ? 'Asking…' : 'Apply to Template'}
        </button>
      </form>
      <div aria-live="polite" className="mt-3 space-y-2 text-sm">
        {error && <p role="alert" className="text-error">{error}</p>}
        {result?.unavailableReason && (
          <div role="status" className="rounded-md border border-warning p-3">
            <p>{result.unavailableReason}</p>
            <button type="button" className="mt-2 text-link underline" onClick={onManual}>
              Add the field by hand
            </button>
          </div>
        )}
        {proposal && (
          <div className="rounded-md border border-hairline p-3" data-testid="ai-proposal">
            <p className="text-xs text-fg-muted">
              AI proposal ({result!.provider} · {result!.model}). Nothing is saved until you accept it.
            </p>
            <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-2 text-xs">
              <dt className="text-fg-muted">Label</dt>
              <dd>{proposal.label}</dd>
              <dt className="text-fg-muted">field_id</dt>
              <dd className="font-mono">{proposal.field_id}</dd>
              <dt className="text-fg-muted">Type</dt>
              <dd>{proposal.input_type}</dd>
              {proposal.options.length > 0 && (
                <>
                  <dt className="text-fg-muted">Options</dt>
                  <dd>{proposal.options.join(', ')}</dd>
                </>
              )}
              <dt className="text-fg-muted">Default</dt>
              <dd className="font-mono">{JSON.stringify(proposal.default_value)}</dd>
              <dt className="text-fg-muted">Inject into</dt>
              <dd className="font-mono">{proposal.inject_into.join(', ') || '—'}</dd>
            </dl>
            {problems.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-error">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={problems.length > 0 || disabled} className="btn btn-primary !px-3 !py-1 text-xs" onClick={() => { onAccept(proposal); setResult(null); setPrompt(''); }}>
                Accept
              </button>
              <button type="button" disabled={disabled} className="btn btn-secondary !px-3 !py-1 text-xs" onClick={() => { onEdit(proposal); setResult(null); }}>
                Edit
              </button>
              <button type="button" className="btn btn-secondary !px-3 !py-1 text-xs" onClick={() => setResult(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
