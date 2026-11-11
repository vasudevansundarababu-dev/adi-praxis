import { SEED_DEMOGRAPHIC_ATTRIBUTES, type DemographicAttributeDto, type JobDescriptionDto } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { GeneratedJdPanel } from '../components/projects/generated-jd';
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
