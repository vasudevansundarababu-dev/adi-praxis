'use client';

import type { ValidationRunDto } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export interface ExportState {
  canValidate: boolean;
  canExport: boolean;
  reason: string | null;
  validator: { name: string; version: string; isAnvil: boolean };
  tasks: { recordId: string; taskId: string; title: string; approvedAt: string }[];
  runs: ValidationRunDto[];
}

/**
 * Project export (owner, 12 Nov 2026). Validate one approved task at any time; export every approved task once the project
 * is complete. The validator's verdict lists the tasks that need fixing; it changes nothing by itself.
 */
export function ExportPanel({ projectId, initial }: { projectId: string; initial: ExportState }) {
  const [state, setState] = useState(initial);
  const [recordId, setRecordId] = useState(initial.tasks[0]?.recordId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = state.runs[0] ?? null;

  async function run(path: string, body: object) {
    setPending(true);
    setError(null);
    const res = await mutate<ValidationRunDto>('POST', path, body);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setState((s) => ({ ...s, runs: [res.data!, ...s.runs] }));
  }

  const validatorNote = state.validator.isAnvil ? 'Validated by Anvil.' : 'Anvil validation is not connected yet: Praxis checks each task with its own export checks.';
  return (
    <section aria-labelledby="export-heading" className="mt-6 rounded-md border border-line p-4">
      <h2 id="export-heading" className="text-lg font-semibold">
        Export
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {state.tasks.length} approved {state.tasks.length === 1 ? 'task' : 'tasks'}. {validatorNote}
      </p>
      {state.reason && <p className="mt-2 text-sm">{state.reason}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {state.canValidate && (
          <>
            <label className="text-sm">
              <span className="block font-medium">Task to validate</span>
              <select className="mt-1 rounded-md border border-line bg-surface px-2 py-1" value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                {state.tasks.map((t) => (
                  <option key={t.recordId} value={t.recordId}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={pending || !recordId} onClick={() => void run(`/projects/${projectId}/validate`, { recordIds: [recordId] })}>
              Validate
            </button>
          </>
        )}
        <button type="button" className="btn btn-primary disabled:opacity-60" disabled={pending || !state.canExport} onClick={() => void run(`/projects/${projectId}/exports`, {})}>
          Export
        </button>
      </div>
      {pending && <p className="mt-2 text-sm text-fg-muted">Working…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {latest && (
        <div className="mt-4 text-sm" role="status">
          <p className="font-medium">
            {latest.kind === 'EXPORT' ? 'Last export' : 'Last validation'} ({latest.createdAt.slice(0, 16).replace('T', ' ')}): {latest.counts.valid} valid, {latest.counts.needsFix} need fixing
            {latest.counts.notValidated ? `, ${latest.counts.notValidated} not validated` : ''}.
            {latest.downloadPath && (
              <>
                {' '}
                <a href={`/api/v1${latest.downloadPath}`}>Download the export</a>
              </>
            )}
          </p>
          {latest.results.some((r) => r.status !== 'valid') && (
            <ul className="mt-2 list-disc pl-5">
              {latest.results
                .filter((r) => r.status !== 'valid')
                .map((r) => (
                  <li key={r.recordId}>
                    <Link href={`/review/tasks/${r.taskId}`}>{r.title}</Link> — {r.status === 'needs_fix' ? 'needs fixing' : 'not validated'}:{' '}
                    {r.issues
                      .slice(0, 3)
                      .map((i) => i.message)
                      .join('; ')}
                    {r.issues.length > 3 ? ` (+${r.issues.length - 3} more)` : ''}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
