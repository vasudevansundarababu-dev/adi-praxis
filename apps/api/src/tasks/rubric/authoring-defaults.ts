import type { CriterionDefault } from '@praxis/shared';
import { evaluatorsOf } from '@praxis/shared';
import { GOLDEN_KYC_RUBRIC_V1_DEFAULTS } from './defaults/golden-kyc-rubric-v1';
import { MARKETING_TASK2_RUBRIC_V1_DEFAULTS } from './defaults/marketing-task2-rubric-v1';

/**
 * D8 (owner, 15 Nov 2026, non-integration): default criteria kept in Authoring, keyed by the evaluator a template maps
 * its criteria to. Data, not code: one file per evaluator. Applied only when the template's own criterion field
 * carries no defaults; the stored template, its hashes and the export are unchanged.
 * D22 (16 Nov 2026): a file may also name the form (profile) it belongs to; its defaults then apply to that form's
 * mapped criteria whatever evaluator the template names. A criterion the template does not map never gets one.
 */
interface DefaultsFile {
  evaluator: { id: string; version: string };
  profileId?: string;
  scale: 'five_two_zero' | 'zero_to_four';
  criteria: CriterionDefault[];
}
const FILES: DefaultsFile[] = [GOLDEN_KYC_RUBRIC_V1_DEFAULTS as unknown as DefaultsFile, MARKETING_TASK2_RUBRIC_V1_DEFAULTS];

export function authoringDefaultsFor(execution: unknown, profileId?: string | null): CriterionDefault[] {
  const map = evaluatorsOf(execution);
  const out: CriterionDefault[] = [];
  const seen = new Set<string>();
  for (const f of FILES)
    for (const c of f.criteria) {
      const ev = map.get(c.id);
      if (!ev || seen.has(c.id)) continue;
      if ((ev.id === f.evaluator.id && ev.version === f.evaluator.version) || (!!f.profileId && f.profileId === profileId)) {
        out.push(c);
        seen.add(c.id);
      }
    }
  return out;
}
