import { CUSTOM_FIELD_STAGES, type HarborBlueprint } from '@praxis/shared';
import Link from 'next/link';
import { modesText, tptText } from '@/lib/mc/format';

/** S1-15 / D10: read-only blueprint summary for PMs, with Create project. No Meta-Compiler controls. */
export function BlueprintSummary({ bp, templateId }: { bp: HarborBlueprint; templateId: string }) {
  const fields = CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s]);
  const rows: Array<[string, React.ReactNode]> = [
    ['SME role', bp.domain_meta.persona_label || '—'],
    ['Objective', bp.domain_meta.objective || '—'],
    ['TPT', tptText(bp.template_meta.tpt_minutes, bp.template_meta.tpt_label)],
    ['Horizon', `${bp.domain_meta.horizon.type}, ${bp.domain_meta.horizon.max_turns} × ${bp.domain_meta.horizon.cadence_unit || 'turn'}`],
    ['Modes', modesText(bp.template_meta.modes)],
    ['Skills', bp.catalog.skills.join(', ') || '—'],
    ['Primary work', bp.catalog.primary_work || '—'],
    ['Verification criteria', bp.catalog.verification_criteria || '—'],
    ['Public inputs', bp.step_2_data_panels.public_dropzones.map((z) => z.label).join(', ') || '—'],
    ['Simulator tools', bp.step_3_mcp_simulators.tools.map((t) => t.tool_id).join(', ') || '—'],
    ['Guardrails', bp.step_4_invariant_catalog.rules.length],
    ['Rubric', bp.step_5_default_rubric.milestones.map((m) => `${m.label || m.id} ${m.weight}%`).join(' · ') || '—'],
    ['Custom fields', fields.map((f) => f.label).join(', ') || '—'],
  ];
  return (
    <div className="mt-6 max-w-3xl">
      <dl className="card divide-y divide-hairline text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-2 sm:grid-cols-[12rem_1fr]">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="whitespace-pre-wrap">{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/projects/new?templateId=${templateId}`} className="btn btn-primary mt-4">
        Create project
      </Link>
    </div>
  );
}
