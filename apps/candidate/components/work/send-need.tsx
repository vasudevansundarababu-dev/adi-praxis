'use client';

import { NEED_KIND_LABEL, NEED_KINDS, type NeedDto, type NeedKind } from '@praxis/shared';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/client';

const STATE_TEXT: Record<NeedDto['state'], string> = {
  open: 'With the project manager',
  sent: 'Passed on by the project manager',
  rejected: 'Not taken forward',
  resolved: 'Resolved',
};

/**
 * New RL Gym part 4 (owner, 22 Nov 2026): the only addition to the author screens. A collapsed card where the author
 * tells the project manager the task needs more data or a new kind of case. It never changes the task or the
 * workbench; the project manager decides what to do with it.
 */
export function SendNeed({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [items, setItems] = useState<NeedDto[]>([]);
  const [kind, setKind] = useState<NeedKind>('more_data');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ items: NeedDto[] }>('GET', `/me/tasks/${taskId}/needs`);
    if (r.ok && r.data) setItems(r.data.items);
  }, [taskId]);
  useEffect(() => void load(), [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const r = await call<NeedDto>('POST', `/me/tasks/${taskId}/needs`, { kind, note });
    setPending(false);
    if (!r.ok) return setMessage({ kind: 'error', text: r.error ?? 'Could not send it.' });
    setMessage({ kind: 'ok', text: 'Sent to your project manager. You can keep working on your task.' });
    setNote('');
    await load();
  }

  return (
    <details className="mb-6 rounded-md border border-line bg-surface" data-send-need>
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        Send a need to PM <span className="font-normal text-fg-muted">({items.length} sent)</span>
      </summary>
      <div className="space-y-4 px-4 pb-4 text-sm">
        <p className="text-fg-muted">Tell your project manager if this task needs more data, or a kind of case the template does not have yet. It does not change your task.</p>
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded border border-line" aria-label="Your needs">
            {items.map((n) => (
              <li key={n.id} className="p-3">
                <p className="font-medium">
                  {NEED_KIND_LABEL[n.kind]} <span className="font-normal text-fg-muted">· {STATE_TEXT[n.state]}</span>
                </p>
                <p>{n.note}</p>
                {n.closedReason && <p className="text-fg-muted">Project manager: {n.closedReason}</p>}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form className="grid gap-3" onSubmit={(e) => void send(e)}>
            <fieldset>
              <legend className="font-medium">What does the task need?</legend>
              <div className="mt-1 flex flex-wrap gap-4">
                {NEED_KINDS.map((k) => (
                  <label key={k} className="inline-flex items-center gap-1.5">
                    <input type="radio" name="need-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    {NEED_KIND_LABEL[k]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              <span className="font-medium">Say what is needed</span>
              <textarea className="mt-1 block w-full rounded border border-line p-2" rows={2} required maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {message && (
              <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-danger' : ''}>
                {message.text}
              </p>
            )}
            <div>
              <button type="submit" className="btn btn-secondary disabled:opacity-60" disabled={pending || !note.trim()}>
                Send to PM
              </button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
