'use client';

import { useState } from 'react';
import { call } from '@/lib/client';

/**
 * D-027 (owner, 23 Nov 2026): under each free-text field, "Show an example" (a ready-to-adapt example and what not to
 * write) and "Check this" (a review of what the SME wrote, with plain suggestions and an optional rewrite). The field
 * changes only when the SME clicks "Use as starting point" or "Use this rewrite"; nothing is decided for them.
 */
type Example = { example: string; avoid: { text: string; why: string }[]; source: string };
type Check = { findings: { kind: string; message: string }[]; rewrite: string | null; reviewedBy: string; modelNote?: string };
const button = 'rounded-md border border-line px-2 py-1 text-xs hover:border-link disabled:opacity-50';

export function FieldCoach({ taskId, section, field, label, value, onUse }: { taskId: string; section: string; field: string; label: string; value: string; onUse: (text: string) => void }) {
  const [busy, setBusy] = useState<'example' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState<Example | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  async function ask(mode: 'example' | 'check') {
    setBusy(mode);
    setError(null);
    const r = await call<Example | Check>('POST', `/me/tasks/${taskId}/fields/coach`, { section, field, mode, ...(mode === 'check' ? { text: value } : {}) });
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error ?? 'That did not work. Try again.');
    if (mode === 'example') setExample(r.data as Example);
    else setCheck(r.data as Check);
  }
  return (
    <div className="mt-1 text-xs" data-field-coach={`${section}.${field}`}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy !== null} onClick={() => ask('example')}>
          {busy === 'example' ? 'Writing an example…' : 'Show an example'}
        </button>
        <button type="button" className={button} disabled={busy !== null || !value.trim()} onClick={() => ask('check')} aria-label={`Check what you wrote in ${label}`}>
          {busy === 'check' ? 'Checking…' : 'Check this'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-error">
          {error}
        </p>
      )}
      {example && (
        <div className="mt-2 rounded-md border border-line p-2" aria-label={`Example for ${label}`}>
          <p className="font-medium">Example to adapt</p>
          <p className="mt-1 whitespace-pre-wrap">{example.example}</p>
          {example.avoid.length > 0 && (
            <ul className="mt-2 space-y-1">
              {example.avoid.map((a, i) => (
                <li key={i}>
                  <span className="text-error">Don’t write:</span> “{a.text}” <span className="text-fg-muted">{a.why}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" className={button} onClick={() => (onUse(example.example), setExample(null))}>
              {value.trim() ? 'Replace my text with this' : 'Use as starting point'}
            </button>
            <button type="button" className={button} onClick={() => setExample(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {check && (
        <div className="mt-2 rounded-md border border-line p-2" aria-label={`Check of ${label}`} role="status">
          {check.findings.length === 0 ? (
            <p className="text-success">No problems found. Your reviewer still decides.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              {check.findings.map((x, i) => (
                <li key={i}>{x.message}</li>
              ))}
            </ul>
          )}
          {check.modelNote && <p className="mt-1 text-fg-muted">{check.modelNote}</p>}
          {check.rewrite && check.rewrite.trim() !== value.trim() && (
            <div className="mt-2">
              <p className="font-medium">Suggested rewrite</p>
              <p className="mt-1 whitespace-pre-wrap">{check.rewrite}</p>
              <button type="button" className={`${button} mt-1`} onClick={() => (onUse(check.rewrite!), setCheck(null))}>
                Use this rewrite
              </button>
            </div>
          )}
          <button type="button" className={`${button} mt-2`} onClick={() => setCheck(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
