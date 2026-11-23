'use client';

import { COVERAGE_WORDS, type CoverageCheck } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * E-002 §4.1 and E-001 §4 (owner decisions 23 Nov 2026):
 * - Validate shows Studio's coverage check for the project's edge cases and clauses.
 * - Tasks held waiting for a new case kind can be released by the PM; the inbox asks after 3 days.
 * - The Policies tab lists the approved clauses with the condition in plain language and "setup needed" when the
 *   template does not bind a fact the condition uses (shown, never hidden), and the project's fact catalog.
 */

const STATUS_PILL: Record<string, string> = { supported: 'pill-success', needs_data: 'pill-warning', needs_environment_change: 'pill-error', available: 'pill-success', setup_needed: 'pill-warning' };
const STATUS_LABEL: Record<string, string> = { supported: 'Supported', needs_data: 'Needs data', needs_environment_change: 'Needs an environment change', available: 'Available', setup_needed: 'Setup needed' };
const Err = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-error">{text}</p> : null);

type CoverageAnswer = { connected: boolean; request: { edgeCaseTags: string[]; clauses: number }; result?: CoverageCheck; message?: string };

export function CoveragePanel({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CoverageAnswer | null>(null);
  async function validate() {
    setBusy(true);
    setError(null);
    const r = await mutate<CoverageAnswer>('POST', `/projects/${projectId}/coverage-check`, {});
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setAnswer(r.data ?? null);
  }
  const res = answer?.result;
  return (
    <section aria-labelledby="coverage-h" className="rounded-md border border-line p-4">
      <h2 id="coverage-h" className="text-lg font-semibold">
        Validate with Studio
      </h2>
      <p className="text-sm text-fg-muted">Asks Studio whether the environment can run this project’s edge cases (task focus and SME needs) and approved clauses. Needs data: Studio generates more cases. Needs an environment change: the run is blocked until Studio fixes it.</p>
      <button type="button" className="btn btn-secondary mt-2" disabled={busy} onClick={validate}>
        {busy ? 'Checking…' : 'Validate'}
      </button>
      <Err text={error} />
      {answer && !res && <p className="mt-2 text-sm">{answer.message}</p>}
      {answer && (
        <p className="mt-1 text-xs text-fg-muted">
          Checked {answer.request.edgeCaseTags.length} edge case{answer.request.edgeCaseTags.length === 1 ? '' : 's'} and {answer.request.clauses} clause{answer.request.clauses === 1 ? '' : 's'}.
        </p>
      )}
      {res && (
        <div className="mt-2 space-y-2 text-sm" data-coverage>
          <p className="text-xs text-fg-muted">Environment {res.environment_version_id} · checked {new Date(res.checked_at).toLocaleString()}</p>
          <ul className="space-y-2">
            {[...res.edge_cases.map((e) => ({ key: `edge ${e.tag}`, name: `Edge case ${e.tag}`, status: e.status, gaps: e.gaps })), ...res.clauses.map((c) => ({ key: `clause ${c.clause_id}`, name: `Clause ${c.clause_id} v${c.version}`, status: c.status, gaps: c.gaps }))].map((x) => (
              <li key={x.key} className="rounded border border-line p-2">
                <span className="font-medium">{x.name}</span> <span className={`pill ${STATUS_PILL[x.status] ?? ''}`}>{STATUS_LABEL[x.status] ?? x.status}</span>
                <span className="block text-xs text-fg-muted">{COVERAGE_WORDS[x.status]}</span>
                {x.gaps.map((g, i) => (
                  <span key={i} className="block text-xs">
                    Missing {g.kind} {g.ref}: {g.message}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function HeldTasksPanel({ projectId, held }: { projectId: string; held: { taskId: string; title: string; waitingFor: string }[] }) {
  const router = useRouter();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!held.length) return null;
  async function release(taskId: string) {
    setError(null);
    const r = await mutate('POST', `/projects/${projectId}/held-tasks/${taskId}/release`, { reason: reason[taskId] ?? '' });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="held-h" className="rounded-md border border-line p-4">
      <h2 id="held-h" className="text-lg font-semibold">
        Held tasks
      </h2>
      <p className="text-sm text-fg-muted">These tasks wait for a new case kind from Studio and are not exported. After 3 days your inbox asks you to chase Studio or release the task. Releasing drops the task’s edge-case focus so it exports as a normal case.</p>
      <Err text={error} />
      <ul className="mt-2 space-y-2 text-sm">
        {held.map((t) => (
          <li key={t.taskId} className="flex flex-wrap items-end gap-2 rounded border border-line p-2">
            <span className="min-w-[12rem]">
              {t.title} <span className="text-xs text-fg-muted">· waiting for {t.waitingFor}</span>
            </span>
            <label className="flex flex-1 flex-col text-xs">
              <span className="text-fg-muted">Reason for releasing</span>
              <input className="input" value={reason[t.taskId] ?? ''} onChange={(e) => setReason({ ...reason, [t.taskId]: e.target.value })} />
            </label>
            <button type="button" className="btn btn-secondary" disabled={(reason[t.taskId] ?? '').trim().length < 3} onClick={() => release(t.taskId)}>
              Release task
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ClauseRow {
  clauseId: string;
  version: number;
  title: string;
  conditionText: string;
  status: 'available' | 'setup_needed';
  missingFacts: string[];
  source: { sha256: string } | null;
}

export function ApprovedClausesPanel({ projectId, clauses, catalog }: { projectId: string; clauses: ClauseRow[]; catalog: { version: number | null; catalog: unknown } }) {
  const router = useRouter();
  const [text, setText] = useState(catalog.catalog ? JSON.stringify(catalog.catalog, null, 2) : '');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return setError('The fact catalog is not valid JSON.');
    }
    const r = await mutate('PUT', `/projects/${projectId}/policy/fact-catalog`, body);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="clauses-h" className="mt-6 rounded-md border border-line p-4" data-approved-clauses>
      <h2 id="clauses-h" className="text-lg font-semibold">
        Approved clauses
      </h2>
      <p className="text-sm text-fg-muted">Each applied rule as the benchmark will use it: when it applies, in plain words. “Setup needed” means the template does not yet supply a fact the condition uses; Studio adds it. SMEs choose clauses in S4; they never change a condition.</p>
      {clauses.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">No applied rules yet.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {clauses.map((c) => (
            <li key={`${c.clauseId}-${c.version}`} className="rounded border border-line p-2">
              <span className="font-medium">
                {c.clauseId} v{c.version}: {c.title}
              </span>{' '}
              <span className={`pill ${STATUS_PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              <span className="block text-xs">Applies when: {c.conditionText}</span>
              {c.missingFacts.length > 0 && <span className="block text-xs text-warning">Facts the template does not supply yet: {c.missingFacts.join(', ')}</span>}
              {c.source && <span className="block font-mono text-[11px] text-fg-muted">source {c.source.sha256.slice(0, 12)}…</span>}
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-link">Project fact catalog {catalog.version ? `(version ${catalog.version})` : '(not set up)'}</summary>
        <p className="mt-1 text-xs text-fg-muted">The logical facts conditions may use (fact-catalog.v1, owner kind project_scope with this project’s ID). Saving makes a new version; earlier versions are kept.</p>
        <label htmlFor="fact-catalog" className="sr-only">
          Project fact catalog (JSON)
        </label>
        <textarea id="fact-catalog" className="input mt-2 w-full font-mono text-xs" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="btn btn-secondary mt-2" disabled={!text.trim()} onClick={save}>
          Save fact catalog
        </button>
        <Err text={error} />
      </details>
    </section>
  );
}
