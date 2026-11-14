'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { setRuleApplied, type ApplyTarget } from './apply-rule';
import { applySteps, rulesForDocument, STATE_LABEL, visibleRules, type Suggestion, type TableRule } from './rules-table-logic';

export interface RulesTableRule extends TableRule {
  versionId: string;
  version: number;
  contentHash: string;
  requirement: string;
  evidence: { quote: string; resolution: string; document: string; documentVersion: number } | null;
}

const EXAMPLE = 'This template is for KYC for single, joint and minor accounts. Select all the rules that are mandatory for these tasks, including edge cases and special cases.';

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

  const docRules = useMemo(() => rulesForDocument(rules, docId), [rules, docId]);
  const rows = useMemo(() => visibleRules(docRules, suggestions, showAll), [docRules, suggestions, showAll]);
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
    const todo = rows.filter((r) => suggestions?.get(r.ruleKey)?.match && !r.applied);
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
          <textarea id="rule-prompt" className="min-h-16 rounded-md border border-line bg-surface px-2 py-1 text-fg" value={prompt} placeholder={EXAMPLE} onChange={(e) => setPrompt(e.target.value)} aria-describedby="rule-prompt-hint" />
          <span id="rule-prompt-hint" className="text-xs text-fg-muted">
            Leave empty to see every rule. The assistant only suggests; you decide by ticking Apply to project.
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary disabled:opacity-50" disabled={!!busy || !prompt.trim()}>
              Suggest rules
            </button>
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
                Apply all suggested
              </button>
            )}
          </>
        )}
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
        <p className="text-fg-muted">{suggestions ? 'The assistant suggested no rules from this document. Tick “Show all rules” to choose by hand.' : 'No rules from this document yet. Extract candidates first.'}</p>
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
                  Required
                </th>
                <th scope="col">Apply to project</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
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
                    <td className="pr-3">{r.required ? 'Yes' : 'No'}</td>
                    <td>
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
        </div>
      )}
    </div>
  );
}
