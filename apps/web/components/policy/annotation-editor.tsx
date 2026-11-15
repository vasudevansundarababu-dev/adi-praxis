'use client';

import {
  ACTOR_LABEL, CLASSIFICATION_LABEL, COMPOUND_ROLES, MANDATORY_MARKINGS, MARKING_LABEL, RESPONSIBLE_ACTORS, RULE_CLASSIFICATIONS, RULE_LINK_RELATIONS, RuleAnnotationInput,
  type RuleAnnotation, type ScopeList,
} from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';
import { blankAnnotation } from './annotation-logic';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const input = 'rounded-md border border-line bg-surface px-2 py-1 text-fg';

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}

function Scope({ label, value, options, onChange }: { label: string; value: ScopeList; options?: string[]; onChange: (v: ScopeList) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-medium">{label}</legend>
      <select aria-label={`${label}: how far it applies`} className={input} value={value.kind} onChange={(e) => onChange({ kind: e.target.value as ScopeList['kind'], items: e.target.value === 'listed' ? value.items : [] })}>
        <option value="unknown">Unknown (the policy does not say)</option>
        <option value="all">All</option>
        <option value="listed">Only these</option>
      </select>
      {value.kind === 'listed' &&
        (options?.length ? (
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <label key={o} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={value.items.includes(o)} onChange={(e) => onChange({ kind: 'listed', items: e.target.checked ? [...value.items, o] : value.items.filter((x) => x !== o) })} /> {o}
              </label>
            ))}
          </div>
        ) : (
          <input aria-label={`${label}: values`} className={input} value={value.items.join(', ')} placeholder="Comma separated, e.g. US, US-CA" onChange={(e) => onChange({ kind: 'listed', items: commas(e.target.value) })} />
        ))}
    </fieldset>
  );
}

/**
 * The annotation part of the rule editor (spec §4): classification, marking, actor, scope, trigger, stage, deadline,
 * evidence, links and open questions. Every detail has an explicit Unknown. Saving is an ordinary rule edit: a new
 * annotation version, and a new draft version when the rule is applied. The source quotation is never edited here.
 */
export function AnnotationEditor({ projectId, ruleId, contentHash, applied, annotation, applicationTypeOptions, ruleKeys, basedOnRevisionId }: { projectId: string; ruleId: string; contentHash: string; applied: boolean; annotation: RuleAnnotation | null; applicationTypeOptions: string[]; ruleKeys: string[]; basedOnRevisionId?: string | null }) {
  const router = useRouter();
  const start = (): RuleAnnotationInput => {
    if (!annotation) return blankAnnotation('needs_clarification');
    const { version: _v, ...rest } = annotation;
    return rest;
  };
  const [a, setA] = useState<RuleAnnotationInput>(start);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const set = <K extends keyof RuleAnnotationInput>(k: K, v: RuleAnnotationInput[K]) => setA({ ...a, [k]: v });

  async function save() {
    const parsed = RuleAnnotationInput.safeParse(a);
    if (!parsed.success) return setMsg({ kind: 'error', text: 'Some values are too long or incomplete. Check the fields and try again.' });
    setPending(true);
    const r = await mutate<{ version: number; annotationVersion: number }>('PUT', `/projects/${projectId}/policy/rules/${ruleId}/annotation`, { expectedContentHash: contentHash, annotation: parsed.data, basedOnRevisionId: basedOnRevisionId ?? null });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not save the annotation.' });
    setMsg({ kind: 'ok', text: `Saved as annotation version ${r.data!.annotationVersion}.${applied ? ` The rule was applied, so this is new draft version ${r.data!.version}: tick Apply to project again when it is right.` : ''}` });
    router.refresh();
  }

  return (
    <form
      className="grid gap-3 text-sm md:grid-cols-2"
      aria-label="Edit annotation"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Labeled label="Classification">
        <select className={input} value={a.classification} onChange={(e) => set('classification', e.target.value as RuleAnnotationInput['classification'])}>
          {RULE_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABEL[c]}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Mandatory marking" hint="“Other responsibility/scope” does not make the bank’s obligation optional.">
        <select className={input} value={a.marking} onChange={(e) => set('marking', e.target.value as RuleAnnotationInput['marking'])}>
          {MANDATORY_MARKINGS.map((m) => (
            <option key={m} value={m}>
              {MARKING_LABEL[m]}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Applies when" hint="Leave empty if the policy does not say (shown as Unknown).">
        <textarea className={input} rows={2} value={a.appliesWhen ?? ''} onChange={(e) => set('appliesWhen', e.target.value.trim() ? e.target.value : null)} />
      </Labeled>
      <Labeled label="Why" hint="Plain English: why this marking.">
        <textarea className={input} rows={2} value={a.why ?? ''} onChange={(e) => set('why', e.target.value.trim() ? e.target.value : null)} />
      </Labeled>
      <Labeled label="Responsible actor" hint="A human officer’s approval is never the agent’s to give.">
        <select className={input} value={a.responsibleActor} onChange={(e) => set('responsibleActor', e.target.value as RuleAnnotationInput['responsibleActor'])}>
          {RESPONSIBLE_ACTORS.map((x) => (
            <option key={x} value={x}>
              {ACTOR_LABEL[x]}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label="Actor note">
        <input className={input} value={a.actorNote ?? ''} onChange={(e) => set('actorNote', e.target.value.trim() ? e.target.value : null)} />
      </Labeled>
      <Scope label="Application types" value={a.applicationTypes} options={applicationTypeOptions} onChange={(v) => set('applicationTypes', v)} />
      <Scope label="Jurisdictions" value={a.jurisdictions} onChange={(v) => set('jurisdictions', v)} />
      <Labeled label="Workflow stage" hint="Empty = unknown.">
        <input className={input} value={a.workflowStage ?? ''} onChange={(e) => set('workflowStage', e.target.value.trim() ? e.target.value : null)} />
      </Labeled>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Deadline</legend>
        <select aria-label="Deadline: stated?" className={input} value={a.deadline.kind} onChange={(e) => set('deadline', { kind: e.target.value as RuleAnnotationInput['deadline']['kind'], text: e.target.value === 'stated' ? a.deadline.text : null, measuredFrom: e.target.value === 'stated' ? a.deadline.measuredFrom : null })}>
          <option value="unknown">Unknown</option>
          <option value="none">The policy sets no deadline</option>
          <option value="stated">Stated</option>
        </select>
        {a.deadline.kind === 'stated' && (
          <>
            <input aria-label="Deadline" className={input} value={a.deadline.text ?? ''} placeholder="e.g. within 30 days" onChange={(e) => set('deadline', { ...a.deadline, text: e.target.value || null })} />
            <input aria-label="Deadline measured from" className={input} value={a.deadline.measuredFrom ?? ''} placeholder="Measured from, e.g. account opening" onChange={(e) => set('deadline', { ...a.deadline, measuredFrom: e.target.value || null })} />
          </>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Evidence</legend>
        <select aria-label="Evidence: stated?" className={input} value={a.evidence.status} onChange={(e) => set('evidence', { ...a.evidence, status: e.target.value as RuleAnnotationInput['evidence']['status'] })}>
          <option value="unknown">Unknown</option>
          <option value="partly_stated">Partly stated</option>
          <option value="stated">Stated by the policy</option>
        </select>
        <textarea aria-label="Missing evidence, one per line" className={input} rows={2} value={a.evidence.missing.join('\n')} placeholder="Missing evidence, one per line" onChange={(e) => set('evidence', { ...a.evidence, missing: lines(e.target.value) })} />
      </fieldset>
      <fieldset className="flex flex-col gap-1 md:col-span-2">
        <legend className="font-medium">Dependencies and linked rules</legend>
        {a.links.map((l, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select aria-label={`Link ${i + 1}: relation`} className={input} value={l.relation} onChange={(e) => set('links', a.links.map((x, j) => (j === i ? { ...x, relation: e.target.value as typeof l.relation } : x)))}>
              {RULE_LINK_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select aria-label={`Link ${i + 1}: rule`} className={input} value={l.ruleKey} onChange={(e) => set('links', a.links.map((x, j) => (j === i ? { ...x, ruleKey: e.target.value } : x)))}>
              {!ruleKeys.includes(l.ruleKey) && <option value={l.ruleKey}>{l.ruleKey} (not in this project)</option>}
              {ruleKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => set('links', a.links.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        {ruleKeys.length > 0 && (
          <button type="button" className="btn btn-secondary self-start" onClick={() => set('links', [...a.links, { ruleKey: ruleKeys[0]!, relation: 'references', note: null }])}>
            Add a linked rule
          </button>
        )}
      </fieldset>
      {a.compound && (
        <div className="rounded bg-bg p-2 md:col-span-2">
          <p className="font-medium">
            Part of a compound statement ({a.compound.role}, group {a.compound.groupKey})
          </p>
          <blockquote className="mt-1 border-l-2 border-line pl-2">{a.compound.originalStatement}</blockquote>
          <div className="mt-1 flex gap-2">
            <select aria-label="Role in the compound statement" className={input} value={a.compound.role} onChange={(e) => set('compound', { ...a.compound!, role: e.target.value as (typeof COMPOUND_ROLES)[number] })}>
              {COMPOUND_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => set('compound', null)}>
              Not part of a compound statement
            </button>
          </div>
        </div>
      )}
      <Labeled label="Open questions and conflicts" hint="One per line. Flagged on the Rules page and exported as unresolved.">
        <textarea className={input} rows={2} value={a.openQuestions.join('\n')} onChange={(e) => set('openQuestions', lines(e.target.value))} />
      </Labeled>
      <div className="flex flex-col justify-end gap-1 md:col-span-2">
        <p className="text-xs text-fg-muted">Trigger details, prerequisites, exceptions and effective dates are edited in “Edit fields and quotes” below.</p>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary disabled:opacity-50" disabled={pending}>
            {applied ? 'Save annotation as new draft' : 'Save annotation'}
          </button>
          {msg && (
            <span role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'text-error' : 'text-success'}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
