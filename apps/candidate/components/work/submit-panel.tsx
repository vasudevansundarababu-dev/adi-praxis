'use client';

import { KYC_SECTIONS, type TaskCheck } from '@praxis/shared';
import { useState } from 'react';
import type { CheckResult } from '@/lib/work-types';

const sectionTitle = (id: string) => KYC_SECTIONS.find((s) => s.id === id)?.title ?? id;

/**
 * W06 — runs every automated check, shows the closest existing tasks (briefs only) and any likely-real data, and
 * submits after the synthetic-data declaration. Submission is blocked by any failing check or unexplained flag.
 */
export function SubmitPanel(props: { taskId: string; flush: () => Promise<boolean>; revision: () => number; onSubmitted: () => void; onGoTo?: (section: string) => void; declaration?: string }) {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [declared, setDeclared] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    await props.flush();
    const res = await fetch(`/api/v1/me/tasks/${props.taskId}/check`, { method: 'POST' });
    setPending(false);
    if (!res.ok) return setError('Could not run the checks. Try again.');
    setResult(await res.json());
  }
  async function submit() {
    setPending(true);
    setError(null);
    if (!(await props.flush())) {
      setPending(false);
      return setError('Your latest changes could not be saved yet, so nothing was submitted.');
    }
    const res = await fetch(`/api/v1/me/tasks/${props.taskId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: props.revision(), syntheticDeclaration: true, flagExplanations: Object.fromEntries(Object.entries(explanations).filter(([, v]) => v.trim())) }),
    });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (res.ok) return props.onSubmitted();
    if (body?.error === 'CHECKS_FAILED') setResult((r) => ({ checks: body.details.checks, flags: body.details.flags, similar: r?.similar ?? [] }));
    setError(body?.message ?? 'Could not submit.');
  }

  const failing = (result?.checks ?? []).filter((c) => !c.ok && c.severity !== 'warning');
  const warnings = (result?.checks ?? []).filter((c) => !c.ok && c.severity === 'warning');
  const unexplained = (result?.flags ?? []).filter((f) => !explanations[f.id]?.trim());
  const bySection = failing.reduce<Record<string, TaskCheck[]>>((m, c) => ({ ...m, [c.section]: [...(m[c.section] ?? []), c] }), {});

  return (
    <section aria-labelledby="w06-h" className="space-y-4">
      <h2 id="w06-h" className="text-lg font-semibold">Check and submit</h2>
      <button type="button" disabled={pending} onClick={check} className="btn btn-secondary disabled:opacity-60">
        {pending ? 'Checking…' : 'Run checks'}
      </button>
      {result && (
        <div aria-live="polite" className="space-y-4">
          {failing.length === 0 ? (
            <p className="text-success">All automated checks pass.</p>
          ) : (
            <div role="alert" className="rounded-md border border-error p-3">
              <p className="font-medium">{failing.length} check(s) need attention</p>
              {Object.entries(bySection).map(([section, list]) => (
                <div key={section} className="mt-2">
                  {props.onGoTo ? (
                    <button type="button" onClick={() => props.onGoTo!(section)} className="text-link underline">
                      {section} {sectionTitle(section)}
                    </button>
                  ) : (
                    <p className="font-medium">{section}</p>
                  )}
                  <ul className="list-disc pl-5 text-sm">
                    {list.map((c) => (
                      <li key={c.id}>{c.message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-warning">
              {warnings.map((c) => (
                <li key={c.id}>{c.message}</li>
              ))}
            </ul>
          )}
          {result.flags.length > 0 && (
            <div className="rounded-md border border-warning p-3 text-sm">
              <p className="font-medium">Possible real data</p>
              <p className="text-fg-muted">Replace these with synthetic values (use the generator), or explain why they are not real. The reviewer sees your explanation.</p>
              <ul className="mt-2 space-y-2">
                {result.flags.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono">{f.excerpt}</span> <span className="text-fg-muted">({f.kind.toLowerCase().replace(/_/g, ' ')} in {f.path})</span>
                    <label className="mt-1 block">
                      <span className="sr-only">Explanation for {f.excerpt}</span>
                      <input value={explanations[f.id] ?? ''} onChange={(e) => setExplanations({ ...explanations, [f.id]: e.target.value })} placeholder="Why this is not real data" className="w-full rounded-md border border-line bg-surface px-2 py-1" />
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.similar.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Closest existing tasks</p>
              <p className="text-fg-muted">Make your case clearly different from these.</p>
              <ul className="mt-1 space-y-1">
                {result.similar.map((m, i) => (
                  <li key={i} className={m.flagged ? 'text-warning' : ''}>
                    {Math.round(m.score * 100)}% similar{m.flagged ? ' (likely duplicate)' : ''}: {m.brief ?? 'another task'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1" />
        {props.declaration ?? 'This case is entirely synthetic. It contains no real customer, colleague, employer or confidential information.'}
      </label>
      <button type="button" disabled={pending || !declared || !result || failing.length > 0 || unexplained.length > 0} onClick={submit} className="btn btn-primary disabled:opacity-50">
        Submit for review
      </button>
      {!result && <p className="text-sm text-fg-muted">Run the checks first.</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </section>
  );
}
