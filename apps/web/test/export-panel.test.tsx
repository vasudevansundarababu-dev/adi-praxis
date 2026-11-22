import type { ProjectExportRunDto } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { ExportPanel, type ExportState } from '../components/projects/export-panel';
import { exportStatusLine } from '../lib/forge-console';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

/** New RL Gym part 2 (22 Nov 2026): Export for benchmark, Re-export, the receipt history, and "not connected". */
const P = '00000000-0000-4000-8000-000000000001';
const task = { recordId: '00000000-0000-4000-8000-000000000011', taskId: '00000000-0000-4000-8000-000000000021', title: 'Teen joint checking (NY)', approvedAt: '2026-11-12T10:00:00.000Z', revision: 1, inRlGym: false };
const base: ExportState = { canExport: true, reason: null, connected: true, rlgymTemplate: { id: 'tpl_x5rwt6d5eu', version: 9, specSha256: 'f'.repeat(64) }, exported: false, tasks: [task], runs: [] };
const run = (over: Partial<ProjectExportRunDto> = {}): ProjectExportRunDto => ({
  id: '00000000-0000-4000-8000-000000000031',
  projectId: P,
  exportId: 'exp-0123456789abcdef',
  exportSha256: 'a'.repeat(64),
  reason: 'first export of KYC November',
  tasks: [{ recordId: task.recordId, taskId: task.taskId, title: task.title, revision: 1, packageSha256: 'b'.repeat(64), correctsRevision: null }],
  notSent: [],
  outcome: 'received',
  httpStatus: 201,
  requestId: 'req-7',
  receipt: { new: 1, superseding: 0, unchanged: 0, blocked: [], replayed: false, receiptSha256: 'c'.repeat(64) },
  error: null,
  requestedById: P,
  createdAt: '2026-11-22T11:00:00.000Z',
  ...over,
});

describe('export for benchmark panel', () => {
  it('not connected: says so and Export is off', () => {
    const m = html(<ExportPanel projectId={P} initial={{ ...base, connected: false, canExport: false, reason: 'RL Gym isn’t connected yet.', rlgymTemplate: null }} />);
    expect(text(m)).toContain('RL Gym isn’t connected yet, so export is off.');
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*>Export for benchmark<\/button>/);
    expect(text(m)).not.toContain('Validate');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('connected and qualified: Export for benchmark is on and names the RL Gym template', () => {
    const m = html(<ExportPanel projectId={P} initial={base} />);
    expect(m).toMatch(/<button type="button" class="btn btn-primary[^"]*">Export for benchmark<\/button>/);
    expect(text(m)).toContain('tpl_x5rwt6d5eu');
    expect(text(m)).toContain('1 approved task.');
  });

  it('after an export: Re-export, the receipt with RL Gym’s request ID, and how many tasks are in RL Gym', () => {
    const m = html(<ExportPanel projectId={P} initial={{ ...base, exported: true, tasks: [{ ...task, inRlGym: true }], runs: [run()] }} />);
    expect(m).toMatch(/>Re-export<\/button>/);
    expect(text(m)).toContain('1 approved task, 1 in RL Gym.');
    expect(text(m)).toContain('Received by RL Gym');
    expect(text(m)).toContain('1 new, 0 superseding, 0 unchanged.');
    expect(m).toContain('<code class="font-mono text-xs">req-7</code>');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('a refused export shows RL Gym’s code and message; blocked and not-sent tasks link to the task', () => {
    const refused = html(<ExportPanel projectId={P} initial={{ ...base, runs: [run({ outcome: 'rejected', httpStatus: 422, receipt: null, error: { code: 'TEMPLATE_NOT_ACTIVE', message: 'Template is not active in this workspace' } })] }} />);
    expect(text(refused)).toContain('Refused by RL Gym');
    expect(text(refused)).toContain('TEMPLATE_NOT_ACTIVE Template is not active in this workspace');
    const blocked = html(
      <ExportPanel
        projectId={P}
        newFlow
        initial={{ ...base, runs: [run({ receipt: { new: 1, superseding: 0, unchanged: 0, blocked: [{ taskId: task.taskId, reason: 'BINDING_UNRESOLVED' }], replayed: false, receiptSha256: null }, notSent: [{ recordId: '00000000-0000-4000-8000-000000000012', taskId: '00000000-0000-4000-8000-000000000022', title: 'Custodial', code: 'GENERIC_PRIVATE_EXPOSURE', message: 'Form problem.' }] })] }}
      />,
    );
    expect(text(blocked)).toContain('Teen joint checking (NY) — blocked by RL Gym: BINDING_UNRESOLVED');
    expect(text(blocked)).toContain('Custodial — not sent: GENERIC_PRIVATE_EXPOSURE Form problem.');
    expect(blocked).toContain(`href="/projects/${P}/tasks/${task.taskId}/review"`);
  });

  it('dashboard line: not connected, ready, exported', () => {
    expect(exportStatusLine({ ...base, connected: false })).toBe('Not connected · RL Gym isn’t connected yet');
    expect(exportStatusLine(base)).toBe('Not exported · ready to export the approved tasks so far');
    expect(exportStatusLine({ ...base, canExport: false, reason: 'Export needs at least one approved task.' })).toBe('Not exported · Export needs at least one approved task');
    expect(exportStatusLine({ ...base, runs: [run()] })).toMatch(/^Exported .* · can be re-exported$/);
    expect(exportStatusLine(null)).toBe('—');
  });
});
