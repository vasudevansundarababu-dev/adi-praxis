import type { AnvilDefinitionDto } from '@praxis/shared';

/** Anvil readiness of one template version (Praxis-Anvil contract, 12 Nov 2026): published here and qualified by Anvil. */
export interface AnvilReadiness {
  versionHash: string;
  proposedByAnvil: boolean;
  qualification: 'none' | 'qualified' | 'revoked';
  receiptId: string | null;
  qualifiedAt: string | null;
  anvilReady: boolean;
  requirementId: string | null;
  channel: string | null;
  /** Summary of Anvil's parts; null for a template without `anvilSpec`. */
  definition?: AnvilDefinitionDto | null;
}

export function AnvilReadinessBadge({ r }: { r: AnvilReadiness }) {
  const text = r.anvilReady
    ? `Anvil-ready for benchmarks (receipt ${r.receiptId})`
    : r.qualification === 'revoked'
      ? 'Anvil revoked its qualification of this version: not ready for benchmarks'
      : 'Not yet qualified by Anvil for benchmarks';
  return (
    <p className={`mt-2 text-sm ${r.anvilReady ? 'text-success' : 'text-fg-muted'}`} role="status">
      {text}
      {r.proposedByAnvil && r.requirementId ? ` · proposed by Anvil for requirement ${r.requirementId}${r.channel ? ` (${r.channel})` : ''}` : ''}
    </p>
  );
}
