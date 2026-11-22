'use client';

import type { ProjectExportRunDto, ProjectExportStateDto } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { exportFixHref } from '@/lib/forge-console';

export type ExportState = ProjectExportStateDto;

/** The project's export state, shared by the Tasks table ("In RL Gym") and the export panel (Export, history). */
export function useExportRuns(projectId: string, initial: ExportState) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function exportNow() {
    setPending(true);
    setError(null);
    const res = await mutate<ProjectExportRunDto>('POST', `/projects/${projectId}/exports`, {});
    setPending(false);
    if (!res.ok) return setError(res.error);
    const run = res.data!;
    setState((s) => {
      if (run.outcome !== 'received') return { ...s, runs: [run, ...s.runs] };
      const blocked = new Set(run.receipt?.blocked.map((b) => b.taskId) ?? []);
      const sent = new Set(run.tasks.filter((t) => !blocked.has(t.taskId)).map((t) => t.recordId));
      return { ...s, exported: true, runs: [run, ...s.runs], tasks: s.tasks.map((t) => (sent.has(t.recordId) ? { ...t, inRlGym: true } : t)) };
    });
  }
  return { state, pending, error, exportNow };
}
export type ExportRuns = ReturnType<typeof useExportRuns>;

const OUTCOME: Record<ProjectExportRunDto['outcome'], string> = { received: 'Received by RL Gym', rejected: 'Refused by RL Gym', unavailable: 'RL Gym did not answer' };
const Mono = ({ children }: { children: string }) => <code className="font-mono text-xs">{children}</code>;
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/**
 * Export for benchmark (new RL Gym, part 2). The PM or an Admin sends the project's approved tasks so far to RL Gym;
 * after more approvals or a correction, Re-export sends them again (unchanged tasks are recognised by RL Gym). Each
 * export is listed with RL Gym's receipt. Nothing is exported automatically.
 */
export function ExportPanel({ projectId, initial, newFlow = false, runs }: { projectId: string; initial: ExportState; newFlow?: boolean; runs?: ExportRuns }) {
  const own = useExportRuns(projectId, initial);
  const { state, pending, error, exportNow } = runs ?? own;
  const inRlGym = state.tasks.filter((t) => t.inRlGym).length;
  return (
    <section aria-labelledby="export-heading" className="mt-6 rounded-md border border-line p-4" data-export-panel>
      <h2 id="export-heading" className="text-lg font-semibold">
        Export for benchmark
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {state.tasks.length} approved {state.tasks.length === 1 ? 'task' : 'tasks'}
        {state.exported ? `, ${inRlGym} in RL Gym` : ''}. Export sends the approved tasks so far to RL Gym; re-export after more approvals or a correction.
      </p>
      {!state.connected && (
        <p className="mt-2 text-sm" data-rlgym-not-connected>
          RL Gym isn’t connected yet, so export is off.
        </p>
      )}
      {state.connected && state.reason && <p className="mt-2 text-sm">{state.reason}</p>}
      {state.rlgymTemplate && (
        <p className="mt-1 text-xs text-fg-muted">
          RL Gym template <Mono>{state.rlgymTemplate.id}</Mono> version {state.rlgymTemplate.version}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button type="button" className="btn btn-primary disabled:opacity-60" disabled={pending || !state.canExport} onClick={() => void exportNow()}>
          {state.exported ? 'Re-export' : 'Export for benchmark'}
        </button>
      </div>
      {pending && <p className="mt-2 text-sm text-fg-muted">Sending to RL Gym…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      {state.runs.length > 0 && <ExportHistory projectId={projectId} runs={state.runs} newFlow={newFlow} />}
    </section>
  );
}

/** Every export, newest first: what was sent, RL Gym's receipt or error with its request ID, and tasks not sent. */
function ExportHistory({ projectId, runs, newFlow }: { projectId: string; runs: ProjectExportRunDto[]; newFlow: boolean }) {
  return (
    <div className="mt-4 text-sm">
      <h3 className="font-medium">Export history</h3>
      <ul className="mt-2 space-y-3" aria-label="Exports">
        {runs.map((run) => (
          <li key={run.id} data-export-run={run.id} data-outcome={run.outcome}>
            <p>
              <span className={`pill ${run.outcome === 'received' ? 'pill-success' : 'pill-warning'}`}>{OUTCOME[run.outcome]}</span> {when(run.createdAt)} · {run.tasks.length} {run.tasks.length === 1 ? 'task' : 'tasks'} sent ·{' '}
              {run.reason}
              {run.requestId && (
                <>
                  {' '}
                  · RL Gym request <Mono>{run.requestId}</Mono>
                </>
              )}
            </p>
            {run.receipt && (
              <p className="mt-0.5 text-fg-muted" data-receipt>
                {run.receipt.new} new, {run.receipt.superseding} superseding, {run.receipt.unchanged} unchanged
                {run.receipt.blocked.length ? `, ${run.receipt.blocked.length} blocked` : ''}
                {run.receipt.replayed ? ' (already received; RL Gym repeated its receipt)' : ''}.
              </p>
            )}
            {run.error && (
              <p className="mt-0.5 text-fg-muted" data-export-error={run.error.code}>
                <Mono>{run.error.code}</Mono> {run.error.message}
              </p>
            )}
            {(run.receipt?.blocked.length ?? 0) > 0 && (
              <ul className="mt-1 list-disc pl-5" aria-label="Blocked by RL Gym">
                {run.receipt!.blocked.map((b) => {
                  const t = run.tasks.find((x) => x.taskId === b.taskId);
                  return (
                    <li key={b.taskId}>
                      {t ? <Link href={exportFixHref(projectId, t.taskId, newFlow)}>{t.title}</Link> : <Mono>{b.taskId}</Mono>} — blocked by RL Gym: <Mono>{b.reason}</Mono>
                    </li>
                  );
                })}
              </ul>
            )}
            {run.notSent.length > 0 && (
              <ul className="mt-1 list-disc pl-5" aria-label="Not sent">
                {run.notSent.map((n) => (
                  <li key={n.recordId} data-not-sent={n.code}>
                    <Link href={exportFixHref(projectId, n.taskId, newFlow)}>{n.title}</Link> — not sent: <Mono>{n.code}</Mono> {n.message}
                  </li>
                ))}
              </ul>
            )}
            {run.tasks.some((t) => t.correctsRevision) && (
              <p className="mt-0.5 text-xs text-fg-muted">
                Corrections: {run.tasks.filter((t) => t.correctsRevision).map((t) => `${t.title} (revision ${t.revision})`).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
