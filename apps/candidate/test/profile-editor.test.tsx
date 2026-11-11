import { addRepeatedItem, emptyOutput, KYB_PROFILE, registerProfile, sampleProfileOutput, setFieldValue, type TemplateProfile } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProfileDiagnostic, ProfileEditor, profileRouteFor } from '@/components/work/profile-editor';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function taskView(profile: TemplateProfile, output: Record<string, unknown> | null, over: Partial<TaskView> = {}): TaskView {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    status: 'IN_PROGRESS',
    taskType: 'AUTHORING',
    brief: 'Risk level: high',
    isOpenSlot: false,
    assignedAt: null,
    submittedAt: null,
    activeSeconds: 0,
    revision: 3,
    projectId: '00000000-0000-4000-8000-000000000011',
    projectName: 'Wave 1',
    tptMinutes: 60,
    definition: 'generic',
    template: { workflow: profile.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null },
    input: { slot: { id: 's', brief: 'Risk level: high', tags: { risk_level: 'high' }, edgeCase: null, isOpen: false } },
    output,
    coverageTags: null,
    checks: null,
    readOnly: false,
    review: null,
    ...over,
  };
}
const render = (profile: TemplateProfile, output: Record<string, unknown> | null, section = 0, over: Partial<TaskView> = {}) =>
  renderToStaticMarkup(<ProfileEditor task={taskView(profile, output, over)} profile={profile} onSubmitted={() => undefined} initialSection={section} />);

describe('ProfileEditor (Classic renderer for template profiles)', () => {
  it('renders all eight sections, each editable, with "Section X of 8"', () => {
    const first = text(render(KYB_PROFILE, null));
    for (const s of KYB_PROFILE.sections) expect(first).toContain(`${s.key} ${s.title}`);
    for (let i = 0; i < 8; i++) {
      const html = render(KYB_PROFILE, emptyOutput(KYB_PROFILE), i);
      const s = KYB_PROFILE.sections[i]!;
      expect(text(html)).toContain(`Section ${i + 1} of 8`);
      expect(text(html)).toContain(`${s.key} · ${s.title}`);
      // Every field of the section is rendered, and the section is not disabled.
      for (const f of s.fields) expect(text(html), `${s.key}.${f.key}`).toContain(f.label);
      expect(html).not.toMatch(/<fieldset disabled/);
      expect(a11yProblems(html), s.key).toEqual([]);
    }
  });

  it('shows per-section progress and collapsed examples, and the graph slot below the editor', () => {
    const html = render(KYB_PROFILE, emptyOutput(KYB_PROFILE));
    expect(text(html)).toMatch(/S1 Assignment and brief 0\/7 required done/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Example<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html.indexOf('data-workflow-graph-slot')).toBeGreaterThan(html.indexOf('Next section'));
    const done = render(KYB_PROFILE, sampleProfileOutput(KYB_PROFILE));
    expect(text(done)).toMatch(/S1 Assignment and brief 7\/7 required done/);
  });

  it('repeated arrays: an empty list explains Add; Add opens a record with its fields and a Remove button', () => {
    const empty = render(KYB_PROFILE, emptyOutput(KYB_PROFILE), 1);
    expect(text(empty)).toContain('No evidence items yet. Use “Add evidence item”');
    expect(empty).toMatch(/<button type="button"[^>]*>Add evidence item<\/button>/);
    const added = addRepeatedItem(KYB_PROFILE, emptyOutput(KYB_PROFILE), 'S2', 'evidence');
    const html = render(KYB_PROFILE, added, 1);
    expect(text(html)).toContain('Evidence item 1 · E1');
    expect(html).toContain('aria-label="Remove evidence item 1"');
    for (const label of ['Evidence ID', 'Evidence type', 'Source / issuer', 'Relevant date', 'Content']) expect(text(html)).toContain(label);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('shows the profile problems inline, next to their fields', () => {
    const added = addRepeatedItem(KYB_PROFILE, setFieldValue(KYB_PROFILE, emptyOutput(KYB_PROFILE), 'S1', 'title', 'A case'), 'S2', 'evidence');
    const s1 = render(KYB_PROFILE, added, 0);
    expect(s1).toMatch(/id="pf-S1-businessContext-problems"[^>]*><li>Business context: required<\/li>/);
    expect(s1).toContain('aria-invalid="true"');
    expect(s1).not.toContain('Title: required');
    const s2 = render(KYB_PROFILE, added, 1);
    expect(text(s2)).toContain('Evidence item 1 › Content: required');
    const s8 = render(KYB_PROFILE, added, 7);
    expect(text(s8)).toContain('Still to fix');
    expect(text(s8)).toContain('S7 Criteria: required');
  });

  it('works at 390 px: no fixed widths, the navigation wraps', () => {
    const html = render(KYB_PROFILE, sampleProfileOutput(KYB_PROFILE), 4);
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}/);
    expect(html).toMatch(/<ol class="flex flex-wrap gap-2">/);
  });

  it('read-only tasks keep section navigation but disable editing', () => {
    const html = render(KYB_PROFILE, sampleProfileOutput(KYB_PROFILE), 2, { readOnly: true });
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(/<button type="button"[^>]*aria-current="step"/);
  });
});

describe('profile routing', () => {
  const base = taskView(KYB_PROFILE, null);
  it('routes blank and profile outputs to the profile editor; legacy, KYC and unprofiled tasks keep their editors', () => {
    expect(profileRouteFor(base)?.kind).toBe('editor');
    expect(profileRouteFor({ ...base, output: { header: { title: 'x' } } })?.kind).toBe('editor');
    expect(profileRouteFor({ ...base, output: sampleProfileOutput(KYB_PROFILE) })?.kind).toBe('editor');
    expect(profileRouteFor({ ...base, output: { header: { title: 'x' }, body: 'Legacy content' } })).toBeNull();
    expect(profileRouteFor({ ...base, definition: 'kyc-onboarding-v1', template: { ...base.template, workflow: 'KYC onboarding and refresh' } })).toBeNull();
    expect(profileRouteFor({ ...base, template: { ...base.template, workflow: 'KYC onboarding and refresh' } })).toBeNull();
    expect(profileRouteFor({ ...base, template: { ...base.template, workflow: 'Adverse media review' } })).toBeNull();
    expect(profileRouteFor({ ...base, taskType: 'ANNOTATION' })).toBeNull();
  });

  it('an unsupported profile shows a diagnostic, not a blank form', () => {
    const broken = JSON.parse(JSON.stringify(KYB_PROFILE));
    broken.catalogWorkflowName = 'Broken Candidate Workflow';
    broken.sections[1].fields.push({ key: 'sig', type: 'signature_pad', label: 'Sign', help: 'x' });
    registerProfile(broken);
    const route = profileRouteFor({ ...base, template: { ...base.template, workflow: 'Broken Candidate Workflow' } });
    expect(route?.kind).toBe('diagnostic');
    const html = renderToStaticMarkup(<ProfileDiagnostic workflow="Broken Candidate Workflow" problems={route?.kind === 'diagnostic' ? route.problems : []} />);
    expect(text(html)).toContain('This template cannot be edited yet');
    expect(text(html)).toContain('unsupported field type "signature_pad"');
    expect(html).not.toContain('<input');
  });
});
