'use client';

import { chapterTime, OPEN_TUTORIAL_RUN_STATUSES, type TutorialRunDto, type TutorialRunsResponse } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate } from '@/lib/client-api';

const STATUS_TEXT: Record<TutorialRunDto['status'], string> = {
  QUEUED: 'Queued',
  SCRIPTING: 'Writing the script',
  CLIPS: 'Making the video clips',
  NARRATION: 'Recording the narration',
  STITCHING: 'Putting the video together',
  READY_FOR_REVIEW: 'Ready for your review',
  APPROVED: 'Approved, shown on task pages',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Replaced by a newer approved video',
  FAILED: 'Failed',
};
const WORKING = ['QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING'];
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * D2: the Admin's AI tutorial video panel. Generate (with the cost shown first), follow progress, preview with chapters
 * and captions, then Approve or Reject. Nothing reaches SMEs or Reviewers until an Admin approves it.
 */
export function TutorialVideoPanel({ templateId, initial }: { templateId: string; initial: TutorialRunsResponse }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const video = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/v1/templates/${templateId}/tutorial/runs`).catch(() => null);
    if (res?.ok) setData((await res.json()) as TutorialRunsResponse);
  }, [templateId]);

  const latest = data.runs[0] ?? null;
  const working = !!latest && WORKING.includes(latest.status);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [working, refresh]);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/tutorial/generate`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: '{}' });
      const body = (await res.json().catch(() => null)) as { reason?: string | null; message?: string } | null;
      if (!res.ok) setError(body?.reason ?? body?.message ?? `Request failed (${res.status})`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setPending(false);
    await refresh();
  }

  async function decide(run: TutorialRunDto, action: 'approve' | 'reject') {
    if (action === 'reject' && reason.trim().length < 3) return setError('Say briefly why the video is rejected.');
    setPending(true);
    setError(null);
    const res = await mutate<TutorialRunDto>('POST', `/tutorial-runs/${run.id}/${action}`, action === 'reject' ? { reason: reason.trim() } : {});
    setPending(false);
    if (!res.ok) return setError(res.error);
    setReason('');
    await refresh();
    router.refresh();
  }

  const g = data.generation;
  const open = data.runs.some((r) => (OPEN_TUTORIAL_RUN_STATUSES as readonly string[]).includes(r.status));
  const approved = data.runs.find((r) => r.status === 'APPROVED');

  return (
    <section aria-labelledby="tutorial-video-h" className="card mt-4 p-4">
      <h2 id="tutorial-video-h" className="text-base font-semibold">
        AI tutorial video
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        An overview, then one chapter per form section, made from this template's fields and a synthetic example. You preview it first; SMEs and Reviewers see it only after you approve it.
        {approved ? ' Making a new one keeps the approved video on task pages until you approve the new one.' : ''}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-fg-muted">Chapters</dt>
          <dd>{g.chapters}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Estimated cost</dt>
          <dd>{g.live ? usd(g.estimatedUsd) : 'None (mock)'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Per-video cap</dt>
          <dd>{g.costCapUsd === null ? 'Not set' : usd(g.costCapUsd)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Spent today / daily cap</dt>
          <dd>
            {usd(g.spentTodayUsd)} / {g.dailyCapUsd === null ? 'not set' : usd(g.dailyCapUsd)}
          </dd>
        </div>
      </dl>
      {g.blockedReason && !open && (
        <p role="status" className="mt-2 text-sm text-fg-muted">
          {g.blockedReason}
        </p>
      )}
      <button type="button" className="btn btn-primary mt-3 disabled:opacity-60" disabled={pending || !!g.blockedReason} onClick={() => void generate()}>
        {approved ? 'Generate a new tutorial' : 'Generate tutorial'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}

      {latest && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm">
            <span className="font-medium">Latest (v{latest.templateVersion}):</span> {STATUS_TEXT[latest.status]}
            {working && <span className="text-fg-muted"> (this takes a few minutes; the page updates by itself)</span>}
            {latest.actualUsd > 0 && <span className="text-fg-muted"> · cost so far {usd(latest.actualUsd)}</span>}
          </p>
          {latest.error && <p className="mt-1 text-sm text-error">{latest.error}</p>}
          {latest.rejectReason && <p className="mt-1 text-sm text-fg-muted">Reason: {latest.rejectReason}</p>}
          {latest.previewUrl && (
            <>
              <video ref={video} controls preload="metadata" src={latest.previewUrl} {...(latest.captionsUrl ? { crossOrigin: 'anonymous' as const } : {})} className="mt-3 w-full max-w-3xl rounded-md bg-black" aria-label="Tutorial video preview">
                {latest.captionsUrl && <track kind="captions" src={latest.captionsUrl} srcLang="en" label="English" default />}
              </video>
              {latest.chapters.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-sm">
                  {latest.chapters.map((c, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="text-link hover:underline"
                        onClick={() => {
                          if (!video.current) return;
                          video.current.currentTime = c.at;
                          void video.current.play()?.catch(() => undefined);
                        }}
                      >
                        <span className="font-mono text-xs">{chapterTime(c.at)}</span> {c.title}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {latest.script && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Script</summary>
              {latest.script.chapters.map((c, i) => (
                <div key={i} className="mt-2">
                  <p className="font-medium">{c.title}</p>
                  <p className="whitespace-pre-line">{c.narration}</p>
                </div>
              ))}
            </details>
          )}
          {latest.status === 'READY_FOR_REVIEW' && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary disabled:opacity-60" disabled={pending} onClick={() => void decide(latest, 'approve')}>
                  Approve and show on task pages
                </button>
              </div>
              <label className="block text-sm">
                Or reject it (reason)
                <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" />
              </label>
              <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={pending} onClick={() => void decide(latest, 'reject')}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
