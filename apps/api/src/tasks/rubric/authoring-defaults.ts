import type { CriterionDefault } from '@praxis/shared';
import { evaluatorsOf } from '@praxis/shared';
import { GOLDEN_KYC_RUBRIC_V1_DEFAULTS } from './defaults/golden-kyc-rubric-v1';

/**
 * D8 (owner, 15 Nov 2026, non-integration): default criteria kept in Authoring, keyed by the evaluator a template maps
 * its criteria to. Data, not code: one JSON file per evaluator. Applied only when the template's own criterion field
 * carries no defaults; the stored template, its hashes and the export are unchanged.
 */
interface DefaultsFile {
  evaluator: { id: string; version: string };
  scale: 'five_two_zero' | 'zero_to_four';
  criteria: CriterionDefault[];
}
const FILES: DefaultsFile[] = [GOLDEN_KYC_RUBRIC_V1_DEFAULTS as unknown as DefaultsFile];

export function authoringDefaultsFor(execution: unknown): CriterionDefault[] {
  const map = evaluatorsOf(execution);
  const out: CriterionDefault[] = [];
  for (const f of FILES)
    for (const c of f.criteria) {
      const ev = map.get(c.id);
      if (ev && ev.id === f.evaluator.id && ev.version === f.evaluator.version) out.push(c);
    }
  return out;
}
