'use client';

import { usePagedRows } from '@praxis/shared/ui/use-page';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ClientPager } from '@/components/pager';
import { mutate } from '@/lib/client-api';
import { filterOptions, filterQueue, NO_FILTERS, readyRows, ruleHref, STATUS_LABEL, type QueueFilters, type QueueNextAction } from './queue-logic';

/**
 * KYC Judgment v1 A3 (owner, 25 Nov 2026) and D-091/D-092 (owner, 26 Nov 2026): the PM's review queue, the one place a
 * policy-library project approves rules. A table of every draft with its document, jurisdiction, status and what to do
 * next in plain words; each row opens the rule page at the field for that action. Filters (document, next action,
 * jurisdiction, status, text) and 25 rows a page. "Confirm all ready" confirms the unflagged rules within the current
 * filter: the PM's confirm is the approval, never the AI's, and the server refuses the whole batch if any rule changed
 * or became flagged. The AI suggestions step runs for the drafts in the current document filter, or all of them.
 */
export interface QueueRow {
  ruleId: string;
  ruleKey: string;
  version: number;
  state?: string;
  contentHash: string;
  title: string;
  requirement: string;
  conditionText: string;
  library: { kind?: string; issuer?: string; jurisdiction?: string; subject?: string; scope?: { process?: string } } | null;
  jurisdiction?: string | null;
  documents?: { id: string; title: string }[];
  quotes: { fieldPath: string; role: string; quote: string; resolution: string; document: string }[];
  coverage: { status: string; environmentVersionId: string } | null;
  flags: { code: string; message: string }[];
  nextAction?: QueueNextAction;
}
export interface QueueData {
  items: QueueRow[];
  /** Flags about the library as a whole (for example: no approved rule defines "US person"), with the rule to approve. */
  projectFlags?: { code: string; message: string; rule?: { ruleId: string; ruleKey: string } | null }[];
  flagged: number;
  total: number;
  studioConnected: boolean;
  approvalRoute?: 'review_queue' | 'apply_tick';
  counts?: { rules: number; approved: number; excluded: number };
}

/** The rules that may be confirmed in one batch (no flag). */
export const confirmable = (rows: QueueRow[]) => rows.filter((r) => r.flags.length === 0);

const READY: QueueNextAction = { code: 'ready', label: 'Ready to confirm', focus: null };
/** Rows as the table needs them (older API answers lack the D-092 fields). */
export const tableRows = (items: QueueRow[]) =>
  items.map((r) => ({ ...r, state: r.state ?? 'DRAFT', jurisdiction: r.jurisdiction !== undefined ? r.jurisdiction : (r.library?.jurisdiction ?? null), documents: r.documents ?? [...new Map(r.quotes.map((q) => [q.document, { id: q.document, title: q.document }])).values()], nextAction: r.nextAction ?? (r.flags.length ? { code: r.flags[0]!.code, label: 'Review on its page', focus: null } : READY) }));

interface Estimate {
  rules: number;
  calls: number;
  model: string;
  live: boolean;
  estimatedUsd?: number;
}
interface EnrichmentRun {
  status: 'none' | 'running' | 'no_worker' | 'done' | 'failed' | 'skipped';
  message?: string;
  result?: { prefilled?: number; offered?: number; rules?: number; reason?: string; error?: string };
}

const usd = (n: number) => (n < 0.01 ? `under $0.01` : `$${n.toFixed(2)}`);

/** D-092: AI suggestions as one step, with its estimate first; says plainly when no worker has picked the job up (D-089). */
export function AiSuggestions({ projectId, documentId, documentTitle, initialRun = null }: { projectId: string; documentId: string; documentTitle: string | null; initialRun?: EnrichmentRun | null }) {
  const router = useRouter();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [run, setRun] = useState<EnrichmentRun | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    setEstimate(null);
    void fetch(`/api/v1/projects/${projectId}/policy/enrichment/estimate${documentId ? `?documentId=${documentId}` : ''}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Estimate | null) => !stop && setEstimate(d))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [projectId, documentId]);
  const active = run?.status === 'running' || run?.status === 'no_worker';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/v1/projects/${projectId}/policy/enrichment`, { cache: 'no-store' }).catch(() => null);
      if (!r?.ok) return;
      const d = (await r.json()) as EnrichmentRun;
      setRun(d);
      if (d.status === 'done') router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [active, projectId, router]);
  async function start() {
    setBusy(true);
    setMsg(null);
    const r = await mutate<EnrichmentRun>('POST', `/projects/${projectId}/policy/enrichment`, documentId ? { documentId } : {});
    setBusy(false);
    if (!r.ok) return setMsg(r.error ?? 'The AI suggestions could not start.');
    setRun({ status: 'running' });
  }
  const scope = documentId ? `the drafts from ${documentTitle ?? 'this document'}` : 'every draft';
  return (
    <section id="ai-suggestions" aria-labelledby="ai-h" className="mt-3 rounded border border-line p-3 text-sm" data-ai-suggestions>
      <h3 id="ai-h" className="font-medium">
        AI suggestions: library details and when each rule applies
      </h3>
      <p className="text-fg-muted">The assistant fills in the library details and a condition for drafts no person has edited, and offers them for the rest. It never approves: you confirm each rule below.</p>
      <p className="mt-1" data-estimate>
        {estimate ? (
          <>
            Runs for {scope}: {estimate.rules} rule{estimate.rules === 1 ? '' : 's'}, {estimate.calls} model call{estimate.calls === 1 ? '' : 's'} ({estimate.model}).{' '}
            {estimate.estimatedUsd !== undefined ? <strong>Estimated cost {usd(estimate.estimatedUsd)}{estimate.live ? '' : ' if run live (this deployment uses a stand-in, so nothing is spent)'}.</strong> : <span className="text-fg-muted">An Admin sees the cost estimate.</span>}
          </>
        ) : (
          <span className="text-fg-muted">Working out the estimate…</span>
        )}
      </p>
      <button type="button" className="btn btn-secondary mt-2" disabled={busy || active || !estimate?.rules} onClick={() => void start()}>
        {busy ? 'Starting…' : `Suggest library details (AI) for ${estimate?.rules ?? '…'} rule${estimate?.rules === 1 ? '' : 's'}`}
      </button>
      <div aria-live="polite">
        {run?.status === 'running' && <p className="mt-2 text-fg-muted">The assistant is working on {scope}. This updates by itself.</p>}
        {run?.status === 'no_worker' && (
          <p role="alert" className="mt-2 text-warning">
            <strong>No worker is running.</strong> {run.message ?? 'The job has not started.'}
          </p>
        )}
        {run?.status === 'done' && <p className="mt-2 text-success">Done: {run.result?.prefilled ?? 0} rules filled in, {run.result?.offered ?? 0} offered on their page. Check them in the table below.</p>}
        {(run?.status === 'failed' || run?.status === 'skipped') && <p role="alert" className="mt-2 text-error">The last run did not finish{run.result?.reason ? ` (${run.result.reason})` : run.result?.error ? `: ${run.result.error}` : ''}. Nothing was changed; you can try again.</p>}
        {msg && (
          <p role="alert" className="mt-2 text-error">
            {msg}
          </p>
        )}
      </div>
    </section>
  );
}

export function ReviewQueuePanel({ projectId, initial, enrichment = null }: { projectId: string; initial: QueueData | null; enrichment?: EnrichmentRun | null }) {
  const router = useRouter();
  const [filters, setFilters] = useState<QueueFilters>(NO_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const data = initial ?? { items: [], flagged: 0, total: 0, studioConnected: false };
  const rows = useMemo(() => tableRows(data.items), [data.items]);
  const options = useMemo(() => filterOptions(rows), [rows]);
  const shown = useMemo(() => filterQueue(rows, filters), [rows, filters]);
  const ready = readyRows(shown);
  const paged = usePagedRows(shown, { param: 'queuePage', pageSize: 25, resetKey: JSON.stringify(filters) });
  const set = (k: keyof QueueFilters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  async function run(kind: string, path: string, body: unknown, ok: (d: Record<string, unknown>) => string) {
    setBusy(kind);
    setMsg(null);
    const r = await mutate<Record<string, unknown>>('POST', path, body);
    setBusy(null);
    setAsking(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Something went wrong.' });
    setMsg({ kind: 'ok', text: ok(r.data ?? {}) });
    router.refresh();
  }
  const confirmReady = () => run('confirm', `/projects/${projectId}/policy/rules/apply-batch`, { items: ready.map((r) => ({ ruleId: r.ruleId, expectedContentHash: r.contentHash })) }, (d) => `Confirmed ${String(d.applied ?? 0)} rules: they are approved for the project.`);
  const docTitle = options.documents.find((d) => d.value === filters.documentId)?.label ?? null;
  const select = (id: string, label: string, k: keyof QueueFilters, opts: { value: string; label: string; count: number }[], all: string) => (
    <label htmlFor={id} className="flex flex-col text-sm">
      <span className="font-medium">{label}</span>
      <select id={id} className="input mt-1" value={filters[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section id="review-queue" aria-labelledby="queue-h" className="card mt-6 p-4" data-review-queue>
      <h2 id="queue-h" className="text-lg font-semibold">
        Review queue
      </h2>
      <p className="text-sm text-fg-muted">
        {data.total ? `${data.total} rules to review, ${data.flagged} with something to do first.` : 'No draft rules to review.'} Work down the “Next action” column: each link opens the rule at the field to fix. When a rule reads “Ready to confirm”, confirm it here. AI suggestions are not approval: your confirm is.
      </p>
      {(data.projectFlags ?? []).length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-warning" data-project-flags>
          {data.projectFlags!.map((f) => (
            <li key={f.code}>
              {f.message}{' '}
              {f.rule && (
                <Link className="text-link hover:underline" href={`/projects/${projectId}/policy/rules/${f.rule.ruleId}?focus=defines`}>
                  Open {f.rule.ruleKey}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <AiSuggestions projectId={projectId} documentId={filters.documentId} documentTitle={docTitle} initialRun={enrichment} />
      <div className="mt-4 grid gap-3 md:grid-cols-5" role="search" aria-label="Filter the review queue">
        <label htmlFor="q-text" className="flex flex-col text-sm">
          <span className="font-medium">Search</span>
          <input id="q-text" className="input mt-1" value={filters.q} placeholder="Rule key or title" onChange={(e) => set('q', e.target.value)} />
        </label>
        {select('q-doc', 'Document', 'documentId', options.documents, 'All documents')}
        {select('q-action', 'Next action', 'action', options.actions, 'Any next action')}
        {select('q-jur', 'Jurisdiction', 'jurisdiction', options.jurisdictions, 'Any jurisdiction')}
        {select('q-status', 'Status', 'status', options.statuses, 'Any status')}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!asking ? (
          <button type="button" className="btn btn-primary" disabled={!ready.length || !!busy} onClick={() => setAsking(true)}>
            Confirm all ready ({ready.length})
          </button>
        ) : (
          <span role="group" aria-label="Confirm the ready rules" className="inline-flex flex-wrap items-center gap-2">
            <span>
              Approve {ready.length} rule{ready.length === 1 ? '' : 's'}
              {filtered ? ' in this filter' : ''}? You have read each against its source.
            </span>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void confirmReady()}>
              {busy === 'confirm' ? 'Confirming…' : `Yes, confirm ${ready.length}`}
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </span>
        )}
        <button type="button" className="btn btn-secondary" disabled={!!busy || !data.studioConnected} onClick={() => void run('coverage', `/projects/${projectId}/policy/review-queue/coverage`, {}, (d) => `Studio checked ${String(d.checked ?? 0)} conditions.`)}>
          {busy === 'coverage' ? 'Checking…' : 'Check coverage with Studio'}
        </button>
        {filtered && (
          <button type="button" className="text-link hover:underline" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.kind === 'error' ? 'text-error' : 'text-success'}`}>
          {msg.text}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Draft rules to review</caption>
            <thead className="text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-1">
                  Rule
                </th>
                <th scope="col">Document</th>
                <th scope="col">Jurisdiction</th>
                <th scope="col">Status</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((r) => (
                <tr key={r.ruleId} className="border-t border-line align-top" data-next-action={r.nextAction.code}>
                  <td className="py-1.5 pr-2">
                    <Link className="font-mono text-xs text-link hover:underline" href={`/projects/${projectId}/policy/rules/${r.ruleId}`}>
                      {r.ruleKey}
                    </Link>
                    <span className="block">{r.title}</span>
                  </td>
                  <td className="pr-2">{r.documents.map((d) => d.title).join(', ') || '—'}</td>
                  <td className="pr-2">{r.jurisdiction ?? <span className="text-fg-muted">None set</span>}</td>
                  <td className="pr-2">{STATUS_LABEL[r.state] ?? r.state}</td>
                  <td>
                    {r.nextAction.code === 'ready' ? (
                      <span className="text-success">Ready to confirm</span>
                    ) : (
                      <Link className="text-link hover:underline" href={ruleHref(projectId, r)} title={r.flags.map((f) => f.message).join(' ')}>
                        {r.nextAction.label}
                      </Link>
                    )}
                    {r.flags.length > 1 && <span className="block text-xs text-fg-muted">and {r.flags.length - 1} more</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="mt-2 text-sm text-fg-muted">No rule matches these filters.</p>}
          <ClientPager paged={paged} noun="rules" singular="rule" />
        </>
      )}
    </section>
  );
}
