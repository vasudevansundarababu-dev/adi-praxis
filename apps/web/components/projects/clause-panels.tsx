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
  async function fromTemplate() {
    setError(null);
    const r = await mutate('POST', `/projects/${projectId}/policy/fact-catalog/from-template`, {});
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
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
      {!catalog.version && (
        <div className="mt-3 text-sm">
          <button type="button" className="btn btn-secondary" onClick={fromTemplate}>
            Start the fact catalog from the template’s facts
          </button>
          <p className="mt-1 text-xs text-fg-muted">Uses the facts the template already supplies (its policy bindings), so conditions can use them. You can edit it afterwards.</p>
        </div>
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

export interface DispositionRow {
  ruleKey: string;
  ruleId: string;
  contentHash: string;
  disposition: 'recommended' | 'needs_review' | 'outside_scope';
  mode?: 'always' | 'conditional';
  condition?: unknown;
  conditionText?: string;
  question?: string;
  mismatch?: { quote: string; reason: string };
  bindingGaps: string[];
}
const DISPOSITION_LABEL = { recommended: 'Recommended', needs_review: 'Needs review', outside_scope: 'Outside scope' } as const;
const DISPOSITION_PILL = { recommended: 'pill-success', needs_review: 'pill-warning', outside_scope: '' } as const;

/**
 * E-002 §1.3: the AI suggests one disposition per rule; it never approves. The PM can use a suggested condition (a new
 * rule version, audited), then applies the rule as usual. When the AI is unavailable, every rule can still be reviewed
 * by hand in the rules table above.
 */
export function DispositionsPanel({ projectId, initial = null }: { projectId: string; initial?: { model: string; items: DispositionRow[] } | null }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState<Record<string, boolean>>({});
  async function suggest() {
    setBusy(true);
    setError(null);
    const r = await mutate<{ model: string; items: DispositionRow[] }>('POST', `/projects/${projectId}/policy/dispositions`, {});
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setData(r.data ?? null);
  }
  async function use(d: DispositionRow) {
    setError(null);
    const r = await mutate('POST', `/projects/${projectId}/policy/rules/${d.ruleId}/condition`, { expectedContentHash: d.contentHash, condition: d.condition ?? null });
    if (!r.ok) return setError(r.error);
    setUsed({ ...used, [d.ruleKey]: true });
    router.refresh();
  }
  return (
    <section aria-labelledby="dispositions-h" className="mt-6 rounded-md border border-line p-4" data-dispositions>
      <h2 id="dispositions-h" className="text-lg font-semibold">
        Suggested dispositions
      </h2>
      <p className="text-sm text-fg-muted">An AI suggestion per rule, against this project’s scope and fact catalog: Recommended (always, or when a condition holds), Needs review (with a question for you) or Outside scope (with the quoted mismatch). Suggestions never approve anything; you decide and apply rules as usual. Using a condition saves a new draft of the rule: tick Apply to project on it afterwards (and publish the rule set) to approve it.</p>
      <button type="button" className="btn btn-secondary mt-2" disabled={busy} onClick={suggest}>
        {busy ? 'Suggesting…' : data ? 'Suggest again' : 'Suggest dispositions'}
      </button>
      <Err text={error} />
      {data && data.items.length === 0 && <p className="mt-2 text-sm text-fg-muted">No rules to suggest for yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {data.items.map((d) => (
            <li key={d.ruleKey} className="rounded border border-line p-2">
              <span className="font-medium">{d.ruleKey}</span> <span className={`pill ${DISPOSITION_PILL[d.disposition]}`}>{DISPOSITION_LABEL[d.disposition]}</span> <span className="text-xs text-fg-muted">AI suggestion</span>
              {d.disposition === 'recommended' && <span className="block text-xs">Applies when: {d.conditionText}</span>}
              {d.bindingGaps.length > 0 && <span className="block text-xs text-warning">Setup needed: the template doesn’t supply {d.bindingGaps.join(', ')} yet.</span>}
              {d.question && <span className="block text-xs">Question for you: {d.question}</span>}
              {d.mismatch && (
                <span className="block text-xs">
                  “{d.mismatch.quote}”: {d.mismatch.reason}
                </span>
              )}
              {d.disposition === 'recommended' && (
                <button type="button" className="btn btn-secondary mt-1 !px-2 !py-1 text-xs" disabled={used[d.ruleKey]} onClick={() => use(d)}>
                  {used[d.ruleKey] ? 'Condition saved' : 'Use this condition'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && <p className="mt-2 text-xs text-fg-muted">Suggested by {data.model}.</p>}
    </section>
  );
}

type Ratio = { value: number | null; numerator: number; denominator: number };
export interface QualityRun {
  id: string;
  at: string;
  result: { extraction: { precision: Ratio; recall: Ratio }; suggestions: { agreement: Ratio }; counts: Record<string, number>; discrepancies: { type: string; labelId?: string; ruleKey?: string; expected?: string; got?: string }[] };
  metadata: { document: { sha256: string; documentVersion: number }; scope: { factCatalogVersion: number | null }; extraction: { provider: string; jobId: string } | null; suggestions: { promptVersion: string; model: string } | null; referenceSet: { version: number; labels: number } };
}
const pct = (r: Ratio) => `${r.value === null ? '—' : `${Math.round(r.value * 100)}%`} (${r.numerator} of ${r.denominator})`;
const DISCREPANCY_WORDS: Record<string, string> = { missed_obligation: 'Missed obligation', extra_rule: 'Extra rule (not in your labels)', merged_obligations: 'Two labelled obligations in one rule', disposition_mismatch: 'Suggestion differs from your label', no_suggestion: 'No suggestion' };

/** E-002 §4.1.4: PM-only quality evaluation of extraction and suggestions, against private reference labels; reproducible. */
export function QualityPanel({ projectId, documents, runs, sets }: { projectId: string; documents: { versionId: string; label: string }[]; runs: QualityRun[]; sets: { id: string; documentVersionId: string; version: number; labels: number }[] }) {
  const router = useRouter();
  const [doc, setDoc] = useState(documents[0]?.versionId ?? '');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latestSet = sets.find((s) => s.documentVersionId === doc);
  async function saveLabels() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(labels);
    } catch {
      return setError('The labels are not valid JSON: a list of {"id", "quote", "disposition"}.');
    }
    const r = await mutate('PUT', `/projects/${projectId}/policy/reference-sets`, { documentVersionId: doc, labels: parsed });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  async function evaluate(includeSuggestions: boolean) {
    if (!latestSet) return;
    setBusy(true);
    setError(null);
    const r = await mutate('POST', `/projects/${projectId}/policy/quality-runs`, { referenceSetId: latestSet.id, includeSuggestions });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <section aria-labelledby="quality-h" className="mt-6 rounded-md border border-line p-4" data-quality>
      <h2 id="quality-h" className="text-lg font-semibold">
        Quality evaluation (PM only)
      </h2>
      <p className="text-sm text-fg-muted">Compare extraction and suggestions with your own private labels for a document. Your labels are never shown to SMEs or sent anywhere. Each run keeps what it used, so it can be repeated.</p>
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">Add a policy document first.</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <label className="flex flex-col text-xs">
            <span className="text-fg-muted">Document version</span>
            <select className="input" value={doc} onChange={(e) => setDoc(e.target.value)}>
              {documents.map((d) => (
                <option key={d.versionId} value={d.versionId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs">{latestSet ? `Reference labels: version ${latestSet.version}, ${latestSet.labels} labels.` : 'No reference labels for this document yet.'}</p>
          <details>
            <summary className="cursor-pointer text-link">Add a new version of the labels</summary>
            <label htmlFor="quality-labels" className="sr-only">
              Reference labels (JSON)
            </label>
            <textarea id="quality-labels" className="input mt-1 w-full font-mono text-xs" rows={6} placeholder='[{"id":"L1","quote":"exact text of one obligation","disposition":"recommended"}]' value={labels} onChange={(e) => setLabels(e.target.value)} />
            <button type="button" className="btn btn-secondary mt-1" disabled={!labels.trim() || !doc} onClick={saveLabels}>
              Save labels
            </button>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={!latestSet || busy} onClick={() => evaluate(true)}>
              Evaluate extraction and suggestions
            </button>
            <button type="button" className="btn btn-secondary" disabled={!latestSet || busy} onClick={() => evaluate(false)}>
              Evaluate extraction only
            </button>
          </div>
        </div>
      )}
      <Err text={error} />
      {runs.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {runs.map((r) => (
            <li key={r.id} className="rounded border border-line p-2">
              <span className="text-xs text-fg-muted">{new Date(r.at).toLocaleString()}</span>
              <span className="block">
                Extraction precision {pct(r.result.extraction.precision)} · recall {pct(r.result.extraction.recall)} · suggestion agreement {pct(r.result.suggestions.agreement)}
              </span>
              <span className="block text-xs">{Object.entries(r.result.counts).filter(([, n]) => n > 0).map(([k, n]) => `${DISCREPANCY_WORDS[k] ?? k}: ${n}`).join(' · ') || 'No discrepancies.'}</span>
              <details className="text-xs">
                <summary className="cursor-pointer text-link">Discrepancies and how to reproduce this run</summary>
                <ul className="mt-1 list-disc pl-5">
                  {r.result.discrepancies.map((d, i) => (
                    <li key={i}>
                      {DISCREPANCY_WORDS[d.type] ?? d.type}
                      {d.labelId ? ` · label ${d.labelId}` : ''}
                      {d.ruleKey ? ` · rule ${d.ruleKey}` : ''}
                      {d.expected ? ` · expected ${d.expected}` : ''}
                      {d.got ? ` · got ${d.got}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-mono">
                  document v{r.metadata.document.documentVersion} sha256 {r.metadata.document.sha256.slice(0, 12)}… · scope (fact catalog) v{r.metadata.scope.factCatalogVersion ?? '—'} · extraction {r.metadata.extraction ? `${r.metadata.extraction.provider} job ${r.metadata.extraction.jobId.slice(0, 8)}` : 'manual'} · {r.metadata.suggestions ? `prompt ${r.metadata.suggestions.promptVersion}, model ${r.metadata.suggestions.model}` : 'no suggestions'} · labels v{r.metadata.referenceSet.version}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
