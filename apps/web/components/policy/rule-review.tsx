'use client';

import type { PolicyRuleBody } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mutate } from '@/lib/client-api';
import { locatorText } from './locator';

interface Citation {
  id: string;
  fieldPath: string;
  role: 'supports' | 'qualifies' | 'exception' | 'conflict';
  quote: string;
  locator: { page?: number | null; lineStart?: number | null; lineEnd?: number | null; section?: string | null };
  resolution: 'RESOLVED' | 'QUOTE_MISMATCH' | 'UNRESOLVED';
  documentVersionId: string;
  document: string;
  documentVersion: number;
  sha256: string;
}
interface Detail {
  ruleId: string;
  ruleKey: string;
  required: boolean;
  versionId: string;
  version: number;
  state: 'DRAFT' | 'NEEDS_DEFINITION' | 'REVIEWED' | 'EXCLUDED';
  contentHash: string;
  body: PolicyRuleBody;
  excludeReason: string | null;
  reviewedAt: string | null;
  origin: string;
  problems: string[];
  citations: Citation[];
  history: Array<{ id: string; version: number; state: string }>;
}

const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const RESOLUTION: Record<Citation['resolution'], string> = { RESOLVED: 'Quote found in this version', QUOTE_MISMATCH: 'Quote NOT found in this version — check it', UNRESOLVED: 'Not linked to a location' };

/** Review Rules (S1 R01–R11): source evidence beside the editable rule. Reviewed content is read-only; editing makes a new draft. */
export function RuleReview({ projectId, versionId }: { projectId: string; versionId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [body, setBody] = useState<PolicyRuleBody | null>(null);
  const [cites, setCites] = useState<Citation[]>([]);
  const [reason, setReason] = useState('');
  const [required, setRequired] = useState(true);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load(id = versionId) {
    const res = await fetch(`/api/v1/projects/${projectId}/policy/rule-versions/${id}`, { cache: 'no-store' });
    if (!res.ok) return setLoadError('Could not load this rule.');
    const x = (await res.json()) as Detail;
    setD(x);
    setBody(x.body);
    setCites(x.citations);
    setRequired(x.required);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  if (loadError) return <p role="alert" className="text-error">{loadError}</p>;
  if (!d || !body) return <p className="text-sm text-fg-muted">Loading…</p>;
  const locked = d.state === 'REVIEWED' || d.state === 'EXCLUDED';
  const set = <K extends keyof PolicyRuleBody>(k: K, v: PolicyRuleBody[K]) => setBody({ ...body, [k]: v });
  const setA = <K extends keyof PolicyRuleBody['applicability']>(k: K, v: PolicyRuleBody['applicability'][K]) => setBody({ ...body, applicability: { ...body.applicability, [k]: v } });
  const dirty = JSON.stringify(body) !== JSON.stringify(d.body) || JSON.stringify(cites.map((c) => [c.fieldPath, c.role, c.quote])) !== JSON.stringify(d.citations.map((c) => [c.fieldPath, c.role, c.quote]));

  async function save() {
    setPending(true);
    const r = await mutate<{ versionId: string; version: number }>('PUT', `/projects/${projectId}/policy/rules/${d!.ruleId}`, {
      expectedContentHash: d!.contentHash,
      body,
      citations: cites.map((c) => ({ documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, role: c.role, quote: c.quote, section: c.locator.section ?? null })),
    });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not save.' });
    setMsg({ kind: 'ok', text: r.data!.version !== d!.version ? `Saved as new draft version ${r.data!.version}. The reviewed version is unchanged.` : 'Saved.' });
    await load(r.data!.versionId);
    router.refresh();
  }
  async function decide(kind: 'review' | 'exclude') {
    setPending(true);
    const r = await mutate('POST', `/projects/${projectId}/policy/rule-versions/${d!.versionId}/${kind}`, kind === 'review' ? { expectedContentHash: d!.contentHash, required } : { expectedContentHash: d!.contentHash, reason });
    setPending(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Could not save the decision.' });
    setMsg({ kind: 'ok', text: kind === 'review' ? 'Marked Reviewed.' : 'Excluded.' });
    await load();
    router.refresh();
  }

  const field = (label: string, el: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-0.5">
      <span className="font-medium">{label}</span>
      {el}
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );

  return (
    <div className="grid gap-4 text-sm xl:grid-cols-2">
      <section aria-label="Source evidence" className="rounded border border-line p-3">
        <h3 className="font-semibold">Source evidence</h3>
        {cites.length === 0 && <p className="mt-1 text-warning">No source quote yet. Add one so the rule can be reviewed.</p>}
        <ul className="mt-2 space-y-3">
          {cites.map((c, i) => (
            <li key={`${c.id}-${i}`} className="rounded bg-bg p-2">
              <p className="text-xs text-fg-muted">
                {c.document} v{c.documentVersion} · {locatorText(c.locator)} · <span title={c.sha256}>sha {c.sha256.slice(0, 8)}</span> · supports <code>{c.fieldPath}</code>
              </p>
              {locked ? (
                <blockquote className="mt-1 border-l-2 border-line pl-2">{c.quote}</blockquote>
              ) : (
                <textarea aria-label={`Quote ${i + 1}`} className="rounded-md border border-line bg-surface px-2 py-1 text-fg mt-1 w-full text-xs" value={c.quote} onChange={(e) => setCites(cites.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} />
              )}
              <p className={`text-xs ${c.resolution === 'RESOLVED' ? 'text-success' : 'text-warning'}`}>{RESOLUTION[c.resolution]}</p>
              {!locked && (
                <div className="mt-1 flex gap-2 text-xs">
                  <select aria-label="Field this quote supports" className="rounded-md border border-line bg-surface px-2 py-1 text-fg text-xs" value={c.fieldPath} onChange={(e) => setCites(cites.map((x, j) => (j === i ? { ...x, fieldPath: e.target.value } : x)))}>
                    <option value="requirement">requirement</option>
                    <option value="applicability.conditionText">applicability</option>
                    <option value="exceptions">exceptions</option>
                    <option value="effective">effective dates</option>
                    <option value="precedence">precedence</option>
                  </select>
                  <button type="button" className="text-error hover:underline" onClick={() => setCites(cites.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!locked && cites[0] && (
          <button type="button" className="mt-2 text-link hover:underline" onClick={() => setCites([...cites, { ...cites[0]!, id: `new-${cites.length}`, quote: '', fieldPath: 'requirement', role: 'supports', resolution: 'UNRESOLVED' }])}>
            Add another quote from {cites[0].document}
          </button>
        )}
        <a className="mt-2 block text-link hover:underline" href={`/api/v1/projects/${projectId}/policy/document-versions/${cites[0]?.documentVersionId ?? ''}/file`}>
          Open the source document
        </a>
      </section>

      <section aria-label="Rule" className="rounded border border-line p-3">
        <h3 className="font-semibold">
          <span className="font-mono">{d.ruleKey}</span> v{d.version} — {d.state === 'NEEDS_DEFINITION' ? 'Needs definition' : d.state.charAt(0) + d.state.slice(1).toLowerCase()}
        </h3>
        {d.history.length > 1 && <p className="text-xs text-fg-muted">History: {d.history.map((h) => `v${h.version} ${h.state.toLowerCase()}`).join(' · ')}</p>}
        {locked && <p className="mt-1 text-xs text-fg-muted">{d.state === 'REVIEWED' ? 'Reviewed content is fixed. Editing below creates a new draft version.' : `Excluded: ${d.excludeReason}`}</p>}
        <fieldset className="mt-2 grid gap-2" disabled={pending}>
          {field('Title', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.title} onChange={(e) => set('title', e.target.value)} />)}
          {field('Requirement', <textarea className="rounded-md border border-line bg-surface px-2 py-1 text-fg min-h-20" value={body.requirement} onChange={(e) => set('requirement', e.target.value)} />)}
          {field(
            'Type',
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.requirementType} onChange={(e) => set('requirementType', e.target.value as PolicyRuleBody['requirementType'])}>
              <option value="obligation">Obligation (must)</option>
              <option value="prohibition">Prohibition (must not)</option>
              <option value="permission">Permission (may)</option>
              <option value="definition">Definition</option>
              <option value="unknown">Unknown — needs definition</option>
            </select>,
          )}
          {field(
            'Who sees it',
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.visibility} onChange={(e) => set('visibility', e.target.value as PolicyRuleBody['visibility'])}>
              <option value="agent_visible">Agent-visible (shown to the SME and the agent)</option>
              <option value="evaluator_only">Evaluator-only (never in agent-visible files)</option>
            </select>,
          )}
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={body.applicability.universal} onChange={(e) => setA('universal', e.target.checked)} /> Applies everywhere in the project
          </label>
          {!body.applicability.universal && (
            <>
              {field('Applies to actors', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.actors.join(', ')} onChange={(e) => setA('actors', list(e.target.value))} />, 'Comma-separated, e.g. agent, reviewer')}
              {field('When the agent does', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.actions.join(', ')} onChange={(e) => setA('actions', list(e.target.value))} />, 'e.g. schedule launch event')}
              {field('Channels', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.channels.join(', ')} onChange={(e) => setA('channels', list(e.target.value))} />)}
              {field('Locales', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.locales.join(', ')} onChange={(e) => setA('locales', list(e.target.value))} />)}
              {field('Jurisdictions', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.jurisdictions.join(', ')} onChange={(e) => setA('jurisdictions', list(e.target.value))} />)}
              {field('Condition', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.applicability.conditionText ?? ''} onChange={(e) => setA('conditionText', e.target.value || null)} />, 'Plain language; link it to a quote')}
            </>
          )}
          {field(
            'Exceptions',
            <select className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.exceptions.kind} onChange={(e) => set('exceptions', { kind: e.target.value as PolicyRuleBody['exceptions']['kind'], items: e.target.value === 'listed' ? body.exceptions.items : [] })}>
              <option value="unknown">Not stated / unknown</option>
              <option value="none">The source says there are none</option>
              <option value="listed">The source lists exceptions</option>
            </select>,
          )}
          {body.exceptions.kind === 'listed' &&
            field(
              'Listed exceptions',
              <textarea className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.exceptions.items.map((x) => x.statement).join('\n')} onChange={(e) => set('exceptions', { kind: 'listed', items: e.target.value.split('\n').filter((x) => x.trim()).map((statement) => ({ statement, conditions: null })) })} />,
              'One per line; an exemption on a task must cite one of these',
            )}
          <div className="grid grid-cols-2 gap-2">
            {field('Effective from', <input type="date" className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.effective.from ?? ''} onChange={(e) => set('effective', { ...body.effective, from: e.target.value || null })} />)}
            {field('Effective to', <input type="date" className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.effective.to ?? ''} onChange={(e) => set('effective', { ...body.effective, to: e.target.value || null })} />)}
          </div>
          {field('Or effective when', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.effective.conditionText ?? ''} onChange={(e) => set('effective', { ...body.effective, conditionText: e.target.value || null })} />, 'e.g. always')}
          {field('Required evidence', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.evidenceNeeds.join(', ')} onChange={(e) => set('evidenceNeeds', list(e.target.value))} />)}
          {field('Gate / precedence', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.precedence.map((p) => `${p.relation}:${p.ruleKey}`).join(', ')} onChange={(e) => set('precedence', list(e.target.value).map((x) => { const [relation, ruleKey] = x.includes(':') ? x.split(':') : ['overrides', x]; return { relation: (['overridden_by', 'requires_before'].includes(relation!) ? relation : 'overrides') as PolicyRuleBody['precedence'][number]['relation'], ruleKey: ruleKey!.trim(), note: null }; }))} />, 'overrides:R-OTHER, overridden_by:R-OTHER or requires_before:R-OTHER')}
          {field('Suggested check (hint only)', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={body.verificationHint ?? ''} onChange={(e) => set('verificationHint', e.target.value || null)} />)}
          {body.uncertainty.length > 0 && <p className="text-xs text-warning">Extraction noted: {body.uncertainty.join('; ')}</p>}
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={!dirty || pending} onClick={save} className="btn btn-secondary disabled:opacity-50">
            {locked ? 'Save as new draft' : 'Save changes'}
          </button>
          {!locked && (
            <>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required policy
              </label>
              <button type="button" disabled={dirty || pending || d.problems.length > 0} onClick={() => decide('review')} className="btn btn-primary disabled:opacity-50" title={dirty ? 'Save your changes first' : undefined}>
                Mark Reviewed
              </button>
            </>
          )}
        </div>
        {!locked && d.problems.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-warning" aria-label="Before this rule can be reviewed">
            {d.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {!locked && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {field('Reason to exclude', <input className="rounded-md border border-line bg-surface px-2 py-1 text-fg" value={reason} onChange={(e) => setReason(e.target.value)} />)}
            <button type="button" disabled={!reason.trim() || pending} onClick={() => decide('exclude')} className="btn btn-secondary disabled:opacity-50">
              Exclude
            </button>
          </div>
        )}
        {msg && (
          <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 ${msg.kind === 'error' ? 'text-error' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
      </section>
    </div>
  );
}
