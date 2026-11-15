import { SEED_DEMOGRAPHIC_ATTRIBUTES, type DemographicAttributeDto, type JobDescriptionDto } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_PAY, GeneratedJdPanel, payProblem } from '../components/projects/generated-jd';
import { html, template, text } from './helpers';

const attributes = SEED_DEMOGRAPHIC_ATTRIBUTES.map((a, i) => ({ ...a, id: `00000000-0000-4000-8000-0000000009${String(i).padStart(2, '0')}` })) as unknown as DemographicAttributeDto[];
const t = template({ workflowName: 'Enhanced due diligence', domainName: 'Banking', skills: ['EDD', 'KYC'] });
const filters = [
  { attributeKey: 'country', operator: 'IN' as const, values: ['GB'], required: true },
  { attributeKey: 'domain_experience_years', operator: 'GTE' as const, values: { min: 6 }, required: false },
];
const panel = (over: Partial<Parameters<typeof GeneratedJdPanel>[0]> = {}) =>
  text(
    html(
      <GeneratedJdPanel template={t} taskMode="AUTHORING" reviewRoute="SME_PM" tptMinutes={60} filters={filters} attributes={attributes} projectId={null} jds={null} onJdsChange={() => {}} {...over} />,
    ),
  );

describe('generated JD step (owner, 12 Nov 2026)', () => {
  it('previews the author JD from the template: mandatory skills, experience, education, demographics', () => {
    const out = panel();
    expect(out).toContain('Enhanced due diligence task author (Banking)');
    expect(out).toContain('EDD (mandatory, from the template)');
    expect(out).toContain('At least 6 years in the domain');
    expect(out).toContain('or equivalent or higher (or equivalent professional experience)');
    expect(out).toContain('Country / region: United Kingdom (required)');
    expect(out).not.toContain('expert reviewer');
  });

  it('the Expert route previews a reviewer JD with more years', () => {
    const out = panel({ reviewRoute: 'SME_EXPERT_PM' });
    expect(out).toContain('Enhanced due diligence expert reviewer (Banking)');
    expect(out).toContain('At least 11 years in the domain');
  });

  it('a saved draft shows the editable JDs with pay and location', () => {
    const jd: JobDescriptionDto = {
      id: '00000000-0000-4000-8000-000000000777',
      title: 'Senior EDD author',
      responsibilities: 'Write cases.',
      skills: ['EDD', 'KYC', 'Python'],
      wagePerTask: 40,
      wageCurrency: 'GBP',
      locationType: 'REMOTE',
      location: null,
      updatedAt: '2026-11-12T10:00:00.000Z',
      role: 'AUTHOR',
      generated: true,
      projectId: '00000000-0000-4000-8000-000000000778',
      mandatorySkills: ['EDD', 'KYC'],
      minExperienceYears: 6,
      educationLevel: 'ISCED_6',
      demographicProfile: [],
    };
    const markup = html(
      <GeneratedJdPanel template={t} taskMode="AUTHORING" reviewRoute="SME_PM" tptMinutes={60} filters={filters} attributes={attributes} projectId={jd.projectId} jds={{ author: jd, reviewer: null }} onJdsChange={() => {}} />,
    );
    expect(text(markup)).toContain('Task author (SME) job description');
    expect(text(markup)).toContain('Other skills Python');
    expect(markup).toContain('value="Senior EDD author"');
    expect(markup).toContain('value="40"');
  });
});

describe('D10: pay and location before the first save', () => {
  it('a new project shows Wage per task, currency and location on the generated JDs, with no "save first" message', () => {
    const out = panel({ reviewRoute: 'SME_EXPERT_PM', pay: { author: EMPTY_PAY, reviewer: EMPTY_PAY }, onPayChange: () => {} });
    expect(out.match(/Wage per task/g)).toHaveLength(2);
    expect(out).toContain('Currency (ISO code)');
    expect(out).toContain('Set the pay and location now; they are saved with the draft.');
    expect(out).not.toContain('Save the draft to create these job descriptions');
  });

  it('shows the inline problem once Next was tried, and none when a wage is set', () => {
    expect(panel({ pay: { author: EMPTY_PAY, reviewer: EMPTY_PAY }, onPayChange: () => {}, showProblems: true })).toContain('Set the wage per task for the task author (sme) job description.');
    expect(panel({ pay: { author: { ...EMPTY_PAY, wagePerTask: '40' }, reviewer: EMPTY_PAY }, onPayChange: () => {}, showProblems: true })).not.toContain('Set the wage per task');
  });

  it('payProblem: a wage above zero, and a location unless remote', () => {
    expect(payProblem({ ...EMPTY_PAY }, 'x')).toBe('Set the wage per task for the x.');
    expect(payProblem({ ...EMPTY_PAY, wagePerTask: '0' }, 'x')).toBe('Set the wage per task for the x.');
    expect(payProblem({ ...EMPTY_PAY, wagePerTask: '25', locationType: 'ONSITE' }, 'x')).toBe('Set the location for the x.');
    expect(payProblem({ ...EMPTY_PAY, wagePerTask: '25' }, 'x')).toBeNull();
  });
});
