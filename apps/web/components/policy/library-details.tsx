'use client';

import { ISO_JURISDICTION, LIBRARY_CHANGE_KINDS, LIBRARY_CHANNELS, LIBRARY_CUSTOMER_TYPES, LIBRARY_ISSUERS, LIBRARY_PROCESSES, LIBRARY_PRODUCT_LINES, LIBRARY_RULE_KINDS, LIBRARY_SUBJECTS, type PolicyRuleBody } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

/**
 * KYC Judgment v1 console gap (a): the rule page sets the condition and the policy library details C1 needs (kind,
 * issuer, ISO jurisdiction, subject, scope, effect, how the version takes effect, how it changes the version before it).
 * Saving is an ordinary rule edit; on an approved rule it makes a new draft, which the PM applies again.
 */
export interface LibraryForm {
  kind: string;
  issuer: string;
  jurisdiction: string;
  subject: string;
  process: string;
  customerTypes: string[];
  productLines: string[];
  channels: string[];
  effect: string;
  effectiveMode: string;
  changeKind: string;
  changeSummary: string;
  always: boolean;
  condition: string;
  /** A derived fact this rule defines (C1 derived_facts), e.g. us_person; its definition names catalog facts only. */
  definesId: string;
  definesDefinition: string;
}

export function libraryForm(body: PolicyRuleBody): LibraryForm {
  const l = body.library ?? {};
  return {
    kind: l.kind ?? '',
    issuer: l.issuer ?? '',
    jurisdiction: l.jurisdiction ?? '',
    subject: l.subject ?? '',
    process: l.scope?.process ?? '',
    customerTypes: l.scope?.customer_types ?? [],
    productLines: l.scope?.product_lines ?? [],
    channels: l.scope?.channels ?? [],
    effect: l.effect ?? 'obligation',
    effectiveMode: l.effectiveMode ?? 'from_date',
    changeKind: l.change?.kind ?? '',
    changeSummary: l.change?.summary ?? '',
    always: body.condition === null,
    condition: body.condition ? JSON.stringify(body.condition, null, 2) : '',
    definesId: l.defines?.id ?? '',
    definesDefinition: l.defines ? JSON.stringify(l.defines.definition, null, 2) : '',
  };
}

/** The body with the form applied, or the problems that stop saving it (nothing is guessed). */
export function libraryBody(body: PolicyRuleBody, f: LibraryForm): { body: PolicyRuleBody; problems: string[] } {
  const problems: string[] = [];
  let condition: unknown = body.condition;
  if (f.always) condition = null;
  else if (f.condition.trim()) {
    try {
      condition = JSON.parse(f.condition);
    } catch {
      problems.push('The condition is not valid JSON.');
    }
  } else condition = undefined;
  if (f.jurisdiction && !ISO_JURISDICTION.test(f.jurisdiction)) problems.push(`"${f.jurisdiction}" is not an ISO code: use US, or US-CA for California.`);
  if (f.changeKind && !f.changeSummary.trim()) problems.push('Say in a short summary how this version changes the one before it.');
  let defines: unknown;
  if (f.definesId.trim()) {
    try {
      defines = { id: f.definesId.trim(), type: 'boolean', definition: JSON.parse(f.definesDefinition) };
    } catch {
      problems.push('The definition is not valid JSON.');
    }
  }
  const library = {
    ...(body.library ?? {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.issuer ? { issuer: f.issuer } : {}),
    ...(f.jurisdiction ? { jurisdiction: f.jurisdiction } : {}),
    ...(f.subject ? { subject: f.subject } : {}),
    ...(f.process ? { scope: { process: f.process, ...(f.customerTypes.length ? { customer_types: f.customerTypes } : {}), ...(f.productLines.length ? { product_lines: f.productLines } : {}), ...(f.channels.length ? { channels: f.channels } : {}) } } : {}),
    effect: f.effect,
    effectiveMode: f.effectiveMode,
    ...(f.changeKind ? { change: { kind: f.changeKind, summary: f.changeSummary.trim() } } : {}),
    ...(defines ? { defines } : {}),
  } as NonNullable<PolicyRuleBody['library']>;
  if (!f.definesId.trim()) delete (library as { defines?: unknown }).defines;
  const next = { ...body, library, ...(condition === undefined ? {} : { condition }) } as PolicyRuleBody;
  return { body: next, problems };
}

const label = (v: string) => v.replace(/_/g, ' ');

export function LibraryDetailsEditor({ projectId, ruleId, contentHash, body, approved }: { projectId: string; ruleId: string; contentHash: string; body: PolicyRuleBody; approved: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<LibraryForm>(() => libraryForm(body));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LibraryForm>(k: K, v: LibraryForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'customerTypes' | 'productLines' | 'channels', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  async function save() {
    const out = libraryBody(body, f);
    if (out.problems.length) return setMsg({ kind: 'error', text: out.problems.join(' ') });
    setBusy(true);
    const r = await mutate('PUT', `/projects/${projectId}/policy/rules/${ruleId}`, { expectedContentHash: contentHash, body: out.body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Not saved.' });
    setMsg({ kind: 'ok', text: 'Saved.' });
    router.refresh();
  }
  const select = (id: string, name: string, k: 'kind' | 'issuer' | 'subject' | 'process' | 'effect' | 'effectiveMode' | 'changeKind', options: readonly string[], none = 'Not set') => (
    <label htmlFor={id} className="flex flex-col text-sm">
      <span className="font-medium">{name}</span>
      <select id={id} className="input mt-1" value={f[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">{none}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
    </label>
  );
  const checks = (legend: string, k: 'customerTypes' | 'productLines' | 'channels', options: readonly string[]) => (
    <fieldset className="text-sm">
      <legend className="font-medium">{legend}</legend>
      {options.map((o) => (
        <label key={o} className="mr-3 inline-flex items-center gap-1">
          <input type="checkbox" checked={f[k].includes(o)} onChange={() => toggle(k, o)} />
          {label(o)}
        </label>
      ))}
    </fieldset>
  );
  return (
    <section aria-labelledby="library-h" className="card mt-6 p-5" data-library-details>
      <h2 id="library-h" className="text-lg font-semibold">
        Library details
      </h2>
      <p className="text-sm text-fg-muted">
        What the policy library (C1) needs: when the rule applies (its condition over the case’s facts) and how it is classified. {approved ? 'This rule is approved: saving makes a new draft version, which you apply again.' : 'Saving updates this draft.'}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {select('lib-kind', 'Kind', 'kind', LIBRARY_RULE_KINDS)}
        {select('lib-issuer', 'Issuer', 'issuer', LIBRARY_ISSUERS)}
        <label htmlFor="lib-jurisdiction" className="flex flex-col text-sm">
          <span className="font-medium">Jurisdiction (ISO: US, US-CA)</span>
          <input id="lib-jurisdiction" className="input mt-1" value={f.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value.trim().toUpperCase())} />
        </label>
        {select('lib-subject', 'Evaluated for', 'subject', LIBRARY_SUBJECTS)}
        {select('lib-process', 'Process', 'process', LIBRARY_PROCESSES)}
        {select('lib-effect', 'Effect', 'effect', ['obligation', 'withdrawn'])}
        {select('lib-mode', 'Takes effect', 'effectiveMode', ['from_date', 'scenario_only'])}
        {select('lib-change', 'Change from the version before', 'changeKind', LIBRARY_CHANGE_KINDS, 'First version / none')}
        <label htmlFor="lib-change-summary" className="flex flex-col text-sm">
          <span className="font-medium">Change summary</span>
          <input id="lib-change-summary" className="input mt-1" value={f.changeSummary} onChange={(e) => set('changeSummary', e.target.value)} />
        </label>
      </div>
      <div className="mt-3 space-y-2">
        {checks('Customer types', 'customerTypes', LIBRARY_CUSTOMER_TYPES)}
        {checks('Product lines', 'productLines', LIBRARY_PRODUCT_LINES)}
        {checks('Channels', 'channels', LIBRARY_CHANNELS)}
      </div>
      <div className="mt-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.always} onChange={(e) => set('always', e.target.checked)} />
          Applies always within its process (no condition)
        </label>
        {!f.always && (
          <label htmlFor="lib-condition" className="mt-2 flex flex-col text-sm">
            <span className="font-medium">Condition over the case’s facts (JSON, for example {'{"fact":"us_person","op":"eq","value":true}'})</span>
            <textarea id="lib-condition" rows={6} className="mt-1 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs" value={f.condition} onChange={(e) => set('condition', e.target.value)} />
          </label>
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">This rule defines a fact (for example “US person”)</summary>
        <label htmlFor="lib-defines-id" className="mt-2 flex flex-col">
          <span>Fact name (lower case, e.g. us_person)</span>
          <input id="lib-defines-id" className="input mt-1" value={f.definesId} onChange={(e) => set('definesId', e.target.value.trim())} />
        </label>
        <label htmlFor="lib-defines-def" className="mt-2 flex flex-col">
          <span>True when (JSON over catalog facts only, e.g. {'{"fact":"citizenship","op":"in","value":["US"]}'})</span>
          <textarea id="lib-defines-def" rows={4} className="mt-1 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs" value={f.definesDefinition} onChange={(e) => set('definesDefinition', e.target.value)} />
        </label>
      </details>
      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.kind === 'error' ? 'text-error' : ''}`}>
          {msg.text}
        </p>
      )}
      <button type="button" className="btn btn-primary mt-3" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save library details'}
      </button>
    </section>
  );
}
