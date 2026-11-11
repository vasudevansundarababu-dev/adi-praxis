import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTHOR_EXPERIENCE_YEARS,
  generateJobDescriptions,
  jdProblems,
  jdRequirementLines,
  requisitionFromJd,
  REVIEWER_EXTRA_EXPERIENCE_YEARS,
  SEED_DEMOGRAPHIC_ATTRIBUTES,
} from '../src';

const attributes = SEED_DEMOGRAPHIC_ATTRIBUTES.map((a) => ({ key: a.key, label: a.label, type: a.type, allowedValues: a.allowedValues }));
const base = { workflowName: 'Enhanced due diligence', domainName: 'Banking', skills: ['EDD', 'KYC', 'edd'], taskMode: 'AUTHORING', tptMinutes: 60, attributes };

describe('generated job descriptions (owner, 12 Nov 2026)', () => {
  it('template skills become mandatory (de-duplicated); defaults apply without filters; no reviewer on SME -> PM', () => {
    const { author, reviewer } = generateJobDescriptions({ ...base, reviewRoute: 'SME_PM', filters: [] });
    expect(author.mandatorySkills).toEqual(['EDD', 'KYC']);
    expect(author.minExperienceYears).toBe(DEFAULT_AUTHOR_EXPERIENCE_YEARS);
    expect(author.educationLevel).toBe('ISCED_6');
    expect(author.demographicProfile).toEqual([]);
    expect(reviewer).toBeNull();
  });

  it('the Expert route adds a reviewer JD: same skills, demographics and education, more years', () => {
    const filters = [
      { attributeKey: 'domain_experience_years', operator: 'GTE' as const, values: { min: 7 }, required: true },
      { attributeKey: 'education_level', operator: 'IN' as const, values: ['ISCED_8', 'ISCED_7'], required: true },
      { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS' as const, values: { city: 'London', radiusKm: 50 }, required: false },
      { attributeKey: 'languages', operator: 'IN' as const, values: [{ language: 'en', minLevel: 'C1' }], required: true },
    ];
    const { author, reviewer } = generateJobDescriptions({ ...base, reviewRoute: 'SME_EXPERT_PM', filters });
    expect(author).toMatchObject({ minExperienceYears: 7, educationLevel: 'ISCED_7' });
    expect(reviewer).toMatchObject({ role: 'REVIEWER', mandatorySkills: ['EDD', 'KYC'], minExperienceYears: 7 + REVIEWER_EXTRA_EXPERIENCE_YEARS, educationLevel: 'ISCED_7' });
    expect(reviewer!.demographicProfile).toEqual(author.demographicProfile);
    expect(author.demographicProfile.map((l) => l.text)).toEqual(['within 50 km of London', 'English (C1 Advanced or above)']);
  });

  it('requirement lines: mandatory skills, experience, education and required demographics are required', () => {
    const { author } = generateJobDescriptions({ ...base, filters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: false }] });
    const lines = jdRequirementLines({ ...author, skills: [...author.mandatorySkills, 'Python'] });
    expect(lines.required).toEqual([
      'Hands-on experience with EDD',
      'Hands-on experience with KYC',
      'At least 5 years of experience in the domain',
      "Education: Bachelor's or equivalent or higher (or equivalent professional experience)",
    ]);
    expect(lines.preferred).toEqual(['Hands-on experience with Python', 'Country / region: United Kingdom']);
  });

  it('submit problems: missing mandatory skills, missing reviewer JD, reviewer not more senior', () => {
    const route = { taskMode: 'AUTHORING', reviewRoute: 'SME_EXPERT_PM' };
    expect(jdProblems(['KYC', 'EDD'], route, { skills: ['kyc'], minExperienceYears: 5 }, null)).toEqual([
      "The job description is missing the template's mandatory skills: EDD",
      'The Expert review route needs a reviewer job description',
    ]);
    expect(jdProblems(['KYC'], route, { skills: ['KYC'], minExperienceYears: 5 }, { skills: ['KYC'], minExperienceYears: 5 })).toEqual([
      'The reviewer job description must ask for more years of experience than the author job description',
    ]);
    expect(jdProblems(['KYC'], { taskMode: 'AUTHORING', reviewRoute: 'SME_PM' }, { skills: ['KYC'] }, null)).toEqual([]);
  });

  it('a requisition is filled from the reviewer JD', () => {
    const { reviewer } = generateJobDescriptions({ ...base, reviewRoute: 'SME_EXPERT_PM', filters: [] });
    const r = requisitionFromJd({ ...reviewer!, skills: reviewer!.mandatorySkills });
    expect(r).toMatchObject({ minYears: 10, qualifications: ['Skill (mandatory): EDD', 'Skill (mandatory): KYC', "Education: Bachelor's or equivalent or higher"] });
  });
});
