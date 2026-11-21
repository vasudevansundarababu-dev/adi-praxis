'use client';

import type { ForgeTaskRow, ProjectPersonDto } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useEffect, useRef, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { ExportPanel, useExportRuns, type ExportState } from '@/components/projects/export-panel';
import { mutate } from '@/lib/client-api';
import { selectableRecords, selectAllState, toggleAll, validateBody } from '@/lib/export-selection';
import { canPickAuthor, fmtDate, fullName, smesOf, taskCode, taskName, tasksSummary, taskStatusLabel, taskStatusTone } from '@/lib/forge-console';

const TH = 'px-4 py-2.5 text-xs font-semibold text-fg-muted';
const TD = 'px-4 py-3 align-top';
const FILTERS = ['', 'CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK', 'ACCEPTED', 'REJECTED'];

/** "Assign SME…" on an Open task: the project's assigned SMEs; choosing one puts them on the task (POST assignments/direct). */
function AssignSme({ projectId, task, smes, code }: { projectId: string; task: ForgeTaskRow; smes: ProjectPersonDto[]; code: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <select
        aria-label={`Assign an SME to ${code}`}
        data-assign-sme={task.taskId}
        disabled={pending || smes.length === 0}
        defaultValue=""
        onChange={async (e) => {
          const sourcedPersonId = e.target.value;
          if (!sourcedPersonId) return;
          setPending(true);
          setError(null);
          const res = await mutate('POST', `/projects/${projectId}/assignments/direct`, { sourcedPersonId, taskId: task.taskId });
          setPending(false);
          if (!res.ok) {
            e.target.value = '';
            return setError(res.error);
          }
          router.refresh();
        }}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
      >
        <option value="">{smes.length ? 'Assign SME…' : 'No SMEs assigned yet'}</option>
        {smes.map((s) => (
          <option key={s.sourcedPersonId} value={s.sourcedPersonId}>
            {fullName(s)}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The header's select-all checkbox: checked when every listed approved task is selected, mixed when some are. */
function SelectAll({ state, disabled, onChange }: { state: 'all' | 'some' | 'none'; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label="Select all approved tasks for validation" data-select-all checked={state === 'all'} disabled={disabled} onChange={onChange} className="h-4 w-4" />;
}

const EMPTY_EXPORT: ExportState = { canValidate: false, canExport: false, reason: null, validator: { name: '', version: '', isAnvil: false }, tasks: [], runs: [] };

/**
 * MVP1 Tasks tab: exactly one row per task the project defines; every task name opens the task page. Approved tasks
 * carry a checkbox (owner, 21 Nov 2026): Validate sends the selected ones in one call. Export ignores the selection.
 */
export function ForgeTasksTab({ projectId, tasks, people, exportState }: { projectId: string; tasks: ForgeTaskRow[]; people: ProjectPersonDto[]; exportState: ExportState | null }) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const runs = useExportRuns(projectId, exportState ?? EMPTY_EXPORT);
  const selectable = selectableRecords(exportState);
  const selecting = selectable.size > 0;
  const smes = smesOf(people);
  const rows = tasks.map((t, i) => ({ t, code: taskCode(i) })).filter(({ t }) => !filter || t.status === filter);
  // D24: 10 tasks a page, the page in the URL; a new status filter goes back to page 1.
  const paged = usePagedRows(rows, { resetKey: filter });
  // Select-all covers every approved task the filter lists, on every page.
  const listed = rows.flatMap(({ t }) => (selectable.has(t.taskId) ? [selectable.get(t.taskId)!] : []));
  const chosen = validateBody(selected, exportState?.tasks ?? []).recordIds;
  const cols = selecting ? 6 : 5;
  return (
    <section aria-label="Tasks">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-fg-muted" data-tasks-summary>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} set for this project · {tasksSummary(tasks)}
        </span>
        <label className="ml-auto text-sm">
          <span className="sr-only">Filter by status</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1 text-sm">
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f ? taskStatusLabel(f) : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
        {selecting && (
          <>
            <span className="text-sm text-fg-muted" data-selected-count aria-live="polite">
              {chosen.length} selected
            </span>
            <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={runs.pending || chosen.length === 0} onClick={() => void runs.validate(chosen)}>
              Validate
            </button>
          </>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-hairline">
            <tr>
              {selecting && (
                <th className={`${TH} w-10`}>
                  <SelectAll state={selectAllState(selected, listed)} disabled={listed.length === 0} onChange={() => setSelected((s) => toggleAll(s, listed))} />
                </th>
              )}
              <th className={TH}>Task ID</th>
              <th className={TH}>Task name</th>
              <th className={TH}>Authored by</th>
              <th className={TH}>Status</th>
              <th className={TH}>Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {paged.items.map(({ t, code }) => {
              const recordId = selectable.get(t.taskId);
              return (
                <tr key={t.taskId} data-task={t.taskId}>
                  {selecting && (
                    <td className={TD}>
                      {recordId && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${code} for validation`}
                          data-select-task={t.taskId}
                          checked={selected.has(recordId)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(recordId);
                              else next.delete(recordId);
                              return next;
                            })
                          }
                          className="h-4 w-4"
                        />
                      )}
                    </td>
                  )}
                  <td className={`${TD} font-mono text-xs whitespace-nowrap`}>{code}</td>
                  <td className={TD}>
                    <Link href={`/projects/${projectId}/tasks/${t.taskId}/review`} className="font-semibold text-link hover:underline">
                      {taskName(t.label)}
                    </Link>
                    {t.canDecide && <span className="ml-2 pill pill-warning">Your decision</span>}
                    {t.waitingFor === 'REVIEWER' && <span className="ml-2 text-xs text-fg-muted">Waiting for the Reviewer</span>}
                  </td>
                  <td className={TD}>{canPickAuthor(t) ? <AssignSme projectId={projectId} task={t} smes={smes} code={code} /> : (t.author?.name ?? '')}</td>
                  <td className={TD}>
                    <span className={`pill ${taskStatusTone(t.status)}`}>{taskStatusLabel(t.status)}</span>
                  </td>
                  <td className={`${TD} font-mono text-xs whitespace-nowrap tabular-nums`}>{fmtDate(t.date)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-4 py-6 text-center text-fg-muted">
                  {tasks.length ? 'No task has this status.' : 'This project has no tasks yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && <ClientPager paged={paged} noun="tasks" singular="task" />}
      <p className="mt-2.5 text-xs text-fg-muted">
        One row per task set on the project. The PM or Admin picks the SME for each task from the assigned experts; until then &quot;Authored by&quot; offers &quot;Assign SME…&quot;. An author
        can be changed only before they start.{selecting && ' Tick approved tasks and choose Validate to check them with RL Gym in one go.'}
      </p>
      {exportState && <ExportPanel projectId={projectId} initial={exportState} newFlow runs={runs} />}
    </section>
  );
}
