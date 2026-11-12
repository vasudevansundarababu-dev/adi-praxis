import { describe, expect, it } from 'vitest';
import { ExportPanel, type ExportState } from '../components/projects/export-panel';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

const P = '00000000-0000-4000-8000-000000000001';
const task = { recordId: '00000000-0000-4000-8000-000000000011', taskId: '00000000-0000-4000-8000-000000000021', title: 'Teen joint checking (NY)', approvedAt: '2026-11-12T10:00:00.000Z' };
const base: ExportState = { canValidate: true, canExport: false, reason: 'Export opens when the project is complete: 1 of 2 required tasks approved, or on 2026-12-31. You can validate one task now.', validator: { name: 'praxis-precheck', version: 'v1', isAnvil: false }, tasks: [task], runs: [] };

describe('project export panel (owner, 12 Nov 2026)', () => {
  it('validate one task now; Export is disabled until the project is complete; says Anvil is not connected', () => {
    const m = html(<ExportPanel projectId={P} initial={base} />);
    expect(text(m)).toContain('Anvil validation is not connected yet');
    expect(text(m)).toContain('1 of 2 required tasks approved');
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*>Export<\/button>/);
    expect(text(m)).toContain('Validate');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('shows which tasks need fixing and the export download', () => {
    const run = { id: '00000000-0000-4000-8000-000000000031', projectId: P, kind: 'EXPORT' as const, validator: 'praxis-precheck', validatorVersion: 'v1', results: [{ ...task, status: 'needs_fix' as const, issues: [{ code: 'MISSING_BINDING', path: 'S7.criteria[0].outputField', message: 'Name the output field this rule or criterion checks' }] }], counts: { valid: 0, needsFix: 1, notValidated: 0 }, requestedById: P, createdAt: '2026-11-12T11:00:00.000Z', downloadPath: `/projects/${P}/exports/x/download` };
    const m = html(<ExportPanel projectId={P} initial={{ ...base, canExport: true, reason: null, runs: [run] }} />);
    expect(text(m)).toContain('Last export');
    expect(text(m)).toContain('0 valid, 1 need fixing');
    expect(text(m)).toContain('Teen joint checking (NY) — needs fixing: Name the output field this rule or criterion checks');
    expect(m).toContain(`href="/api/v1/projects/${P}/exports/x/download"`);
  });

  it('with no approved task there is nothing to validate', () => {
    const m = html(<ExportPanel projectId={P} initial={{ ...base, canValidate: false, reason: 'Export needs at least one approved task.', tasks: [] }} />);
    expect(text(m)).toContain('Export needs at least one approved task.');
    expect(text(m)).not.toContain('Task to validate');
  });
});
