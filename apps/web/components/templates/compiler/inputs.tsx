'use client';

import { useEffect, useId, useState } from 'react';
import { parseList } from '@/lib/mc/editor';

export const inputClass = 'mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm disabled:opacity-70';

export function Labelled({ label, hint, children }: { label: string; hint?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children(id, hint ? `${id}-hint` : undefined)}
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, value, onChange, hint, multiline, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: string; multiline?: boolean; placeholder?: string; mono?: boolean }) {
  return (
    <Labelled label={label} hint={hint}>
      {(id, d) =>
        multiline ? (
          <textarea id={id} aria-describedby={d} rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${inputClass} ${mono ? 'font-mono text-xs' : ''}`} />
        ) : (
          <input id={id} aria-describedby={d} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${inputClass} ${mono ? 'font-mono text-xs' : ''}`} />
        )
      }
    </Labelled>
  );
}

/** Number input that keeps partial text while typing; reports `null` for empty. */
export function NumberField({ label, value, onChange, hint, min, max, step, integer }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; hint?: string; min?: number; max?: number; step?: number; integer?: boolean }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text);
    if (parsed !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value));
  }, [value]);
  return (
    <Labelled label={label} hint={hint}>
      {(id, d) => (
        <input
          id={id}
          aria-describedby={d}
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : 'any')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim() === '') return onChange(null);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(integer ? Math.trunc(n) : n);
          }}
          className={inputClass}
        />
      )}
    </Labelled>
  );
}

/** Comma-separated list (skills, columns, tag options…). */
export function ListField({ label, value, onChange, hint, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => {
    if (JSON.stringify(parseList(text)) !== JSON.stringify(value)) setText(value.join(', '));
  }, [value]);
  return (
    <Labelled label={label} hint={hint ?? 'Separate items with commas.'}>
      {(id, d) => (
        <input
          id={id}
          aria-describedby={d}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseList(e.target.value));
          }}
          className={inputClass}
        />
      )}
    </Labelled>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: ReadonlyArray<T | { value: T; label: string }>; onChange: (v: T) => void; hint?: string }) {
  return (
    <Labelled label={label} hint={hint}>
      {(id, d) => (
        <select id={id} aria-describedby={d} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
      )}
    </Labelled>
  );
}

export function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="text-sm">
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={checked} disabled={disabled} aria-describedby={hint ? id : undefined} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        <span className="font-medium">{label}</span>
      </label>
      {hint && (
        <p id={id} className="ml-6 text-xs text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CheckboxGroup<T extends string>({ legend, options, value, onChange, labels }: { legend: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <fieldset className="text-sm">
      <legend className="font-medium">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} className="h-4 w-4" />
            {labels?.[o] ?? o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SectionCard({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <div className="ml-auto flex gap-2">{actions}</div>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function SmallButton({ children, onClick, label, tone }: { children: React.ReactNode; onClick: () => void; label?: string; tone?: 'danger' }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`rounded-md border border-hairline px-2 py-1 text-xs hover:border-focus disabled:opacity-50 ${tone === 'danger' ? 'text-error' : ''}`}>
      {children}
    </button>
  );
}
