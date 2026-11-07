import { ctr } from '@/lib/studio/steps';

const W = 320;
const H = 160;
const PAD = { l: 44, r: 10, t: 10, b: 28 };

/** SVG points for CTR(s) over [0, maxSpend]; x/y in plot pixels. */
export function curvePath(ctrBase: number, kHalf: number, maxSpend: number, samples = 48): string {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const top = Math.max(ctrBase, 1e-9);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = (maxSpend * i) / samples;
    const x = PAD.l + (iw * i) / samples;
    const y = PAD.t + ih - (ih * ctr(s, ctrBase, kHalf)) / top;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** Live plot of CTR(s) = CTR_base × s / (s + K_half) (S4-07). No chart dependency. */
export function CurvePlot({ ctrBase, kHalf, maxSpend }: { ctrBase: number; kHalf: number; maxSpend: number }) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const kx = PAD.l + iw * Math.min(1, kHalf / maxSpend);
  const ky = PAD.t + ih / 2;
  const summary = `CTR curve: rises from 0 towards ${pct(ctrBase)}; reaches ${pct(ctr(kHalf, ctrBase, kHalf))} at a spend of ${kHalf.toLocaleString('en-GB')} (K_half) and ${pct(ctr(maxSpend, ctrBase, kHalf))} at ${maxSpend.toLocaleString('en-GB')}.`;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className="w-full max-w-md" data-testid="curve-plot">
        <line x1={PAD.l} y1={PAD.t + ih} x2={PAD.l + iw} y2={PAD.t + ih} stroke="currentColor" strokeOpacity={0.4} />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + ih} stroke="currentColor" strokeOpacity={0.4} />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l + iw} y2={PAD.t} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="4 4" />
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize="9" fill="currentColor">{pct(ctrBase)}</text>
        <text x={PAD.l - 4} y={PAD.t + ih} textAnchor="end" fontSize="9" fill="currentColor">0</text>
        <text x={PAD.l + iw} y={H - 8} textAnchor="end" fontSize="9" fill="currentColor">spend {maxSpend.toLocaleString('en-GB')}</text>
        <path d={curvePath(ctrBase, kHalf, maxSpend)} fill="none" stroke="var(--praxis-focus)" strokeWidth={2} data-testid="curve-path" />
        <line x1={kx} y1={ky} x2={kx} y2={PAD.t + ih} stroke="var(--praxis-accent)" strokeDasharray="3 3" />
        <circle cx={kx} cy={ky} r={3.5} fill="var(--praxis-accent)" />
        <text x={kx + 4} y={ky - 6} fontSize="9" fill="currentColor">K_half</text>
      </svg>
      <figcaption className="mt-1 text-xs text-fg-muted">{summary}</figcaption>
    </figure>
  );
}
