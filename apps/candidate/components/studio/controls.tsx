'use client';

import { normaliseWeights, type CustomField, type StudioAnswers } from '@praxis/shared';
import { useId, useRef } from 'react';
import { oracleGridRows, setOracleTag, type OracleRow } from '@/lib/studio/steps';

export const inputClass = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-70';
type FieldValue = StudioAnswers['fields'][string];

function formatValue(f: CustomField, v: number) {
  return f.input_type === 'currency_slider' ? `$${v.toLocaleString('en-GB')}` : String(v);
}

/** One Meta-Compiler custom field, rendered from its type, options and default (S4-05). */
export function CustomFieldControl({ field: f, value, onChange, disabled }: { field: CustomField; value: FieldValue | undefined; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const id = useId();
  const hint = `${id}-hint`;
  const range = f.min !== undefined || f.max !== undefined ? `Range ${f.min ?? '−∞'} to ${f.max ?? '∞'}.` : '';
  const help = <p id={hint} className="mt-0.5 text-xs text-fg-muted">{[range, `Used in ${f.inject_into.join(', ')}.`].filter(Boolean).join(' ')}</p>;
  const wrap = (control: React.ReactNode) => (
    <div className="text-sm" data-field-id={f.field_id}>
      <label htmlFor={id} className="font-medium">{f.label}</label>
      {control}
      {help}
    </div>
  );
  switch (f.input_type) {
    case 'number_input':
      return wrap(
        <input id={id} type="number" aria-describedby={hint} min={f.min} max={f.max} step="any" disabled={disabled} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={inputClass} />,
      );
    case 'currency_slider': {
      const v = typeof value === 'number' ? value : (f.min ?? 0);
      return wrap(
        <div className="mt-1 flex items-center gap-3">
          <input id={id} type="range" aria-describedby={hint} min={f.min} max={f.max} step={1} disabled={disabled} value={v} aria-valuetext={formatValue(f, v)} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--praxis-focus)]" />
          <output htmlFor={id} className="w-20 text-right font-mono text-sm">{formatValue(f, v)}</output>
        </div>,
      );
    }
    case 'single_select':
      return wrap(
        <select id={id} aria-describedby={hint} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>,
      );
    case 'multi_select': {
      const list = Array.isArray(value) ? value : [];
      return (
        <fieldset className="text-sm" data-field-id={f.field_id} aria-describedby={hint}>
          <legend className="font-medium">{f.label}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {f.options.map((o) => (
              <label key={o} className="chip cursor-pointer">
                <input type="checkbox" disabled={disabled} checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? f.options.filter((x) => x === o || list.includes(x)) : list.filter((x) => x !== o))} className="mr-1.5" />
                {o}
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case 'boolean_toggle':
      return (
        <div className="text-sm" data-field-id={f.field_id}>
          <label className="inline-flex items-center gap-2 font-medium">
            <input type="checkbox" role="switch" aria-describedby={hint} disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            {f.label}
          </label>
          {help}
        </div>
      );
    case 'text_input':
      return wrap(<input id={id} aria-describedby={hint} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />);
  }
}

/** Public dropzone: synthetic text the agent sees at `targetPath` (S4-04, NFR-05). */
export function DropzoneControl({ label, format, targetPath, value, onChange, disabled }: { label: string; format: string; targetPath: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">{label}</label>
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        Agent-visible at <code>{targetPath}</code> ({format}). Paste or load synthetic content only.
      </p>
      <textarea id={id} aria-describedby={`${id}-hint`} rows={5} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} font-mono text-xs`} />
      <div className="mt-1 flex items-center gap-2">
        <input
          ref={file}
          type="file"
          accept={`.${format},text/plain`}
          aria-label={`Load a ${format} file into ${label}`}
          disabled={disabled}
          className="text-xs"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onChange((await f.text()).slice(0, 200_000));
            if (file.current) file.current.value = '';
          }}
        />
        <span className="text-xs text-fg-muted">{value.length.toLocaleString('en-GB')} characters</span>
      </div>
    </div>
  );
}

/**
 * Ground-truth oracle grid (S4-06). Rows come from the template preview; each row gets one tag from `tagOptions`.
 * Keyboard: the grid has one tab stop; ↑/↓ move between rows, 1–9 set a tag, 0 or Delete clears it.
 */
export function OracleGrid({ columns, tagOptions, previewRows, rows, onChange, disabled }: { columns: string[]; tagOptions: string[]; previewRows: string[][]; rows: OracleRow[]; onChange: (rows: OracleRow[]) => void; disabled?: boolean }) {
  const grid = oracleGridRows(previewRows, rows);
  const refs = useRef<Array<HTMLTableRowElement | null>>([]);
  const focusIndex = useRef(0);
  const tag = (i: number, t: string) => onChange(setOracleTag(grid, i, t, tagOptions));
  const onKey = (i: number) => (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    const move = (to: number) => {
      e.preventDefault();
      focusIndex.current = Math.max(0, Math.min(grid.length - 1, to));
      refs.current[focusIndex.current]?.focus();
    };
    if (e.key === 'ArrowDown') return move(i + 1);
    if (e.key === 'ArrowUp') return move(i - 1);
    if (e.key === 'Home') return move(0);
    if (e.key === 'End') return move(grid.length - 1);
    if (disabled) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= tagOptions.length) {
      e.preventDefault();
      tag(i, tagOptions[n - 1]!);
    } else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      tag(i, '');
    }
  };
  const tagged = grid.filter((r) => r.tag).length;
  return (
    <section aria-labelledby="oracle-grid-title" className="text-sm">
      <h3 id="oracle-grid-title" className="font-medium">Ground-truth oracle table</h3>
      <p id="oracle-grid-help" className="text-xs text-fg-muted">
        Hidden from the agent: stored under <code>/eval/ground_truth/</code>. Tag each row with {tagOptions.join(', ')}; untagged rows are left out. Keys: ↑/↓ move, {tagOptions.map((t, i) => `${i + 1} ${t}`).join(', ')}, 0 clears.
      </p>
      {grid.length === 0 ? (
        <p className="mt-2 text-fg-muted">This template has no preview rows.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left" aria-describedby="oracle-grid-help">
            <caption className="sr-only">Oracle rows: {tagged} of {grid.length} tagged</caption>
            <thead className="bg-surface">
              <tr>
                {columns.map((c) => <th key={c} scope="col" className="px-3 py-1.5 font-medium">{c}</th>)}
                <th scope="col" className="px-3 py-1.5 font-medium">SME tag</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((r, i) => {
                const name = r.cells.join(' · ');
                return (
                  <tr
                    key={`${i}:${name}`}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    tabIndex={i === Math.min(focusIndex.current, grid.length - 1) ? 0 : -1}
                    onFocus={() => (focusIndex.current = i)}
                    onKeyDown={onKey(i)}
                    aria-label={`${name}: ${r.tag || 'not tagged'}`}
                    data-tagged={r.tag ? 'true' : 'false'}
                    className={`border-t border-line outline-none focus-visible:ring-2 focus-visible:ring-[var(--praxis-focus)] ${r.tag ? 'bg-[color-mix(in_srgb,var(--praxis-accent)_14%,transparent)]' : ''}`}
                  >
                    {columns.map((c, ci) => <td key={c} className="px-3 py-1.5">{r.cells[ci] ?? ''}</td>)}
                    <td className="px-3 py-1">
                      <select aria-label={`Tag for ${name}`} disabled={disabled} value={r.tag} onChange={(e) => tag(i, e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1">
                        <option value="">Not tagged</option>
                        {tagOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Simulator slider (curve or fuzzy-match archetype), clamped to the template range (S4-07). */
export function SimulatorSlider({ label, min, max, step, value, formula, onChange, disabled }: { label: string; min: number; max: number; step: number; value: number; formula: string; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">{label}</label>
      <div className="mt-1 flex items-center gap-3">
        <input id={id} type="range" min={min} max={max} step={step} disabled={disabled} value={value} aria-valuetext={`${value} (range ${min} to ${max})`} onChange={(e) => onChange(clamp(Number(e.target.value)))} className="w-full accent-[var(--praxis-focus)]" />
        <output htmlFor={id} className="w-20 text-right font-mono">{value}</output>
      </div>
      {formula && <p className="text-xs text-fg-muted"><code>{formula}</code></p>}
    </div>
  );
}

/** Guardrail on/off (S4-04, Stage 4 rules). */
export function InvariantToggle({ ruleId, description, checked, onChange, disabled }: { ruleId: string; description: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-line p-3 text-sm">
      <input type="checkbox" role="switch" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        <span className="font-medium">{description}</span>
        <span className="block text-xs text-fg-muted">
          <code>{ruleId}</code> · Hard fail (−1.0) when breached
        </span>
      </span>
    </label>
  );
}

/** Rubric weights that must total 100, with "Auto-normalise" (S4-04, Stage 5). */
export function WeightSliders({ milestones, weights, onChange, disabled }: { milestones: Array<{ milestoneId: string; label: string; default: number }>; weights: Record<string, number>; onChange: (w: Record<string, number>) => void; disabled?: boolean }) {
  const values = milestones.map((m) => weights[m.milestoneId] ?? m.default);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3 text-sm">
      {milestones.map((m, i) => (
        <WeightRow key={m.milestoneId} label={m.label} value={values[i]!} disabled={disabled} onChange={(v) => onChange({ ...weights, [m.milestoneId]: v })} />
      ))}
      <div className="flex items-center gap-3">
        <span role="status" className={total === 100 ? 'text-success' : 'text-error'}>
          Total {total}%{total === 100 ? '' : ' (must be 100%)'}
        </span>
        <button type="button" disabled={disabled || total === 100} className="btn btn-secondary !px-3 !py-1 text-xs" onClick={() => onChange(Object.fromEntries(normaliseWeights(values).map((w, i) => [milestones[i]!.milestoneId, w])))}>
          Auto-normalise
        </button>
      </div>
    </div>
  );
}

function WeightRow({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="font-medium">{label}</label>
      <div className="mt-1 flex items-center gap-3">
        <input id={id} type="range" min={0} max={100} step={1} disabled={disabled} value={value} aria-valuetext={`${value}%`} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--praxis-focus)]" />
        <output htmlFor={id} className="w-12 text-right font-mono">{value}%</output>
      </div>
    </div>
  );
}
