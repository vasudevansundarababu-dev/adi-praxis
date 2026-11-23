import { emptyOutput, setFieldValue, TemplateProfileSchema, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NOT_A_TEMPLATE_TOOL, ProfileEditor } from '@/components/work/profile-editor';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * APR-13d (owner, 22 Nov 2026): a procedure step's Tool (S5.steps[].tool) is a dropdown of the template's declared tools,
 * so an author cannot name a tool the RL Gym would refuse (GENERIC_TOOL_UNDECLARED at approval). The form itself is
 * unchanged (it is hashed verbatim); the app swaps the control when the server sends the template's tools.
 */
const V7 = JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } };
const PROFILE = TemplateProfileSchema.parse(V7.authoring.profile) as TemplateProfile;
const S5 = PROFILE.sections.findIndex((s) => s.key === 'S5');
const TOOLS = [
  { id: 'application.read', label: 'application.read (read)' },
  { id: 'address.check', label: 'address.check (read)' },
];

function taskView(output: Record<string, unknown>, stepTools: TaskView['template']['stepTools']): TaskView {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    status: 'REWORK',
    taskType: 'AUTHORING',
    brief: 'Write the task.',
    isOpenSlot: false,
    assignedAt: null,
    submittedAt: null,
    activeSeconds: 0,
    revision: 1,
    projectId: '00000000-0000-4000-8000-000000000021',
    projectName: 'KYC',
    tptMinutes: 45,
    definition: 'generic',
    template: { workflow: PROFILE.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null, stepTools },
    input: { slot: { id: 's', brief: 'Write the task.', tags: {}, edgeCase: null, isOpen: false } },
    output,
    coverageTags: null,
    checks: null,
    readOnly: false,
    review: null,
  };
}
const withSteps = (steps: Record<string, unknown>[]) => setFieldValue(PROFILE, emptyOutput(PROFILE), 'S5', 'steps', steps);
const render = (output: Record<string, unknown>, tools: TaskView['template']['stepTools']) =>
  renderToStaticMarkup(<ProfileEditor task={taskView(output, tools)} profile={PROFILE} onSubmitted={() => undefined} initialSection={S5} />);
const toolControl = (html: string, i: number) => {
  const m = new RegExp(`<(select|input)[^>]*id="[^"]*S5[^"]*steps[^"]*${i}[^"]*tool[^"]*"[^>]*>([\\s\\S]*?</select>)?`).exec(html);
  return m?.[0] ?? '';
};

describe('S5 step Tool dropdown', () => {
  it('offers only the template’s tools, plus blank', () => {
    const html = render(withSteps([{ action: 'Read the application', tool: 'application.read' }]), TOOLS);
    const control = toolControl(html, 0);
    expect(control.startsWith('<select')).toBe(true);
    expect([...control.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', 'application.read', 'address.check']);
    expect(control).toContain('address.check (read)');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('keeps a saved tool that is not the template’s visible and marked, so the author can see and change it', () => {
    const control = toolControl(render(withSteps([{ action: 'Fetch the case', tool: 'case_data_fetcher' }]), TOOLS), 0);
    expect(control).toContain(`case_data_fetcher (${NOT_A_TEMPLATE_TOOL})`);
  });

  it('stays a text box when the template declares no tools', () => {
    expect(toolControl(render(withSteps([{ action: 'x', tool: 'anything' }]), null), 0).startsWith('<input')).toBe(true);
  });
});
