'use client';

import { LAUNCH_DOMAINS, SME_TIERS, TIER_LABELS, type SmeTier } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionMessages, input, splitList, useAction } from './action';
import type { PartnerRow, RequisitionDto } from './types';

const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const intOrNull = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));

/** Create or edit a requisition: every RequisitionInput field (packages/shared supply.ts). */
export function RequisitionForm({ projects, partners, existing, initialProjectId }: { projects: { id: string; name: string }[]; partners: PartnerRow[]; existing?: RequisitionDto; initialProjectId?: string }) {
  const router = useRouter();
  const a = useAction();
  const sw = useAction();
  const e = existing;
  const [f, setF] = useState({
    projectId: e?.projectId ?? initialProjectId ?? projects[0]?.id ?? '',
    title: e?.title ?? '',
    summary: e?.summary ?? '',
    domain: e?.domain ?? 'banking',
    tier: (e?.tier ?? 'ANNOTATOR') as SmeTier,
    headcount: String(e?.headcount ?? 10),
    startDate: e?.startDate ?? '',
    durationWeeks: e?.durationWeeks?.toString() ?? '',
    hoursPerWeek: e?.hoursPerWeek?.toString() ?? '',
    location: e?.location ?? '',
    jurisdictions: e?.jurisdictions.join(', ') ?? '',
    languages: e?.languages.join(', ') ?? 'en',
    minYears: String(e?.minimumRequirements.minYears ?? 0),
    qualifications: e?.minimumRequirements.qualifications.join('\n') ?? '',
    licenceRequired: e?.minimumRequirements.licenceRequired ?? false,
    notes: e?.minimumRequirements.notes ?? '',
    allowedPartnerIds: e?.allowedPartnerIds ?? ([] as string[]),
    directChannel: e?.directChannel ?? false,
    submissionDeadline: toLocal(e?.submissionDeadline ?? null),
    maxPerPartner: e?.maxPerPartner?.toString() ?? '',
    payRoute: e?.payRoute ?? ('DIRECT' as 'DIRECT' | 'VIA_PARTNER'),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const body = () => ({
    projectId: f.projectId,
    title: f.title.trim(),
    summary: f.summary.trim(),
    domain: f.domain.trim().toLowerCase(),
    tier: f.tier,
    headcount: Number.parseInt(f.headcount, 10),
    startDate: f.startDate || null,
    durationWeeks: intOrNull(f.durationWeeks),
    hoursPerWeek: intOrNull(f.hoursPerWeek),
    location: f.location.trim() || null,
    jurisdictions: splitList(f.jurisdictions),
    languages: splitList(f.languages),
    minimumRequirements: { minYears: Number.parseInt(f.minYears || '0', 10), qualifications: splitList(f.qualifications), licenceRequired: f.licenceRequired, notes: f.notes.trim() },
    allowedPartnerIds: f.allowedPartnerIds,
    directChannel: f.directChannel,
    submissionDeadline: f.submissionDeadline ? new Date(f.submissionDeadline).toISOString() : null,
    maxPerPartner: intOrNull(f.maxPerPartner),
    payRoute: f.payRoute,
  });

  const eligible = partners.filter((p) => p.status === 'ACTIVE' || f.allowedPartnerIds.includes(p.id));

  return (
    <form
      className="mt-6 space-y-6 text-sm"
      onSubmit={async (ev) => {
        ev.preventDefault();
        const res = e ? await a.run<RequisitionDto>('PUT', `/requisitions/${e.id}`, body(), { refresh: false }) : await a.run<RequisitionDto>('POST', '/requisitions', body(), { refresh: false });
        if (res.ok && res.data) router.push(`/requisitions/${res.data.id}`);
      }}
    >
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Project and role</h2>
        <label className="block">
          Project
          <select required disabled={!!e} value={f.projectId} onChange={(ev) => set('projectId', ev.target.value)} className={input}>
            {projects.length === 0 && <option value="">No projects you own</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!e && f.projectId && (
          <div className="rounded-md border border-line p-3">
            <p>A project needs SME supply switched on before it can have requisitions. Switching it on does not change JD matching for the project.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={sw.pending} onClick={() => sw.run('POST', `/projects/${f.projectId}/sme-supply`, { enabled: true }, { success: 'SME supply is on for this project.', refresh: false })} className="btn btn-secondary">
                Switch on SME supply for this project
              </button>
              <button type="button" disabled={sw.pending} onClick={() => sw.run('POST', `/projects/${f.projectId}/sme-supply`, { enabled: false }, { success: 'SME supply is off for this project.', refresh: false })} className="btn btn-secondary">
                Switch off
              </button>
            </div>
            <div className="mt-2">
              <ActionMessages error={sw.error} notice={sw.notice} />
            </div>
          </div>
        )}
        <label className="block">
          Title
          <input required minLength={3} maxLength={200} value={f.title} onChange={(ev) => set('title', ev.target.value)} placeholder="KYC analysts, retail onboarding" className={input} />
        </label>
        <label className="block">
          Summary for partners and candidates
          <textarea rows={3} maxLength={4000} value={f.summary} onChange={(ev) => set('summary', ev.target.value)} className={input} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            Domain
            <input required list="req-domains" value={f.domain} onChange={(ev) => set('domain', ev.target.value)} className={input} />
            <datalist id="req-domains">
              {LAUNCH_DOMAINS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label className="block">
            Tier
            <select value={f.tier} onChange={(ev) => set('tier', ev.target.value as SmeTier)} className={input}>
              {SME_TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Headcount
            <input required type="number" min={1} max={10000} value={f.headcount} onChange={(ev) => set('headcount', ev.target.value)} className={input} />
          </label>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">When and where</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            Start date
            <input type="date" value={f.startDate} onChange={(ev) => set('startDate', ev.target.value)} className={input} />
          </label>
          <label className="block">
            Duration (weeks)
            <input type="number" min={1} max={260} value={f.durationWeeks} onChange={(ev) => set('durationWeeks', ev.target.value)} className={input} />
          </label>
          <label className="block">
            Hours per week
            <input type="number" min={1} max={60} value={f.hoursPerWeek} onChange={(ev) => set('hoursPerWeek', ev.target.value)} className={input} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            Location
            <input value={f.location} onChange={(ev) => set('location', ev.target.value)} placeholder="Remote, India" className={input} />
          </label>
          <label className="block">
            Jurisdictions (comma-separated)
            <input value={f.jurisdictions} onChange={(ev) => set('jurisdictions', ev.target.value)} placeholder="IN, US" className={input} />
          </label>
          <label className="block">
            Languages (comma-separated)
            <input value={f.languages} onChange={(ev) => set('languages', ev.target.value)} placeholder="en, hi" className={input} />
          </label>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Minimum requirements</h2>
        <p className="text-fg-muted">The screen compares each submission with these and recommends only; a Validator confirms any “not met”.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            Minimum years in the domain
            <input type="number" min={0} max={50} value={f.minYears} onChange={(ev) => set('minYears', ev.target.value)} className={input} />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2 sm:mt-6">
            <input type="checkbox" checked={f.licenceRequired} onChange={(ev) => set('licenceRequired', ev.target.checked)} />
            Professional licence required (checked by a Validator before Expert certification)
          </label>
        </div>
        <label className="block">
          Qualifications (one per line)
          <textarea rows={3} value={f.qualifications} onChange={(ev) => set('qualifications', ev.target.value)} className={input} />
        </label>
        <label className="block">
          Notes
          <textarea rows={2} maxLength={2000} value={f.notes} onChange={(ev) => set('notes', ev.target.value)} className={input} />
        </label>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Channels and pay</h2>
        <fieldset>
          <legend>Partners allowed to submit</legend>
          {eligible.length === 0 && <p className="mt-1 text-fg-muted">No active partners yet. An Admin adds them under Partners.</p>}
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {eligible.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input type="checkbox" checked={f.allowedPartnerIds.includes(p.id)} onChange={(ev) => set('allowedPartnerIds', ev.target.checked ? [...f.allowedPartnerIds, p.id] : f.allowedPartnerIds.filter((x) => x !== p.id))} />
                {p.name}
                {p.status !== 'ACTIVE' && <span className="text-xs text-warning">(suspended)</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.directChannel} onChange={(ev) => set('directChannel', ev.target.checked)} />
          Also accept direct applications from the careers page
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            Submission deadline
            <input type="datetime-local" value={f.submissionDeadline} onChange={(ev) => set('submissionDeadline', ev.target.value)} className={input} />
          </label>
          <label className="block">
            Most candidates per partner
            <input type="number" min={1} max={10000} value={f.maxPerPartner} onChange={(ev) => set('maxPerPartner', ev.target.value)} placeholder="No limit" className={input} />
          </label>
        </div>
        <fieldset>
          <legend>Who pays the SMEs</legend>
          <label className="mt-1 flex items-center gap-2">
            <input type="radio" name="payRoute" checked={f.payRoute === 'DIRECT'} onChange={() => set('payRoute', 'DIRECT')} />
            Direct: Praxis pays each SME from the rate card (payee set-up is on their checklist)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="payRoute" checked={f.payRoute === 'VIA_PARTNER'} onChange={() => set('payRoute', 'VIA_PARTNER')} />
            Via partner: the partner pays its people; Praxis records no earnings
          </label>
        </fieldset>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={a.pending || !f.projectId || f.title.trim().length < 3} className="btn btn-primary">
          {e ? 'Save changes' : 'Create draft requisition'}
        </button>
        <ActionMessages error={a.error} problems={a.problems} />
      </div>
    </form>
  );
}
