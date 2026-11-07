import type { Domain, Template } from '@prisma/client';
import {
  BLUEPRINT_SECTIONS,
  CoverageDimensions,
  CUSTOM_FIELD_STAGES,
  EdgeCaseCatalog,
  emptyBlueprint,
  HarborBlueprint,
  sectionProblems,
  validSectionCount,
  type CustomField,
  type SectionProblems,
} from '@praxis/shared';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';

type TemplateRow = Template & { domain: Domain };

/**
 * The template's blueprint. A template without one (the old catalog) gets a blueprint pre-filled from its catalog
 * fields (panel 0, D11b), so opening it in the Meta-Compiler never loses today's data.
 */
export function blueprintOf(t: TemplateRow): HarborBlueprint {
  if (t.blueprint !== null) {
    const parsed = HarborBlueprint.safeParse(t.blueprint);
    if (parsed.success) return parsed.data;
  }
  const bp = emptyBlueprint();
  bp.catalog = {
    ...bp.catalog,
    primary_work: t.primaryWork ?? '',
    verification_criteria: t.verificationCriteria ?? '',
    human_gate: t.humanGate ?? '',
    skills: t.skills,
    default_jd_id: t.defaultJdId,
    task_modes: t.taskModes,
    coverage_dimensions: CoverageDimensions.safeParse(t.coverageDimensions).data ?? { dimensions: [], cells: [] },
    edge_case_catalog: EdgeCaseCatalog.safeParse(t.edgeCaseCatalog).data ?? [],
    default_distinct_target: t.defaultDistinctTarget,
    default_max_per_expert: t.defaultMaxPerExpert,
  };
  bp.template_meta = { ...bp.template_meta, label: t.workflowName, domain_category: t.domain.name, version: t.version, tpt_minutes: t.defaultTptMinutes, modes: t.executionMode ? [t.executionMode] : [] };
  return bp;
}

/** `sectionProblems` plus the rules only the server can check (D-03): the Studio Blueprint ID is unique per client. */
export async function serverProblems(tx: Db | Tx, t: Pick<Template, 'clientId' | 'lineageId'>, bp: HarborBlueprint): Promise<SectionProblems> {
  const problems = sectionProblems(bp);
  if (bp.studio_id) {
    const clash = await tx.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM "Template" WHERE client_id = ${t.clientId}::uuid AND lineage_id <> ${t.lineageId}::uuid AND blueprint->>'studio_id' = ${bp.studio_id} LIMIT 1`;
    if (clash.length) problems.stage_1.push(`Studio Blueprint ID "${bp.studio_id}" is already used by another workflow`);
  }
  return problems;
}

export const isComplete = (p: SectionProblems) => validSectionCount(p) === BLUEPRINT_SECTIONS.length;

export const blueprintHash = (bp: HarborBlueprint) => sha256(stableStringify(bp));

/** Problems for one custom field, validated exactly like a field added by hand (S2-08, S2-14). */
export function fieldProblems(field: CustomField, stage: (typeof CUSTOM_FIELD_STAGES)[number] = 'stage_1'): string[] {
  const bp = emptyBlueprint();
  bp.custom_fields_by_stage[stage] = [field];
  return sectionProblems(bp)[stage].filter((p) => p.startsWith(`Custom field "${field.field_id}"`));
}

/**
 * The blueprint as the SME's agent-facing view sees it (D-21): verifier code, verifier assertions, the oracle script
 * and the hidden ground-truth path are removed. The SME still sees the oracle grid's columns, tags and preview rows.
 */
export function agentFacingBlueprint(bp: HarborBlueprint): HarborBlueprint {
  const v = structuredClone(bp);
  v.step_2_data_panels.oracle_annotator.target_path = '';
  v.authored_content.solve_sh = '';
  v.step_5_default_rubric.milestones = v.step_5_default_rubric.milestones.map((m) => ({ ...m, verifier_body: '' }));
  for (const s of CUSTOM_FIELD_STAGES) v.custom_fields_by_stage[s] = v.custom_fields_by_stage[s].map((f) => ({ ...f, verifier_assertion: '' }));
  return v;
}

/** `45m (12 Wks)`-style TPT label (S1-08). */
export function tptLabel(bp: HarborBlueprint | null, fallbackMinutes: number | null): { minutes: number | null; label: string } {
  const minutes = bp?.template_meta.tpt_minutes ?? fallbackMinutes;
  if (bp?.template_meta.tpt_label) return { minutes, label: bp.template_meta.tpt_label };
  if (minutes === null) return { minutes, label: '—' };
  const h = bp?.domain_meta.horizon;
  return { minutes, label: h?.cadence_unit ? `${minutes}m (${h.max_turns} ${h.cadence_unit})` : `${minutes}m` };
}
