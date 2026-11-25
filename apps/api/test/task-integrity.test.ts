import type { Template } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { jcsSha256 } from '../src/anvil/jcs';
import { exportReceipt, rlgymTaskAnswers, type BuiltExport } from '../src/anvil/rlgym-export';
import { problemCheck, snapshotProblems, splitByOwner, statedScoring } from '../src/tasks/task-integrity';

/** E-007 phase 2 (owner, 24 Nov 2026): stronger checks on a frozen snapshot, the export receipt and the RL Gym's answer. */

// A template with no registered form: the structural checks (S3/S5 tools, S7 scoring) still run on the sections.
const template = { id: '00000000-0000-4000-8000-000000000001', version: 3, workflowName: 'no-such-workflow', profileId: null, anvilSpec: null } as unknown as Template;
const crit = (over: Record<string, unknown> = {}) => ({ id: 'decision', name: 'Decision', weight: 5, critical: true, passCondition: 'Right decision with evidence.', partialCredit: 'Right decision, thin evidence.', failCondition: 'Wrong decision.', ...over });
const task = (sections: Record<string, unknown>) => ({ profile: { id: 'p', version: 1 }, sections: { S3: { tools: ['application.read', 'recommend'] }, S5: { steps: [{ tool: 'application.read', action: 'Read it.' }, { tool: 'recommend', action: 'Recommend.' }] }, S7: { criteria: [crit(), crit({ id: 'evidence', name: 'Evidence', critical: false })], scoringRule: 'Award 5 points for pass, 2 for partial and 0 for fail. The max is 10 points. The task passes with at least 8 points.' }, ...sections } });
const codes = (sections: Record<string, unknown>, bench: unknown = null) => snapshotProblems(template, task(sections), bench).map((p) => [p.code, p.field, p.owner]);

describe('task checks on a frozen snapshot', () => {
  it('a consistent task passes', () => {
    expect(codes({})).toEqual([]);
  });

  it('a step naming a tool S3 does not offer (the custodial task of 23 Nov)', () => {
    expect(codes({ S3: { tools: ['application.read'] } })).toEqual([['STEP_TOOL_NOT_OFFERED', 'S5.steps[1].tool', 'author']]);
  });

  it('a critical criterion with no failure definition; a "0:" anchor or a whole-task failure counts as one', () => {
    const rule = 'Award 5 points for pass, 2 for partial and 0 for fail. The max is 10.';
    expect(codes({ S7: { criteria: [crit({ failCondition: '' }), crit({ id: 'e', critical: false, failCondition: '' })], scoringRule: rule } })).toEqual([['CRITICAL_WITHOUT_FAILURE', 'S7.criteria[0].failCondition', 'author']]);
    expect(codes({ S7: { criteria: [crit({ failCondition: '', partialCredit: '2 points: thin. 0: wrong or omitted.' }), crit({ id: 'e' })], scoringRule: rule } })).toEqual([]);
    expect(codes({ S7: { criteria: [crit({ failCondition: '', criticalCondition: 'Approves a sanctioned person.' }), crit({ id: 'e' })], scoringRule: rule } })).toEqual([]);
  });

  it('S7 on the 5/2/0 scale: the stated maximum matches the weights, the threshold is reachable, the awards are 5/2/0', () => {
    expect(statedScoring('Award 5 Point for pass , 2 for partial and 0 for fail. The max is 25 points. The task passes with at least 22.5 point')).toEqual({ max: 25, threshold: 22.5, pass: 5, partial: 2, fail: 0 });
    const s7 = (scoringRule: string) => ({ S7: { criteria: [crit(), crit({ id: 'e' })], scoringRule } });
    expect(codes(s7('The max is 12 points. The task passes with at least 8.'))).toEqual([['S7_MAX_MISMATCH', 'S7.scoringRule', 'author']]);
    expect(codes(s7('The max is 10 points. The task passes with at least 11.'))).toEqual([['S7_THRESHOLD_OUT_OF_RANGE', 'S7.scoringRule', 'author']]);
    expect(codes(s7('Award 4 points for pass, 2 for partial and 0 for fail.'))).toEqual([['S7_SCALE_NOT_520', 'S7.scoringRule', 'author']]);
    // No numbers stated: nothing to contradict.
    expect(codes(s7('Score each criterion once.'))).toEqual([]);
  });

  it('KYC Judgment v1 A6: a conditional follow-up that decides the outcome ("if possible match → refer") is a warning, never a block', () => {
    const steps = (followUps: unknown) => ({ S5: { steps: [{ tool: 'application.read', action: 'Read it.' }, { tool: 'recommend', action: 'Recommend.', followUps }] } });
    // The adult joint task's step before T2: a possible match is recorded and referred by the procedure, not by the rules.
    const branch = { if: 'screening returns a possible match for an applicant', tools: ['finding.write', 'specialist.refer'] };
    const [w, ...rest] = snapshotProblems(template, task(steps([branch])));
    expect(rest).toEqual([]);
    expect(w).toMatchObject({ code: 'STEP_OUTCOME_BRANCH', section: 'S5', field: 'S5.steps[1].followUps[0]', severity: 'warning', owner: 'author', retryHelps: false });
    expect(w!.message).toContain('Step 2');
    expect(w!.message).toContain('finding.write, specialist.refer');
    expect(w!.message).toContain('screening returns a possible match for an applicant');
    // One warning per branch; a request or a recommendation decided by the procedure counts too.
    expect(codes(steps([branch, { if: 'a document is expired', tools: ['information.request'] }]))).toEqual([
      ['STEP_OUTCOME_BRANCH', 'S5.steps[1].followUps[0]', 'author'],
      ['STEP_OUTCOME_BRANCH', 'S5.steps[1].followUps[1]', 'author'],
    ]);
    // Not outcome branches: the documents.list → document.read chain (no condition), a condition that only reads, none at all.
    expect(codes(steps([{ tools: ['document.read'] }]))).toEqual([]);
    expect(codes(steps([{ tools: ['specialist.refer'] }]))).toEqual([]);
    expect(codes(steps([{ if: 'a check is pending', tools: ['operation.read'] }]))).toEqual([]);
    expect(codes(steps([]))).toEqual([]);
    // A warning is shown by Validate but never sends the task back or stops an approval.
    expect(splitByOwner([w!])).toEqual({ author: [], others: [] });
  });

  it('each problem says its section, field, code, who fixes it and that retrying does not help; author problems become D18 checks', () => {
    const [p] = snapshotProblems(template, task({ S3: { tools: ['application.read'] } }));
    expect(p).toMatchObject({ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', field: 'S5.steps[1].tool', severity: 'blocking', owner: 'author', retryHelps: false });
    expect(problemCheck(p!)).toMatchObject({ id: 'integrity.STEP_TOOL_NOT_OFFERED', section: 'S5', ok: false });
    const split = splitByOwner([p!, { ...p!, owner: 'pm' }, { ...p!, severity: 'warning' }]);
    expect([split.author.length, split.others.length]).toEqual([1, 1]);
  });
});

const built = (tasks: { taskId: string; revision: number }[]): BuiltExport =>
  ({
    body: { project_id: 'prj_x', template: { id: 'tpl', version: 9 } },
    exportId: 'exp-1',
    exportSha256: 'e'.repeat(64),
    reason: 'first export',
    tasks: tasks.map((t) => ({ recordId: `r-${t.taskId}`, taskId: t.taskId, title: t.taskId, revision: t.revision, packageSha256: 'p'.repeat(64), correctsRevision: null, smeBatchId: null, complexity: null, archetype: null, edgeCase: null, contentHash: 'c'.repeat(64), snapshotSha256: 's'.repeat(64), checkReportSha256: 'k'.repeat(64) })),
    notSent: [{ recordId: 'r-z', taskId: 'z', title: 'z', code: 'CHECKS_FAILED', message: 'S5: …', problems: [{ code: 'STEP_TOOL_NOT_OFFERED', section: 'S5', field: 'S5.steps[1].tool', severity: 'blocking', owner: 'author', retryHelps: false, message: '…' }] }],
  }) as BuiltExport;

describe('export receipt and the RL Gym’s answer', () => {
  it('the receipt binds the export digest to each task’s record, package, snapshot and check report; its digest covers the rest', () => {
    const r = exportReceipt(built([{ taskId: 'a', revision: 1 }]), new Date('2026-11-24T12:00:00Z'));
    const { receipt_sha256, ...rest } = r;
    expect(receipt_sha256).toBe(jcsSha256(rest));
    expect(r).toMatchObject({ schema: 'praxis.export-receipt.v1', export_id: 'exp-1', export_sha256: 'e'.repeat(64), signature: null, tasks: [{ task_id: 'a', revision: 1, record_id: 'r-a', record_content_hash: 'c'.repeat(64), package_sha256: 'p'.repeat(64), snapshot_sha256: 's'.repeat(64), check_report_sha256: 'k'.repeat(64), checks: 'pass' }], not_sent: [{ task_id: 'z', code: 'CHECKS_FAILED', checks: ['STEP_TOOL_NOT_OFFERED'] }] });
    // A changed digest changes the receipt.
    const other = built([{ taskId: 'a', revision: 1 }]);
    other.tasks[0]!.packageSha256 = 'q'.repeat(64);
    expect(exportReceipt(other, new Date('2026-11-24T12:00:00Z')).receipt_sha256).not.toBe(receipt_sha256);
  });

  it('per task: accepted, duplicate (same revision received before, or a replayed receipt) or rejected (blocked, or the export refused)', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 24, 12, m));
    const first = { outcome: 'received', tasks: [{ taskId: 'a', revision: 1 }], receipt: { blocked: [] }, createdAt: at(0) };
    const second = { outcome: 'received', tasks: [{ taskId: 'a', revision: 1 }, { taskId: 'b', revision: 1 }, { taskId: 'c', revision: 2 }], receipt: { blocked: [{ taskId: 'c' }] }, createdAt: at(5) };
    expect(rlgymTaskAnswers(first, [first, second])).toEqual({ a: 'accepted' });
    expect(rlgymTaskAnswers(second, [first, second])).toEqual({ a: 'duplicate', b: 'accepted', c: 'rejected' });
    expect(rlgymTaskAnswers({ ...second, receipt: { blocked: [], replayed: true } }, [])).toEqual({ a: 'duplicate', b: 'duplicate', c: 'duplicate' });
    expect(rlgymTaskAnswers({ ...first, outcome: 'rejected' }, [])).toEqual({ a: 'rejected' });
    expect(rlgymTaskAnswers({ ...first, outcome: 'unavailable' }, [])).toEqual({ a: 'not_answered' });
  });
});
