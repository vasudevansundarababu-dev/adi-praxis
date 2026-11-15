'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { settingsUpdate, type ForgeSettingsView } from '@/lib/forge-console';

/**
 * Admin → Candidate app sign-in (owner, 15 Nov): the MVP1 new flow switch and how SMEs and Reviewers sign in to the
 * candidate app, for everyone at once. Admins change it; PMs see it read-only. Offline is refused by the server in
 * production, so it is disabled when the API says it is not allowed.
 */
export function CandidateSignInSettings({ initial, canEdit }: { initial: ForgeSettingsView; canEdit: boolean }) {
  const router = useRouter();
  const [newFlow, setNewFlow] = useState(initial.newFlow);
  const [mode, setMode] = useState<'OFFLINE' | 'ONLINE'>(initial.candidateSignIn);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const offlineDisabled = !canEdit || !initial.offlineAllowed;

  async function save() {
    setPending(true);
    setMsg(null);
    const body = settingsUpdate(initial, { newFlow, candidateSignIn: mode });
    if (!Object.keys(body).length) {
      setPending(false);
      return setMsg({ ok: true, text: 'Nothing changed.' });
    }
    const res = await mutate<ForgeSettingsView>('PUT', '/admin/forge-settings', body);
    setPending(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? 'Could not save.' });
    const ended = res.data!.candidateSessionsEnded ?? 0;
    setMsg({ ok: true, text: `Saved: the new flow is ${res.data!.newFlow ? 'on' : 'off'}; candidate sign-in is ${res.data!.candidateSignIn === 'OFFLINE' ? 'Offline' : 'Online'}.${ended ? ` ${ended} candidate ${ended === 1 ? 'session was' : 'sessions were'} signed out.` : ''}` });
    router.refresh();
  }

  return (
    <div className="card max-w-3xl px-5 py-4">
      {!canEdit && (
        <p className="mb-3 text-sm text-fg-muted" data-read-only>
          Read-only: only an Admin can change these settings.
        </p>
      )}
      <fieldset className="border-b border-hairline pb-3">
        <legend className="mb-1 font-semibold">New flow</legend>
        <p className="mb-2 text-sm text-fg-muted">
          On: direct assignment to tasks, the four-tab project page, the candidate task list and the shorter menu. Off: the earlier journey (opportunity, apply, selection) keeps running.
        </p>
        <label className="mr-5 inline-flex items-center gap-2 text-sm">
          <input type="radio" name="newFlow" value="on" checked={newFlow} disabled={!canEdit} onChange={() => setNewFlow(true)} /> On
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name="newFlow" value="off" checked={!newFlow} disabled={!canEdit} onChange={() => setNewFlow(false)} /> Off
        </label>
      </fieldset>
      <fieldset className="mt-1">
        <legend className="sr-only">Sign-in mode</legend>
        <label className={`flex items-start gap-3 border-b border-hairline py-3 ${offlineDisabled ? '' : 'cursor-pointer'}`}>
          <input type="radio" name="mode" value="OFFLINE" checked={mode === 'OFFLINE'} disabled={offlineDisabled} onChange={() => setMode('OFFLINE')} className="mt-1" data-mode="OFFLINE" />
          <span>
            <strong>Offline</strong> <span className="pill pill-warning">QA and demos only</span>
            <br />
            <span className="text-sm text-fg-muted">People sign in by typing their email and name. No password. Anyone who knows an uploaded email can sign in as that person.</span>
            {!initial.offlineAllowed && (
              <span className="mt-1 block text-sm text-error" data-offline-refused>
                Not available here: this is a production environment, where the server refuses Offline sign-in. Use Online.
              </span>
            )}
          </span>
        </label>
        <label className={`flex items-start gap-3 py-3 ${canEdit ? 'cursor-pointer' : ''}`}>
          <input type="radio" name="mode" value="ONLINE" checked={mode === 'ONLINE'} disabled={!canEdit} onChange={() => setMode('ONLINE')} className="mt-1" data-mode="ONLINE" />
          <span>
            <strong>Online</strong>
            <br />
            <span className="text-sm text-fg-muted">
              People sign in with their email (their Gmail address) and a password. When a PM or Admin assigns a new person to a project, ADI Forge emails them a one-time link to set
              their password (never the password itself).
            </span>
          </span>
        </label>
      </fieldset>
      {mode === 'OFFLINE' && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm" data-offline-warning>
          <span className="pill pill-warning">Offline</span>Never use Offline in production.
        </div>
      )}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button type="button" disabled={pending} onClick={() => void save()} className="btn btn-primary disabled:opacity-60">
            Save
          </button>
          {msg && (
            <span role={msg.ok ? 'status' : 'alert'} className={`text-[13px] ${msg.ok ? 'text-fg-muted' : 'text-error'}`}>
              {msg.text}
            </span>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-fg-muted" data-sign-out-note>
        Changing the sign-in mode signs everyone out of the candidate app (SMEs and Reviewers sign in again with the new mode). Every change is audited.
      </p>
    </div>
  );
}
