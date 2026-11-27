'use client';

import { matchesQuery, type DemographicAttributeDto } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';

function describe(a: DemographicAttributeDto): string {
  const v = a.allowedValues as Record<string, unknown> | unknown[];
  switch (a.type) {
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
      return `${(v as unknown[]).length} values`;
    case 'NUMBER_RANGE': {
      const r = v as { min: number; max: number; unit: string };
      return `${r.min}–${r.max} ${r.unit}`;
    }
    case 'GEO_RADIUS':
      return `up to ${(v as { maxRadiusKm: number }).maxRadiusKm} km`;
    case 'LANGUAGE_PROFICIENCY': {
      const l = v as { languages: unknown[]; levels: unknown[] };
      return `${l.languages.length} languages, ${l.levels.length} levels`;
    }
  }
}

const TYPE_LABELS = {
  SINGLE_SELECT: 'Single choice',
  MULTI_SELECT: 'Multiple choice',
  NUMBER_RANGE: 'Number range',
  GEO_RADIUS: 'City and radius',
  LANGUAGE_PROFICIENCY: 'Language and level',
} as const;

/** The demographic attributes table (UI standard 3a): searched by label, key or type, 10 a page (`?page=`). */
export function AttributeTable({ items }: { items: DemographicAttributeDto[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter((a) => matchesQuery([a.label, a.key, TYPE_LABELS[a.type]], q)), [items, q]);
  const paged = usePagedRows(shown, { resetKey: q });
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Search attributes</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search attributes" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      <div className="mt-3 overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-2 font-medium">Attribute</th>
              <th className="px-4 py-2 font-medium">Key</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Allowed values</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2">{a.label}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.key}</td>
                <td className="px-4 py-2">{TYPE_LABELS[a.type]}</td>
                <td className="px-4 py-2">{describe(a)}</td>
              </tr>
            ))}
            {items.length > 0 && shown.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={4} className="px-4 py-4 text-center text-fg-muted">
                  No matches for &lsquo;{q}&rsquo;.{' '}
                  <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
                    Clear search
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ClientPager paged={paged} noun="attributes" singular="attribute" className="px-4 pb-3" />
      </div>
    </>
  );
}
