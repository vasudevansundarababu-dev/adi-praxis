import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StageActions, StageSummary, type StageData } from '@/components/tasks/stage-review';
import { TaskReview, type TaskReviewData } from '@/components/tasks/task-review';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const checklist = [
  { key: 'realistic', label: 'Realistic' },
  { key: 'correct', label: 'Correct' },
];
const stage = (over: Partial<StageData> = {}): StageData => ({
  reviewRoute: 'SME_EXPERT_PM',
  stage: 'PM_APPROVAL',
  currentVersion: 2,
  viewer: { canExpert: false, canPm: true, bothResponsibilities: false },
  actions: ['APPROVE', 'REWORK'],
  expertPass: { by: 'Eve Expert', version: 2, at: '2026-11-11T10:00:00Z' },
  stageHistory: [
    { id: 'a', stage: 'EXPERT_REVIEW', decision: 'PASS', by: 'Eve Expert', version: 1, at: '2026-11-11T09:00:00Z', reason: null, material: null, notes: null, comments: [], void: true },
    { id: 'b', stage: 'PM_APPROVAL', decision: 'EDIT', by: 'Eve Expert', version: 2, at: '2026-11-11T09:30:00Z', reason: 'Clarify the trigger.', material: false, notes: null, comments: [], void: false },
    { id: 'c', stage: 'EXPERT_REVIEW', decision: 'PASS', by: 'Eve Expert', version: 2, at: '2026-11-11T10:00:00Z', reason: null, material: null, notes: null, comments: [], void: false },
  ],
  diff: { fromVersion: 1, toVersion: 2, changes: [{ path: 'sections.S1.businessContext', before: 'Old context', after: 'New context' }] },
  ...over,
});
const task = { id: 't1', revision: 7, output: { profile: { id: 'kyb-and-beneficial-ownership', version: 1 } }, checklist, flaggedDuplicate: false, openSlot: false, coverageTags: null, nodeIds: ['review_ownership'] };

describe('Wave 2 review stages in the console', () => {
  it('shows the stage, who passed which version, the history with void decisions and the version diff', () => {
    const html = renderToStaticMarkup(<StageSummary d={stage()} status="SUBMITTED" />);
    expect(html).toContain('Approval pending: PM approval');
    expect(html).toContain('passed by Eve Expert on version 2');
    expect(html).toContain('(void: the task changed after this decision)');
    expect(html).toContain('Reason: Clarify the trigger.');
    expect(html).toContain('Changes from version 1 to version 2 (1)');
    expect(html).toContain('sections.S1.businessContext');
    expect(html).toContain('Old context');
    expect(html).not.toContain('both responsibilities');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says so when one person holds both responsibilities', () => {
    const html = renderToStaticMarkup(<StageSummary d={stage({ viewer: { canExpert: true, canPm: true, bothResponsibilities: true } })} status="SUBMITTED" />);
    expect(html).toContain('You hold both responsibilities on this project, Expert and PM');
  });

  it('shows pinned comments with their anchor (section, node or field)', () => {
    const html = renderToStaticMarkup(
      <StageSummary d={stage({ stage: null, stageHistory: [{ id: 'r', stage: 'EXPERT_REVIEW', decision: 'REWORK', by: 'Eve Expert', version: 1, at: '2026-11-11T09:00:00Z', reason: null, material: null, notes: null, void: false, comments: [{ section: 'S1', text: 'Name the trigger.' }, { target: { kind: 'node', id: 'review_ownership' }, text: 'Explain the join.' }] }] })} status="REWORK" />,
    );
    expect(html).toContain('Back with the author (Authoring).');
    expect(html).toContain('S1: Name the trigger.');
    expect(html).toContain('node review_ownership: Explain the join.');
  });

  it('offers the PM only approve or return, for the exact version', () => {
    const html = renderToStaticMarkup(<StageActions d={stage()} task={task} />);
    expect(html).toContain('PM approval · version 2');
    expect(html).toContain('Approve this exact version');
    expect(html).toContain('Return for rework');
    expect(html).toContain('passed by Eve Expert');
    expect(html).toContain('does not run a benchmark or send a payment');
    expect(html).not.toContain('Pass to PM approval');
    expect(html).not.toContain('Edit with a reason');
    expect(html).not.toContain('Checklist');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('offers the Expert pass, return, reject and edit with the checklist', () => {
    const html = renderToStaticMarkup(<StageActions d={stage({ stage: 'EXPERT_REVIEW', actions: ['PASS', 'REWORK', 'REJECT', 'EDIT'], expertPass: null, viewer: { canExpert: true, canPm: false, bothResponsibilities: false } })} task={task} />);
    expect(html).toContain('Expert review · version 2');
    for (const t of ['Pass to PM approval', 'Return for rework', 'Reject', 'Edit with a reason', 'Checklist']) expect(html).toContain(t);
    expect(html).not.toContain('Approve this exact version');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('offers nothing to a viewer without the current stage', () => {
    const html = renderToStaticMarkup(<StageActions d={stage({ stage: 'EXPERT_REVIEW', actions: [], viewer: { canExpert: false, canPm: true, bothResponsibilities: false } })} task={task} />);
    expect(html).toContain('Waiting for Expert review; you have no action at this stage.');
    expect(html).not.toContain('<button');
  });

  it('the review page uses the stage panel for two-stage tasks and the one-step decision otherwise', () => {
    const base: TaskReviewData = {
      id: 't1',
      status: 'SUBMITTED',
      revision: 7,
      taskType: 'AUTHORING',
      definition: 'generic',
      project: { id: 'p1', name: 'KYB', workflow: 'KYB and beneficial ownership', verificationCriteria: null, humanGate: null, tptMinutes: 60 },
      slot: null,
      author: 'Ada',
      input: {},
      output: { header: { title: 'A KYB case' } },
      coverageTags: null,
      coverageDimensions: [],
      activeSeconds: 600,
      reworkCount: 0,
      checks: [],
      flags: [],
      embeddingModel: null,
      similar: [],
      text: '',
      versions: [{ version: 1, submittedAt: '2026-11-11T09:00:00Z' }, { version: 2, submittedAt: '2026-11-11T09:30:00Z' }],
      previousOutput: null,
      reviews: [],
      checklist,
      drafting: null,
    };
    const staged = renderToStaticMarkup(<TaskReview data={{ ...base, ...stage() }} />);
    expect(staged).toContain('Review route: SME → Expert review → PM approval');
    expect(staged).toContain('Approve this exact version');
    expect(staged).not.toContain('Record decision');
    const direct = renderToStaticMarkup(<TaskReview data={base} />);
    expect(direct).toContain('Record decision');
    expect(direct).not.toContain('Review route: SME → Expert review → PM approval');
  });
});
