'use client';

import { SME_TIERS, TIER_LABELS, type SmeTier } from '@praxis/shared';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, input, useAction } from '@/components/supply/action';

/** Publishing a tier makes its course and test available to candidates; it cannot be undone for this version. */
export function PublishTierButton({ versionId, tier, tierLabel, ready }: { versionId: string; tier: SmeTier; tierLabel: string; ready: boolean }) {
  const a = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={a.pending} onClick={() => a.run('POST', `/guidelines/versions/${versionId}/tiers/${tier}/publish`, undefined, { success: `${tierLabel} published.` })} className="btn btn-primary">
            Yes, publish {tierLabel}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="btn btn-secondary">
            Not yet
          </button>
        </div>
      ) : (
        <button type="button" disabled={!ready || a.pending} onClick={() => setConfirming(true)} className="btn btn-primary w-full">
          Publish {tierLabel}
        </button>
      )}
      {confirming && <p className="text-xs text-fg-muted">Candidates can start this course and test at once. To change anything later, upload a new version.</p>}
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </div>
  );
}

const SCOPES = [
  ['FULL', 'Everything (knowledge map, courses, blueprints, families)'],
  ['KNOWLEDGE', 'Knowledge map'],
  ['COURSE', 'Course'],
  ['BLUEPRINT', 'Blueprint'],
  ['FAMILIES', 'Item families'],
] as const;

/** Regenerate part of a version. Published tiers are left alone; one run at a time. */
export function RegenerateForm({ versionId, publishedTiers, disabled }: { versionId: string; publishedTiers: SmeTier[]; disabled: boolean }) {
  const a = useAction();
  const [scope, setScope] = useState<(typeof SCOPES)[number][0]>('COURSE');
  const [tier, setTier] = useState<SmeTier | ''>('');
  const tiered = scope === 'COURSE' || scope === 'BLUEPRINT' || scope === 'FAMILIES';
  return (
    <form
      className="card mt-3 flex flex-wrap items-end gap-3 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run('POST', `/guidelines/versions/${versionId}/regenerate`, { scope, ...(tiered && tier ? { tier } : {}) }, { success: 'Regeneration queued. Refresh in a minute to see the new drafts.' });
      }}
    >
      <RequiredNote className="w-full" />
      <label className="block">
        Regenerate
        <Req />
        <select required value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={input}>
          {SCOPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {tiered && (
        <label className="block">
          For tier
          <select value={tier} onChange={(e) => setTier(e.target.value as SmeTier | '')} className={input}>
            <option value="">Every unpublished tier</option>
            {SME_TIERS.filter((t) => !publishedTiers.includes(t)).map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" disabled={a.pending || disabled} className="btn btn-secondary">
        Regenerate
      </button>
      {disabled && <span className="text-xs text-fg-muted">Wait for the current run to finish.</span>}
      <div className="w-full">
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </div>
    </form>
  );
}
