'use client';

import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { filterFacts, NO_DESCRIPTION, originText, queueForFact, typeText, type FactRow } from './facts-logic';

/**
 * The fact list (read-only): each fact a condition may name, with what it means, its type and values, where it comes
 * from, and how many rules use it (linked to the review queue filtered to them). Search and 10 rows a page (PAGE_SIZE, D-120).
 */
export function FactsTable({ projectId, rows }: { projectId: string; rows: FactRow[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => filterFacts(rows, q), [rows, q]);
  const paged = usePagedRows(shown, { param: 'factsPage', resetKey: q });
  return (
    <div>
      <label htmlFor="facts-q" className="flex max-w-sm flex-col text-sm">
        Search
        <input id="facts-q" className="input mt-1" value={q} placeholder="Variable or description" onChange={(e) => setQ(e.target.value)} />
      </label>
      <table className="mt-3 w-full text-left text-sm">
        <caption className="sr-only">Facts conditions can use</caption>
        <thead className="text-xs text-fg-muted">
          <tr>
            <th scope="col" className="py-1">Variable</th>
            <th scope="col">Description</th>
            <th scope="col">Type and allowed values</th>
            <th scope="col">Where it comes from</th>
            <th scope="col">Used by</th>
          </tr>
        </thead>
        <tbody>
          {paged.items.map((r) => (
            <tr key={r.id} className="border-t border-line align-top" data-fact={r.id}>
              <td className="py-1.5 pr-2 font-mono text-xs">{r.id}</td>
              <td className="pr-2">
                {r.label && <span className="block font-medium">{r.label}</span>}
                {r.description ? <span className="block">{r.description}</span> : <span className="block text-fg-muted">{NO_DESCRIPTION}</span>}
              </td>
              <td className="pr-2">{typeText(r)}</td>
              <td className="pr-2">
                {r.definedBy ? (
                  <>
                    Derived: defined by rule{' '}
                    <Link className="font-mono text-xs text-link hover:underline" href={`/projects/${projectId}/policy/rules/${r.definedBy.ruleId}`}>
                      {r.definedBy.ruleKey}
                    </Link>
                  </>
                ) : (
                  originText(r)
                )}
              </td>
              <td>
                {r.usedBy > 0 ? (
                  <Link className="text-link hover:underline" href={queueForFact(projectId, r.id)}>
                    {r.usedBy} {r.usedBy === 1 ? 'rule' : 'rules'}
                  </Link>
                ) : (
                  <span className="text-fg-muted">0 rules</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="mt-2 text-sm text-fg-muted">No fact matches this search.</p>}
      <ClientPager paged={paged} noun="facts" singular="fact" />
    </div>
  );
}
