import type { EdgeCase } from '@praxis/shared';
import { ChecksPanel, EdgeCaseList, type ChecksView } from '@praxis/shared/ui/benchmark-checks';

/** Templates → version detail: Studio's edge cases and the read-only checks (AUTHORING-SPEC 1.4, 2.3). */
export interface TemplateBenchmarkDto {
  edgeCases: EdgeCase[];
  sliceLists: { complexity: string[]; archetype: string[] };
  checks: ChecksView | null;
  studioTemplate: { templateId: string; version: number } | null;
}

export function TemplateBenchmarkPanel({ b }: { b: TemplateBenchmarkDto }) {
  if (!b.edgeCases.length && !b.checks) return null;
  return (
    <section aria-labelledby="studio-benchmark" className="mt-6 rounded-lg border border-line p-4">
      <h2 id="studio-benchmark" className="text-lg font-semibold">
        From Studio
      </h2>
      {b.studioTemplate && (
        <p className="text-sm text-fg-muted">
          Studio Template ID <span className="font-mono">{b.studioTemplate.templateId}</span> · version {b.studioTemplate.version}
        </p>
      )}
      {(b.sliceLists.complexity.length > 0 || b.sliceLists.archetype.length > 0) && (
        <p className="mt-2 text-sm">
          Slice tags (reviewer-only): Complexity {b.sliceLists.complexity.join(', ') || '—'} · Archetype {b.sliceLists.archetype.join(', ') || '—'}
        </p>
      )}
      <h3 className="mt-4 font-medium">Edge cases</h3>
      <EdgeCaseList edgeCases={b.edgeCases} />
      <h3 className="mt-4 font-medium">Checks</h3>
      <ChecksPanel checks={b.checks} />
    </section>
  );
}
