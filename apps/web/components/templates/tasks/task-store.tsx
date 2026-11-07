'use client';

import type { SmeAuthoredTaskDto } from '@praxis/shared';
import { useState } from 'react';
import { Modal } from '@/components/templates/compiler/custom-field-dialog';
import { JudgePanel } from '@/components/templates/tasks/judge-panel';
import { mcBrowser } from '@/lib/mc/browser';
import { MODE_LABELS } from '@/lib/mc/format';

const REVIEW: Record<string, [string, string]> = {
  SUBMITTED: ['Submitted for review', 'pill-info'],
  IN_REVIEW: ['In review', 'pill-info'],
  ACCEPTED: ['Accepted', 'pill-success'],
  REWORK: ['Returned to SME', 'pill-warning'],
  REJECTED: ['Not accepted', 'pill-error'],
};
export const reviewPill = (s: string) => REVIEW[s] ?? [s.toLowerCase().replace(/_/g, ' '), ''];
const score = (n: number | null) => (n === null ? '—' : n.toFixed(2));

/** Task store (Mock S4): every studio-authored task for the client, with JSON and Harbor bundle (S4-11, S4-12). */
export function TaskStore({ tasks }: { tasks: SmeAuthoredTaskDto[] }) {
  const [inspect, setInspect] = useState<{ task: SmeAuthoredTaskDto; json: string | null; error: string | null } | null>(null);

  async function open(task: SmeAuthoredTaskDto) {
    setInspect({ task, json: null, error: null });
    const r = await mcBrowser.studioTask(task.id);
    setInspect({ task, json: r.data ? `${JSON.stringify(r.data.taskJson, null, 2)}\n` : null, error: r.error });
  }

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-fg-muted">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}. Each is stored in PostgreSQL, as task JSON and as a Harbor bundle, and goes through independent review before it can reach the
          Approved Task Dataset.
        </p>
        <a href={mcBrowser.exportUrl()} download className="btn btn-secondary ml-auto !py-1.5 text-sm">
          Export all (JSON)
        </a>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-6 text-fg-muted">No studio tasks yet. They appear here after an SME uses Save &amp; Commit.</p>
      ) : (
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Studio-authored tasks</caption>
            <thead className="bg-surface">
              <tr>
                {['Task ID', 'Template / Workflow', 'Project', 'Authored by', 'Title', 'DB & Harbor', 'Review', 'Actions'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const [label, tone] = reviewPill(t.reviewStatus);
                return (
                  <tr key={t.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-mono text-xs">{t.externalTaskId}</td>
                    <td className="px-3 py-2">
                      {t.workflowName} <span className="text-fg-muted">(v{t.templateVersion})</span>
                    </td>
                    <td className="px-3 py-2">{t.projectName}</td>
                    <td className="px-3 py-2">{t.authoredBy ?? '—'}</td>
                    <td className="px-3 py-2">{t.title}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="block">Stored · {t.dataClassification === 'SYNTHETIC' ? 'Synthetic' : 'Real public'} · {MODE_LABELS[t.executionMode]}</span>
                      <span className="block font-mono" title={t.bundleSha256}>
                        sha256 {t.bundleSha256.slice(0, 12)}…
                      </span>
                      <span className="block text-fg-muted">
                        zero-baseline {score(t.zeroBaselineScore)} · oracle {score(t.oracleScore)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`pill ${tone}`}>{label}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 text-xs">
                        <button type="button" className="text-left text-link hover:underline" onClick={() => void open(t)}>
                          Inspect JSON<span className="sr-only"> for {t.externalTaskId}</span>
                        </button>
                        <a href={mcBrowser.bundleUrl(t.id)} download className="text-link hover:underline">
                          Download bundle<span className="sr-only"> for {t.externalTaskId}</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={inspect !== null} onClose={() => setInspect(null)} label="Task JSON">
        {inspect && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">
              {inspect.task.externalTaskId} <span className="text-sm font-normal text-fg-muted">task.json</span>
            </h2>
            {inspect.error ? (
              <p role="alert" className="text-sm text-error">
                {inspect.error}
              </p>
            ) : (
              <pre tabIndex={0} aria-label="task.json" className="max-h-[60vh] overflow-auto rounded-md bg-surface p-3 font-mono text-xs">
                {inspect.json ?? 'Loading…'}
              </pre>
            )}
            <h3 className="text-base font-semibold">LLM judge</h3>
            <JudgePanel taskId={inspect.task.id} />
            <div className="flex justify-end gap-2">
              {inspect.json && (
                <button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard?.writeText(inspect.json!)}>
                  Copy
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setInspect(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
