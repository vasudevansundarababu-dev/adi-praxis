import { emptyOutput, setFieldValue, TemplateProfileSchema, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileEditor } from '@/components/work/profile-editor';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * KYC v7 (15 Nov 2026): the task's case-selector field (Application type) is set by its slot and shown read-only, so the
 * author never chooses it a second time. The form is the v7 proposal's synthetic authoring profile (API test fixture).
 */
const V7 = JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } };
const PROFILE = TemplateProfileSchema.parse(V7.authoring.profile) as TemplateProfile;
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function taskView(output: Record<string, unknown> | null, slotCase: { field: string; source: string; value: string; label?: string } | undefined, over: Partial<TaskView> = {}): TaskView {
  const brief = 'Application type: Minor (joint with adult). Write this reusable task for Minor (joint with adult) only; set Application type to Minor (joint with adult).';
  return {
    id: '00000000-0000-4000-8000-000000000010',
    status: 'IN_PROGRESS',
    taskType: 'AUTHORING',
    brief,
    isOpenSlot: false,
    assignedAt: null,
    submittedAt: null,
    activeSeconds: 0,
    revision: 1,
    projectId: '00000000-0000-4000-8000-000000000011',
    projectName: 'KYC v7',
    tptMinutes: 45,
    definition: 'generic',
    template: { workflow: PROFILE.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null },
    input: { slot: { id: 's', brief, tags: { product: 'teen_joint' }, edgeCase: null, isOpen: false, ...(slotCase ? { case: slotCase } : {}) } },
    output,
    coverageTags: null,
    checks: null,
    readOnly: false,
    review: null,
    ...over,
  };
}
const render = (output: Record<string, unknown> | null, slotCase?: Parameters<typeof taskView>[1]) => renderToStaticMarkup(<ProfileEditor task={taskView(output, slotCase)} profile={PROFILE} onSubmitted={() => undefined} initialSection={0} />);
const CASE = { field: 'product', source: 'S1.applicationType', value: 'teen_joint', label: 'Minor (joint with adult)' };

describe('case-selector field in the author form', () => {
  it('shows Application type read-only with the slot’s display label, never as a pick list', () => {
    const html = render(emptyOutput(PROFILE), CASE);
    expect(html).toContain('data-selector-field="applicationType"');
    expect(text(html)).toContain('Application type Minor (joint with adult) Set by this task. It cannot be changed.');
    expect(html).not.toMatch(/<select[^>]*id="[^"]*applicationType/);
    expect(text(html)).not.toContain('teen_joint');
    // The optional example state stays an ordinary field.
    expect(text(html)).toContain('Example governing state');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a draft that names another type still shows the slot’s type (the slot value wins)', () => {
    const html = render(setFieldValue(PROFILE, emptyOutput(PROFILE), 'S1', 'applicationType', 'individual'), CASE);
    expect(text(html)).toContain('Application type Minor (joint with adult)');
    expect(text(html)).not.toMatch(/Application type Single/);
  });

  it('an older slot without a stored label uses the form’s option label; a task without a selector keeps the pick list', () => {
    const { label: _drop, ...older } = CASE;
    expect(text(render(emptyOutput(PROFILE), older))).toContain('Application type Minor (joint with adult) Set by this task.');
    const open = render(emptyOutput(PROFILE));
    expect(open).not.toContain('data-selector-field');
    expect(open).toMatch(/<select[^>]*>/);
  });
});
