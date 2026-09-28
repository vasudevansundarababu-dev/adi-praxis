'use client';

import { CLAIM_TYPES, type FieldValue, type ProfileData } from '@praxis/shared';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { correct } from '@/lib/profile-client';
import type { ConversationState } from '@/lib/profile-types';

const STATUS_TEXT: Record<string, string> = {
  PROPOSED: 'Please confirm',
  CONFIRMED: 'Confirmed by you',
  UNKNOWN: 'Not known',
  DECLINED: 'Not disclosed',
  SKIPPED: 'Skipped',
};
const show = (v: FieldValue | null) => (v === null ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
const parseInput = (raw: string, like: FieldValue | null): FieldValue => {
  if (typeof like === 'number') return Number(raw);
  if (Array.isArray(like)) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
};

/**
 * "Your SME profile": structured facts with claim labels. Proposed facts come from the assistant and only count once
 * you confirm or edit them. Everything is self-reported unless a reviewer later checks evidence.
 */
export function ProfilePanel({ state, onChange, readOnly = false }: { state: ConversationState; onChange: (s: ConversationState) => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState({ title: '', start: '', end: '', specialtyRelevant: true });
  const [newClaim, setNewClaim] = useState({ type: 'CERTIFICATION' as (typeof CLAIM_TYPES)[number], value: '' });
  const p: ProfileData = state.profile;
  const rev = state.session?.revision ?? 0;

  async function apply(changes: Parameters<typeof correct>[2]) {
    const r = await correct(state.enrollment.id, rev, changes);
    if (!r.ok) return setError(r.code === 'STALE_REVISION' ? 'Your profile changed in another tab. Reload the page to continue.' : r.message);
    setError(null);
    setEditing(null);
    onChange(r.data);
  }

  const entries = Object.entries(p.fields).filter(([k]) => k !== 'roles');
  const proposed = entries.filter(([, v]) => v.status === 'PROPOSED' || v.conflictWith !== null);
  const rest = entries.filter(([, v]) => !(v.status === 'PROPOSED' || v.conflictWith !== null));
  const d = state.durations;

  const fieldRow = ([key, f]: (typeof entries)[number]) => (
    <li key={key} className="rounded-md border border-line p-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{state.fieldLabels[key] ?? key}</span>
        <span className={`text-xs ${f.status === 'PROPOSED' ? 'text-warning' : 'text-fg-muted'}`}>{STATUS_TEXT[f.status]}</span>
        {f.approximate && <span className="text-xs text-fg-muted">approximate</span>}
        {f.reused && <span className="text-xs text-fg-muted">from your earlier profile</span>}
      </div>
      {editing === key ? (
        <div className="mt-1 flex gap-2">
          <input aria-label={`Edit ${state.fieldLabels[key] ?? key}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1" />
          <button type="button" onClick={() => apply({ fields: [{ fieldKey: key, action: 'EDIT', value: parseInput(draft, f.value ?? f.conflictWith) }] })} className="rounded-md bg-primary px-2 py-1 text-on-primary">
            Save
          </button>
          <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-line px-2 py-1">
            Cancel
          </button>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap">{show(f.value)}</p>
      )}
      {f.conflictWith !== null && (
        <p className="mt-1 text-xs text-warning">
          A later answer said “{show(f.conflictWith)}”. Keep your confirmed value, or edit it.
        </p>
      )}
      {!readOnly && editing !== key && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          {(f.status === 'PROPOSED' || f.conflictWith !== null) && f.value !== null && (
            <button type="button" onClick={() => apply({ fields: [{ fieldKey: key, action: 'CONFIRM' }] })} className="text-link underline">
              {f.conflictWith !== null ? 'Keep confirmed value' : 'Confirm'}
            </button>
          )}
          <button type="button" onClick={() => { setEditing(key); setDraft(show(f.value === null ? (f.conflictWith ?? '') : f.value).replace(/^—$/, '')); }} className="text-link underline">
            Edit
          </button>
          {f.status === 'PROPOSED' && (
            <button type="button" onClick={() => apply({ fields: [{ fieldKey: key, action: 'CLEAR' }] })} className="text-link underline">
              Not right, remove
            </button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-md border border-error p-2 text-sm text-error">{error}</p>}

      {proposed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">To confirm ({proposed.length})</h3>
          <p className="text-xs text-fg-muted">Picked up from your answers. Check each one; nothing counts until you confirm it.</p>
          <ul className="mt-2 space-y-2">{proposed.map(fieldRow)}</ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold">Experience</h3>
        <p className="text-sm">
          Relevant to this opportunity: <strong>{d.specialty.years} years</strong>
          {d.specialty.approximate ? ' (approximate)' : ''} · In the domain overall: <strong>{d.domain.years} years</strong>
        </p>
        <p className="text-xs text-fg-muted">
          Worked out from the confirmed roles below{d.domain.overlapsMerged ? '; overlapping periods are counted once' : ''}. Self-reported until evidence is reviewed.
        </p>
        {d.undated.length > 0 && <p className="text-xs text-warning">Roles without dates are not counted: {d.undated.join(', ')}.</p>}
        <ul className="mt-2 space-y-2">
          {p.roles.map((r) => (
            <li key={r.id} className="rounded-md border border-line p-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{r.title}</span>
                <span className="text-xs text-fg-muted">
                  {r.start ?? '?'} to {r.end ?? 'now'}
                  {r.approximate ? ' (approx.)' : ''}
                  {r.specialtyRelevant ? '' : ' · not counted as specialty'}
                </span>
                <span className={`text-xs ${r.status === 'PROPOSED' ? 'text-warning' : 'text-fg-muted'}`}>{STATUS_TEXT[r.status]}</span>
              </div>
              {!readOnly && (
                <div className="mt-1 flex gap-3 text-xs">
                  {r.status === 'PROPOSED' && <button type="button" onClick={() => apply({ roles: [{ action: 'CONFIRM', id: r.id }] })} className="text-link underline">Confirm</button>}
                  <button type="button" onClick={() => apply({ roles: [{ action: 'EDIT', id: r.id, role: { specialtyRelevant: !r.specialtyRelevant } }] })} className="text-link underline">
                    {r.specialtyRelevant ? 'Not specialty work' : 'Counts as specialty'}
                  </button>
                  <button type="button" onClick={() => apply({ roles: [{ action: 'REMOVE', id: r.id }] })} className="text-link underline">Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="mt-2 grid grid-cols-2 gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void apply({ roles: [{ action: 'ADD', role: { title: newRole.title, start: newRole.start || null, end: newRole.end || null, specialtyRelevant: newRole.specialtyRelevant } }] }).then(() => setNewRole({ title: '', start: '', end: '', specialtyRelevant: true }));
            }}
          >
            <RequiredNote className="col-span-2" />
            <label className="col-span-2 text-xs">
              Role title
              <Req />
              <input aria-required="true" placeholder="Add a role: title" value={newRole.title} onChange={(e) => setNewRole({ ...newRole, title: e.target.value })} className="block w-full rounded-md border border-line bg-bg px-2 py-1" />
            </label>
            <label className="text-xs">From (month)<input type="month" value={newRole.start} onChange={(e) => setNewRole({ ...newRole, start: e.target.value })} className="block w-full rounded-md border border-line bg-bg px-2 py-1" /></label>
            <label className="text-xs">To (blank = now)<input type="month" value={newRole.end} onChange={(e) => setNewRole({ ...newRole, end: e.target.value })} className="block w-full rounded-md border border-line bg-bg px-2 py-1" /></label>
            <button type="submit" disabled={!newRole.title.trim()} className="col-span-2 rounded-md border border-line px-2 py-1 disabled:opacity-50">Add role</button>
          </form>
        )}
      </section>

      {rest.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">Your answers</h3>
          <ul className="mt-2 space-y-2">{rest.map(fieldRow)}</ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold">Credentials</h3>
        <p className="text-xs text-fg-muted">Shown as self-reported. Only a Validator can mark a claim as supported by evidence.</p>
        <ul className="mt-2 space-y-2">
          {p.claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2 rounded-md border border-line p-2 text-sm">
              <span className="font-medium">{c.value}</span>
              <span className="text-xs text-fg-muted">{c.type.toLowerCase()} · self-reported{c.evidenceIds.length ? ` · ${c.evidenceIds.length} file(s) attached` : ''}</span>
              {!readOnly && <button type="button" onClick={() => apply({ claims: [{ action: 'REMOVE', id: c.id }] })} className="ml-auto text-xs text-link underline">Remove</button>}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="mt-2 flex flex-wrap gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void apply({ claims: [{ action: 'ADD', claim: newClaim }] }).then(() => setNewClaim({ ...newClaim, value: '' }));
            }}
          >
            <RequiredNote className="w-full" />
            <label className="text-xs">
              Credential type
              <Req />
              <select aria-required="true" value={newClaim.type} onChange={(e) => setNewClaim({ ...newClaim, type: e.target.value as (typeof CLAIM_TYPES)[number] })} className="block rounded-md border border-line bg-bg px-2 py-1 text-sm">
                {CLAIM_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1 text-xs">
              Credential
              <Req />
              <input aria-required="true" placeholder="e.g. CAMS" value={newClaim.value} onChange={(e) => setNewClaim({ ...newClaim, value: e.target.value })} className="block w-full rounded-md border border-line bg-bg px-2 py-1 text-sm" />
            </label>
            <button type="submit" disabled={!newClaim.value.trim()} className="self-end rounded-md border border-line px-2 py-1 disabled:opacity-50">Add</button>
          </form>
        )}
      </section>
    </div>
  );
}
