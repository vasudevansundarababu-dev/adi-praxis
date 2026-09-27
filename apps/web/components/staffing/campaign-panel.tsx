'use client';

import type { CampaignDto } from '@praxis/shared';
import Link from 'next/link';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/** SPEC FLOW 2 sourcing on the Resource Assignment screen: launch, view, pause/resume and close the campaign. */
export function CampaignPanel({ projectId, initial, opportunityPublished, staffing }: { projectId: string; initial: CampaignDto[]; opportunityPublished: boolean; staffing: boolean }) {
  const [campaigns, setCampaigns] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const current = campaigns.find((c) => c.status === 'LIVE' || c.status === 'PAUSED') ?? campaigns[0];

  async function act(method: 'POST' | 'PATCH', path: string, body?: unknown) {
    setPending(true);
    const res = await mutate<CampaignDto>(method, path, body);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setCampaigns((list) => [res.data!, ...list.filter((c) => c.id !== res.data!.id)]);
  }

  return (
    <section className="mt-6 rounded-lg border border-line p-4" aria-label="Sourcing campaign">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Sourcing campaign</h2>
        <Link href={`/projects/${projectId}/opportunity`} className="text-sm text-link hover:underline">
          Opportunity page
        </Link>
        {staffing && (!current || current.status === 'CLOSED') && (
          <button type="button" disabled={pending || !opportunityPublished} onClick={() => act('POST', `/projects/${projectId}/campaigns`, { channel: 'LINKEDIN_MANUAL' })} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary disabled:opacity-50">
            Launch sourcing campaign
          </button>
        )}
      </div>
      {!opportunityPublished && staffing && <p className="mt-2 text-sm text-fg-muted">Publish the opportunity page first; the apply link points to it.</p>}
      {current && (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            LinkedIn (manual post) · <strong>{current.status.toLowerCase()}</strong>
          </p>
          <dl className="grid grid-cols-5 gap-2 text-center">
            {Object.entries({ Clicks: current.metrics.clicks, Applies: current.metrics.applies, 'Identity done': current.metrics.kycCompleted, Approved: current.metrics.approved, Assigned: current.metrics.assigned }).map(([k, v]) => (
              <div key={k} className="rounded-md border border-line p-2">
                <dt className="text-xs text-fg-muted">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {current.status !== 'CLOSED' && (
            <>
              <p className="text-fg-muted">{current.instructions}</p>
              <p>
                Apply link: <code className="break-all rounded bg-surface px-1">{current.applyUrl}</code>
              </p>
              <textarea readOnly rows={10} value={current.postText ?? ''} aria-label="Job post text" className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(current.postText ?? ''); setCopied(true); }} className="rounded-md border border-line px-3 py-1.5">
                  {copied ? 'Copied' : 'Copy post text'}
                </button>
                <button type="button" disabled={pending} onClick={() => act('PATCH', `/campaigns/${current.id}`, { status: current.status === 'LIVE' ? 'PAUSED' : 'LIVE' })} className="rounded-md border border-line px-3 py-1.5">
                  {current.status === 'LIVE' ? 'Pause' : 'Resume'}
                </button>
                <button type="button" disabled={pending} onClick={() => act('POST', `/campaigns/${current.id}/close`)} className="rounded-md border border-line px-3 py-1.5">
                  Close campaign
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </section>
  );
}
