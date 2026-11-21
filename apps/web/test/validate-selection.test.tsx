import type { ForgeTaskRow, ValidationRunDto } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForgeTasksTab } from '@/components/forge/tasks-tab';
import { ExportPanel, type ExportState } from '@/components/projects/export-panel';
import { exportBody, issueParts, selectableRecords, selectAllState, toggleAll, validateBody } from '@/lib/export-selection';
import { a11yProblems } from './a11y';
import { text } from './helpers';

/** Multi-select validation in the project's task table (owner, 21 Nov 2026). Export ignores the selection. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/projects/x', useSearchParams: () => new URLSearchParams() }));

const PID = '00000000-0000-4000-8000-0000000000aa';
const T = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
const R = (n: number) => `00000000-0000-4000-8000-00000000020${n}`;
const row = (n: number, status: string): ForgeTaskRow => ({
  taskId: T(n),
  label: `Product: case ${n}`,
  selector: null,
  slotLabel: `Task ${n}`,
  status,
  smeStatus: 'New',
  author: { name: `Author ${n}` },
  reviewer: null,
  reviewStage: null,
  date: '2026-11-21T10:00:00.000Z',
  canDecide: false,
  waitingFor: null,
} as unknown as ForgeTaskRow);
// Three approved tasks and one still with its author.
const TASKS = [row(1, 'ACCEPTED'), row(2, 'ACCEPTED'), row(3, 'IN_PROGRESS'), row(4, 'ACCEPTED')];
const approved = [1, 2, 4].map((n) => ({ recordId: R(n), taskId: T(n), title: `Case ${n}`, approvedAt: '2026-11-21T10:00:00.000Z' }));
const STATE: ExportState = { canValidate: true, canExport: true, reason: null, validator: { name: 'anvil-discovery+praxis-precheck', version: 'v1', isAnvil: true }, tasks: approved, runs: [] };

describe('selection rules', () => {
  it('only approved tasks are selectable, and none while validation is closed', () => {
    expect([...selectableRecords(STATE).entries()]).toEqual([[T(1), R(1)], [T(2), R(2)], [T(4), R(4)]]);
    expect(selectableRecords({ ...STATE, canValidate: false }).size).toBe(0);
    expect(selectableRecords(null).size).toBe(0);
  });

  it('select-all selects every listed approved task, then clears them; partial selection shows as mixed', () => {
    const ids = [R(1), R(2), R(4)];
    const all = toggleAll(new Set(), ids);
    expect([...all]).toEqual(ids);
    expect(selectAllState(all, ids)).toBe('all');
    expect(toggleAll(all, ids).size).toBe(0);
    const one = new Set([R(2)]);
    expect(selectAllState(one, ids)).toBe('some');
    expect([...toggleAll(one, ids)].sort()).toEqual([...ids].sort());
    expect(selectAllState(new Set(), ids)).toBe('none');
  });

  it('Validate sends every selected task in one body, in table order; Export sends {} whatever is selected', () => {
    expect(validateBody(new Set([R(4), R(1)]), approved)).toEqual({ recordIds: [R(1), R(4)] });
    expect(validateBody(new Set([R(2)]), approved)).toEqual({ recordIds: [R(2)] });
    expect(exportBody()).toEqual({});
  });

  it('splits RL Gym’s request id out of an issue message; keeps the code and location', () => {
    expect(issueParts({ code: 'AV_TEMPLATE_NOT_QUALIFIED', path: null, message: 'RL Gym’s own work (not a task repair), blocked; the source is checked separately. (RL Gym request req-7f3a)' })).toEqual({
      code: 'AV_TEMPLATE_NOT_QUALIFIED',
      message: 'RL Gym’s own work (not a task repair), blocked; the source is checked separately.',
      requestId: 'req-7f3a',
      location: null,
    });
    expect(issueParts({ code: 'ANVIL_CONTRACT_DISABLED', path: null, message: 'RL Gym lists x.v1 but has it switched off; RL Gym request c-1.' })).toMatchObject({ message: 'RL Gym lists x.v1 but has it switched off.', requestId: 'c-1' });
    expect(issueParts({ code: 'PX_CRITERIA_ANCHORS', path: 'private/t/reference.json#/criteria/0', message: 'Incomplete.' })).toEqual({ code: 'PX_CRITERIA_ANCHORS', message: 'Incomplete.', requestId: null, location: 'private/t/reference.json#/criteria/0' });
  });
});

describe('Tasks tab with checkboxes', () => {
  const m = renderToStaticMarkup(<ForgeTasksTab projectId={PID} tasks={TASKS} people={[]} exportState={STATE} />);

  it('labelled checkboxes on approved rows only, a select-all in the header and a Validate button by the table', () => {
    expect(m).toContain('aria-label="Select all approved tasks for validation"');
    for (const [n, code] of [[1, 'TSK-001'], [2, 'TSK-002'], [4, 'TSK-004']] as const) expect(m).toContain(`aria-label="Select ${code} for validation" data-select-task="${T(n)}"`);
    expect(m).not.toContain(`data-select-task="${T(3)}"`);
    expect(m).toMatch(/<button type="button" class="btn btn-secondary[^"]*" disabled="">Validate<\/button>/); // nothing selected yet
    expect(text(m)).toContain('0 selected');
    // The panel below keeps Export (all approved tasks) and drops its one-task picker.
    expect(text(m)).not.toContain('Task to validate');
    expect(text(m)).toContain('Export always sends every approved task; the selection in the table is only for Validate.');
    expect(m).toMatch(/<button type="button" class="btn btn-primary[^"]*">Export to RL Gym<\/button>/);
    expect(a11yProblems(m)).toEqual([]);
  });

  it('no checkboxes while nothing can be validated', () => {
    const closed = renderToStaticMarkup(<ForgeTasksTab projectId={PID} tasks={TASKS} people={[]} exportState={{ ...STATE, canValidate: false, canExport: false, tasks: [] }} />);
    expect(closed).not.toContain('type="checkbox"');
    expect(closed).not.toMatch(/>Validate<\/button>/);
  });
});

describe('RL Gym block on the result lines', () => {
  it('shows RL Gym’s contract support, and for each task its package’s status, request id and intake', () => {
    const part = (n: number, recordIds: string[], resolve: boolean) => ({ partIndex: n, partCount: 2, packageId: `pkg-${n}`, packageSha256: 'a'.repeat(64), zipSha256: 'b'.repeat(64), bytes: 10, recordIds, validate: { kind: 'business', httpStatus: 200, status: n === 1 ? 'validation_blocked' : 'export_valid', valid: n === 1 ? null : true, errorCount: 0, requestId: `req-${n}`, anvilPackageSha256: null }, resolve: resolve ? { kind: 'business', httpStatus: 200, status: 'import_resolved', requestId: 'rs-2' } : null });
    const run: ValidationRunDto = {
      id: '00000000-0000-4000-8000-000000000302',
      projectId: PID,
      kind: 'EXPORT',
      validator: 'anvil-discovery+praxis-precheck',
      validatorVersion: 'v1',
      results: [
        { recordId: R(1), taskId: T(1), title: 'Case 1', status: 'not_validated', issues: [{ code: 'AV_TEMPLATE_NOT_REGISTERED', path: null, message: 'RL Gym’s own work (not a task repair), blocked; the source is checked separately.' }] },
        { recordId: R(2), taskId: T(2), title: 'Case 2', status: 'valid', issues: [] },
      ],
      counts: { valid: 1, needsFix: 0, notValidated: 1 },
      requestedById: PID,
      createdAt: '2026-11-21T15:00:00.000Z',
      downloadPath: null,
      anvil: { contract: 'praxis.authored-task-export.v1', support: 'enabled', batchId: 'b-1', problems: [], parts: [part(1, [R(1)], false), part(2, [R(2)], true)] },
    };
    const m = renderToStaticMarkup(<ExportPanel projectId={PID} initial={{ ...STATE, runs: [run] }} newFlow />);
    const t = text(m);
    expect(t).toContain('RL Gym contract praxis.authored-task-export.v1: enabled.');
    expect(t).toContain('Case 1 — not validated (RL Gym validation_blocked, request req-1 ) : AV_TEMPLATE_NOT_REGISTERED');
    expect(t).toContain('Case 2 — valid (RL Gym export_valid, request req-2 ; intake import_resolved, request rs-2 )');
  });
});

describe('result per task', () => {
  it('one line per validated task with its verdict, each issue’s code and RL Gym’s request id', () => {
    const run: ValidationRunDto = {
      id: '00000000-0000-4000-8000-000000000301',
      projectId: PID,
      kind: 'VALIDATE',
      validator: 'anvil-discovery+praxis-precheck',
      validatorVersion: 'v1',
      results: [
        { recordId: R(1), taskId: T(1), title: 'Single KYC Onboarding and Refresh', status: 'not_validated', issues: [{ code: 'AV_TEMPLATE_NOT_QUALIFIED', path: null, message: 'RL Gym’s own work (not a task repair), blocked; the source is checked separately. (RL Gym request req-111)' }] },
        { recordId: R(2), taskId: T(2), title: 'Minor (joint with adult) KYC', status: 'valid', issues: [] },
        { recordId: R(4), taskId: T(4), title: 'Custodian KYC Onboarding and Refresh', status: 'needs_fix', issues: [{ code: 'PX_CRITERIA_ANCHORS', path: 'private/x/reference.json#/criteria/0', message: 'Explicit 5/2/0 conditions are incomplete.' }] },
      ],
      counts: { valid: 1, needsFix: 1, notValidated: 1 },
      requestedById: PID,
      createdAt: '2026-11-21T14:52:00.000Z',
      downloadPath: null, anvil: null,
    };
    const m = renderToStaticMarkup(<ExportPanel projectId={PID} initial={{ ...STATE, runs: [run] }} newFlow />);
    const t = text(m);
    expect(t).toContain('Last validation (2026-11-21 14:52): 1 valid, 1 need fixing, 1 not validated.');
    expect(m.match(/data-result="/g)).toHaveLength(3);
    expect(t).toContain('Single KYC Onboarding and Refresh — not validated: AV_TEMPLATE_NOT_QUALIFIED RL Gym’s own work (not a task repair), blocked; the source is checked separately. · RL Gym request req-111');
    expect(t).toContain('Minor (joint with adult) KYC — valid');
    expect(t).toContain('Custodian KYC Onboarding and Refresh — needs fixing: PX_CRITERIA_ANCHORS Explicit 5/2/0 conditions are incomplete. (at private/x/reference.json#/criteria/0 )');
    expect(m).toContain(`href="/projects/${PID}/tasks/${T(1)}/review"`);
    expect(a11yProblems(m)).toEqual([]);
  });
});
