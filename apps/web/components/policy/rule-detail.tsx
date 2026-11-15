'use client';

import { ACTOR_LABEL, CLASSIFICATION_LABEL, MARKING_LABEL, annotationText, type AnnotationFlag, type PolicyRuleBody, type RuleAnnotation, type ScopeList } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { setRuleApplied, type ApplyTarget } from './apply-rule';
import { locatorText } from './locator';
import { RuleReview } from './rule-review';
import { AnnotationEditor } from './annotation-editor';
import { sourceLabel, type AnnotationSource, type PendingSuggestion } from './annotation-logic';

export interface AnnotationRevision {
  id: string;
  annotationVersion: number;
  source: 'AI_SUGGESTION' | 'AUTHOR_EDIT';
  adopted: boolean;
  model: string | null;
  editedRole: string | null;
  createdAt: string;
  ruleVersionId: string;
  annotation: RuleAnnotation;
}

export interface RuleDetailData {
  ruleId: string;
  ruleKey: string;
  required: boolean;
  versionId: string;
  version: number;
  state: 'DRAFT' | 'NEEDS_DEFINITION' | 'REVIEWED' | 'EXCLUDED';
  applied: boolean;
  contentHash: string;
  body: PolicyRuleBody;
  excludeReason: string | null;
  reviewedAt: string | null;
  origin: string;
  createdAt?: string;
  updatedAt?: string;
  definitionProblems: string[];
  evidenceProblems: string[];
  citations: Array<{ id: string; fieldPath: string; role: string; quote: string; locator: { page?: number | null; lineStart?: number | null; lineEnd?: number | null; section?: string | null }; resolution: string; documentVersionId: string; document: string; documentVersion: number; sha256: string }>;
  history: Array<{ id: string; version: number; state: string; origin?: string; reviewedAt: string | null; createdAt: string }>;
  annotation?: RuleAnnotation | null;
  annotationSource?: AnnotationSource | null;
  pendingAiSuggestion?: PendingSuggestion | null;
  flags?: AnnotationFlag[];
  linkedFrom?: Array<{ ruleKey: string; relation: string }>;
  annotationHistory?: AnnotationRevision[];
  applicationTypeOptions?: string[];
  projectRuleKeys?: string[];
}

const scope = (s: ScopeList) => (s.kind === 'all' ? 'All' : s.kind === 'listed' ? s.items.join(', ') || 'None listed' : 'Unknown');
const unknown = <span className="text-warning">Unknown</span>;

/** The current annotation, read-only (Mandatory marking, Applies when, Why first: spec §4). */
function AnnotationView({ a }: { a: RuleAnnotation }) {
  return (
    <dl className="mt-2">
      <Field label="Mandatory marking">
        <strong>{MARKING_LABEL[a.marking]}</strong>
      </Field>
      <Field label="Applies when">{a.appliesWhen ?? unknown}</Field>
      <Field label="Why">{a.why ?? unknown}</Field>
      <Field label="Classification">{CLASSIFICATION_LABEL[a.classification]}</Field>
      <Field label="Responsible actor">
        {a.responsibleActor === 'unknown' ? unknown : ACTOR_LABEL[a.responsibleActor]}
        {a.actorNote && ` — ${a.actorNote}`}
      </Field>
      <Field label="Application types">{scope(a.applicationTypes)}</Field>
      <Field label="Jurisdictions">{scope(a.jurisdictions)}</Field>
      <Field label="Workflow stage">{a.workflowStage ?? unknown}</Field>
      <Field label="Deadline">{a.deadline.kind === 'stated' ? `${a.deadline.text ?? 'Stated'}${a.deadline.measuredFrom ? `, measured from ${a.deadline.measuredFrom}` : ''}` : a.deadline.kind === 'none' ? 'None' : unknown}</Field>
      <Field label="Evidence">
        {a.evidence.status === 'stated' ? 'Stated by the policy' : a.evidence.status === 'partly_stated' ? 'Partly stated' : unknown}
        {a.evidence.missing.length > 0 && ` — missing: ${a.evidence.missing.join('; ')}`}
      </Field>
      <Field label="Linked rules" empty={a.links.length === 0}>
        <List items={a.links.map((l) => `${l.relation.replace(/_/g, ' ')} ${l.ruleKey}`)} />
      </Field>
      {a.compound && (
        <Field label="Compound statement">
          <span className="text-fg-muted">
            {a.compound.role} in group {a.compound.groupKey}:
          </span>
          <blockquote className="mt-1 border-l-2 border-line pl-2">{a.compound.originalStatement}</blockquote>
        </Field>
      )}
      <Field label="Open questions" empty={a.openQuestions.length === 0}>
        <List items={a.openQuestions} />
      </Field>
    </dl>
  );
}

const TYPE: Record<PolicyRuleBody['requirementType'], string> = { obligation: 'Obligation (must)', prohibition: 'Prohibition (must not)', permission: 'Permission (may)', definition: 'Definition', unknown: 'Not determined' };
const STATE: Record<RuleDetailData['state'], string> = { DRAFT: 'Draft — not applied', NEEDS_DEFINITION: 'Needs definition — not applied', REVIEWED: 'Applied to the project (reviewed)', EXCLUDED: 'Excluded' };
const ORIGIN: Record<string, string> = { extraction: 'Extracted', manual: 'Added by hand', edit: 'Edited', unapplied: 'Unticked (new draft)', reapplied: 'Re-applied', seed: 'Seed fixture' };
const RESOLUTION: Record<string, string> = { RESOLVED: 'Quote found in this version', QUOTE_MISMATCH: 'Quote NOT found in this version — check it', UNRESOLVED: 'Not linked to a location' };
const day = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 10) : '—');

function Field({ label, children, empty }: { label: string; children?: React.ReactNode; empty?: boolean }) {
  return (
    <div className="grid gap-1 border-t border-line py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="font-medium text-fg-muted">{label}</dt>
      <dd>{empty ? <span className="text-fg-muted">Not stated</span> : children}</dd>
    </div>
  );
}
const List = ({ items }: { items: string[] }) => (
  <ul className="flex flex-wrap gap-1">
    {items.map((x) => (
      <li key={x} className="rounded bg-bg px-1.5">
        {x}
      </li>
    ))}
  </ul>
);

/** The rule page (PRD PR-M07): every field, formatted; evidence; history; Apply to project and Define with AI. */
export function RuleDetail({ projectId, d }: { projectId: string; d: RuleDetailData }) {
  const router = useRouter();
  const [stage, setStage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ target: ApplyTarget; problems: string[] } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const b = d.body;
  const a = b.applicability;
  const target: ApplyTarget = { ruleId: d.ruleId, contentHash: d.contentHash, definitionProblems: d.definitionProblems, evidenceProblems: d.evidenceProblems };

  async function apply(applied: boolean, accept = false, t: ApplyTarget = target) {
    setMsg(null);
    setConfirm(null);
    const out = await setRuleApplied(projectId, t, applied, { acceptUnverifiedEvidence: accept, onStage: setStage });
    setStage(null);
    router.refresh();
    if (out.kind === 'confirm') return setConfirm({ target: out.target, problems: out.problems });
    if (out.kind === 'error') return setMsg({ kind: 'error', text: out.text });
    setMsg({ kind: 'ok', text: out.applied ? 'Applied to the project.' : 'No longer applied. The reviewed version is kept in the history.' });
  }
  async function define() {
    setMsg(null);
    setStage('Defining with AI…');
    const r = await mutate<{ rejectedQuotes: number; definitionProblems: string[] }>('POST', `/projects/${projectId}/policy/rules/${d.ruleId}/define`, { expectedContentHash: d.contentHash });
    setStage(null);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not define this rule.' });
    setMsg({ kind: 'ok', text: `The assistant drafted the definition. Check it below, then tick Apply to project.${r.data!.rejectedQuotes ? ` ${r.data!.rejectedQuotes} quote(s) it proposed were not found in the document and were dropped.` : ''}${r.data!.definitionProblems.length ? ` Still missing: ${r.data!.definitionProblems.join(' ')}` : ''}` });
    router.refresh();
  }

  const scopeEmpty = !a.universal && a.actors.length + a.actions.length + a.entities.length + a.channels.length + a.locales.length + a.jurisdictions.length === 0 && !a.conditionText;
  return (
    <div className="mt-4 space-y-6 text-sm">
      <section aria-labelledby="status-h" className="card p-4">
        <h2 id="status-h" className="sr-only">
          Status
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <span className={`rounded px-2 py-0.5 ${d.applied ? 'bg-success/15 text-success' : d.state === 'EXCLUDED' ? 'bg-bg text-fg-muted' : 'bg-warning/15 text-warning'}`}>{STATE[d.state]}</span>
          <span>
            Mandatory marking: <strong>{d.annotation ? MARKING_LABEL[d.annotation.marking] : 'Not annotated'}</strong> <span className="text-xs text-fg-muted">({sourceLabel({ ruleKey: d.ruleKey, annotation: d.annotation, annotationSource: d.annotationSource })})</span>
          </span>
          <span className="text-fg-muted">
            Version {d.version} · {ORIGIN[d.origin] ?? d.origin}
            {d.reviewedAt && ` · applied ${day(d.reviewedAt)}`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 font-medium">
            <input type="checkbox" checked={d.applied} disabled={!!stage} onChange={(e) => void apply(e.target.checked)} /> Apply to project
          </label>
          {!d.applied && (
            <button type="button" className="btn btn-secondary disabled:opacity-50" disabled={!!stage} onClick={define}>
              Define with AI
            </button>
          )}
          {stage && (
            <span role="status" className="text-fg-muted">
              {stage}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-fg-muted">Your tick is the review; no further approval is needed. The assistant only drafts fields and never ticks a rule.</p>
        {d.excludeReason && <p className="mt-1 text-fg-muted">Excluded: {d.excludeReason}</p>}
        {confirm && (
          <div role="alertdialog" aria-labelledby="rd-confirm" className="mt-3 rounded border border-warning/40 bg-warning/10 p-3">
            <p id="rd-confirm" className="font-medium">
              The evidence was not found word for word in the document.
            </p>
            <ul className="list-disc pl-5 text-xs">
              {confirm.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void apply(true, true, confirm.target)}>
                I checked the source — apply
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {msg && (
          <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${msg.kind === 'error' ? 'text-error' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
        {!d.applied && (d.definitionProblems.length > 0 || d.evidenceProblems.length > 0) && (
          <ul className="mt-2 list-disc pl-5 text-xs text-warning" aria-label="Open points">
            {[...d.definitionProblems, ...d.evidenceProblems].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ann-h" className="card p-4">
        <h2 id="ann-h" className="font-semibold">
          Annotation
        </h2>
        <p className="text-xs text-fg-muted">
          {d.annotation ? `${sourceLabel({ ruleKey: d.ruleKey, annotation: d.annotation, annotationSource: d.annotationSource })}. ` : ''}AI annotations are suggestions; your edit and your Apply tick are the decision. Extraction is not approval or legal validation.
        </p>
        {(d.flags ?? []).length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-warning" aria-label="Flags">
            {(d.flags ?? []).map((f, i) => (
              <li key={i}>⚠ {f.message}</li>
            ))}
          </ul>
        )}
        {d.annotation ? <AnnotationView a={d.annotation} /> : <p className="mt-2 text-fg-muted">Not annotated yet. Use “Suggest annotations with AI” on the Rules page, or annotate it below.</p>}
        {(d.linkedFrom ?? []).length > 0 && (
          <p className="mt-2 text-xs text-fg-muted">
            Linked from: {(d.linkedFrom ?? []).map((l) => `${l.ruleKey} (${l.relation.replace(/_/g, ' ')})`).join(', ')}
          </p>
        )}
        {d.pendingAiSuggestion && (
          <div className="mt-3 rounded border border-link/30 bg-link/5 p-3">
            <p className="font-medium">
              AI suggestion v{d.pendingAiSuggestion.annotationVersion} ({d.pendingAiSuggestion.model ?? 'assistant'}), not used yet
            </p>
            <p className="text-xs">{annotationText(d.pendingAiSuggestion.annotation)}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-link">Review and use it</summary>
              <div className="mt-2">
                <AnnotationEditor key={`ai-${d.pendingAiSuggestion.id}`} projectId={projectId} ruleId={d.ruleId} contentHash={d.contentHash} applied={d.applied} annotation={d.pendingAiSuggestion.annotation} applicationTypeOptions={d.applicationTypeOptions ?? []} ruleKeys={(d.projectRuleKeys ?? []).filter((k) => k !== d.ruleKey)} basedOnRevisionId={d.pendingAiSuggestion.id} />
              </div>
            </details>
          </div>
        )}
        {d.state !== 'EXCLUDED' && (
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">Edit annotation</summary>
            <div className="mt-2">
              <AnnotationEditor key={`${d.versionId}-${d.annotation?.version ?? 0}`} projectId={projectId} ruleId={d.ruleId} contentHash={d.contentHash} applied={d.applied} annotation={d.annotation ?? null} applicationTypeOptions={d.applicationTypeOptions ?? []} ruleKeys={(d.projectRuleKeys ?? []).filter((k) => k !== d.ruleKey)} />
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="def-h" className="card p-4">
        <h2 id="def-h" className="font-semibold">
          Definition
        </h2>
        <dl className="mt-2">
          <Field label="Requirement" empty={!b.requirement}>
            <p className="text-base">{b.requirement}</p>
          </Field>
          <Field label="Type">{TYPE[b.requirementType]}</Field>
          <Field label="Who sees it">{b.visibility === 'agent_visible' ? 'Agent-visible (shown to the SME and the agent)' : 'Evaluator-only (never in agent-visible files)'}</Field>
          <Field label="Applies to" empty={scopeEmpty}>
            {a.universal ? (
              'Everywhere in the project'
            ) : (
              <dl className="grid gap-1">
                {(
                  [
                    ['Actors', a.actors],
                    ['Actions', a.actions],
                    ['Entities', a.entities],
                    ['Channels', a.channels],
                    ['Locales', a.locales],
                    ['Jurisdictions', a.jurisdictions],
                  ] as const
                )
                  .filter(([, v]) => v.length > 0)
                  .map(([k, v]) => (
                    <div key={k} className="flex flex-wrap gap-2">
                      <dt className="w-24 text-fg-muted">{k}</dt>
                      <dd>
                        <List items={[...v]} />
                      </dd>
                    </div>
                  ))}
                {a.conditionText && (
                  <div className="flex flex-wrap gap-2">
                    <dt className="w-24 text-fg-muted">Condition</dt>
                    <dd>{a.conditionText}</dd>
                  </div>
                )}
              </dl>
            )}
          </Field>
          <Field label="Prerequisites" empty={b.prerequisites.length === 0}>
            <List items={b.prerequisites} />
          </Field>
          <Field label="Exceptions">
            {b.exceptions.kind === 'none' ? (
              'The source says there are none'
            ) : b.exceptions.kind === 'unknown' ? (
              <span className="text-fg-muted">Not stated / unknown</span>
            ) : (
              <ul className="list-disc pl-5">
                {b.exceptions.items.map((x) => (
                  <li key={x.statement}>
                    {x.statement}
                    {x.conditions && <span className="text-fg-muted"> — when {x.conditions}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="Effective" empty={!b.effective.from && !b.effective.to && !b.effective.conditionText}>
            {[b.effective.from && `from ${b.effective.from}`, b.effective.to && `to ${b.effective.to}`, b.effective.conditionText].filter(Boolean).join(' · ')}
          </Field>
          <Field label="Precedence" empty={b.precedence.length === 0}>
            <ul>
              {b.precedence.map((p) => (
                <li key={`${p.relation}-${p.ruleKey}`}>
                  {p.relation.replace(/_/g, ' ')} <span className="font-mono">{p.ruleKey}</span>
                  {p.note && <span className="text-fg-muted"> — {p.note}</span>}
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Required evidence" empty={b.evidenceNeeds.length === 0}>
            <List items={b.evidenceNeeds} />
          </Field>
          <Field label="Suggested check (hint)" empty={!b.verificationHint}>
            {b.verificationHint}
          </Field>
          {b.uncertainty.length > 0 && (
            <Field label="Noted uncertainty">
              <ul className="list-disc pl-5 text-warning">
                {b.uncertainty.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
      </section>

      <section aria-labelledby="ev-h" className="card p-4">
        <h2 id="ev-h" className="font-semibold">
          Source evidence
        </h2>
        {d.citations.length === 0 ? (
          <p className="mt-1 text-warning">No source quote yet.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {d.citations.map((c) => (
              <li key={c.id} className="rounded bg-bg p-3">
                <blockquote className="border-l-2 border-line pl-2">{c.quote}</blockquote>
                <p className="mt-1 text-xs text-fg-muted">
                  Supports <code>{c.fieldPath}</code> · {c.document} v{c.documentVersion} · {locatorText(c.locator)} · <span title={c.sha256}>sha {c.sha256.slice(0, 8)}</span> ·{' '}
                  <a className="text-link hover:underline" href={`/api/v1/projects/${projectId}/policy/document-versions/${c.documentVersionId}/file`}>
                    open document
                  </a>
                </p>
                <p className={`text-xs ${c.resolution === 'RESOLVED' ? 'text-success' : 'text-warning'}`}>{c.resolution === 'RESOLVED' ? '✓ ' : '⚠ '}{RESOLUTION[c.resolution] ?? c.resolution}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="hist-h" className="card p-4">
        <h2 id="hist-h" className="font-semibold">
          History
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
            {d.history.map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-1">v{h.version}</td>
                <td>{STATE[h.state as RuleDetailData['state']] ?? h.state}</td>
                <td>{(h.origin && ORIGIN[h.origin]) ?? h.origin ?? '—'}</td>
                <td>{day(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(d.annotationHistory ?? []).length > 0 && (
        <section aria-labelledby="ann-hist-h" className="card p-4">
          <h2 id="ann-hist-h" className="font-semibold">
            Annotation history
          </h2>
          <p className="text-xs text-fg-muted">Every saved annotation is kept: the original AI suggestion and each edit. The source quotation is never changed by an annotation edit.</p>
          <table className="mt-2 w-full text-left">
            <thead className="text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-1">
                  Annotation
                </th>
                <th scope="col">By</th>
                <th scope="col">Marking</th>
                <th scope="col">Used</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {(d.annotationHistory ?? []).map((h) => (
                <tr key={h.id} className="border-t border-line align-top">
                  <td className="py-1">v{h.annotationVersion}</td>
                  <td>{h.source === 'AI_SUGGESTION' ? `AI suggestion (${h.model ?? 'assistant'})` : `Edit by ${h.editedRole === 'ADMIN' ? 'Admin' : (h.editedRole ?? 'author')}`}</td>
                  <td>{MARKING_LABEL[h.annotation.marking]}</td>
                  <td>{h.adopted ? (d.annotation?.version === h.annotationVersion ? 'Current' : 'Yes') : 'Offered only'}</td>
                  <td>{new Date(h.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Edit fields and quotes</summary>
        <p className="mt-1 text-xs text-fg-muted">{d.applied ? 'This rule is applied; saving an edit creates a new draft version that you tick again.' : 'Save your changes, then tick Apply to project.'}</p>
        <div className="mt-3">
          <RuleReview key={d.versionId} projectId={projectId} versionId={d.versionId} editOnly />
        </div>
      </details>
    </div>
  );
}
