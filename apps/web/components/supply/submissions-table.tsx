'use client';

import { useState } from 'react';
import { ActionMessages, input, useAction } from './action';
import type { SubmissionRow } from './types';
import { fmtDate, humanize, StatePill, TD, TH } from './ui';

/**
 * Submissions with their requirement-screen recommendation. A Validator (or Admin) selects rows and confirms
 * "not met" or overrides to "meets", in bulk, with a note. Nothing here is automatic.
 */
export function SubmissionsTable({ items, canDecide }: { items: SubmissionRow[]; canDecide: boolean }) {
  const a = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const decidable = items.filter((s) => s.screen !== 'CONFIRMED_NOT_MET');
  const recommendedNotMet = decidable.filter((s) => s.screen === 'DOES_NOT_MEET_RECOMMENDED').map((s) => s.id);
  const toggle = (id: string, on: boolean) => setSelected((x) => (on ? [...x, id] : x.filter((y) => y !== id)));

  async function decide(decision: 'CONFIRM_NOT_MET' | 'MEETS') {
    const res = await a.run('POST', '/partner-submissions/screen-decisions', { submissionIds: selected, decision, note: note.trim() }, { success: decision === 'CONFIRM_NOT_MET' ? `Confirmed “not met” for ${selected.length}. The partner and candidate are told.` : `Marked ${selected.length} as meeting the requirements.` });
    if (res.ok) {
      setSelected([]);
      setNote('');
    }
  }

  if (items.length === 0) return <p className="card mt-3 p-4 text-sm text-fg-muted">No submissions yet.</p>;
  return (
    <div className="mt-3 space-y-3">
      {canDecide && (
        <div className="card flex flex-wrap items-end gap-3 p-4 text-sm">
          <button type="button" disabled={!recommendedNotMet.length} onClick={() => setSelected(recommendedNotMet)} className="btn btn-secondary">
            Select all recommended “not met” ({recommendedNotMet.length})
          </button>
          <label className="block min-w-64 flex-1">
            Note for the record (task-related)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reported experience is below the 3-year minimum." className={input} />
          </label>
          <button type="button" disabled={a.pending || !selected.length || note.trim().length < 3} onClick={() => decide('CONFIRM_NOT_MET')} className="btn btn-primary">
            Confirm not met ({selected.length})
          </button>
          <button type="button" disabled={a.pending || !selected.length || note.trim().length < 3} onClick={() => decide('MEETS')} className="btn btn-secondary">
            Mark as meeting ({selected.length})
          </button>
          <div className="w-full">
            <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-fg-muted">
            <tr>
              {canDecide && (
                <th className={TH}>
                  <span className="sr-only">Select</span>
                </th>
              )}
              <th className={TH}>Candidate</th>
              <th className={TH}>Source</th>
              <th className={TH}>Submission</th>
              <th className={TH}>Requirement screen</th>
              <th className={TH}>Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((s) => (
              <tr key={s.id}>
                {canDecide && (
                  <td className={TD}>
                    <input type="checkbox" aria-label={`Select ${s.name}`} disabled={s.screen === 'CONFIRMED_NOT_MET'} checked={selected.includes(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
                  </td>
                )}
                <td className={TD}>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-xs text-fg-muted">
                    {s.email}
                    {s.country ? ` · ${s.country}` : ''}
                  </span>
                </td>
                <td className={TD}>
                  {s.partner?.name ?? 'Careers page'}
                  <span className="block text-xs text-fg-muted">{humanize(s.channel)}</span>
                </td>
                <td className={TD}>
                  <StatePill state={s.state} />
                  {s.inviteAccepted && <span className="block text-xs text-fg-muted">Invite accepted</span>}
                  {s.duplicateReason && <span className="block text-xs text-fg-muted">{s.duplicateReason}</span>}
                </td>
                <td className={TD}>
                  <StatePill state={s.screen} />
                  {!!s.screenReasons?.length && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-fg-muted">
                      {s.screenReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={TD}>{fmtDate(s.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canDecide && decidable.length !== items.length && <p className="text-xs text-fg-muted">Rows already confirmed “not met” cannot be changed here.</p>}
    </div>
  );
}
