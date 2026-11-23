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

  it('D-016: purpose-labelled options, conditional follow-ups, the guide’s warnings with a fix, and the translator', () => {
    const tools = [
      { id: 'screening.check', label: 'Screen an applicant — screening.check' },
      { id: 'finding.write', label: 'Record a discrepancy found during a check — finding.write' },
      { id: 'specialist.refer', label: 'Route an unresolved issue to a specialist when policy requires it — specialist.refer' },
      { id: 'recommend', label: 'Submit the final onboarding recommendation — recommend' },
    ];
    const html = render(withSteps([{ action: 'Perform watch-list screening on both applicants', tool: 'specialist.refer' }, { action: 'Screen both joint applicants.', tool: 'screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] }]), tools);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(toolControl(html, 0)).toContain('Screen an applicant — screening.check');
    expect(text).toContain('Conditional follow-ups');
    expect(html).toContain('value="either has an unresolved match"');
    expect(text).toContain('but its tool is specialist.refer');
    expect(text).toContain('Use screening.check');
    expect(text).toContain('uses specialist.refer as its main tool with no condition');
    expect(text).toContain('does not end with the final recommendation');
    expect(text).toContain('Write the procedure in your own words');
    expect(a11yProblems(html)).toEqual([]);
  });
});

