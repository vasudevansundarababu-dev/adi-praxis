'use client';

import { useState } from 'react';
import { ActionMessages, input, useAction } from '@/components/supply/action';
import type { BlueprintDetail, Competency } from './types';

/** Item count, time limit, pass rules and competency weights (section 7.2 defaults, editable before approval). */
export function BlueprintSettings({ blueprint: b }: { blueprint: BlueprintDetail }) {
  const a = useAction();
  const [itemCount, setItemCount] = useState(String(b.itemCount));
  const [time, setTime] = useState(String(b.timeLimitMinutes));
  const [rules, setRules] = useState({ ...b.passRules, plantedErrorsPct: b.passRules.plantedErrorsPct === null ? '' : String(b.passRules.plantedErrorsPct) });
  const [comps, setComps] = useState<Competency[]>(b.competencies);
  const total = comps.reduce((n, c) => n + (Number.isFinite(c.weight) ? c.weight : 0), 0);
  const published = b.status === 'PUBLISHED';

  return (
    <details className="card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Edit length, time, pass rules and weights</summary>
      <form
        className="mt-3 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(
            'PATCH',
            `/blueprints/${b.id}`,
            {
              itemCount: Number(itemCount),
              timeLimitMinutes: Number(time),
              passRules: { ...rules, overallPct: Number(rules.overallPct), plantedErrorsPct: rules.plantedErrorsPct === '' ? null : Number(rules.plantedErrorsPct), writtenPassScore: Number(rules.writtenPassScore), confirmationsRequired: Number(rules.confirmationsRequired) },
              competencies: comps,
            },
            { success: 'Blueprint saved. Approve it again when you are happy.' },
          );
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            Items (5–100)
            <input type="number" min={5} max={100} value={itemCount} onChange={(e) => setItemCount(e.target.value)} className={input} />
          </label>
          <label className="block">
            Time limit, minutes (10–300)
            <input type="number" min={10} max={300} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </label>
          <label className="block">
            Overall pass mark, %
            <input type="number" min={0} max={100} value={rules.overallPct} onChange={(e) => setRules({ ...rules, overallPct: Number(e.target.value) })} className={input} />
          </label>
          <label className="block">
            Planted errors to find, % (blank = not used)
            <input type="number" min={0} max={100} value={rules.plantedErrorsPct} onChange={(e) => setRules({ ...rules, plantedErrorsPct: e.target.value })} className={input} />
          </label>
          <label className="block">
            Written answer pass score (0–1)
            <input type="number" min={0} max={1} step={0.05} value={rules.writtenPassScore} onChange={(e) => setRules({ ...rules, writtenPassScore: Number(e.target.value) })} className={input} />
          </label>
          <label className="block">
            People confirming each authoring grade
            <input type="number" min={1} max={3} value={rules.confirmationsRequired} onChange={(e) => setRules({ ...rules, confirmationsRequired: Number(e.target.value) })} className={input} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.noCriticalMiss} onChange={(e) => setRules({ ...rules, noCriticalMiss: e.target.checked })} />
            Fail on any critical-rule miss
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rules.objectiveOnlyOverall} onChange={(e) => setRules({ ...rules, objectiveOnlyOverall: e.target.checked })} />
            Overall mark counts objective items only
          </label>
        </div>
        <fieldset>
          <legend className="font-medium">Competency weights (must total 100; now {total})</legend>
          <div className="mt-2 space-y-2">
            {comps.map((c, i) => (
              <label key={c.key} className="flex items-center gap-3">
                <input type="number" min={1} max={100} value={c.weight} onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} className="w-20 rounded-md border border-line bg-surface px-2 py-1.5" aria-label={`Weight for ${c.name}`} />
                <span>
                  {c.name} <span className="text-xs text-fg-muted">({c.key} · cites {c.citations.join(', ')})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={a.pending || total !== 100 || published} className="btn btn-primary">
          Save blueprint
        </button>
        {total !== 100 && <p className="text-xs text-warning">Weights total {total}; change them to total 100 before saving.</p>}
        <ActionMessages error={a.error} problems={a.problems} notice={a.notice} />
      </form>
    </details>
  );
}
