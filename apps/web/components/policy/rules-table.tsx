'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MANDATORY_MARKINGS, MARKING_LABEL, type MandatoryMarking, type RuleAnnotationInput } from '@praxis/shared';
import { usePagedRows } from '@praxis/shared/ui/use-page';
import { ClientPager } from '@/components/pager';
import { mutate } from '@/lib/client-api';
import { MARKING_FILTERS, OUTCOME_LABEL, applicationTypeOptions, byMarking, forApplication, sourceLabel, withMarking, type AnnotatedRow, type MarkingFilter } from './annotation-logic';
import { setRuleApplied, type ApplyTarget } from './apply-rule';
import { applySteps, rulesForDocument, STATE_LABEL, visibleRules, type Suggestion, type TableRule, byName } from './rules-table-logic';

export interface RulesTableRule extends TableRule, AnnotatedRow {
  versionId: string;
  version: number;
  contentHash: string;
  requirement: string;
  evidence: { quote: string; resolution: string; document: string; documentVersion: number } | null;
}

type AnnotationRun = { status: 'none' | 'running' | 'done' | 'failed' | 'skipped'; annotated?: number; offered?: number; error?: string | null; model?: string | null };

const EXAMPLE = 'This template is for KYC for single, joint and minor accounts. Select all the rules that are mandatory for these tasks, including edge cases and special cases.';
/** D4 (owner, 15 Nov 2026): a short placeholder, so the example never looks like real input. */
const PLACEHOLDER = 'Describe the tasks this template covers…';

/**
 * Rules table with prompt-guided selection (PRD 5.6). The AI only marks rules as Suggested, with a reason; the PM's
 * "Apply to project" tick is the decision and the review.
 */
export function RulesTable({ projectId, documents, rules, initialDocumentId }: { projectId: string; documents: Array<{ id: string; title: string }>; rules: RulesTableRule[]; initialDocumentId?: string | null }) {
  const router = useRouter();
  const [docId, setDocId] = useState<string | null>(initialDocumentId ?? documents[0]?.id ?? null);
  const [prompt, setPrompt] = useState('');
  const [ranPrompt, setRanPrompt] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion> | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowStage, setRowStage] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ target: ApplyTarget; problems: string[]; title: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const runId = useRef(0);
  const [markingFilter, setMarkingFilter] = useState<MarkingFilter>('all');
  const [appType, setAppType] = useState('');
  const [govState, setGovState] = useState('');
  const [annotationRun, setAnnotationRun] = useState<AnnotationRun | null>(null);
  const [appliedOnly, setAppliedOnly] = useState(false);
  // Rule-name search: the box is typed into; Search (or Enter) applies it.
  const [nameInput, setNameInput] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  /** Suggestions the PM rejected in this session: hidden from the suggested list; the rule itself is unchanged. */
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const docRules = useMemo(() => rulesForDocument(rules, docId), [rules, docId]);
  const rows = useMemo(() => {
    const kept = suggestions && !showAll ? docRules.filter((r) => !rejected.has(r.ruleKey) || r.applied) : docRules;
    const visible = visibleRules(kept, suggestions, showAll).filter((r) => !appliedOnly || r.applied);
    return forApplication(byMarking(byName(visible, nameQuery), markingFilter), { applicationType: appType, governingState: govState.trim() });
  }, [docRules, suggestions, showAll, markingFilter, appType, govState, appliedOnly, rejected, nameQuery]);
  const appTypes = useMemo(() => applicationTypeOptions(rules), [rules]);
  // D24: 10 rules per page (?rulesPage=); a new document, prompt or filter returns to page 1.
  const paged = usePagedRows(rows, { param: 'rulesPage', resetKey: [docId, ranPrompt, showAll, markingFilter, appType, govState.trim(), appliedOnly, nameQuery].join('|') });
  const filtering = !!appType || !!govState.trim();

  // The AI annotation run for the chosen document: polled while it runs, then the rules reload.
  useEffect(() => {
    if (!docId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/policy/annotation-suggestions?documentId=${docId}`, { cache: 'no-store' }).catch(() => null);
      if (stop || !res?.ok) return;
      const r = (await res.json()) as AnnotationRun;
      setAnnotationRun((prev) => {
        if (prev?.status === 'running' && r.status !== 'running') router.refresh();
        return r;
      });
      if (r.status === 'running') timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [docId, projectId, router, annotationRun?.status === 'running']);

  async function suggestAnnotations() {
    if (!docId) return;
    setMsg(null);
    const r = await mutate<AnnotationRun>('POST', `/projects/${projectId}/policy/annotation-suggestions`, { documentId: docId });
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not ask for annotation suggestions.' });
    setAnnotationRun({ status: 'running' });
  }

  async function saveAnnotation(r: RulesTableRule, annotation: RuleAnnotationInput, basedOnRevisionId: string | null, done: string) {
    setMsg(null);
    setRowStage((x) => ({ ...x, [r.ruleId]: 'Saving…' }));
    const out = await mutate<{ applied: boolean; version: number }>('PUT', `/projects/${projectId}/policy/rules/${r.ruleId}/annotation`, { expectedContentHash: r.contentHash, annotation, basedOnRevisionId });
    setRowStage((x) => {
      const { [r.ruleId]: _, ...rest } = x;
      return rest;
    });
    if (!out.ok) return setMsg({ kind: 'error', text: `${r.ruleKey}: ${out.error ?? 'Could not save the annotation.'}` });
    setMsg({ kind: 'ok', text: `${r.ruleKey}: ${done}${r.applied ? ' The rule was applied, so this is a new draft version: tick Apply to project again when it is right.' : ''}` });
    router.refresh();
  }
  const suggestedCount = suggestions ? docRules.filter((r) => suggestions.get(r.ruleKey)?.match).length : 0;

  const run = useCallback(
    async (text: string, documentId: string) => {
      const id = ++runId.current;
      setBusy('Asking the assistant which rules match…');
      setMsg(null);
      const r = await mutate<{ model: string; items: Suggestion[] }>('POST', `/projects/${projectId}/policy/rule-suggestions`, { documentId, prompt: text });
      if (id !== runId.current) return;
      setBusy(null);
      if (!r.ok) {
        setSuggestions(null);
        return setMsg({ kind: 'error', text: r.error ?? 'The assistant could not suggest rules. All rules are shown.' });
      }
      setSuggestions(new Map(r.data!.items.map((i) => [i.ruleKey, i])));
      setModel(r.data!.model);
      setRanPrompt(text);
    },
    [projectId],
  );

  // PR-M02: changing the document re-runs the same prompt against that document's rules.
  useEffect(() => {
    if (ranPrompt && docId) void run(ranPrompt, docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  function clearPrompt() {
    runId.current++;
    setPrompt('');
    setRanPrompt(null);
    setSuggestions(null);
    setBusy(null);
  }

  async function toggle(r: RulesTableRule, applied: boolean, acceptUnverifiedEvidence = false, target?: ApplyTarget) {
    setMsg(null);
    setConfirm(null);
    const t = target ?? { ruleId: r.ruleId, contentHash: r.contentHash, definitionProblems: r.definitionProblems, evidenceProblems: r.evidenceProblems };
    const out = await setRuleApplied(projectId, t, applied, { acceptUnverifiedEvidence, onStage: (s) => setRowStage((x) => ({ ...x, [r.ruleId]: s })) });
    setRowStage((x) => {
      const { [r.ruleId]: _, ...rest } = x;
      return rest;
    });
    if (out.kind === 'confirm') {
      router.refresh();
      return setConfirm({ target: out.target, problems: out.problems, title: r.title });
    }
    if (out.kind === 'error') return setMsg({ kind: 'error', text: `${r.ruleKey}: ${out.text}` });
    setMsg({ kind: 'ok', text: out.applied ? `${r.ruleKey} applied to the project${out.warnings.length ? ` (noted: ${out.warnings.join(' ')})` : ''}.` : `${r.ruleKey} is no longer applied.` });
    router.refresh();
  }

  async function applyAllSuggested() {
    const todo = rows.filter((r) => suggestions?.get(r.ruleKey)?.match && !r.applied && !rejected.has(r.ruleKey));
    let done = 0;
    const skipped: string[] = [];
    for (const r of todo) {
      setBusy(`Applying ${done + 1} of ${todo.length}…`);
      const out = await setRuleApplied(projectId, { ruleId: r.ruleId, contentHash: r.contentHash, definitionProblems: r.definitionProblems, evidenceProblems: r.evidenceProblems }, true);
      if (out.kind === 'done') done++;
      else skipped.push(out.kind === 'confirm' ? `${r.ruleKey} (evidence not verified: tick it on its own to confirm)` : `${r.ruleKey} (${out.text})`);
    }
    setBusy(null);
    setMsg({ kind: skipped.length ? 'error' : 'ok', text: `Applied ${done} of ${todo.length} suggested rules.${skipped.length ? ` Not applied: ${skipped.join('; ')}.` : ''}` });
    router.refresh();
  }

  if (documents.length === 0) return <p className="mt-2 text-sm text-fg-muted">Add a policy document first; its extracted rules appear here.</p>;

  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,20rem)_1fr]">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Policy document</span>
          <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={docId ?? ''} onChange={(e) => setDocId(e.target.value)}>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim() && docId) void run(prompt.trim(), docId);
            else clearPrompt();
          }}
        >
          <label htmlFor="rule-prompt" className="font-medium">
            Which rules does this template need?
          </label>
          <textarea id="rule-prompt" className="min-h-16 rounded-md border border-line bg-surface px-2 py-1 text-fg" value={prompt} placeholder={PLACEHOLDER} onChange={(e) => setPrompt(e.target.value)} aria-describedby="rule-prompt-hint" />
          <span className="text-xs">
            Example:{' '}
            <button type="button" className="text-link underline" onClick={() => setPrompt(EXAMPLE)}>
              Use this example
            </button>{' '}
            <span className="text-fg-muted">— “{EXAMPLE}”</span>
          </span>
          <span id="rule-prompt-hint" className="text-xs text-fg-muted">
            Leave empty to see every rule. The assistant only suggests; you decide by accepting (ticking Apply to project).
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary disabled:opacity-50" disabled={!!busy || !prompt.trim()}>
              Suggest rules
            </button>
            {!prompt.trim() && <span className="self-center text-xs text-warning">Type what the template needs</span>}
            {ranPrompt && (
              <button type="button" className="btn btn-secondary" onClick={clearPrompt}>
                Clear and show all
              </button>
            )}
          </div>
        </form>
      </div>

      {busy && (
        <p role="status" aria-live="polite" className="text-fg-muted">
          {busy}
        </p>
      )}
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'text-error' : 'text-success'}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-fg-muted">
        <span>
          {suggestions ? `${suggestedCount} of ${docRules.length} rules suggested by the assistant (${model}) for: “${ranPrompt}”.` : `${docRules.length} rule${docRules.length === 1 ? '' : 's'} from this document.`} {docRules.filter((r) => r.applied).length} applied.
        </span>
        {suggestions && (
          <>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all rules (suggested first)
            </label>
            {suggestedCount > 0 && (
              <button type="button" className="btn btn-secondary disabled:opacity-50" disabled={!!busy} onClick={applyAllSuggested}>
                Accept all suggested
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border border-line p-2">
        <form
          role="search"
          className="flex w-full flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNameQuery(nameInput.trim());
          }}
        >
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="font-medium">Search rule name</span>
            <input type="search" className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={nameInput} placeholder="e.g. beneficial owner" maxLength={200} onChange={(e) => setNameInput(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
          {nameQuery && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setNameInput('');
                setNameQuery('');
              }}
            >
              Clear
            </button>
          )}
          {nameQuery && (
            <span className="self-center text-sm text-fg-muted" role="status">
              {rows.length} rule{rows.length === 1 ? '' : 's'} match “{nameQuery}”
            </span>
          )}
        </form>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Mandatory marking</span>
          <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={markingFilter} onChange={(e) => setMarkingFilter(e.target.value as MarkingFilter)}>
            {MARKING_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Show rules for application type</span>
          <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={appType} onChange={(e) => setAppType(e.target.value)}>
            <option value="">Any type</option>
            {appTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Governing state</span>
          <input className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-fg" value={govState} placeholder="e.g. CA" maxLength={8} onChange={(e) => setGovState(e.target.value)} />
        </label>
        <label className="inline-flex items-center gap-1 self-end pb-1">
          <input type="checkbox" checked={appliedOnly} onChange={(e) => setAppliedOnly(e.target.checked)} /> Applied only
        </label>
        <div className="flex flex-col gap-1">
          <button type="button" className="btn btn-secondary disabled:opacity-50" disabled={!docId || annotationRun?.status === 'running'} onClick={suggestAnnotations}>
            Suggest annotations with AI
          </button>
        </div>
        <p className="basis-full text-xs text-fg-muted">
          {filtering ? 'Rules are matched on their own scope and the application’s attributes only; the project name and example states never exclude a rule. Out-of-scope rules are hidden; unknown applicability stays visible. ' : ''}
          {annotationRun?.status === 'running' && 'The assistant is suggesting annotations for this document… '}
          {annotationRun?.status === 'done' && `Last AI suggestion run (${annotationRun.model ?? 'assistant'}): ${annotationRun.annotated ?? 0} annotated, ${annotationRun.offered ?? 0} offered next to an existing annotation. `}
          {annotationRun?.status === 'failed' && `The last AI suggestion run failed: ${annotationRun.error ?? 'try again'}. `}
          {annotationRun?.status === 'skipped' && 'The last AI suggestion run was skipped: today’s assistant limit was reached. '}
          AI annotations are suggestions; your edit and your Apply tick are the decision.
        </p>
      </div>

      {confirm && (
        <div role="alertdialog" aria-labelledby="confirm-h" className="rounded border border-warning/40 bg-warning/10 p-3">
          <p id="confirm-h" className="font-medium">
            The evidence for “{confirm.title}” was not found word for word in the document.
          </p>
          <ul className="list-disc pl-5 text-xs">
            {confirm.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const r = rules.find((x) => x.ruleId === confirm.target.ruleId);
                if (r) void toggle(r, true, true, confirm.target);
              }}
            >
              I checked the source — apply
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-fg-muted">{nameQuery ? `No rules match “${nameQuery}”. Clear the search to see every rule.` : suggestions ? 'The assistant suggested no rules from this document. Tick “Show all rules” to choose by hand.' : 'No rules from this document yet. Extract candidates first.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Rules from the selected policy document</caption>
            <thead className="text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-1 pr-3">
                  Rule name
                </th>
                <th scope="col" className="pr-3">
                  Evidence
                </th>
                <th scope="col" className="pr-3">
                  Mandatory marking
                </th>
                <th scope="col" className="pr-3">
                  Applies when
                </th>
                <th scope="col" className="pr-3">
                  Why
                </th>
                <th scope="col">Apply to project</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((r) => {
                const s = suggestions?.get(r.ruleKey);
                const steps = applySteps(r);
                const stage = rowStage[r.ruleId];
                return (
                  <tr key={r.ruleId} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/projects/${projectId}/policy/rules/${r.ruleId}`} className="font-medium text-link hover:underline">
                        {r.title}
                      </Link>
                      <span className="block font-mono text-xs text-fg-muted">
                        {r.ruleKey} v{r.version} · {STATE_LABEL[r.state]}
                      </span>
                      {s?.match && (
                        <span className="mt-1 block text-xs">
                          <span className="rounded bg-link/10 px-1 text-link">Suggested</span> {s.reason}
                        </span>
                      )}
                      {!r.applied && steps.define && <span className="mt-1 block text-xs text-fg-muted">Some fields are missing; ticking defines them with AI first.</span>}
                      {filtering && <span className="mt-1 block text-xs text-fg-muted">For this application: {OUTCOME_LABEL[r.outcome]}</span>}
                    </td>
                    <td className="max-w-md pr-3 text-xs">
                      {r.evidence ? (
                        <>
                          <q>{r.evidence.quote}</q>
                          <span className="block text-fg-muted">
                            {r.evidence.document} v{r.evidence.documentVersion}
                          </span>
                          {r.evidence.resolution !== 'RESOLVED' && <span className="block text-warning">⚠ Quote not found in the document — check it before applying.</span>}
                        </>
                      ) : (
                        <span className="text-warning">⚠ No source quote.</span>
                      )}
                    </td>
                    <td className="pr-3 text-xs">
                      <select
                        aria-label={`Mandatory marking for ${r.title}`}
                        className="rounded-md border border-line bg-surface px-1 py-0.5 text-fg"
                        value={r.annotation?.marking ?? ''}
                        disabled={!!stage || !!busy}
                        onChange={(e) => e.target.value && void saveAnnotation(r, withMarking(r.annotation, e.target.value as MandatoryMarking), null, `marked ${MARKING_LABEL[e.target.value as MandatoryMarking]}.`)}
                      >
                        {!r.annotation && <option value="">Not annotated</option>}
                        {MANDATORY_MARKINGS.map((m) => (
                          <option key={m} value={m}>
                            {MARKING_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-fg-muted">{sourceLabel(r)}</span>
                      {r.pendingAiSuggestion && (
                        <button type="button" className="mt-1 block text-link underline disabled:opacity-50" disabled={!!stage || !!busy} onClick={() => void saveAnnotation(r, r.pendingAiSuggestion!.annotation, r.pendingAiSuggestion!.id, 'AI suggestion used.')}>
                          Use AI suggestion ({MARKING_LABEL[r.pendingAiSuggestion.annotation.marking]})
                        </button>
                      )}
                      {(r.flags ?? []).filter((f) => f.code !== 'NOT_ANNOTATED').length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-warning" aria-label={`Flags for ${r.title}`}>
                          {(r.flags ?? [])
                            .filter((f) => f.code !== 'NOT_ANNOTATED')
                            .map((f, i) => (
                              <li key={i}>⚠ {f.message}</li>
                            ))}
                        </ul>
                      )}
                    </td>
                    <td className="max-w-xs pr-3 text-xs">{r.annotation ? (r.annotation.appliesWhen ?? <span className="text-warning">Unknown</span>) : <span className="text-fg-muted">—</span>}</td>
                    <td className="max-w-xs pr-3 text-xs">{r.annotation ? (r.annotation.why ?? <span className="text-warning">Not given</span>) : <span className="text-fg-muted">—</span>}</td>
                    <td>
                      {s?.match && !r.applied && !rejected.has(r.ruleKey) && (
                        <div className="mb-1 flex flex-col gap-1">
                          <button type="button" className="btn btn-primary px-2 py-1 text-xs disabled:opacity-50" disabled={!!stage || !!busy} onClick={() => void toggle(r, true)}>
                            {steps.define ? 'Define with AI, then accept' : 'Accept'}
                          </button>
                          <button type="button" className="btn btn-secondary px-2 py-1 text-xs" onClick={() => setRejected((x) => new Set(x).add(r.ruleKey))} aria-label={`Reject the suggestion ${r.title}`}>
                            Reject
                          </button>
                        </div>
                      )}
                      {s?.match && rejected.has(r.ruleKey) && !r.applied && (
                        <span className="mb-1 block text-xs text-fg-muted">
                          Rejected · not applied{' '}
                          <button type="button" className="text-link underline" onClick={() => setRejected((x) => new Set([...x].filter((k) => k !== r.ruleKey)))}>
                            Undo
                          </button>
                        </span>
                      )}
                      <label className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={r.applied} disabled={!!stage || !!busy} onChange={(e) => void toggle(r, e.target.checked)} aria-label={`Apply ${r.title} to the project`} />
                        <span className="sr-only">{r.applied ? 'Applied' : 'Not applied'}</span>
                      </label>
                      {stage && <span className="block text-xs text-fg-muted">{stage}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ClientPager paged={paged} noun="rules" singular="rule" />
        </div>
      )}
    </div>
  );
}
