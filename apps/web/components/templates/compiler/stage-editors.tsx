'use client';

import {
  CoverageDimensions,
  DATAPANEL_FORMATS,
  EdgeCaseCatalog,
  EXECUTION_MODES,
  HORIZON_TYPES,
  INVARIANT_OPERATORS,
  normaliseWeights,
  TASK_MODES,
  VERIFIER_TEMPLATES,
  WIDGET_ARCHETYPES,
  type BlueprintSection,
  type HarborBlueprint,
} from '@praxis/shared';
import { useEffect, useState } from 'react';
import { coupleWeights, edit, parseList } from '@/lib/mc/editor';
import { MODE_LABELS } from '@/lib/mc/format';
import { CheckboxGroup, inputClass, Labelled, ListField, NumberField, SectionCard, SelectField, SmallButton, TextField, Toggle } from './inputs';

export interface StageEditorProps {
  bp: HarborBlueprint;
  onChange: (next: HarborBlueprint) => void;
  jobDescriptions: Array<{ id: string; title: string }>;
}

export function StageEditor({ section, ...props }: StageEditorProps & { section: BlueprintSection }) {
  switch (section) {
    case 'catalog':
      return <CatalogEditor {...props} />;
    case 'stage_1':
      return <Stage1Editor {...props} />;
    case 'stage_2':
      return <Stage2Editor {...props} />;
    case 'stage_3':
      return <Stage3Editor {...props} />;
    case 'stage_4':
      return <Stage4Editor {...props} />;
    case 'stage_5':
      return <Stage5Editor {...props} />;
  }
}

const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

/** JSON editor for nested catalog structures; applies only valid JSON that passes the schema. */
function JsonField<T>({ label, value, schema, onChange, hint }: { label: string; value: T; schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }; onChange: (v: T) => void; hint?: string }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value)) return;
    } catch {
      /* keep the user's partial text until the value changes from outside */
      return;
    }
    setText(JSON.stringify(value, null, 2));
    setProblem(null);
  }, [value]);
  return (
    <Labelled label={label} hint={hint}>
      {(id, d) => (
        <>
          <textarea
            id={id}
            aria-describedby={d}
            aria-invalid={problem ? true : undefined}
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              try {
                const r = schema.safeParse(JSON.parse(e.target.value));
                if (r.success) {
                  setProblem(null);
                  onChange(r.data);
                } else setProblem(r.error.issues[0]?.message ?? 'Invalid');
              } catch {
                setProblem('Not valid JSON yet');
              }
            }}
            className={`${inputClass} font-mono text-xs`}
          />
          {problem && <p className="mt-0.5 text-xs text-error">{problem}</p>}
        </>
      )}
    </Labelled>
  );
}

function CatalogEditor({ bp, onChange, jobDescriptions }: StageEditorProps) {
  const c = bp.catalog;
  const set = (m: (d: HarborBlueprint['catalog']) => void) => onChange(edit(bp, (d) => m(d.catalog)));
  return (
    <SectionCard title="0. Catalog & Staffing">
      <TextField label="Primary work" multiline value={c.primary_work} onChange={(v) => set((d) => void (d.primary_work = v))} />
      <TextField label="Verification criteria" multiline value={c.verification_criteria} onChange={(v) => set((d) => void (d.verification_criteria = v))} />
      <TextField label="Human gate" multiline value={c.human_gate} onChange={(v) => set((d) => void (d.human_gate = v))} />
      <ListField label="Skills" value={c.skills} onChange={(v) => set((d) => void (d.skills = v))} />
      <SelectField
        label="Default job description"
        value={c.default_jd_id ?? ''}
        options={[{ value: '', label: 'None' }, ...jobDescriptions.map((j) => ({ value: j.id, label: j.title }))]}
        onChange={(v) => set((d) => void (d.default_jd_id = v || null))}
      />
      <CheckboxGroup legend="Task modes" options={TASK_MODES} value={c.task_modes} labels={{ AUTHORING: 'Authoring', ANNOTATION: 'Annotation' }} onChange={(v) => set((d) => void (d.task_modes = v))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Default distinct target" integer min={1} value={c.default_distinct_target} onChange={(v) => set((d) => void (d.default_distinct_target = v ?? 1))} />
        <NumberField label="Default max tasks per expert" integer min={1} value={c.default_max_per_expert} onChange={(v) => set((d) => void (d.default_max_per_expert = v ?? 1))} />
      </div>
      <JsonField label="Coverage dimensions (JSON)" value={c.coverage_dimensions} schema={CoverageDimensions} onChange={(v) => set((d) => void (d.coverage_dimensions = v))} />
      <JsonField label="Edge-case catalog (JSON)" value={c.edge_case_catalog} schema={EdgeCaseCatalog} onChange={(v) => set((d) => void (d.edge_case_catalog = v))} />
    </SectionCard>
  );
}

function Stage1Editor({ bp, onChange }: StageEditorProps) {
  const set = (m: (d: HarborBlueprint) => void) => onChange(edit(bp, m));
  const h = bp.domain_meta.horizon;
  return (
    <>
      <SectionCard title="1. Domain, Persona & Horizon">
        <TextField label="Studio Blueprint ID" mono value={bp.studio_id} hint="Lowercase letters, digits, - or _. Unique in your organisation." onChange={(v) => set((d) => void (d.studio_id = v))} />
        <TextField label="Display title" value={bp.domain_meta.title} onChange={(v) => set((d) => void (d.domain_meta.title = v))} />
        <TextField label="SME role persona" value={bp.domain_meta.persona_label} onChange={(v) => set((d) => void (d.domain_meta.persona_label = v))} />
        <TextField label="Objective" multiline value={bp.domain_meta.objective} onChange={(v) => set((d) => void (d.domain_meta.objective = v))} />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Execution topology" value={h.type} options={HORIZON_TYPES} onChange={(v) => set((d) => void (d.domain_meta.horizon.type = v))} />
          <NumberField label="Max horizon turns" integer min={1} value={h.max_turns} onChange={(v) => set((d) => void (d.domain_meta.horizon.max_turns = Math.max(1, v ?? 1)))} />
          <TextField label="Cadence unit label" value={h.cadence_unit} placeholder="Wks, Steps…" onChange={(v) => set((d) => void (d.domain_meta.horizon.cadence_unit = v))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="TPT (minutes)" integer min={1} max={480} value={bp.template_meta.tpt_minutes} onChange={(v) => set((d) => void (d.template_meta.tpt_minutes = v))} />
          <TextField label="TPT horizon label" value={bp.template_meta.tpt_label} placeholder="12 Wks" onChange={(v) => set((d) => void (d.template_meta.tpt_label = v))} />
        </div>
        <CheckboxGroup legend="Execution modes" options={EXECUTION_MODES} labels={MODE_LABELS} value={bp.template_meta.modes} onChange={(v) => set((d) => void (d.template_meta.modes = v))} />
      </SectionCard>
      <SectionCard title="Harbor contract">
        <Toggle label="ATIF v1.2 trajectories" checked={bp.harbor_contract.atif_v1_2} onChange={(v) => set((d) => void (d.harbor_contract.atif_v1_2 = v))} />
        <Toggle label="--network=internal" checked disabled onChange={() => undefined} hint="Always on: every Harbor task runs hermetically with no outbound network (NFR-01)." />
        <Toggle label="Require solution/solve.sh" checked={bp.harbor_contract.require_solve_sh} onChange={(v) => set((d) => void (d.harbor_contract.require_solve_sh = v))} />
        <Toggle label="Zero-Baseline Gate" checked={bp.harbor_contract.zero_baseline_gate} onChange={(v) => set((d) => void (d.harbor_contract.zero_baseline_gate = v))} />
      </SectionCard>
    </>
  );
}

function Stage2Editor({ bp, onChange }: StageEditorProps) {
  const set = (m: (d: HarborBlueprint) => void) => onChange(edit(bp, m));
  const dz = bp.step_2_data_panels.public_dropzones;
  const o = bp.step_2_data_panels.oracle_annotator;
  return (
    <>
      <SectionCard
        title="Public dropzones (agent-visible)"
        actions={
          <SmallButton onClick={() => set((d) => void d.step_2_data_panels.public_dropzones.push({ id: `input_${dz.length + 1}`, label: '', target_path: '/workspace/inputs/', format: 'csv', description: '' }))}>
            + Add dropzone
          </SmallButton>
        }
      >
        {dz.length === 0 && <p className="text-sm text-fg-muted">No dropzones yet.</p>}
        {dz.map((z, i) => (
          <fieldset key={i} className="rounded-md border border-hairline p-3">
            <legend className="px-1 text-xs font-semibold">Dropzone {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="ID" mono value={z.id} onChange={(v) => set((d) => void (d.step_2_data_panels.public_dropzones[i]!.id = v))} />
              <TextField label="Label" value={z.label} onChange={(v) => set((d) => void (d.step_2_data_panels.public_dropzones[i]!.label = v))} />
              <TextField label="Target path" mono value={z.target_path} hint="A file under /workspace/inputs/" onChange={(v) => set((d) => void (d.step_2_data_panels.public_dropzones[i]!.target_path = v))} />
              <SelectField label="Format" value={z.format} options={DATAPANEL_FORMATS} onChange={(v) => set((d) => void (d.step_2_data_panels.public_dropzones[i]!.format = v))} />
            </div>
            <div className="mt-2">
              <SmallButton tone="danger" label={`Remove dropzone ${z.id}`} onClick={() => set((d) => void d.step_2_data_panels.public_dropzones.splice(i, 1))}>
                Remove
              </SmallButton>
            </div>
          </fieldset>
        ))}
      </SectionCard>
      <SectionCard title="Hidden Oracle Table Annotator">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Dataset name" value={o.dataset_name} onChange={(v) => set((d) => void (d.step_2_data_panels.oracle_annotator.dataset_name = v))} />
          <TextField label="Ground-truth path" mono value={o.target_path} hint="A file under /eval/ground_truth/ (hidden from the agent)" onChange={(v) => set((d) => void (d.step_2_data_panels.oracle_annotator.target_path = v))} />
        </div>
        <ListField
          label="Columns"
          value={o.columns}
          onChange={(v) =>
            set((d) => {
              const a = d.step_2_data_panels.oracle_annotator;
              a.columns = v;
              a.template_preview_rows = a.template_preview_rows.map((r) => v.map((_, ci) => r[ci] ?? ''));
            })
          }
        />
        <ListField label="SME tag options" value={o.sme_tag_options} onChange={(v) => set((d) => void (d.step_2_data_panels.oracle_annotator.sme_tag_options = v))} />
        <div>
          <p className="text-sm font-medium">Preview rows (synthetic)</p>
          {o.columns.length === 0 ? (
            <p className="text-xs text-fg-muted">Add columns first.</p>
          ) : (
            <table className="mt-1 w-full text-xs">
              <thead>
                <tr>
                  {o.columns.map((c) => (
                    <th key={c} scope="col" className="px-1 text-left font-medium">
                      {c}
                    </th>
                  ))}
                  <th scope="col" className="sr-only">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.template_preview_rows.map((r, ri) => (
                  <tr key={ri}>
                    {o.columns.map((c, ci) => (
                      <td key={c} className="px-1 py-0.5">
                        <input aria-label={`Row ${ri + 1} ${c}`} value={r[ci] ?? ''} onChange={(e) => set((d) => void (d.step_2_data_panels.oracle_annotator.template_preview_rows[ri]![ci] = e.target.value))} className={`${inputClass} !mt-0`} />
                      </td>
                    ))}
                    <td className="px-1">
                      <SmallButton tone="danger" label={`Remove row ${ri + 1}`} onClick={() => set((d) => void d.step_2_data_panels.oracle_annotator.template_preview_rows.splice(ri, 1))}>
                        ×
                      </SmallButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {o.columns.length > 0 && (
            <div className="mt-2">
              <SmallButton onClick={() => set((d) => void d.step_2_data_panels.oracle_annotator.template_preview_rows.push(o.columns.map(() => '')))}>+ Add row</SmallButton>
            </div>
          )}
        </div>
      </SectionCard>
    </>
  );
}

function Stage3Editor({ bp, onChange }: StageEditorProps) {
  const set = (m: (d: HarborBlueprint) => void) => onChange(edit(bp, m));
  const sim = bp.step_3_mcp_simulators;
  return (
    <>
      <SectionCard title="MCP simulator tools" actions={<SmallButton onClick={() => set((d) => void d.step_3_mcp_simulators.tools.push({ tool_id: `tool_${sim.tools.length + 1}`, description: '', parameters: [] }))}>+ Add tool</SmallButton>}>
        {sim.tools.map((t, i) => (
          <fieldset key={i} className="rounded-md border border-hairline p-3">
            <legend className="px-1 text-xs font-semibold">Tool {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Tool ID" mono value={t.tool_id} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.tools[i]!.tool_id = v))} />
              <TextField label="Description" value={t.description} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.tools[i]!.description = v))} />
            </div>
            <p className="mt-2 text-xs font-medium">Parameters</p>
            {t.parameters.map((p, pi) => (
              <div key={pi} className="mt-1 grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <TextField label={`Parameter ${pi + 1} name`} mono value={p.name} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.tools[i]!.parameters[pi]!.name = v))} />
                <SelectField label="Type" value={p.type} options={['string', 'number', 'boolean'] as const} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.tools[i]!.parameters[pi]!.type = v))} />
                <SmallButton tone="danger" label={`Remove parameter ${p.name}`} onClick={() => set((d) => void d.step_3_mcp_simulators.tools[i]!.parameters.splice(pi, 1))}>
                  ×
                </SmallButton>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <SmallButton onClick={() => set((d) => void d.step_3_mcp_simulators.tools[i]!.parameters.push({ name: `param_${t.parameters.length + 1}`, type: 'string', description: '' }))}>+ Parameter</SmallButton>
              <SmallButton tone="danger" label={`Remove tool ${t.tool_id}`} onClick={() => set((d) => void d.step_3_mcp_simulators.tools.splice(i, 1))}>
                Remove tool
              </SmallButton>
            </div>
          </fieldset>
        ))}
      </SectionCard>
      <SectionCard
        title="SME widgets"
        actions={
          <SmallButton onClick={() => set((d) => void d.step_3_mcp_simulators.widgets.push({ archetype: 'diminishing_returns_curve_slider', key: `slider_${sim.widgets.length + 1}`, label: '', min: 0, max: 100, default: 50, step: 1, formula: '' }))}>
            + Add widget
          </SmallButton>
        }
      >
        {sim.widgets.map((w, i) => (
          <fieldset key={i} className="rounded-md border border-hairline p-3">
            <legend className="px-1 text-xs font-semibold">Widget {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Archetype" value={w.archetype} options={WIDGET_ARCHETYPES} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.archetype = v))} />
              <TextField label="Slider key" mono value={w.key} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.key = v))} />
              <TextField label="Label" value={w.label} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.label = v))} />
              <TextField label="Formula (display only)" mono value={w.formula} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.formula = v))} />
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <NumberField label="Min" value={w.min} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.min = v ?? 0))} />
              <NumberField label="Default" value={w.default} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.default = v ?? 0))} />
              <NumberField label="Max" value={w.max} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.max = v ?? 0))} />
              <NumberField label="Step" value={w.step} min={0} onChange={(v) => set((d) => void (d.step_3_mcp_simulators.widgets[i]!.step = v && v > 0 ? v : 1))} />
            </div>
            <div className="mt-2">
              <SmallButton tone="danger" label={`Remove widget ${w.key}`} onClick={() => set((d) => void d.step_3_mcp_simulators.widgets.splice(i, 1))}>
                Remove widget
              </SmallButton>
            </div>
          </fieldset>
        ))}
      </SectionCard>
    </>
  );
}

function thresholdText(t: number | string | string[]): string {
  return Array.isArray(t) ? t.join(', ') : String(t);
}

function Stage4Editor({ bp, onChange }: StageEditorProps) {
  const set = (m: (d: HarborBlueprint) => void) => onChange(edit(bp, m));
  const inv = bp.step_4_invariant_catalog;
  return (
    <>
      <SectionCard title="Allowed subjects">
        <ListField label="Subjects a rule may test" value={inv.allowed_subjects} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.allowed_subjects = v))} />
      </SectionCard>
      <SectionCard
        title="Default IF / THEN rules"
        actions={
          <SmallButton onClick={() => set((d) => void d.step_4_invariant_catalog.rules.push({ id: `rule_${inv.rules.length + 1}`, subject: inv.allowed_subjects[0] ?? '', operator: 'GREATER_THAN', threshold: 0, penalty: 'HARD_FAIL', description: '' }))}>
            + Add rule
          </SmallButton>
        }
      >
        {inv.rules.map((r, i) => (
          <fieldset key={i} className="rounded-md border border-hairline p-3">
            <legend className="px-1 text-xs font-semibold">Rule {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Rule ID" mono value={r.id} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.id = v))} />
              <SelectField
                label="IF subject"
                value={r.subject}
                options={[...new Set([...(inv.allowed_subjects.includes(r.subject) ? [] : [r.subject]), ...inv.allowed_subjects])]}
                onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.subject = v))}
              />
              <SelectField
                label="Operator"
                value={r.operator}
                options={INVARIANT_OPERATORS}
                onChange={(v) =>
                  set((d) => {
                    const rule = d.step_4_invariant_catalog.rules[i]!;
                    rule.operator = v;
                    rule.threshold = v === 'GREATER_THAN' ? Number(thresholdText(rule.threshold)) || 0 : v === 'CONTAINS_ANY' ? parseList(thresholdText(rule.threshold)) : thresholdText(rule.threshold);
                  })
                }
              />
              {r.operator === 'GREATER_THAN' ? (
                <NumberField label="Threshold" value={typeof r.threshold === 'number' ? r.threshold : null} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.threshold = v ?? 0))} />
              ) : r.operator === 'CONTAINS_ANY' ? (
                <ListField label="Threshold values" value={Array.isArray(r.threshold) ? r.threshold : []} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.threshold = v))} />
              ) : (
                <TextField label="Threshold value" value={thresholdText(r.threshold)} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.threshold = v))} />
              )}
            </div>
            <p className="mt-2 text-xs">
              THEN <span className="pill pill-error">Hard Fail −1.0</span>
            </p>
            <div className="mt-2">
              <TextField label="Description" value={r.description} onChange={(v) => set((d) => void (d.step_4_invariant_catalog.rules[i]!.description = v))} />
            </div>
            <div className="mt-2">
              <SmallButton tone="danger" label={`Remove rule ${r.id}`} onClick={() => set((d) => void d.step_4_invariant_catalog.rules.splice(i, 1))}>
                Remove rule
              </SmallButton>
            </div>
          </fieldset>
        ))}
      </SectionCard>
    </>
  );
}

function Stage5Editor({ bp, onChange }: StageEditorProps) {
  const set = (m: (d: HarborBlueprint) => void) => onChange(edit(bp, m));
  const ms = bp.step_5_default_rubric.milestones;
  const total = ms.reduce((a, m) => a + m.weight, 0);
  const setWeights = (w: number[]) => set((d) => d.step_5_default_rubric.milestones.forEach((m, i) => void (m.weight = w[i]!)));
  return (
    <SectionCard
      title="Ordered milestones"
      actions={
        <>
          <SmallButton onClick={() => setWeights(normaliseWeights(ms.map((m) => m.weight)))}>Auto-normalise</SmallButton>
          <SmallButton onClick={() => set((d) => void d.step_5_default_rubric.milestones.push({ id: `milestone_${ms.length + 1}`, label: '', weight: 0, verifier_template: 'f1_set_match', verifier_body: '' }))}>+ Add milestone</SmallButton>
        </>
      }
    >
      <p aria-live="polite" className={`text-sm font-medium ${total === 100 ? 'text-success' : 'text-error'}`}>
        Total weight {total}% {total === 100 ? '(locked to 100%)' : '(must be exactly 100%)'}
      </p>
      <ol className="space-y-3">
        {ms.map((m, i) => (
          <li key={i} className="rounded-md border border-hairline p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label={`Milestone ${i + 1} ID`} mono value={m.id} onChange={(v) => set((d) => void (d.step_5_default_rubric.milestones[i]!.id = v))} />
              <TextField label="Label" value={m.label} onChange={(v) => set((d) => void (d.step_5_default_rubric.milestones[i]!.label = v))} />
              <SelectField label="Verifier template" value={m.verifier_template} options={VERIFIER_TEMPLATES} onChange={(v) => set((d) => void (d.step_5_default_rubric.milestones[i]!.verifier_template = v))} />
            </div>
            <Labelled label={`Weight for ${m.label || m.id}`}>
              {(id) => (
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id={id}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={m.weight}
                    aria-valuetext={`${m.weight} percent`}
                    onChange={(e) => setWeights(coupleWeights(ms.map((x) => x.weight), i, Number(e.target.value)))}
                    className="w-full accent-[var(--praxis-focus)]"
                  />
                  <output htmlFor={id} className="w-12 text-right font-mono text-sm">
                    {m.weight}%
                  </output>
                </div>
              )}
            </Labelled>
            <TextField label="Verifier body (Python, Admin-accepted)" multiline mono value={m.verifier_body} onChange={(v) => set((d) => void (d.step_5_default_rubric.milestones[i]!.verifier_body = v))} />
            <div className="mt-2 flex gap-2">
              <SmallButton label={`Move ${m.id} up`} onClick={() => set((d) => void (d.step_5_default_rubric.milestones = move(d.step_5_default_rubric.milestones, i, -1)))}>
                ↑
              </SmallButton>
              <SmallButton label={`Move ${m.id} down`} onClick={() => set((d) => void (d.step_5_default_rubric.milestones = move(d.step_5_default_rubric.milestones, i, 1)))}>
                ↓
              </SmallButton>
              <SmallButton tone="danger" label={`Remove milestone ${m.id}`} onClick={() => set((d) => void d.step_5_default_rubric.milestones.splice(i, 1))}>
                Remove
              </SmallButton>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
