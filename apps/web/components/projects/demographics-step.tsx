'use client';

import type { DemographicAttributeDto, DemographicFilterInput, FilterOperator, Option } from '@praxis/shared';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';

type Range = { min: number; max: number; unit: string };
type Lang = { languages: Option[]; levels: Option[] };

/** Step 4: filters from the Admin-managed taxonomy, each required or preferred (SPEC FLOW 1). */
export function DemographicsStep({
  attributes,
  filters,
  onChange,
}: {
  attributes: DemographicAttributeDto[];
  filters: DemographicFilterInput[];
  onChange: (f: DemographicFilterInput[]) => void;
}) {
  const byKey = new Map(filters.map((f) => [f.attributeKey, f]));
  const update = (key: string, patch: Partial<DemographicFilterInput>) =>
    onChange(filters.map((f) => (f.attributeKey === key ? { ...f, ...patch } : f)));
  const add = (a: DemographicAttributeDto) => onChange([...filters, emptyFilter(a)]);
  const remove = (key: string) => onChange(filters.filter((f) => f.attributeKey !== key));

  return (
    <div className="mt-4 space-y-3">
      <RequiredNote />
      <p className="text-sm text-fg-muted">Add at least one filter. Required filters must match; preferred ones raise the match score.</p>
      {attributes.map((a) => {
        const f = byKey.get(a.key);
        return (
          <div key={a.key} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-medium">
                {a.label}
                {f && <Req />}
              </h3>
              {f ? (
                <>
                  <label className="ml-auto flex items-center gap-2 text-sm">
                    <select aria-required="true" value={f.required ? 'required' : 'preferred'} onChange={(e) => update(a.key, { required: e.target.value === 'required' })} className="rounded-md border border-line bg-surface px-2 py-1" aria-label={`${a.label}: required or preferred`}>
                      <option value="required">Required</option>
                      <option value="preferred">Preferred</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => remove(a.key)} className="text-sm text-link">
                    Remove
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => add(a)} className="ml-auto text-sm text-link">
                  + Add filter
                </button>
              )}
            </div>
            {f && <div className="mt-3">{renderEditor(a, f, (p) => update(a.key, p))}</div>}
          </div>
        );
      })}
    </div>
  );
}

function emptyFilter(a: DemographicAttributeDto): DemographicFilterInput {
  const base = { attributeKey: a.key, required: true };
  switch (a.type) {
    case 'NUMBER_RANGE':
      return { ...base, operator: 'GTE', values: {} };
    case 'GEO_RADIUS':
      return { ...base, operator: 'WITHIN_RADIUS', values: { city: '', radiusKm: 25 } };
    case 'LANGUAGE_PROFICIENCY':
      return { ...base, operator: 'IN', values: [] };
    default:
      return { ...base, operator: 'IN', values: [] };
  }
}

function renderEditor(a: DemographicAttributeDto, f: DemographicFilterInput, update: (p: Partial<DemographicFilterInput>) => void) {
  switch (a.type) {
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return (
        <OptionPicker
          label={a.label}
          options={a.allowedValues as Option[]}
          selected={(f.values as string[]) ?? []}
          single={a.type === 'SINGLE_SELECT'}
          onChange={(values) => update({ values })}
        />
      );
    case 'NUMBER_RANGE': {
      const r = a.allowedValues as Range;
      const v = (f.values ?? {}) as { min?: number; max?: number };
      const numOrUndef = (s: string) => (s === '' ? undefined : Number(s));
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-required="true" aria-label={`${a.label} comparison`} value={f.operator} onChange={(e) => update({ operator: e.target.value as FilterOperator })} className="rounded-md border border-line bg-surface px-2 py-1">
            <option value="GTE">at least</option>
            <option value="LTE">at most</option>
            <option value="BETWEEN">between</option>
          </select>
          {f.operator !== 'LTE' && (
            <input type="number" aria-required="true" aria-label={`${a.label} minimum`} min={r.min} max={r.max} value={v.min ?? ''} onChange={(e) => update({ values: { ...v, min: numOrUndef(e.target.value) } })} className="w-24 rounded-md border border-line bg-surface px-2 py-1" />
          )}
          {f.operator === 'BETWEEN' && <span>and</span>}
          {f.operator !== 'GTE' && (
            <input type="number" aria-required="true" aria-label={`${a.label} maximum`} min={r.min} max={r.max} value={v.max ?? ''} onChange={(e) => update({ values: { ...v, max: numOrUndef(e.target.value) } })} className="w-24 rounded-md border border-line bg-surface px-2 py-1" />
          )}
          <span className="text-fg-muted">{r.unit}</span>
        </div>
      );
    }
    case 'GEO_RADIUS': {
      const v = (f.values ?? {}) as { city?: string; radiusKm?: number };
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Within</span>
          <input type="number" aria-required="true" aria-label="Radius in km" min={1} max={(a.allowedValues as { maxRadiusKm: number }).maxRadiusKm} value={v.radiusKm ?? ''} onChange={(e) => update({ values: { ...v, radiusKm: Number(e.target.value) } })} className="w-24 rounded-md border border-line bg-surface px-2 py-1" />
          <span>km of</span>
          <input aria-required="true" aria-label="City" placeholder="City" value={v.city ?? ''} onChange={(e) => update({ values: { ...v, city: e.target.value } })} className="rounded-md border border-line bg-surface px-2 py-1" />
        </div>
      );
    }
    case 'LANGUAGE_PROFICIENCY': {
      const allowed = a.allowedValues as Lang;
      const rows = (f.values as { language: string; minLevel: string }[]) ?? [];
      const set = (next: typeof rows) => update({ values: next });
      return (
        <div className="space-y-2 text-sm">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select aria-required="true" aria-label="Language" value={row.language} onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, language: e.target.value } : r)))} className="rounded-md border border-line bg-surface px-2 py-1">
                {allowed.languages.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span>at least</span>
              <select aria-required="true" aria-label="Minimum level" value={row.minLevel} onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, minLevel: e.target.value } : r)))} className="rounded-md border border-line bg-surface px-2 py-1">
                {allowed.levels.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="text-link">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => set([...rows, { language: 'en', minLevel: 'B2' }])} className="text-link">
            + Add language
          </button>
        </div>
      );
    }
  }
}

/** Searchable checkbox list; long lists (countries, time zones) stay usable. */
function OptionPicker({ label, options, selected, single, onChange }: { label: string; options: Option[]; selected: string[]; single: boolean; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q) : options).slice(0, 100);
  const labels = new Map(options.map((o) => [o.value, o.label]));
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : single ? [v] : [...selected, v]);
  return (
    <div className="text-sm">
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={`Selected ${label}`}>
          {selected.map((v) => (
            <li key={v}>
              <button type="button" onClick={() => toggle(v)} className="rounded-full border border-line px-2 py-0.5" aria-label={`Remove ${labels.get(v) ?? v}`}>
                {labels.get(v) ?? v} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length > 12 && (
        <input type="search" aria-label={`Search ${label}`} placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2 w-full rounded-md border border-line bg-surface px-2 py-1" />
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-line p-2">
        {shown.map((o) => (
          <label key={o.value} className="flex items-center gap-2 py-0.5">
            <input type={single ? 'radio' : 'checkbox'} name={single ? label : undefined} aria-required={single ? true : undefined} checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {options.length > shown.length && !q && <p className="mt-1 text-xs text-fg-muted">Showing 100 of {options.length}. Search to find more.</p>}
      </div>
    </div>
  );
}
