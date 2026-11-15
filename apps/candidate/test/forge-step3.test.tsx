import { KYB_PROFILE, sampleProfileOutput, type ForgeAuthorTask, type ForgeHomeDto, type ForgeReviewTask, type ForgeTermsDoc, type TemplateProfile } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForgeHome } from '@/components/forge/forge-home';
import { ReviewPage, type ReviewView } from '@/components/forge/review-page';
import { WelcomeForm } from '@/components/forge/welcome-form';
import { ProfileEditor } from '@/components/work/profile-editor';
import { commentsToSend, filterAuthorTasks, nextForgeStep, placeComments, reviewDecisionProblem, reviewGroups, sectionMatches, sortAuthorTasks, welcomeProblem } from '@/lib/forge';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const task = (n: number, status: ForgeAuthorTask['status'], o: Partial<ForgeAuthorTask> = {}): ForgeAuthorTask => ({ taskId: id(n), label: `Task ${n}`, projectName: 'KYC project', status, date: `2026-11-1${n % 10}T10:00:00.000Z`, reworkComments: 0, ...o });
const review = (n: number, status: ForgeReviewTask['status']): ForgeReviewTask => ({ taskId: id(100 + n), label: `Task ${n}`, slotLabel: `Task ${n}`, projectId: id(99), projectName: 'Marketing', author: 'Morgan Hale', status, date: '2026-11-15T10:00:00.000Z' });
const homeOf = (authorTasks: ForgeAuthorTask[], reviewTasks: ForgeReviewTask[] = []): ForgeHomeDto => ({ newFlow: true, termsAccepted: true, name: 'Jamie Okafor', authorTasks, reviewTasks });

describe('Home task list (MVP1)', () => {
  const tasks = [task(1, 'Accepted'), task(2, 'New'), task(3, 'Rework', { reworkComments: 2 }), task(4, 'In review'), task(5, 'Rejected'), task(6, 'In progress')];

  it('orders tasks rework first, then in progress and new, then waiting and closed; the filter keeps one status', () => {
    expect(sortAuthorTasks(tasks).map((t) => t.status)).toEqual(['Rework', 'In progress', 'New', 'In review', 'Accepted', 'Rejected']);
    expect(filterAuthorTasks(tasks, 'Accepted').map((t) => t.taskId)).toEqual([id(1)]);
    expect(filterAuthorTasks(tasks, '')).toHaveLength(6);
  });

  it('the next step is rework first, then a task to review, then work in progress, then a new task', () => {
    expect(nextForgeStep(homeOf(tasks, [review(1, 'To review')]))).toMatchObject({ title: 'Fix Task 3: rework requested', href: `/tasks/${id(3)}` });
    const noRework = tasks.filter((t) => t.status !== 'Rework');
    expect(nextForgeStep(homeOf(noRework, [review(1, 'To review')]))).toMatchObject({ title: 'Review Task 1', href: `/reviews/${id(101)}` });
    expect(nextForgeStep(homeOf(noRework, [review(1, 'Approved')]))).toMatchObject({ title: 'Continue Task 6', href: `/tasks/${id(6)}` });
    expect(nextForgeStep(homeOf([task(2, 'New'), task(4, 'In review')]))).toMatchObject({ title: 'Start Task 2', href: `/tasks/${id(2)}` });
    expect(nextForgeStep(homeOf([task(4, 'In review')]))).toMatchObject({ title: 'Nothing to do right now', href: null });
  });

  it('renders the welcome card, Tasks to review and Your tasks with statuses, links and the filter', () => {
    const html = renderToStaticMarkup(<ForgeHome home={homeOf(tasks, [review(1, 'To review'), review(2, 'Sent back')])} email="jamie@gmail.test" />);
    const t = text(html);
    expect(t).toContain('Welcome, Jamie');
    expect(t).toContain('Next step Fix Task 3: rework requested');
    expect(t).toMatch(/Tasks to review .*Task 1.*To review.*Review →.*Task 2.*Sent back.*View →/);
    for (const s of ['New', 'In progress', 'In review', 'Rework', 'Accepted', 'Rejected']) expect(html).toContain(`<option value="${s}">${s}</option>`);
    expect(t).toContain('2 comments to fix');
    expect(t).toContain('Fix and resubmit →');
    expect(t).toContain('Start authoring →');
    expect(html).toContain(`href="/tasks/${id(3)}"`);
    expect(html).toContain(`href="/reviews/${id(101)}"`);
    expect(t.indexOf('Task 3')).toBeLessThan(t.indexOf('Task 6'));
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a filtered list shows only that status; no review tasks hides that list; no tasks at all shows guidance', () => {
    const filtered = text(renderToStaticMarkup(<ForgeHome home={homeOf(tasks)} email={null} initialFilter="Accepted" />));
    expect(filtered).toContain('Task 1');
    expect(filtered).not.toContain('Task 5 ');
    expect(filtered).not.toContain('Tasks to review');
    const none = text(renderToStaticMarkup(<ForgeHome home={homeOf([])} email="nobody@gmail.test" />));
    expect(none).toContain('No tasks for this account yet');
    expect(none).toContain('nobody@gmail.test');
    expect(none).toContain('the email you gave your recruitment agency');
  });
});

describe('Before you start (MVP1)', () => {
  const terms: ForgeTermsDoc[] = [
    { key: 'contributor', title: 'Contributor agreement', body: 'Agreement text.', version: 3, sha256: 'a'.repeat(64), placeholder: false },
    { key: 'confidentiality_ip', title: 'Confidentiality and intellectual property', body: 'IP text.', version: 1, sha256: 'b'.repeat(64), placeholder: false },
    { key: 'data_use', title: 'How your data is used', body: 'Data text.', version: 2, sha256: 'c'.repeat(64), placeholder: false },
  ];

  it('both boxes are required', () => {
    expect(welcomeProblem(false, false)).toBe('Accept both to continue.');
    expect(welcomeProblem(true, false)).toBe('Accept both to continue.');
    expect(welcomeProblem(false, true)).toBe('Accept both to continue.');
    expect(welcomeProblem(true, true)).toBeNull();
  });

  it('shows each terms document (title, version, expandable body), two required boxes and Accept and continue', () => {
    const html = renderToStaticMarkup(<WelcomeForm terms={terms} />);
    const t = text(html);
    expect(t).toContain('Contributor agreement (version 3)');
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Contributor agreement/);
    expect(t).toContain('Agreement text.');
    expect(html.match(/type="checkbox" aria-required="true"/g)).toHaveLength(2);
    expect(t).toContain('Synthetic data only');
    expect(t).toContain('Accept and continue');
    expect(t).not.toContain('Accept both to continue.');
    expect(text(renderToStaticMarkup(<WelcomeForm terms={terms} initialError="Accept both to continue." />))).toContain('Accept both to continue.');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('unpublished terms block the screen', () => {
    expect(text(renderToStaticMarkup(<WelcomeForm terms={[terms[0]!, null, terms[2]!]} />))).toContain('have not been published yet');
  });
});

function taskView(profile: TemplateProfile, over: Partial<TaskView> = {}): TaskView {
  return {
    id: id(10),
    status: 'REWORK',
    taskType: 'AUTHORING',
    brief: 'Risk level: high',
    isOpenSlot: false,
    assignedAt: null,
    submittedAt: null,
    activeSeconds: 0,
    revision: 3,
    projectId: id(11),
    projectName: 'Wave 1',
    tptMinutes: 60,
    definition: 'generic',
    template: { workflow: profile.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null },
    input: { slot: { id: 's', brief: 'Risk level: high', tags: { risk_level: 'high' }, edgeCase: null, isOpen: false } },
    output: sampleProfileOutput(profile),
    coverageTags: null,
    checks: null,
    readOnly: false,
    review: { decision: 'REWORK', comments: [{ section: 'S1', text: 'Name the business trigger.' }, { section: 'S6-S8', text: 'Explain the outcome.' }, { section: 'W04', text: 'General note on the slot.' }], notes: null, rejectReason: null, at: '2026-11-15T10:00:00.000Z' },
    ...over,
  };
}
const editor = (over: Partial<TaskView> = {}, section?: number) => renderToStaticMarkup(<ProfileEditor task={taskView(KYB_PROFILE, over)} profile={KYB_PROFILE} onSubmitted={() => undefined} initialSection={section} />);

describe('Rework comments in the form (ProfileEditor)', () => {
  it('matches a comment to its section, including ranges such as S3-S4 and S6–S8', () => {
    expect(sectionMatches('S1', 'S1')).toBe(true);
    expect(sectionMatches('S3-S4', 'S4')).toBe(true);
    expect(sectionMatches('S6–S8', 'S7')).toBe(true);
    expect(sectionMatches('S6-S8', 'S5')).toBe(false);
    expect(sectionMatches('W04', 'S1')).toBe(false);
    const placed = placeComments(taskView(KYB_PROFILE).review!.comments, KYB_PROFILE.sections.map((s) => s.key));
    expect(placed.flagged).toEqual(['S1', 'S6', 'S7', 'S8']);
    expect(placed.unmatched.map((c) => c.section)).toEqual(['W04']);
  });

  it('shows each comment under its section heading, highlights those sections and lists unmatched ones at the top', () => {
    const s1 = editor({}, 0);
    expect(text(s1)).toMatch(/S1 · Assignment and brief .*Reviewer: Name the business trigger\./);
    expect(s1).toContain('data-section-comment="S1"');
    expect(text(s1)).not.toContain('Explain the outcome.');
    expect(text(s1)).toContain('Rework requested');
    expect(text(s1)).toContain('Comments on S1, S6, S7, S8');
    expect(text(s1)).toContain('Reviewer (W04): General note on the slot.');
    expect(s1.match(/data-flagged="true"/g)?.length).toBe(5); // four nav buttons and the open section
    const s7 = text(editor({}, 6));
    expect(s7).toContain('Reviewer: Explain the outcome.');
    expect(s7).not.toContain('Reviewer: Name the business trigger.');
    expect(editor({}, 1)).not.toContain('data-section-comment');
  });

  it('opens on the first section with a comment, and the button reads Resubmit for review', () => {
    expect(text(editor())).toContain('Section 1 of 8');
    const onlyS6 = taskView(KYB_PROFILE).review!;
    expect(text(renderToStaticMarkup(<ProfileEditor task={taskView(KYB_PROFILE, { review: { ...onlyS6, comments: [{ section: 'S6-S8', text: 'x' }] } })} profile={KYB_PROFILE} onSubmitted={() => undefined} />))).toContain('Section 6 of 8');
    expect(text(editor({}, 7))).toContain('Resubmit for review');
    const fresh = text(editor({ status: 'IN_PROGRESS', review: null }, 7));
    expect(fresh).toContain('Submit for review');
    expect(fresh).not.toContain('Resubmit');
    expect(fresh).not.toContain('Rework requested');
  });
});

describe('Reviewer page (MVP1)', () => {
  const view = (over: Partial<ReviewView> = {}): ReviewView => ({
    taskId: id(20),
    label: 'Task 2',
    slotLabel: 'Task 2',
    project: { id: id(21), name: 'KYB project' },
    author: 'Morgan Hale',
    status: 'To review',
    taskStatus: 'SUBMITTED',
    template: { workflow: KYB_PROFILE.catalogWorkflowName, profileId: KYB_PROFILE.profileId, profile: KYB_PROFILE },
    output: sampleProfileOutput(KYB_PROFILE),
    version: 1,
    coverageTags: null,
    myDecisions: [],
    canDecide: true,
    expectedVersion: 1,
    expectedRevision: 4,
    flaggedDuplicate: false,
    confirmCoverage: false,
    ...over,
  });

  it('groups the form sections as the design does, with the keys the API stores', () => {
    expect(reviewGroups(KYB_PROFILE).map((g) => g.key)).toEqual(['S1', 'S2', 'S3-S4', 'S5', 'S6-S8']);
    expect(reviewGroups(KYB_PROFILE)[2]!.heading).toMatch(/^S3–S4 · /);
  });

  it('send back needs at least one comment; empty boxes are not sent', () => {
    expect(reviewDecisionProblem('REWORK', {})).toBe('Add a comment on at least one section before sending it back.');
    expect(reviewDecisionProblem('REWORK', { S1: '   ' })).toBe('Add a comment on at least one section before sending it back.');
    expect(reviewDecisionProblem('REWORK', { S5: 'Tighten step 2.' })).toBeNull();
    expect(reviewDecisionProblem('PASS', {})).toBeNull();
    expect(reviewDecisionProblem('PASS', {}, { needsDuplicate: true, duplicateConfirmed: false })).toMatch(/distinct/);
    expect(commentsToSend({ S1: ' a ', 'S3-S4': '', S5: 'b' })).toEqual([{ section: 'S1', text: 'a' }, { section: 'S5', text: 'b' }]);
  });

  it('renders the authored form read-only with a comment box under each section group and both actions', () => {
    const html = renderToStaticMarkup(<ReviewPage initial={view()} />);
    const t = text(html);
    for (const k of ['S1', 'S2', 'S3-S4', 'S5', 'S6-S8']) expect(html).toContain(`data-comment-section="${k}"`);
    expect(t).toContain('Send back for rework');
    expect(t).toContain('Approve');
    expect(t).toContain('by Morgan Hale');
    // Read-only: values as text, no form inputs other than the comment boxes.
    expect(html.match(/<input/g) ?? []).toHaveLength(0);
    expect(html.match(/<textarea/g)).toHaveLength(5);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('after a decision shows the outcome and earlier decisions, without comment boxes', () => {
    const decided = view({ status: 'Sent back', canDecide: false, myDecisions: [{ id: id(30), decision: 'REWORK', comments: [{ section: 'S5', text: 'Tighten step 2.' }], notes: null, version: 1, at: '2026-11-15T10:00:00.000Z' }] });
    const html = renderToStaticMarkup(<ReviewPage initial={decided} />);
    const t = text(html);
    expect(t).toContain('You sent version 1 back for rework');
    expect(t).toContain('Your earlier decisions');
    expect(t).toContain('S5 Tighten step 2.');
    expect(html).not.toContain('<textarea');
    expect(t).not.toContain('Send back for rework');
  });
});
