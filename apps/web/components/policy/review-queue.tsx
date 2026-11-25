'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026): the PM's review queue. Every draft rule shows its text and condition beside
 * the source quote, with the library details the AI filled in and the flags that call for a careful read. Flagged rules
 * open their own page. Unflagged rules can be confirmed together: the PM's confirm is the approval, never the AI's,
 * and the server refuses the whole batch if any rule changed or became flagged.
 */
export interface QueueRow {
  ruleId: string;
  ruleKey: string;
  version: number;
  contentHash: string;
  title: string;
  requirement: string;
  conditionText: string;
  library: { kind?: string; issuer?: string; jurisdiction?: string; subject?: string; scope?: { process?: string } } | null;
  quotes: { fieldPath: string; role: string; quote: string; resolution: string; document: string }[];
  coverage: { status: string; environmentVersionId: string } | null;
  flags: { code: string; message: string }[];
}
export interface QueueData {
  items: QueueRow[];
  flagged: number;
  total: number;
  studioConnected: boolean;
}

/** The rules that may be confirmed in one batch (no flag). */
export const confirmable = (rows: QueueRow[]) => rows.filter((r) => r.flags.length === 0);

const libraryLine = (l: QueueRow['library']) => (l ? [l.kind, l.issuer, l.jurisdiction, l.subject, l.scope?.process].filter(Boolean).join(' · ') : '');

export function ReviewQueuePanel({ projectId, initial }: { projectId: string; initial: QueueData | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const data = initial ?? { items: [], flagged: 0, total: 0, studioConnected: false };
  const ready = confirmable(data.items);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function run(kind: string, path: string, body: unknown, ok: (d: Record<string, unknown>) => string) {
    setBusy(kind);
    setMsg(null);
    const r = await mutate<Record<string, unknown>>('POST', path, body);
    setBusy(null);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Something went wrong.' });
    setMsg({ kind: 'ok', text: ok(r.data ?? {}) });
    setPicked([]);
    router.refresh();
  }
  const confirm = () =>
    run('confirm', `/projects/${projectId}/policy/rules/apply-batch`, { items: data.items.filter((r) => picked.includes(r.ruleId)).map((r) => ({ ruleId: r.ruleId, expectedContentHash: r.contentHash })) }, (d) => `Applied ${String(d.applied ?? 0)} rules to the project.`);

  return (
    <section aria-labelledby="queue-h" className="mt-8 rounded-md border border-line p-4" data-review-queue>
      <h2 id="queue-h" className="text-lg font-semibold">
        Review queue
      </h2>
      <p className="text-sm text-fg-muted">
        {data.total ? `${data.total} rules to review, ${data.flagged} flagged.` : 'No draft rules to review.'} Read each rule against its source quote. AI suggestions are not approval: ticking and confirming a rule is your approval. Flagged rules are reviewed one at a time on their own page.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run('enrich', `/projects/${projectId}/policy/enrichment`, {}, () => 'Suggesting library details for the drafts. Reload in a minute to see them.')}>
          {busy === 'enrich' ? 'Starting…' : 'Suggest library details (AI)'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!!busy || !data.studioConnected} onClick={() => run('coverage', `/projects/${projectId}/policy/review-queue/coverage`, {}, (d) => `Studio checked ${String(d.checked ?? 0)} conditions.`)}>
          {busy === 'coverage' ? 'Checking…' : 'Check coverage with Studio'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!ready.length || !!busy} onClick={() => setPicked(ready.map((r) => r.ruleId))}>
          Select all unflagged ({ready.length})
        </button>
        <button type="button" className="btn btn-primary" disabled={!picked.length || !!busy} onClick={confirm}>
          {busy === 'confirm' ? 'Confirming…' : `Confirm selected (${picked.length})`}
        </button>
      </div>
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.kind === 'error' ? 'text-error' : ''}`}>
          {msg.text}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {data.items.map((r) => {
          const id = `q-${r.ruleId}`;
          return (
            <li key={r.ruleId} className="rounded border border-line p-3" data-flagged={r.flags.length ? 'yes' : 'no'}>
              <div className="flex flex-wrap items-baseline gap-2">
                {r.flags.length === 0 ? (
                  <input id={id} type="checkbox" checked={picked.includes(r.ruleId)} onChange={() => toggle(r.ruleId)} aria-label={`Select ${r.ruleKey} to confirm`} />
                ) : null}
                <span className="font-medium">{r.ruleKey}</span>
                <span>{r.title}</span>
                <span className="text-xs text-fg-muted">v{r.version}</span>
                {r.flags.length ? (
                  <Link href={`/projects/${projectId}/policy/rules/${r.ruleId}`} className="text-sm text-link hover:underline">
                    Review {r.ruleKey} on its page
                  </Link>
                ) : null}
              </div>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div className="text-sm">
                  <p>{r.requirement}</p>
                  <p className="mt-1 text-fg-muted">Applies when: {r.conditionText}</p>
                  {libraryLine(r.library) && <p className="mt-1 text-xs text-fg-muted">{libraryLine(r.library)}</p>}
                  {r.coverage && <p className="mt-1 text-xs">Studio ({r.coverage.environmentVersionId}): {r.coverage.status.replace(/_/g, ' ')}</p>}
                </div>
                <div className="text-sm">
                  <p className="text-xs font-medium text-fg-muted">Source quote</p>
                  {r.quotes.map((q, i) => (
                    <blockquote key={i} className="mt-1 border-l-2 border-line pl-2">
                      {q.quote} <span className="text-xs text-fg-muted">({q.document}, {q.fieldPath}{q.resolution === 'RESOLVED' ? '' : `, ${q.resolution.toLowerCase().replace(/_/g, ' ')}`})</span>
                    </blockquote>
                  ))}
                </div>
              </div>
              {r.flags.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-warning">
                  {r.flags.map((f) => (
                    <li key={f.code}>{f.message}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
