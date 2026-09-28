'use client';

import { useState } from 'react';
import { Req, RequiredNote } from '@/components/required';
import { ActionMessages, inputInline, useAction } from '@/components/supply/action';

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/** Build statements for a month on demand (the monthly job does this automatically). Existing ones are kept. */
export function BuildStatementsForm() {
  const a = useAction();
  const [period, setPeriod] = useState(lastMonth());
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await a.run<{ created: number }>('POST', '/partner-statements/build', { period });
        if (res.ok) a.setNotice(res.data!.created ? `${res.data!.created} statement${res.data!.created === 1 ? '' : 's'} built for ${period}.` : `No new statements for ${period}: they already exist, or no candidate was certified.`);
      }}
    >
      <RequiredNote className="w-full" />
      <label className="block">
        Month<Req />
        <input type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} className={inputInline} />
      </label>
      <button type="submit" disabled={a.pending || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)} className="btn btn-primary">
        Build statements
      </button>
      <div className="w-full">
        <ActionMessages error={a.error} notice={a.notice} />
      </div>
    </form>
  );
}
