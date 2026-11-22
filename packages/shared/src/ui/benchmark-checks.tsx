import type { EdgeCase, VerifierBlockView, VerifierSlot } from '../benchmark';

/**
 * Read-only views of a template's Studio edge cases and verifier checks (AUTHORING-SPEC 1.4, 2.3). Authoring never
 * runs a check: these only show what the RL Gym will check. Shared by the console and the SME app.
 */

export interface ChecksView {
  expectedValuesFrom: 'case_reference' | 'sme';
  failureTaxonomy: string[];
  blocks: VerifierBlockView[];
  slots: VerifierSlot[];
}

const KIND: Record<VerifierBlockView['kind'], string> = { state: 'State', process: 'Process', rubric: 'Rubric' };

function blockDetail(b: VerifierBlockView, values: Record<string, unknown>) {
  if (b.kind === 'process') return b.mustCall ? `Must call ${b.mustCall}${b.before ? ` before ${b.before}` : ''}${b.after ? ` after ${b.after}` : ''}` : null;
  if (b.kind === 'rubric') return `${b.rubricId ?? 'rubric'}${b.sharePercent !== null ? ` · ${b.sharePercent}% of the criterion` : ''}`;
  const v = b.slotId ? values[b.slotId] : undefined;
  return b.slotId ? `Expected value from “${b.slotId}”${v !== undefined && v !== '' ? `: ${String(v)}` : ''}` : b.valueSource === 'case_reference' ? 'Expected value from each case’s private answers' : b.valueSource === 'fixed' ? `Expected value: ${JSON.stringify(b.fixedValue)}` : null;
}

export function EdgeCaseList({ edgeCases }: { edgeCases: EdgeCase[] }) {
  if (!edgeCases.length) return <p className="text-sm text-fg-muted">This template version has no edge cases.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Edge cases</caption>
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">Tag</th>
            <th scope="col" className="py-1 pr-3 font-medium">Archetype</th>
            <th scope="col" className="py-1 pr-3 font-medium">Complexity</th>
            <th scope="col" className="py-1 pr-3 font-medium">Products</th>
            <th scope="col" className="py-1 pr-3 font-medium">Scenario context</th>
            <th scope="col" className="py-1 font-medium">Edge-case twist</th>
          </tr>
        </thead>
        <tbody>
          {edgeCases.map((e) => (
            <tr key={e.tag} className="border-t border-line align-top">
              <td className="py-1 pr-3 font-mono text-xs">
                {e.tag}
                {e.source && <span className="block text-fg-muted">from {e.source}</span>}
              </td>
              <td className="py-1 pr-3">{e.archetype ?? '—'}</td>
              <td className="py-1 pr-3">{e.complexity ?? '—'}</td>
              <td className="py-1 pr-3">{e.products.join(', ') || '—'}</td>
              <td className="py-1 pr-3">{e.context || '—'}</td>
              <td className="py-1">{e.twist || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Checks panel: grouped by criterion, with each block's kind, failure code and (State) the generated query. */
export function ChecksPanel({ checks, values = {}, extraStateChecks = [] }: { checks: ChecksView | null; values?: Record<string, unknown>; extraStateChecks?: { table: string; row: string; column: string; op: string; value: unknown }[] }) {
  if (!checks) return <p className="text-sm text-fg-muted">This template version has no verifier checks from Studio.</p>;
  const byCriterion = new Map<string, VerifierBlockView[]>();
  for (const b of checks.blocks) byCriterion.set(b.criterionId || '—', [...(byCriterion.get(b.criterionId || '—') ?? []), b]);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-fg-muted">
        Read-only. The RL Gym runs these checks after every episode; Authoring never runs them. Expected values come from{' '}
        {checks.expectedValuesFrom === 'sme' ? 'the SME’s expected results on each task' : 'each case’s private answers in the dataset (SMEs fill nothing)'}.
        {checks.failureTaxonomy.length > 0 && <> Failure codes: {checks.failureTaxonomy.join(', ')}.</>}
      </p>
      {[...byCriterion.entries()].map(([criterion, blocks]) => (
        <section key={criterion} aria-label={`Checks for criterion ${criterion}`}>
          <h4 className="font-medium">Criterion {criterion}</h4>
          <ul className="mt-1 space-y-1">
            {blocks.map((b) => (
              <li key={b.id} className="rounded border border-line p-2">
                <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-xs">{KIND[b.kind]}</span>
                <span className="font-medium">{b.name}</span>
                <span className="ml-2 font-mono text-xs text-fg-muted">on fail: {b.onFail}</span>
                {blockDetail(b, values) && <span className="block text-fg-muted">{blockDetail(b, values)}</span>}
                {b.kind === 'state' && b.queryPreview && <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-xs">{b.queryPreview}</code>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {extraStateChecks.length > 0 && (
        <section aria-label="State checks added by the SME">
          <h4 className="font-medium">State checks added by the SME</h4>
          <ul className="mt-1 list-disc pl-5">
            {extraStateChecks.map((c, i) => (
              <li key={i} className="font-mono text-xs">
                {c.table} ({c.row}) · {c.column} {c.op} {JSON.stringify(c.value)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
