'use client';

import { useState } from 'react';
import { ActionMessages, input, useAction } from '@/components/supply/action';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const ok = (s: string) => s === '' || MONEY.test(s);

/** A new rate card, or a new version of an existing one (same name). */
export function RateCardForm({ names }: { names: string[] }) {
  const a = useAction();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'INR'>('USD');
  const [rates, setRates] = useState({ AUTHORING: '', ANNOTATION: '', RL_REVIEW: '' });
  const [hourly, setHourly] = useState('');
  const [cap, setCap] = useState('');
  const perTask = Object.fromEntries(Object.entries(rates).filter(([, v]) => v.trim()));
  const valid = name.trim().length >= 2 && Object.keys(perTask).length > 0 && Object.values(rates).every(ok) && ok(hourly) && ok(cap);
  const existing = names.includes(name.trim());
  return (
    <form
      className="card mt-6 max-w-3xl space-y-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run<{ version: number }>('POST', '/rate-cards', { name: name.trim(), currency, perTask, hourlyRate: hourly || null, weeklyCap: cap || null });
        if (res.ok) {
          a.setNotice(`${name.trim()} v${res.data!.version} created. Link it to requisitions from each requisition page.`);
          setRates({ AUTHORING: '', ANNOTATION: '', RL_REVIEW: '' });
          setHourly('');
          setCap('');
        }
      }}
    >
      <h2 className="font-semibold">New rate card or version</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          Name
          <input required list="rate-card-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Banking KYC 2026" className={input} />
          <datalist id="rate-card-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {existing && <span className="mt-1 block text-xs text-fg-muted">This adds a new version of “{name.trim()}”. Requisitions keep the version they are linked to.</span>}
        </label>
        <label className="block">
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'INR')} className={input}>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>Per accepted task (at least one)</legend>
        <div className="mt-1 grid gap-3 sm:grid-cols-3">
          {(
            [
              ['AUTHORING', 'Authoring'],
              ['ANNOTATION', 'Annotation'],
              ['RL_REVIEW', 'RL review'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="block">
              {l}
              <input inputMode="decimal" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} placeholder="40.00" className={input} aria-invalid={!ok(rates[k])} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          Hourly rate (optional)
          <input inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} className={input} />
        </label>
        <label className="block">
          Weekly cap (optional)
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={input} />
        </label>
      </div>
      {!Object.values(rates).every(ok) || !ok(hourly) || !ok(cap) ? <p className="text-xs text-warning">Use amounts like 40 or 40.50.</p> : null}
      <button type="submit" disabled={a.pending || !valid} className="btn btn-primary">
        Create rate card
      </button>
      <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
    </form>
  );
}
