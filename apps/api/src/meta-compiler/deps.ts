import {
  CUSTOM_FIELD_STAGES,
  STUDIO_STEP_IDS,
  type BuildBundle,
  type BundleManifestEntry,
  type CustomField,
  type GenerateArtifacts,
  type GeneratedArtifacts,
  type HarborBlueprint,
  type StudioAnswerProblems,
  type StudioAnswers,
  type StudioStep,
  type StudioSteps,
} from '@praxis/shared';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { stableStringify } from '../lib/crypto';

/**
 * Stream 1 functions this stream calls (packages/shared/src/blueprint/contract.ts). Everything here is injected, so the
 * lead swaps in the real implementations when merging Stream 1.
 */
export interface MetaCompilerDeps {
  generate: GenerateArtifacts;
  studioSteps: StudioSteps;
  studioAnswerProblems: StudioAnswerProblems;
  buildBundle: BuildBundle;
}

/** The synthetic payload a verification run injects (S3-04): every control at its blueprint default. */
export function defaultAnswers(bp: HarborBlueprint): StudioAnswers {
  const o = bp.step_2_data_panels.oracle_annotator;
  return {
    fields: Object.fromEntries(allFields(bp).map((f) => [f.field_id, f.default_value])),
    inputs: Object.fromEntries(bp.step_2_data_panels.public_dropzones.map((d) => [d.id, `synthetic ${d.format} for ${d.id}\n`])),
    oracleRows: o.template_preview_rows.map((cells) => ({ cells, tag: o.sme_tag_options[0] ?? '' })),
    sliders: Object.fromEntries(bp.step_3_mcp_simulators.widgets.map((w) => [w.key, w.default])),
    invariantRuleIds: bp.step_4_invariant_catalog.rules.map((r) => r.id),
    milestoneWeights: Object.fromEntries(bp.step_5_default_rubric.milestones.map((m) => [m.id, m.weight])),
    instructionNotes: '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// TEMPORARY (Stream 2 placeholder until Stream 1 lands C1, C2 and C3). Replace `temporaryDeps` with the real
// `generateArtifacts`, `studioSteps`, `studioAnswerProblems` (packages/shared) and `buildBundle` (apps/api/src/harbor).
// Deterministic, but deliberately minimal: they only produce the shapes the API needs.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const allFields = (bp: HarborBlueprint): CustomField[] => CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s]);

const tempGenerate: GenerateArtifacts = (bp, answers) => {
  const a = answers ?? defaultAnswers(bp);
  const inject = (target: string) => allFields(bp).filter((f) => (f.inject_into as string[]).includes(target));
  const taskJson = {
    studio_id: bp.studio_id,
    title: bp.domain_meta.title,
    horizon: bp.domain_meta.horizon,
    harbor: bp.harbor_contract,
    modes: bp.template_meta.modes,
    custom: Object.fromEntries(inject('task.json').map((f) => [f.field_id, a.fields[f.field_id] ?? f.default_value])),
  };
  const tests = [
    ...bp.step_5_default_rubric.milestones.map((m) => `def test_${m.id}(env_state):\n    ${m.verifier_body.trim() || 'assert True'}\n`),
    ...inject('eval/test_verifiers.py').map((f) => `def test_custom_${f.field_id}(env_state):\n    assert ${f.verifier_assertion}\n`),
  ];
  const out: GeneratedArtifacts = {
    'UISpec.json': `${JSON.stringify(JSON.parse(stableStringify(bp)), null, 2)}\n`,
    'meta_prompt.md': `# ${bp.domain_meta.title}\n\nPersona: ${bp.domain_meta.persona_label}\n`,
    'instruction.md': `${bp.authored_content.instruction_md}\n${inject('instruction.md').map((f) => `- ${f.label}: ${JSON.stringify(a.fields[f.field_id] ?? f.default_value)}`).join('\n')}\n${a.instructionNotes}`,
    'task.json': `${stableStringify(taskJson)}\n`,
    'environment/mcp_mock.py': `PARAMS = ${stableStringify(a.sliders)}\nSEED_ROWS = ${stableStringify(bp.authored_content.mcp_mock_seed_rows)}\n`,
    'eval/test_verifiers.py': tests.join('\n'),
  };
  return out;
};

const tempStudioSteps: StudioSteps = (bp) => {
  const o = bp.step_2_data_panels.oracle_annotator;
  const steps: StudioStep[] = [
    { id: 'scenario', title: 'Scenario Setup', controls: [{ kind: 'text', key: 'title', label: 'Task title', multiline: false, required: true }, ...bp.custom_fields_by_stage.stage_1.map((field) => ({ kind: 'custom_field' as const, field }))] },
    { id: 'data_oracle', title: 'Data & Oracle Labelling', controls: [...bp.step_2_data_panels.public_dropzones.map((d) => ({ kind: 'dropzone' as const, dropzoneId: d.id, label: d.label, format: d.format, targetPath: d.target_path })), { kind: 'oracle_grid', columns: o.columns, tagOptions: o.sme_tag_options, previewRows: o.template_preview_rows }] },
    { id: 'simulator', title: 'Simulator Curve Tuning', controls: bp.step_3_mcp_simulators.widgets.map((w) => ({ kind: 'curve_slider' as const, key: w.key, label: w.label, archetype: w.archetype, min: w.min, max: w.max, default: w.default, step: w.step, formula: w.formula })) },
    { id: 'guardrails', title: 'Guardrail Thresholds', controls: bp.step_4_invariant_catalog.rules.map((r) => ({ kind: 'invariant_toggle' as const, ruleId: r.id, description: r.description })) },
    { id: 'rubric', title: 'Rubric Weighting', controls: bp.step_5_default_rubric.milestones.map((m) => ({ kind: 'weight_slider' as const, milestoneId: m.id, label: m.label, default: m.weight })) },
    { id: 'confirm', title: 'Final Confirmation', controls: [{ kind: 'text', key: 'instructionNotes', label: 'Business instructions', multiline: true, required: false }, { kind: 'summary' }] },
  ];
  return steps;
};

const tempAnswerProblems: StudioAnswerProblems = (bp, a) => {
  const out = Object.fromEntries(STUDIO_STEP_IDS.map((s) => [s, [] as string[]])) as ReturnType<StudioAnswerProblems>;
  const tags = bp.step_2_data_panels.oracle_annotator.sme_tag_options;
  if (a.oracleRows.length === 0) out.data_oracle.push('Label at least one oracle row');
  for (const r of a.oracleRows) if (!tags.includes(r.tag)) out.data_oracle.push(`Tag "${r.tag}" is not allowed`);
  for (const w of bp.step_3_mcp_simulators.widgets) {
    const v = a.sliders[w.key];
    if (typeof v !== 'number' || v < w.min || v > w.max) out.simulator.push(`${w.label}: choose a value from ${w.min} to ${w.max}`);
  }
  const total = Object.values(a.milestoneWeights).reduce((s, w) => s + w, 0);
  if (bp.step_5_default_rubric.milestones.length && total !== 100) out.rubric.push(`Weights must add up to 100 (now ${total})`);
  return out;
};

/** Minimal deterministic ustar writer (entries sorted, mtime 0, uid/gid 0, mode 0644). */
export function tarGz(files: Record<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  for (const name of Object.keys(files).sort()) {
    const data = files[name]!;
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write(octal(0o644, 8), 100);
    h.write(octal(0, 8), 108);
    h.write(octal(0, 8), 116);
    h.write(octal(data.length, 12), 124);
    h.write(octal(0, 12), 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

const tempBuildBundle: BuildBundle = (bp, answers, meta) => {
  const art = tempGenerate(bp, answers);
  const o = bp.step_2_data_panels.oracle_annotator;
  const files: Record<string, Buffer> = {
    'task.json': Buffer.from(art['task.json']),
    'instruction.md': Buffer.from(art['instruction.md']),
    'environment/mcp_mock.py': Buffer.from(art['environment/mcp_mock.py']),
    'eval/test_verifiers.py': Buffer.from(art['eval/test_verifiers.py']),
    'solution/solve.sh': Buffer.from(bp.authored_content.solve_sh),
    'bundle.json': Buffer.from(stableStringify(meta)),
  };
  for (const d of bp.step_2_data_panels.public_dropzones) files[d.target_path.replace(/^\//, '')] = Buffer.from(answers.inputs[d.id] ?? '');
  if (o.target_path) files[o.target_path.replace(/^\//, '')] = Buffer.from([o.columns.join(','), ...answers.oracleRows.map((r) => [...r.cells, r.tag].join(','))].join('\n'));
  const bytes = tarGz(files);
  const manifest: BundleManifestEntry[] = Object.keys(files).sort().map((path) => ({
    path,
    size: files[path]!.length,
    sha256: createHash('sha256').update(files[path]!).digest('hex'),
    hidden: path.startsWith('eval/') || path.startsWith('solution/'),
  }));
  return { bytes: new Uint8Array(bytes), sha256: createHash('sha256').update(bytes).digest('hex'), manifest };
};

export const temporaryDeps: MetaCompilerDeps = {
  generate: tempGenerate,
  studioSteps: tempStudioSteps,
  studioAnswerProblems: tempAnswerProblems,
  buildBundle: tempBuildBundle,
};
// ───────────────────────────────────────────── end of TEMPORARY ─────────────────────────────────────────────────

export function resolveDeps(overrides: Partial<MetaCompilerDeps> = {}): MetaCompilerDeps {
  return { ...temporaryDeps, ...overrides };
}
