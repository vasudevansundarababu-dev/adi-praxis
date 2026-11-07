import { STUDIO_STEP_IDS, type StudioAnswers } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OracleGrid, SimulatorSlider, WeightSliders } from '@/components/studio/controls';
import { CurvePlot, curvePath } from '@/components/studio/curve-plot';
import { StudioClosed } from '@/components/studio/studio-closed';
import { DbMetadata, StudioWorkbench, type StudioWorkbenchProps } from '@/components/studio/studio-workbench';
import { handleStudioMock, mockStudioBlueprint, resetStudioMock } from '@/lib/studio/mock-backend';
import {
  allCustomFields,
  ctr,
  curveParams,
  defaultStudioAnswers,
  oracleGridRows,
  setOracleTag,
  stableJson,
  studioAnswerProblems,
  studioSteps,
  taskJsonPreview,
  withDefaults,
} from '@/lib/studio/steps';
import type { StudioConfig } from '@/lib/studio/types';

// The workbench calls useRouter(); there is no App Router in a unit test, so the hook is replaced by a no-op router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const html = renderToStaticMarkup;
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const SME = { smeUserId: '00000000-0000-4000-8000-000000000001' };
const KEY = 'mktg-noise-cancelling-launch-a1b2c3';

/** Answers that pass every step. */
function complete(): StudioAnswers {
  const bp = mockStudioBlueprint();
  const a = defaultStudioAnswers(bp);
  return { ...a, fields: { ...a.fields, title: 'Q4 launch, UK only (synthetic)' }, oracleRows: [{ cells: ['quiet phone deal', '1200'], tag: 'BUY' }] };
}
function config(): StudioConfig {
  return handleStudioMock('GET', `/candidate/studio/${KEY}`, undefined, SME).body as StudioConfig;
}
const props = (over: Partial<StudioWorkbenchProps> = {}): StudioWorkbenchProps => ({ config: config(), studioUrl: `http://localhost:3131/studio/${KEY}`, smeLabel: 'Sam Synthetic', tasks: [], ...over });

beforeEach(() => resetStudioMock());

describe('U5 studio steps (C2 stand-in)', () => {
  const bp = mockStudioBlueprint();

  it('S4-03: six steps in PDF order, rendered from the blueprint', () => {
    const steps = studioSteps(bp);
    expect(steps.map((s) => s.id)).toEqual([...STUDIO_STEP_IDS]);
    expect(steps.map((s) => s.title)).toEqual(['Scenario Setup', 'Data & Oracle Labelling', 'Simulator Curve Tuning', 'Guardrail Thresholds', 'Rubric Weighting', 'Final Confirmation']);
    expect(steps.find((s) => s.id === 'simulator')!.controls.filter((c) => c.kind === 'curve_slider')).toHaveLength(3);
    expect(steps.find((s) => s.id === 'guardrails')!.controls.filter((c) => c.kind === 'invariant_toggle')).toHaveLength(2);
  });

  it('S4-05: every custom field appears exactly once, with its default', () => {
    const controls = studioSteps(bp).flatMap((s) => s.controls).filter((c) => c.kind === 'custom_field');
    const ids = controls.map((c) => (c.kind === 'custom_field' ? c.field.field_id : ''));
    expect(ids.sort()).toEqual(allCustomFields(bp).map((f) => f.field_id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    const d = defaultStudioAnswers(bp);
    for (const f of allCustomFields(bp)) expect(d.fields[f.field_id]).toEqual(f.default_value);
    expect(withDefaults(bp, { ...d, fields: { title: 'x' } }).fields.budget_cap_usd).toBe(120000);
  });

  it('S4-03: incomplete steps are marked and confirmation lists every blocking problem', () => {
    const p = studioAnswerProblems(bp, defaultStudioAnswers(bp));
    expect(p.scenario).toContain('Task title is required');
    expect(p.data_oracle).toContain('Tag at least one oracle row');
    expect(p.confirm).toEqual(expect.arrayContaining(['Scenario Setup: Task title is required', 'Data & Oracle Labelling: Tag at least one oracle row']));
    const ok = studioAnswerProblems(bp, complete());
    expect(STUDIO_STEP_IDS.every((s) => ok[s].length === 0)).toBe(true);
    const bad = studioAnswerProblems(bp, { ...complete(), milestoneWeights: { intent_f1: 50, budget_lp: 35, report_schema: 25 }, sliders: { k_half: 999_999 } });
    expect(bad.rubric).toEqual(['Milestone weights must add up to 100 (now 110)']);
    expect(bad.simulator[0]).toMatch(/between 1000 and 50000/);
  });

  it('S4-06: tags are limited to the template options; untagged rows stay out of the ground truth', () => {
    const o = bp.step_2_data_panels.oracle_annotator;
    let grid = oracleGridRows(o.template_preview_rows, []);
    expect(grid.map((r) => r.tag)).toEqual(['', '', '']);
    let rows = setOracleTag(grid, 1, 'RESEARCH', o.sme_tag_options);
    expect(rows).toEqual([{ cells: ['best anc phone review', '5400'], tag: 'RESEARCH' }]);
    grid = oracleGridRows(o.template_preview_rows, rows);
    expect(setOracleTag(grid, 0, 'SPAM', o.sme_tag_options)).toEqual(rows);
    rows = setOracleTag(grid, 1, '', o.sme_tag_options);
    expect(rows).toEqual([]);
    expect(studioAnswerProblems(bp, { ...complete(), oracleRows: [{ cells: ['a', 'b'], tag: 'SPAM' }] }).data_oracle[0]).toMatch(/not one of BUY, RESEARCH, IGNORE/);
  });

  it('S4-07: CTR(s) = CTR_base × s / (s + K_half) and the plot follows the sliders', () => {
    expect(ctr(0, 0.06, 12000)).toBe(0);
    expect(ctr(12000, 0.06, 12000)).toBeCloseTo(0.03);
    expect(ctr(1e9, 0.06, 12000)).toBeCloseTo(0.06, 4);
    expect(curveParams(bp, { k_half: 5000, ctr_base: 0.1 })).toEqual({ ctrBase: 0.1, kHalf: 5000, maxSpend: 100000 });
    expect(curvePath(0.06, 12000, 100000)).not.toBe(curvePath(0.06, 30000, 100000));
    const plot = text(html(<CurvePlot ctrBase={0.06} kHalf={12000} maxSpend={100000} />));
    expect(plot).toContain('reaches 3.00% at a spend of 12,000 (K_half)');
  });

  it('S4-08: the JSON preview is deterministic', () => {
    expect(taskJsonPreview(bp, complete())).toBe(taskJsonPreview(bp, complete()));
    expect(JSON.parse(taskJsonPreview(bp, complete()))).toMatchObject({ title: 'Q4 launch, UK only (synthetic)', harbor: { network: 'internal' }, custom_fields: { launch_locales: ['en-GB'], budget_cap_usd: 120000 } });
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
  });
});

describe('U5 studio mock routes (Stream 2 stand-in)', () => {
  it('S4-02: unauthenticated callers get 401 and no task data; malformed keys 404', () => {
    expect(handleStudioMock('GET', `/candidate/studio/${KEY}`, undefined, { smeUserId: null }).status).toBe(401);
    expect(handleStudioMock('GET', '/candidate/studio/BAD KEY', undefined, SME).status).toBe(404);
  });

  it('autosave uses expectedRevision; a stale revision is a 409 conflict', () => {
    const r = handleStudioMock('PUT', `/candidate/studio/${KEY}/draft`, { answers: complete(), expectedRevision: 0 }, SME);
    expect(r).toMatchObject({ status: 200, body: { revision: 1 } });
    expect(handleStudioMock('PUT', `/candidate/studio/${KEY}/draft`, { answers: complete(), expectedRevision: 0 }, SME)).toMatchObject({ status: 409, body: { error: 'STALE_REVISION' } });
    expect(config().answers).toEqual(complete());
  });

  it('S4-10: commit is refused until every step is complete, then a repeat with the same key does not duplicate', () => {
    handleStudioMock('PUT', `/candidate/studio/${KEY}/draft`, { answers: defaultStudioAnswers(mockStudioBlueprint()), expectedRevision: 0 }, SME);
    const refused = handleStudioMock('POST', `/candidate/studio/${KEY}/commit`, { expectedRevision: 1, dataClassification: 'SYNTHETIC' }, SME, 'k-0');
    expect(refused).toMatchObject({ status: 422, body: { error: 'STUDIO_INCOMPLETE' } });
    handleStudioMock('PUT', `/candidate/studio/${KEY}/draft`, { answers: complete(), expectedRevision: 1 }, SME);
    const first = handleStudioMock('POST', `/candidate/studio/${KEY}/commit`, { expectedRevision: 2, dataClassification: 'SYNTHETIC' }, SME, 'k-1');
    const again = handleStudioMock('POST', `/candidate/studio/${KEY}/commit`, { expectedRevision: 2, dataClassification: 'SYNTHETIC' }, SME, 'k-1');
    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    expect(first.body).toMatchObject({ status: 'SUBMITTED', version: 1 });
    const tasks = handleStudioMock('GET', `/candidate/studio/${KEY}/tasks`, undefined, SME).body as { items: Array<{ reviewStatus: string; title: string }> };
    expect(tasks.items).toHaveLength(1);
    expect(tasks.items[0]).toMatchObject({ reviewStatus: 'SUBMITTED', title: 'Q4 launch, UK only (synthetic)' });
    expect(config().revision).toBe(0);
  });

  it('S4-10: real public data is refused while it is disabled', () => {
    handleStudioMock('PUT', `/candidate/studio/${KEY}/draft`, { answers: complete(), expectedRevision: 0 }, SME);
    expect(handleStudioMock('POST', `/candidate/studio/${KEY}/commit`, { expectedRevision: 1, dataClassification: 'REAL_PUBLIC' }, SME, 'k')).toMatchObject({ status: 422, body: { error: 'REAL_DATA_DISABLED' } });
  });

  it('a stopped deployment reports STOPPED and refuses edits', () => {
    const r = handleStudioMock('GET', '/candidate/studio/demo-stopped', undefined, SME).body as StudioConfig;
    expect(r.deploymentStatus).toBe('STOPPED');
    expect(handleStudioMock('PUT', '/candidate/studio/demo-stopped/draft', { answers: complete(), expectedRevision: 0 }, SME).status).toBe(409);
  });
});

describe('U5 studio rendering', () => {
  it('S4-01: header shows running status, the preserved URL, project and SME', () => {
    const t = text(html(<StudioWorkbench {...props()} />));
    expect(t).toContain('Launch of Noise Cancelling Phone');
    expect(t).toContain('Running');
    expect(t).toContain(`http://localhost:3131/studio/${KEY}`);
    expect(t).toContain('SYNTHETIC Launch pilot');
    expect(t).toContain('Sam Synthetic');
  });

  it('S4-03: the sidebar lists the six steps and marks incomplete ones', () => {
    const m = html(<StudioWorkbench {...props()} />);
    const nav = m.slice(m.indexOf('aria-label="Authoring steps"'), m.indexOf('</nav>'));
    for (const t of ['Scenario Setup', 'Data &amp; Oracle Labelling', 'Simulator Curve Tuning', 'Guardrail Thresholds', 'Rubric Weighting', 'Final Confirmation']) expect(nav).toContain(t);
    expect(nav).toContain('aria-current="step"');
    expect(text(nav)).toMatch(/Scenario Setup 1 to fix/);
    expect(text(nav)).toMatch(/Simulator Curve Tuning Complete/);
  });

  it('S4-04/S4-05: the first step mounts the title, stage 1 custom fields with defaults, and instructions', () => {
    const m = html(<StudioWorkbench {...props()} />);
    expect(m).toContain('Task title / scenario name');
    expect(m).toContain('data-field-id="launch_locales"');
    expect(m).toMatch(/data-field-id="budget_cap_usd"[\s\S]*value="120000"/);
    expect(m).toContain('Business instructions / brand guidelines');
  });

  it('S4-06: grid annotator uses one tab stop, tag options only, and highlights tagged rows', () => {
    const m = html(<OracleGrid columns={['keyword', 'volume']} tagOptions={['BUY', 'IGNORE']} previewRows={[['a', '1'], ['b', '2']]} rows={[{ cells: ['b', '2'], tag: 'BUY' }]} onChange={() => undefined} />);
    expect(m.match(/tabindex="0"/g)).toHaveLength(1);
    expect(m.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(m).toContain('data-tagged="true"');
    expect(m.match(/<option value="BUY"/g)).toHaveLength(2);
    expect(m).not.toContain('value="SPAM"');
    expect(m).toContain('aria-label="Tag for a · 1"');
  });

  it('S4-07/NFR-10: sliders announce their value and range', () => {
    expect(html(<SimulatorSlider label="K_half" min={1000} max={50000} step={500} value={12000} formula="CTR(s)" onChange={() => undefined} />)).toContain('aria-valuetext="12000 (range 1000 to 50000)"');
    const w = html(<WeightSliders milestones={[{ milestoneId: 'a', label: 'A', default: 60 }, { milestoneId: 'b', label: 'B', default: 30 }]} weights={{}} onChange={() => undefined} />);
    expect(text(w)).toContain('Total 90% (must be 100%)');
    expect(w).toContain('Auto-normalise');
  });

  it('S4-09: DB metadata shows where the task lives and no secrets', () => {
    const m = text(html(<DbMetadata config={config()} committed={null} />));
    expect(m).toContain('PostgreSQL');
    expect(m).toContain(config().taskInstanceId);
    expect(m).toContain('Assigned when you commit');
    expect(m).not.toMatch(/postgres(ql)?:\/\/|password|secret|DATABASE_URL/i);
    const after = text(html(<DbMetadata config={config()} committed={{ status: 'SUBMITTED', version: 1, authoredTaskId: 'x', externalTaskId: 'TASK-MKTG-ABC', bundleSha256: 'f'.repeat(64), taskJson: {} }} />));
    expect(after).toContain('tasks/TASK-MKTG-ABC/');
  });

  it('S4-08: live JSON preview shows the task.json for the current answers', () => {
    const m = html(<StudioWorkbench {...props()} />);
    expect(m).toContain('data-testid="json-preview"');
    expect(text(m)).toContain('"schema": "praxis.harbor.task.v1"');
  });

  it('S4-13: committed tasks show "Submitted for review"', () => {
    const t = text(html(<StudioWorkbench {...props({ tasks: [{ id: '00000000-0000-4000-8000-0000000000aa', externalTaskId: 'TASK-MKTG-1', reviewStatus: 'SUBMITTED', title: 'Q4' } as StudioWorkbenchProps['tasks'][number]] })} />));
    expect(t).toContain('TASK-MKTG-1');
    expect(t).toContain('Submitted for review');
  });

  it('stopped deployments get the "studio closed" page with no task data', () => {
    const t = text(html(<StudioClosed workflowName="Launch" status="STOPPED" />));
    expect(t).toContain('This studio is closed');
    expect(t).not.toContain('Save & Commit');
  });
});
