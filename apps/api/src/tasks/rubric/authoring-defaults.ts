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
  /** The forms these defaults belong to. */
  profileIds?: readonly string[];
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
      if ((ev.id === f.evaluator.id && ev.version === f.evaluator.version) || (!!profileId && !!f.profileIds?.includes(profileId))) {
        out.push(c);
        seen.add(c.id);
      }
    }
  return out;
}

export interface WeightTotal {
  /** The total the S7 weights must reach, or null when the template sets none (weights must only be above 0). */
  total: number | null;
  source: 'template_field' | 'template_criteria' | 'none';
}

/**
 * D-029 (owner, 23 Nov 2026): the S7 weight total comes from the live template, never a hard-coded 100.
 * 1. The template's criterion field declares weightTotal: that total.
 * 2. Otherwise the criteria the template maps each have a default weight: their sum (Golden KYC v6: 5 criteria × 5 = 25).
 * 3. Otherwise no fixed total: each weight must be above 0, and the total is reported.
 */
export function expectedWeightTotal(execution: unknown, profileId: string | null | undefined, declared?: number): WeightTotal {
  if (typeof declared === 'number' && declared > 0) return { total: declared, source: 'template_field' };
  const mapped = evaluatorsOf(execution);
  const defaults = authoringDefaultsFor(execution, profileId);
  if (mapped.size > 0 && defaults.length === mapped.size && defaults.every((d) => typeof d.weight === 'number' && d.weight > 0)) {
    return { total: Math.round(defaults.reduce((n, d) => n + (d.weight as number), 0) * 100) / 100, source: 'template_criteria' };
  }
  return { total: null, source: 'none' };
}
