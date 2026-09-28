'use client';

import { REQUISITION_TRANSITIONS, type RequisitionState } from '@praxis/shared';
import { useState } from 'react';
import { ActionMessages, input, useAction } from './action';
import type { GuidelinesPackageRow, RateCardRow } from './types';

const VERB: Record<RequisitionState, string> = { DRAFT: 'Back to draft', OPEN: 'Open', PAUSED: 'Pause', FILLED: 'Mark filled', CLOSED: 'Close' };
const HINT: Record<RequisitionState, string> = {
  DRAFT: '',
  OPEN: 'Allowed partners are told and can submit candidates.',
  PAUSED: 'Partners cannot submit until you open it again.',
  FILLED: 'Headcount reached; no new submissions.',
  CLOSED: 'Final: a closed requisition cannot be changed or reopened.',
};

/** DRAFT → OPEN → PAUSED ⇄ OPEN → FILLED → CLOSED (section 4). Partners get a webhook for each change. */
export function RequisitionTransitions({ id, state }: { id: string; state: RequisitionState }) {
  const a = useAction();
  const [confirmClose, setConfirmClose] = useState(false);
  const next = REQUISITION_TRANSITIONS[state];
  if (!next.length) return null;
  return (
    <section className="card p-4 text-sm" aria-label="Change state">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Change state</span>
        {next.map((to) =>
          to === 'CLOSED' && !confirmClose ? (
            <button key={to} type="button" disabled={a.pending} onClick={() => setConfirmClose(true)} className="btn btn-secondary">
              Close…
            </button>
          ) : (
            <button key={to} type="button" disabled={a.pending} title={HINT[to]} onClick={() => a.run('POST', `/requisitions/${id}/transition`, { to }, { success: `Requisition is now ${to.toLowerCase()}.` })} className={to === 'OPEN' ? 'btn btn-primary' : 'btn btn-secondary'}>
              {to === 'CLOSED' ? 'Yes, close it' : VERB[to]}
            </button>
          ),
        )}
        {confirmClose && (
          <button type="button" onClick={() => setConfirmClose(false)} className="text-link">
            Keep it
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-fg-muted">{confirmClose ? HINT.CLOSED : next.map((s) => `${VERB[s]}: ${HINT[s]}`).join(' ')}</p>
      <div className="mt-2">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </section>
  );
}

/** The guidelines package (and optionally a pinned version) candidates train and certify on. */
export function LinkGuidelines({ requisitionId, domain, packages, currentPackageId, currentVersion }: { requisitionId: string; domain: string; packages: GuidelinesPackageRow[]; currentPackageId: string | null; currentVersion: number | null }) {
  const a = useAction();
  const matching = packages.filter((p) => p.domain === domain);
  const [packageId, setPackageId] = useState(currentPackageId ?? matching[0]?.id ?? '');
  const [version, setVersion] = useState(currentVersion?.toString() ?? '');
  const pkg = matching.find((p) => p.id === packageId);
  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Guidelines</h2>
      {matching.length === 0 ? (
        <p className="text-fg-muted">No guidelines package for “{domain}” yet. An Admin creates one under Guidelines.</p>
      ) : (
        <>
          <label className="block">
            Package
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className={input}>
              {matching.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.taskFamily})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Version
            <select value={version} onChange={(e) => setVersion(e.target.value)} className={input}>
              <option value="">Latest published</option>
              {pkg?.versions.map((v) => (
                <option key={v.id} value={v.version}>
                  Version {v.version} · {v.publishedTiers.length ? `published: ${v.publishedTiers.length} tier(s)` : v.status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={a.pending || !packageId} onClick={() => a.run('PUT', `/requisitions/${requisitionId}/guidelines`, { packageId, version: version ? Number(version) : null }, { success: 'Guidelines linked.' })} className="btn btn-primary">
            Link guidelines
          </button>
        </>
      )}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </section>
  );
}

/** The rate card version SMEs on this requisition are paid at (direct pay only). */
export function LinkRateCard({ requisitionId, cards, currentId }: { requisitionId: string; cards: RateCardRow[]; currentId: string | null }) {
  const a = useAction();
  const [id, setId] = useState(currentId ?? cards[0]?.id ?? '');
  return (
    <section className="card space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Rate card</h2>
      {cards.length === 0 ? (
        <p className="text-fg-muted">No rate cards yet. Finance creates them under Payments → Rate cards.</p>
      ) : (
        <>
          <label className="block">
            Rate card version
            <select value={id} onChange={(e) => setId(e.target.value)} className={input}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} v{c.version} · {c.currency} · {Object.entries(c.perTask).map(([k, v]) => `${k.replace('_', ' ').toLowerCase()} ${v}`).join(', ')}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-fg-muted">Earnings already recorded keep the version they were priced at.</p>
          <button type="button" disabled={a.pending || !id || id === currentId} onClick={() => a.run('PUT', `/requisitions/${requisitionId}/rate-card`, { rateCardId: id }, { success: 'Rate card linked.' })} className="btn btn-primary">
            Link rate card
          </button>
        </>
      )}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </section>
  );
}
