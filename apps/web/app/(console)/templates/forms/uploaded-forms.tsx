'use client';

import { matchesQuery } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';

export interface UploadedForm {
  profileId: string;
  name: string;
  workflowName: string;
  source: 'builtin' | 'uploaded';
  isDefault: boolean;
  agentMode: 'SINGLE' | 'MULTI';
  examples: number;
  uploadedAt: string | null;
}

/** The uploaded forms table (UI standard 3a): searched by form, id or workflow, 10 a page (`?page=`). */
export function UploadedForms({ forms }: { forms: UploadedForm[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => forms.filter((f) => matchesQuery([f.name, f.profileId, f.workflowName], q)), [forms, q]);
  const paged = usePagedRows(shown, { resetKey: q });
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Search uploaded forms</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search uploaded forms" className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">
          No matches for &lsquo;{q}&rsquo;.{' '}
          <button type="button" className="text-link hover:underline" onClick={() => setQ('')}>
            Clear search
          </button>
        </p>
      ) : (
        <>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Form</th>
                <th scope="col">Workflow</th>
                <th scope="col">Agents</th>
                <th scope="col">Golden cases</th>
                <th scope="col">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((f) => (
                <tr key={f.profileId}>
                  <td>
                    {f.name} <span className="text-fg-muted">({f.profileId})</span>
                  </td>
                  <td>{f.workflowName}</td>
                  <td>{f.agentMode === 'MULTI' ? 'multi-agent' : 'single'}</td>
                  <td>{f.examples}</td>
                  <td>{f.uploadedAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ClientPager paged={paged} noun="uploaded forms" singular="uploaded form" />
        </>
      )}
    </>
  );
}
