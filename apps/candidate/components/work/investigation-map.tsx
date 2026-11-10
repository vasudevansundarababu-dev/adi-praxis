'use client';
import { useEffect, useRef, useState } from 'react';
import type { KycStep } from '@praxis/shared';
/** Layout reflects dependency edges, never agent count or an execution receipt. */
export function InvestigationMap({ steps, selected, onSelect }: { steps: KycStep[]; selected: string | null; onSelect(id: string): void }) {
  const root = useRef<HTMLDivElement>(null), [edges, setEdges] = useState<string[]>([]);
  const levels = new Map<string, number>();
  const byId = new Map(steps.map(s => [s.id, s]));
  const level = (id: string, seen = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (seen.has(id)) return 0;
    const next = new Set([...seen, id]);
    const parents = (byId.get(id)?.dependsOn ?? []).filter(d => byId.has(d));
    const n = parents.length ? 1 + Math.max(...parents.map(d => level(d, next))) : 0;
    levels.set(id, n); return n;
  };
  steps.forEach(s => level(s.id));
  const rows = [...new Set(levels.values())].sort((a, b) => a - b);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const draw = () => {
      const bounds = el.getBoundingClientRect();
      const nodes = new Map(Array.from(el.querySelectorAll<HTMLButtonElement>('[data-step]')).map(n => [n.dataset.step!, n.getBoundingClientRect()]));
      setEdges(steps.flatMap(s => (s.dependsOn ?? []).flatMap(id => {
        const a = nodes.get(id), b = nodes.get(s.id); if (!a || !b) return [];
        const x = a.left + a.width / 2 - bounds.left, y = a.bottom - bounds.top;
        const xx = b.left + b.width / 2 - bounds.left, yy = b.top - bounds.top, mid = (y + yy) / 2;
        return [`M ${x} ${y} V ${mid} H ${xx} V ${yy - 3}`, `M ${xx - 3} ${yy - 7} L ${xx} ${yy - 3} L ${xx + 3} ${yy - 7}`];
      })));
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(el); return () => observer.disconnect();
  }, [steps]);
  return <div ref={root} className="relative space-y-8 py-3" aria-label="Investigation dependency graph">
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-fg-muted">{edges.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="1.2" />)}</svg>
    {rows.map(row => <div key={row} className="relative flex flex-wrap justify-center gap-3">{steps.filter(s => levels.get(s.id) === row).map(s => <button key={s.id} data-step={s.id} aria-pressed={selected === s.id} onClick={() => onSelect(s.id)} className={`relative z-10 min-w-0 flex-1 basis-40 rounded border bg-surface p-3 text-left ${selected === s.id ? 'border-fg' : 'border-line'}`}><b className="text-sm">{s.id} · {s.tool ?? 'Reasoning'}</b><p className="break-words text-xs">{s.expectedResult}</p><small className="text-fg-muted">{s.dependsOn?.length ? `After ${s.dependsOn.join(', ')}` : 'Start'}</small></button>)}</div>)}
  </div>;
}
