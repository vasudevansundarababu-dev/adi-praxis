'use client';

import type { ValidationRunDto } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { exportBody, issueParts, partOf, RESULT_LABEL } from '@/lib/export-selection';
import { exportFixHref } from '@/lib/forge-console';

export interface ExportState {
  canValidate: boolean;
  canExport: boolean;
  reason: string | null;
  validator: { name: string; version: string; isAnvil: boolean };
  tasks: { recordId: string; taskId: string; title: string; approvedAt: string }[];
  runs: ValidationRunDto[];
}

/** Validation and export runs of a project, shared by the task table (Validate) and the export panel (Export, results). */
export function useExportRuns(projectId: string, initial: ExportState) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(path: string, body: object) {
    setPending(true);
    setError(null);
    const res = await mutate<ValidationRunDto>('POST', path, body);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setState((s) => ({ ...s, runs: [res.data!, ...s.runs] }));
  }
  return {
    state,
    pending,
    error,
    validate: (recordIds: string[]) => run(`/projects/${projectId}/validate`, { recordIds }),
    exportAll: () => run(`/projects/${projectId}/exports`, exportBody()),
  };
}
export type ExportRuns = ReturnType<typeof useExportRuns>;

/**
 * Project export (owner, 12 Nov 2026). Validate approved tasks at any time; export every approved task once the project
 * is complete (in the MVP1 new flow, 15 Nov 2026: once every task is approved; the API's reason says how many are).
 * The validator's verdict is listed per task; it changes nothing by itself.
 *
 * With `runs` (the project's Tasks tab, owner 21 Nov 2026) the tasks to validate are chosen with the table's checkboxes
 * and its Validate button; this panel then only exports (always every approved task) and shows the results.
 */
export function ExportPanel({ projectId, initial, newFlow = false, runs }: { projectId: string; initial: ExportState; newFlow?: boolean; runs?: ExportRuns }) {
  const own = useExportRuns(projectId, initial);
  const { state, pending, error, validate, exportAll } = runs ?? own;
  const [recordId, setRecordId] = useState(initial.tasks[0]?.recordId ?? '');
  const latest = state.runs[0] ?? null;

  const validatorNote = state.validator.isAnvil ? 'Validated by RL Gym.' : 'RL Gym validation is not connected yet: ADI Forge checks each task with its own export checks.';
  return (
    <section aria-labelledby="export-heading" className="mt-6 rounded-md border border-line p-4">
      <h2 id="export-heading" className="text-lg font-semibold">
        Export
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {state.tasks.length} approved {state.tasks.length === 1 ? 'task' : 'tasks'}. {validatorNote}
        {runs && ' Export always sends every approved task; the selection in the table is only for Validate.'}
      </p>
      {state.reason && <p className="mt-2 text-sm">{state.reason}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {state.canValidate && !runs && (
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
            <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={pending || !recordId} onClick={() => void validate([recordId])}>
              Validate
            </button>
          </>
        )}
        <button type="button" className="btn btn-primary disabled:opacity-60" disabled={pending || !state.canExport} onClick={() => void exportAll()}>
          Export to RL Gym
        </button>
      </div>
      {pending && <p className="mt-2 text-sm text-fg-muted">Working…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {latest && <RunResults projectId={projectId} run={latest} newFlow={newFlow} />}
    </section>
  );
}

const Mono = ({ children }: { children: string }) => <code className="font-mono text-xs">{children}</code>;

/** RL Gym's answer for the package a task was in: its validate status and request id, and on export its intake status. */
function PartNote({ part }: { part: NonNullable<ReturnType<typeof partOf>> }) {
  return (
    <span className="text-fg-muted" data-anvil-part={part.partIndex}>
      {' '}
      (RL Gym {part.validate.status}
      {part.validate.requestId && (
        <>
          , request <Mono>{part.validate.requestId}</Mono>
        </>
      )}
      {part.resolve && (
        <>
          ; intake {part.resolve.status}
          {part.resolve.requestId && (
            <>
              , request <Mono>{part.resolve.requestId}</Mono>
            </>
          )}
        </>
      )}
      )
    </span>
  );
}

/**
 * The latest run: its counts, then one line per task with its verdict, RL Gym's status and request id for the package it
 * was sent in, and each issue's code, location and RL Gym request.
 */
function RunResults({ projectId, run, newFlow }: { projectId: string; run: ValidationRunDto; newFlow: boolean }) {
  return (
    <div className="mt-4 text-sm" role="status" data-validation-run={run.id}>
      <p className="font-medium">
        {run.kind === 'EXPORT' ? 'Last export' : 'Last validation'} ({run.createdAt.slice(0, 16).replace('T', ' ')}): {run.counts.valid} valid, {run.counts.needsFix} need fixing
        {run.counts.notValidated ? `, ${run.counts.notValidated} not validated` : ''}.
        {run.downloadPath && (
          <>
            {' '}
            <a href={`/api/v1${run.downloadPath}`}>Download the export</a>
          </>
        )}
      </p>
      {run.anvil && (
        <p className="mt-1 text-fg-muted" data-anvil-support={run.anvil.support}>
          RL Gym contract {run.anvil.contract}: {run.anvil.support}.
        </p>
      )}
      <ul className="mt-2 list-disc pl-5" aria-label="Result per task">
        {run.results.map((r) => {
          const part = partOf(run.anvil, r.recordId);
          return (
            <li key={r.recordId} data-result={r.recordId} className="mt-1">
              <Link href={exportFixHref(projectId, r.taskId, newFlow)}>{r.title}</Link> — {RESULT_LABEL[r.status]}
              {part && <PartNote part={part} />}
              {r.issues.length > 0 && ':'}
              {r.issues.length > 0 && (
                <ul className="mt-0.5 list-[circle] pl-5">
                  {r.issues.slice(0, 3).map((issue, n) => {
                    const p = issueParts(issue);
                    return (
                      <li key={n} data-issue-code={p.code}>
                        <Mono>{p.code}</Mono> {p.message}
                        {p.location && (
                          <>
                            {' '}
                            (at <Mono>{p.location}</Mono>)
                          </>
                        )}
                        {p.requestId && (
                          <>
                            {' '}
                            · RL Gym request <Mono>{p.requestId}</Mono>
                          </>
                        )}
                      </li>
                    );
                  })}
                  {r.issues.length > 3 && <li>+{r.issues.length - 3} more</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
