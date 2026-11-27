'use client';

import { usePagedRows } from '@praxis/shared/ui/use-page';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClientPager } from '@/components/pager';
import { mutate } from '@/lib/client-api';
import { AnswerBox } from './answer-box';
import { fixItems, splitQuestions } from './fix-logic';
import { FixHint, FixList, NextProblemBar } from './fix-nav';
import { LibraryDetailsEditor } from './library-details';
import { locatorText } from './locator';
import type { RuleDetailData } from './rule-detail';
import { canExclude, canRestore, inForceText, LIBRARY_STATE, quoteGroups } from './rule-library-logic';
import { QUOTE_FOR, quoteKey, RuleReview } from './rule-review';

const RESOLUTION: Record<string, string> = { RESOLVED: 'Quote found word for word in the document', QUOTE_MISMATCH: 'Quote NOT found in the document: check it', UNRESOLVED: 'Not linked to a place in the document' };
const ORIGIN: Record<string, string> = { extraction: 'Extracted', manual: 'Added by hand', edit: 'Edited', unapplied: 'New draft', reapplied: 'Re-applied', restored: 'Brought back for review', seed: 'Seed fixture' };
const day = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 10) : '—');

/**
 * D-094: the rule page of a KYC Judgment (policy-library) project. Only what the policy library (C1) and the run use,
 * top to bottom: status and the one next action (with Exclude or Bring back), the requirement beside its source quotes,
 * when it applies and the facts it uses, the library details, the in-force date, a fact it defines, exceptions, the
 * version history, and an editor for the text and quotes. The annotation, its history, the older definition fields and
 * "Define with AI" are not shown here (their data is kept). Approval stays in the review queue.
 */
export function LibraryRuleDetail({ projectId, d }: { projectId: string; d: RuleDetailData }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const historyPaged = usePagedRows(d.history, { param: 'historyPage' });
  const b = d.body;
  const lib = d.library;
  const quotes = quoteGroups(d.citations);
  const queue = `/projects/${projectId}/policy#review-queue`;
  // Owner, 27 Nov 2026: every open problem as a "To fix" link to its field, with a hint at the field (presentation only).
  const draft = !d.applied && d.state !== 'EXCLUDED';
  // Field links on unless switched off; the AI answer only when switched on (RULE_FIELD_LINKS_ENABLED, AI_ANSWER_ENABLED).
  const aids = d.aids ?? { fieldLinks: true, aiAnswer: false, aiPaused: false };
  const fixes = draft && aids.fieldLinks ? fixItems(d) : [];
  const answerBox = (question: string) => <AnswerBox projectId={projectId} ruleId={d.ruleId} contentHash={d.contentHash} question={question} answers={d.answers ?? []} aids={aids} />;

  async function act(kind: 'exclude' | 'restore') {
    setPending(true);
    setMsg(null);
    const r = kind === 'exclude' ? await mutate('POST', `/projects/${projectId}/policy/rule-versions/${d.versionId}/exclude`, { expectedContentHash: d.contentHash, reason }) : await mutate('POST', `/projects/${projectId}/policy/rules/${d.ruleId}/restore`, { expectedContentHash: d.contentHash, reason });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not save.' });
    setReason('');
    setMsg({ kind: 'ok', text: kind === 'exclude' ? 'Excluded. It leaves the review queue and the library; you can bring it back.' : 'Brought back as a new draft. It is in the review queue again.' });
    router.refresh();
  }

  const quoteItem = (c: RuleDetailData['citations'][number]) => (
    <li key={c.id} className="rounded bg-bg p-3">
      <blockquote className="border-l-2 border-line pl-2">{c.quote}</blockquote>
      <p className="mt-1 text-xs text-fg-muted">
        {QUOTE_FOR[quoteKey(c.fieldPath)] ?? c.fieldPath} · {c.document} v{c.documentVersion} · {locatorText(c.locator)} ·{' '}
        <a className="text-link hover:underline" href={`/api/v1/projects/${projectId}/policy/document-versions/${c.documentVersionId}/file`}>
          open document
        </a>
      </p>
      <p className={`text-xs ${c.resolution === 'RESOLVED' ? 'text-success' : 'text-warning'}`}>
        {c.resolution === 'RESOLVED' ? '✓ ' : '⚠ '}
        {RESOLUTION[c.resolution] ?? c.resolution}
      </p>
    </li>
  );

  return (
    <div className="mt-4 space-y-6 text-sm" data-library-rule>
      <section aria-labelledby="status-h" className="card p-4">
        <h2 id="status-h" className="font-semibold">
          Status
        </h2>
        <p className="mt-1">
          <span className={`rounded px-2 py-0.5 ${d.applied ? 'bg-success/15 text-success' : d.state === 'EXCLUDED' ? 'bg-bg text-fg-muted' : 'bg-warning/15 text-warning'}`}>{LIBRARY_STATE[d.state] ?? d.state}</span>{' '}
          <span className="text-fg-muted">Version {d.version}</span>
        </p>
        <div className="mt-2" data-queue-status id="fix-status" tabIndex={-1}>
          {d.applied ? (
            <p>Approved in the review queue{d.reviewedAt ? ` on ${day(d.reviewedAt)}` : ''}. Editing it makes a new draft that goes back to the queue.</p>
          ) : d.state === 'EXCLUDED' ? (
            <p>Excluded{d.excludeReason ? `: ${d.excludeReason}` : ''}. It is not in the review queue or the policy library.</p>
          ) : d.nextAction?.code === 'ready' ? (
            <p className="text-success">
              Ready to confirm.{' '}
              <a className="text-link hover:underline" href={queue}>
                Confirm it in the review queue
              </a>
              .
            </p>
          ) : (
            <>
              <p>
                Next action: <strong>{d.nextAction?.label ?? 'Review this rule'}</strong>. When nothing is left, the rule reads “Ready to confirm” and you approve it in the{' '}
                <a className="text-link hover:underline" href={queue}>
                  review queue
                </a>
                .
              </p>
              <div data-focus="question" tabIndex={-1}>
                {aids.fieldLinks ? (
                  <FixList fixes={fixes} under={(f) => (f.question ? answerBox(f.question) : null)} />
                ) : (
                  // Field links switched off: the server's messages as before, each open question with its answer box.
                  <ul className="mt-1 list-disc pl-5 text-xs text-warning" aria-label="Still to do">
                    {(d.queueFlags ?? []).map((f) => (
                      <li key={f.code}>
                        {f.message}
                        {(f.code === 'open_question' ? splitQuestions(f.message) : f.code === 'needs_review' || f.code === 'outside_scope' ? [f.message] : []).map((q) => (
                          <div key={q} className="text-fg">
                            {answerBox(q)}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {aids.fieldLinks && <FixHint fixes={fixes} field="status" />}
            </>
          )}
        </div>
        {(canExclude(d.state) || canRestore(d.state)) && (
          <div className="mt-3 flex flex-wrap items-end gap-2" data-focus="exclude" tabIndex={-1}>
            <label className="flex flex-col gap-0.5">
              <span className="font-medium">{canExclude(d.state) ? 'Reason to exclude (for example: duplicate of another rule, or not part of this library)' : 'Why it comes back for review'}</span>
              <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="button" className="btn btn-secondary disabled:opacity-50" disabled={!reason.trim() || pending} onClick={() => void act(canExclude(d.state) ? 'exclude' : 'restore')}>
              {canExclude(d.state) ? 'Exclude' : 'Bring back for review'}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-fg-muted">Your confirm in the review queue is the approval. AI suggestions never approve a rule. Excluding keeps the rule and its history; you can bring it back.</p>
        {msg && (
          <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${msg.kind === 'error' ? 'text-error' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
      </section>

      {(d.answers ?? []).length > 0 && (
        // Every answer stays on the rule, exactly as typed, with what was proposed and accepted, after its question closes.
        <details className="card p-4" data-answer-history open={!fixes.some((f) => f.question)}>
          <summary className="cursor-pointer font-semibold">Answers on this rule ({d.answers!.length})</summary>
          {[...new Set(d.answers!.map((a) => a.question))].map((q) => (
            <div key={q} className="mt-3">
              <p className="text-xs font-medium">Question: {q}</p>
              <AnswerBox projectId={projectId} ruleId={d.ruleId} contentHash={d.contentHash} question={q} answers={d.answers!} aids={aids} readOnly />
            </div>
          ))}
        </details>
      )}

      <section aria-labelledby="req-h" className="card p-4">
        <h2 id="req-h" className="font-semibold">
          Requirement and source
        </h2>
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-fg-muted">The rule says</p>
            <p className="mt-1 text-base" data-focus="definition" tabIndex={-1}>
              {b.requirement || <span className="text-warning">No requirement text yet.</span>}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-fg-muted">The source says</p>
            {quotes.requirement.length ? <ul className="mt-1 space-y-2">{quotes.requirement.map(quoteItem)}</ul> : <p className="mt-1 text-warning">No quote backs the requirement yet.</p>}
          </div>
        </div>
        {quotes.other.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium text-fg-muted">Other quotes</p>
            <ul className="mt-1 space-y-2">{quotes.other.map(quoteItem)}</ul>
          </>
        )}
      </section>

      <section aria-labelledby="when-h" className="card p-4" data-focus="condition" tabIndex={-1}>
        <h2 id="when-h" className="font-semibold">
          When it applies
        </h2>
        <p className="mt-1">{lib?.conditionSet ? lib.conditionText : <span className="text-warning">Not set yet. Set it in Library details below, or let the AI suggest one from the Policy page.</span>}</p>
        {lib && lib.conditionFacts.length > 0 && (
          <p className="mt-1 text-xs text-fg-muted">
            Facts it uses: {lib.conditionFacts.map((f) => <span key={f} className="mr-1 rounded bg-bg px-1.5 font-mono">{f}</span>)}
          </p>
        )}
        <p className="mt-2" data-focus="effective" tabIndex={-1}>
          {inForceText(lib?.inForce ?? null)}
        </p>
        {b.library?.defines && (
          <p className="mt-2">
            This rule defines the fact <span className="font-mono">{b.library.defines.id}</span>
            {b.library.defines.description ? `: ${b.library.defines.description}` : ''}. Other rules can use it once this rule is approved.
          </p>
        )}
        {b.exceptions.kind === 'listed' && b.exceptions.items.length > 0 && (
          <div className="mt-2">
            <p className="font-medium">Exceptions</p>
            <ul className="list-disc pl-5">
              {b.exceptions.items.map((x) => (
                <li key={x.statement}>{x.statement}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Re-keyed by the content hash, so the form shows the saved values after any edit (an accepted answer included). */}
      <LibraryDetailsEditor key={d.contentHash} projectId={projectId} ruleId={d.ruleId} contentHash={d.contentHash} body={b} approved={d.applied} fixes={fixes} />

      <section aria-labelledby="hist-h" className="card p-4">
        <h2 id="hist-h" className="font-semibold">
          Version history
        </h2>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs text-fg-muted">
            <tr>
              <th scope="col" className="py-1">
                Version
              </th>
              <th scope="col">State</th>
              <th scope="col">How</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {historyPaged.items.map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-1">v{h.version}</td>
                <td>{LIBRARY_STATE[h.state] ?? h.state}</td>
                <td>{(h.origin && ORIGIN[h.origin]) ?? h.origin ?? '—'}</td>
                <td>{day(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ClientPager paged={historyPaged} noun="versions" singular="version" />
      </section>

      {d.state !== 'EXCLUDED' && (
        <details className="card p-4" data-focus="quote" data-edit-form>
          <summary className="cursor-pointer font-semibold">Edit the text, the in-force date and the quotes</summary>
          <p className="mt-1 text-xs text-fg-muted">{d.applied ? 'This rule is approved; saving an edit creates a new draft that goes back to the review queue.' : 'Save your changes; the review queue then shows what is left, or “Ready to confirm”. To back the condition with the source, add a quote that supports “When it applies”.'}</p>
          <div className="mt-3">
            <RuleReview key={d.versionId} projectId={projectId} versionId={d.versionId} editOnly library fixes={fixes} />
          </div>
        </details>
      )}
      {draft && d.nextAction && aids.fieldLinks && <NextProblemBar fixes={fixes} queueHref={queue} />}
    </div>
  );
}
