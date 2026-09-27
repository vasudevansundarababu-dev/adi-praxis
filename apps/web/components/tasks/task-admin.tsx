'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export type TaskRow = { id: string; status: string; taskType: string; brief: string | null; author: string | null; assignedAt: string | null; lastSavedAt: string | null; submittedAt: string | null; activeSeconds: number; reworkCount: number };
export type InviteRow = { id: string; candidateName: string | null; channel: string; sentAt: string | null; expiresAt: string; usedAt: string | null; state: string };

const STATUS: Record<string, string> = { CREATED: 'Queued', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', SUBMITTED: 'In review', REWORK: 'Rework', ACCEPTED: 'Accepted', REJECTED: 'Rejected' };
const RECLAIMABLE = ['ASSIGNED', 'IN_PROGRESS', 'REWORK'];

export function TaskTable({ projectId, tptMinutes, initial }: { projectId: string; tptMinutes: number | null; initial: TaskRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [reclaiming, setReclaiming] = useState<string | null>(null);
  const [reason, setReason] = useState('STALLED');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const rows = initial.filter((t) => !filter || t.status === filter);
  const counts = initial.reduce<Record<string, number>>((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {});

  async function reclaim(id: string) {
    const res = await mutate('POST', `/projects/${projectId}/tasks/${id}/reclaim`, { reason });
    setReclaiming(null);
    setMessage(res.ok ? { kind: 'ok', text: 'Task reclaimed; its slot is back in the queue.' } : { kind: 'error', text: res.error! });
    router.refresh();
  }

  return (
    <section aria-labelledby="tasks-h" className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="tasks-h" className="font-semibold">Tasks ({initial.length})</h2>
        <label className="text-sm">
          <span className="sr-only">Filter by status</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v} ({counts[k] ?? 0})
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.kind === 'error' ? 'text-error' : 'text-success'}`}>{message.text}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-fg-muted">
            <tr>
              <th className="px-2 py-2 font-medium">Task</th>
              <th className="px-2 py-2 font-medium">Expert</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Active vs TPT</th>
              <th className="px-2 py-2 font-medium">Last activity</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((t) => {
              const mins = Math.round(t.activeSeconds / 60);
              return (
                <tr key={t.id}>
                  <td className="max-w-xs px-2 py-2">{t.brief ?? `${t.taskType.toLowerCase()} task`}</td>
                  <td className="px-2 py-2">{t.author ?? '—'}</td>
                  <td className="px-2 py-2">
                    {STATUS[t.status] ?? t.status}
                    {t.reworkCount > 0 && <span className="block text-xs text-fg-muted">rework ×{t.reworkCount}</span>}
                  </td>
                  <td className={`px-2 py-2 tabular-nums ${tptMinutes && mins > tptMinutes ? 'text-warning' : ''}`}>
                    {mins} / {tptMinutes ?? '—'} min
                  </td>
                  <td className="px-2 py-2">{t.lastSavedAt ? new Date(t.lastSavedAt).toLocaleString() : t.assignedAt ? `assigned ${new Date(t.assignedAt).toLocaleDateString()}` : '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {RECLAIMABLE.includes(t.status) &&
                      (reclaiming === t.id ? (
                        <span className="flex items-center gap-2">
                          <label>
                            <span className="sr-only">Reason</span>
                            <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-line bg-surface px-1 py-0.5">
                              <option value="STALLED">Stalled</option>
                              <option value="AUTHOR_UNAVAILABLE">Expert unavailable</option>
                              <option value="OTHER">Other</option>
                            </select>
                          </label>
                          <button type="button" onClick={() => reclaim(t.id)} className="text-error">
                            Reclaim
                          </button>
                          <button type="button" onClick={() => setReclaiming(null)} className="text-link">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setReclaiming(t.id)} className="text-link">
                          Reclaim…
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mt-3 text-sm text-fg-muted">No tasks yet. Tasks are issued when experts accept their assignment.</p>}
      </div>
    </section>
  );
}

export function InvitesPanel({ projectId, initial }: { projectId: string; initial: InviteRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function act(id: string, action: 'resend' | 'revoke') {
    const res = await mutate('POST', `/projects/${projectId}/invites/${id}/${action}`);
    if (!res.ok) return setError(res.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="inv-h" className="mt-8">
      <h2 id="inv-h" className="font-semibold">Invites</h2>
      <p className="text-sm text-fg-muted">Each accepted expert gets one single-use link that expires in 7 days. Resending revokes the old link.</p>
      {initial.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">No invites yet.</p>
      ) : (
        <ul className="mt-2 card divide-y divide-line text-sm">
          {initial.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium">{i.candidateName ?? 'Expert'}</span>
              <span className="text-fg-muted">
                {i.state.toLowerCase()} · {i.channel.toLowerCase()} {i.sentAt ? `· sent ${new Date(i.sentAt).toLocaleString()}` : ''} · expires {new Date(i.expiresAt).toLocaleDateString()}
              </span>
              {i.state !== 'REVOKED' && (
                <span className="ml-auto flex gap-3">
                  <button type="button" onClick={() => act(i.id, 'resend')} className="text-link">
                    Resend
                  </button>
                  {i.state !== 'USED' && (
                    <button type="button" onClick={() => act(i.id, 'revoke')} className="text-link">
                      Revoke
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </section>
  );
}

export function InputUpload({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string; problems?: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  async function upload() {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setPending(true);
    const res = await fetch(`/api/v1/projects/${projectId}/task-inputs`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: form });
    const body = await res.json().catch(() => null);
    setPending(false);
    setResult(res.ok ? { kind: 'ok', text: `Added ${body.added} input(s); ${body.total} in total.` } : { kind: 'error', text: body?.message ?? 'Upload failed', problems: body?.details?.problems });
    if (res.ok) router.refresh();
  }
  return (
    <section aria-labelledby="up-h" className="mt-6 card p-4 text-sm">
      <h2 id="up-h" className="font-semibold">Add task inputs</h2>
      <p className="text-fg-muted">Upload a CSV (header row) or JSON array. Every row is validated against the template; if any fails, nothing is added. Client systems can push the same inputs with an API key.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Inputs file" />
        <button type="button" disabled={!file || pending} onClick={upload} className="btn btn-primary disabled:opacity-50">
          Upload
        </button>
      </div>
      {result && (
        <div role={result.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${result.kind === 'error' ? 'text-error' : 'text-success'}`}>
          {result.text}
          {result.problems && (
            <ul className="list-disc pl-5">
              {result.problems.slice(0, 10).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
