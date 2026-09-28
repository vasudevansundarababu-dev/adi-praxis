'use client';

import { useState } from 'react';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import { StatePill, TD, TH } from '@/components/supply/ui';
import type { KnowledgeRow } from './types';

const KINDS = ['ALL', 'RULE', 'DEFINITION', 'STEP', 'DECISION', 'THRESHOLD', 'EDGE_CASE', 'FAILURE_MODE'];

function Row({ k, section, canEdit }: { k: KnowledgeRow; section?: string; canEdit: boolean }) {
  const a = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(k.text);
  const patch = (body: Record<string, unknown>) => a.run('PATCH', `/knowledge-items/${k.id}`, body);
  return (
    <tr>
      <td className={TD}>{k.kind.toLowerCase().replace(/_/g, ' ')}</td>
      <td className={TD}>
        {editing ? (
          <div className="space-y-2">
            <textarea aria-required="true" rows={3} value={text} onChange={(e) => setText(e.target.value)} className={input} aria-label="Knowledge item text" />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={a.pending || text.trim().length < 3}
                onClick={async () => {
                  const res = await patch({ text: text.trim() });
                  if (res.ok) setEditing(false);
                }}
                className="btn btn-primary"
              >
                Save
              </button>
              <button type="button" onClick={() => (setEditing(false), setText(k.text))} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          k.text
        )}
        {k.critical && <span className="pill pill-error ml-2">Critical rule</span>}
        <ActionMessages error={a.error} />
      </td>
      <td className={TD}>
        <a href={`#section-${k.citation}`} title={section} className="font-mono text-link hover:underline">
          {k.citation}
        </a>
      </td>
      <td className={TD}><StatePill state={k.status} /></td>
      {canEdit && (
        <td className={`${TD} whitespace-nowrap`}>
          <div className="flex flex-col items-start gap-1">
            {k.status !== 'APPROVED' && (
              <button type="button" disabled={a.pending} onClick={() => patch({ status: 'APPROVED' })} className="text-link">
                Approve
              </button>
            )}
            {k.status !== 'REJECTED' && (
              <button type="button" disabled={a.pending} onClick={() => patch({ status: 'REJECTED' })} className="text-link">
                Reject
              </button>
            )}
            {!editing && (
              <button type="button" onClick={() => setEditing(true)} className="text-link">
                Edit text
              </button>
            )}
            <button type="button" disabled={a.pending} onClick={() => patch({ critical: !k.critical })} className="text-link">
              {k.critical ? 'Not critical' : 'Mark critical'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

/** The knowledge map, filterable by kind and status. Admin approves, edits, rejects or marks critical rules. */
export function KnowledgeMap({ items, sections, canEdit }: { items: KnowledgeRow[]; sections: { anchor: string; heading: string }[]; canEdit: boolean }) {
  const [kind, setKind] = useState('ALL');
  const [status, setStatus] = useState<'ALL' | KnowledgeRow['status']>('ALL');
  const heading = new Map(sections.map((s) => [s.anchor, s.heading]));
  const shown = items.filter((k) => (kind === 'ALL' || k.kind === kind) && (status === 'ALL' || k.status === status));
  const counts = { DRAFT: 0, APPROVED: 0, REJECTED: 0 };
  for (const k of items) counts[k.status]++;
  const kinds = KINDS.filter((x) => x === 'ALL' || items.some((k) => k.kind === x)).concat([...new Set(items.map((k) => k.kind))].filter((x) => !KINDS.includes(x)));
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === 'ALL' ? 'All kinds' : k.toLowerCase().replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={input}>
            <option value="ALL">All ({items.length})</option>
            <option value="DRAFT">To review ({counts.DRAFT})</option>
            <option value="APPROVED">Approved ({counts.APPROVED})</option>
            <option value="REJECTED">Rejected ({counts.REJECTED})</option>
          </select>
        </label>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-fg-muted">
            <tr>
              <th className={TH}>Kind</th>
              <th className={TH}>Item</th>
              <th className={TH}>Cites</th>
              <th className={TH}>Status</th>
              {canEdit && (
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((k) => (
              <Row key={`${k.id}:${k.status}:${k.text}:${k.critical}`} k={k} section={heading.get(k.citation)} canEdit={canEdit} />
            ))}
            {shown.length === 0 && (
              <tr>
                <td className={`${TD} text-fg-muted`} colSpan={canEdit ? 5 : 4}>
                  {items.length ? 'Nothing matches these filters.' : 'The knowledge map has not been generated yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
