'use client';

import { FIELD_DEFS } from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { correct } from '@/lib/profile-client';
import type { ConversationState } from '@/lib/profile-types';

type Answer = { kind: 'value'; raw: string } | { kind: 'UNKNOWN' | 'DECLINE' | 'SKIP' };

/**
 * The same questions as the conversation, as an accessible form (FLOW2 C04, CF-30). Values typed here are your own
 * confirmed answers. Roles are added on the profile panel of the conversation or review page.
 */
export function FormFallback({ initial }: { initial: ConversationState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fieldKind = (k: string) => FIELD_DEFS[k]?.kind ?? 'text';
  const currentText = (k: string) => {
    const v = state.profile.fields[k]?.value;
    return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const fields = Object.entries(answers).flatMap(([fieldKey, a]): { fieldKey: string; action: string; value?: unknown }[] => {
      if (a.kind !== 'value') return [{ fieldKey, action: a.kind }];
      if (!a.raw.trim()) return [{ fieldKey, action: 'CLEAR' }];
      const kind = fieldKind(fieldKey);
      const value = kind === 'number' ? Number(a.raw) : kind === 'list' ? a.raw.split(',').map((s) => s.trim()).filter(Boolean) : a.raw.trim();
      return [{ fieldKey, action: 'EDIT', value }];
    });
    const r = await correct(state.enrollment.id, state.session?.revision ?? 0, { fields });
    if (!r.ok) return setMessage({ ok: false, text: r.message });
    setState(r.data);
    setAnswers({});
    router.refresh();
    setMessage({ ok: true, text: JSON.stringify(r.data.profile).includes('[removed:')
      ? 'Saved with sensitive identifiers removed. Please describe the work in general terms and confirm the corrected answers.' : 'Saved.' });
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-6" noValidate>
      <div>
        <Link href={`/enrollments/${state.enrollment.id}`} className="text-sm text-link hover:underline">← Back to the conversation</Link>
        <h1 className="mt-2 text-2xl font-semibold">Answer with a form</h1>
        <p className="mt-1 text-sm text-fg-muted">The same questions as the conversation. Answer what applies; optional questions can be skipped. Separate list items with commas.</p>
        {state.questions.some((q) => q.required) && <RequiredNote className="mt-1" />}
      </div>
      {state.questions.map((q) => (
        <fieldset key={q.id} className="rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-medium">
            {q.text}
            {q.required ? <Req /> : ' (optional)'}
          </legend>
          {q.why && <p className="text-xs text-fg-muted">{q.why}</p>}
          {q.fields.filter((f) => f !== 'roles').map((f) => {
            const a = answers[f];
            const status = state.profile.fields[f]?.status;
            return (
              <div key={f} className="mt-3">
                <label htmlFor={`f-${f}`} className="block text-sm">{state.fieldLabels[f] ?? f}{status ? ` · currently: ${status.toLowerCase()}` : ''}</label>
                {fieldKind(f) === 'text' ? (
                  <textarea id={`f-${f}`} aria-required={q.required || undefined} rows={3} value={a ? a.kind === 'value' ? a.raw : '' : currentText(f)} onChange={(e) => setAnswers({ ...answers, [f]: { kind: 'value', raw: e.target.value } })} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
                ) : (
                  <input id={`f-${f}`} aria-required={q.required || undefined} type={fieldKind(f) === 'number' ? 'number' : 'text'} value={a ? a.kind === 'value' ? a.raw : '' : currentText(f)} onChange={(e) => setAnswers({ ...answers, [f]: { kind: 'value', raw: e.target.value } })} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" />
                )}
                <div className="mt-1 flex flex-wrap gap-4 text-xs">
                  {(['UNKNOWN', 'DECLINE', ...(q.required ? [] : ['SKIP' as const])] as ('UNKNOWN' | 'DECLINE' | 'SKIP')[]).map((k) => (
                    <label key={k} className="flex items-center gap-1">
                      <input type="radio" name={`alt-${f}`} checked={a?.kind === k} onChange={() => setAnswers({ ...answers, [f]: { kind: k } })} />
                      {k === 'UNKNOWN' ? 'I don’t know' : k === 'DECLINE' ? 'I can’t disclose' : 'Skip'}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {q.fields.includes('roles') && <p className="mt-2 text-sm">Add your roles with dates on the <Link href={`/enrollments/${state.enrollment.id}/review`} className="text-link underline">review page</Link>.</p>}
        </fieldset>
      ))}
      {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-success' : 'text-error'}`}>{message.text}</p>}
      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary">Save answers</button>
        <Link href={`/enrollments/${state.enrollment.id}/review`} className="btn btn-secondary">Review and submit</Link>
      </div>
    </form>
  );
}
