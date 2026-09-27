import { describe, expect, it } from 'vitest';
import {
  defaultQuestionPolicy,
  experienceDurations,
  nextQuestion,
  OpportunityBrief,
  ProfileData,
  readiness,
  reconcilePolicy,
  unionDuration,
  type OpportunityCriteria,
} from '../src';

const brief = OpportunityBrief.parse({ title: 'KYC Analyst', summary: 's', domain: 'Banking', specialty: 'KYC onboarding and refresh', contributionRoles: ['TASK_AUTHOR', 'REVIEWER'] });
const criteria: OpportunityCriteria = [
  { id: 'kyc', text: 'Hands-on KYC casework', kind: 'REQUIRED', evidence: 'Redacted role proof', equivalence: '' },
  { id: 'edd', text: 'EDD reviews', kind: 'PREFERRED', evidence: '', equivalence: '' },
];
const policy = defaultQuestionPolicy(brief, criteria);
const field = (status: string, value: unknown = 'x') => ({ value, status, approximate: false, sources: [], conflictWith: null, reused: false });

describe('default question policy (CF-08)', () => {
  it('asks banking SMEs six short questions, most of them tap-to-choose', () => {
    expect(policy.questions.map((q) => q.id)).toEqual(['focus', 'roles', 'authority', 'jurisdictions', 'requirements', 'work_example']);
    expect(policy.questions.filter((q) => q.answerType === 'choice').map((q) => q.id)).toEqual(['focus', 'authority', 'jurisdictions']);
    expect(policy.questions[0]!.text).toMatch(/compliance processes/);
    expect(policy.questions[0]!.options).toContain('Sanctions review');
  });
  it('never asks for GitHub, papers, salary, age, nationality or similar', () => {
    const all = policy.questions.map((q) => `${q.text} ${q.why}`).join(' ');
    expect(all).not.toMatch(/github|paper|publication|salary|age\b|date of birth|nationality|religion|photo/i);
  });
  it('asks about all published criteria in one question, required when any criterion is required', () => {
    const req = policy.questions.find((q) => q.id === 'requirements')!;
    expect(req).toMatchObject({ required: true, criterionIds: ['kyc', 'edd'], fields: ['criterion:kyc', 'criterion:edd'] });
    expect(req.text).toMatch(/\(preferred\)/);
  });
  it('non-banking domains get generic wording', () => {
    const p = defaultQuestionPolicy(OpportunityBrief.parse({ title: 't', summary: 's', domain: 'Healthcare', specialty: 'Triage' }), []);
    expect(p.questions[0]!.text).toMatch(/Triage/);
    expect(p.questions.some((q) => q.id === 'exceptions')).toBe(false);
  });
  it('reconciling an owner policy drops questions for removed criteria and adds missing ones', () => {
    const owner = { ...policy, source: 'owner' as const, questions: policy.questions.filter((q) => q.id !== 'requirements') };
    const r = reconcilePolicy(owner, brief, [criteria[1]!]);
    expect(r.questions.some((q) => q.criterionIds.includes('kyc'))).toBe(false);
    expect(r.questions.find((q) => q.id === 'requirements')).toMatchObject({ criterionIds: ['edd'], fields: ['criterion:edd'] });
  });
});

describe('controller (CF-09: never repeat what is already answered)', () => {
  it('asks the first uncovered question', () => {
    expect(nextQuestion(policy, ProfileData.parse({}))?.id).toBe('focus');
  });
  it('a broad answer that proposes several fields skips those questions', () => {
    const p = ProfileData.parse({ fields: { compliance_areas: field('PROPOSED', ['KYC']), specialties: field('PROPOSED', ['KYC']), decision_authority: field('PROPOSED', 'Prepared cases') } });
    expect(nextQuestion(policy, p)?.id).toBe('roles');
  });
  it('unknown, declined and skipped answers count as addressed (no penalty, no re-asking)', () => {
    const p = ProfileData.parse({ fields: { compliance_areas: field('UNKNOWN', null), specialties: field('DECLINED', null) } });
    expect(nextQuestion(policy, p)?.id).toBe('roles');
  });
});

describe('experience durations (CF-10: union, not sum)', () => {
  const now = new Date('2026-09-26');
  it('overlapping roles do not double-count calendar time', () => {
    const d = unionDuration([
      { title: 'Analyst', start: '2016-01', end: '2019-12', approximate: false },
      { title: 'Part-time reviewer', start: '2018-01', end: '2020-12', approximate: true },
    ], now);
    expect(d.months).toBe(60); // 2016-01..2020-12, not 48 + 36
    expect(d).toMatchObject({ years: 5, overlapsMerged: true, approximate: true });
  });
  it('separates total domain time from specialty time', () => {
    const p = ProfileData.parse({
      roles: [
        { id: 'a', title: 'Relationship manager', start: '2010-01', end: '2015-12', specialtyRelevant: false, status: 'CONFIRMED' },
        { id: 'b', title: 'KYC analyst', start: '2016-01', end: null, specialtyRelevant: true, status: 'CONFIRMED' },
        { id: 'c', title: 'Unconfirmed role', start: '2000-01', end: '2009-12', status: 'PROPOSED' },
      ],
    });
    const d = experienceDurations(p, now);
    expect(d.domain.months).toBe(72 + 129);
    expect(d.specialty.months).toBe(129); // 2016-01..2026-09 inclusive
    expect(d.specialty.years).toBe(10.8);
  });
  it('undated roles are listed, never guessed', () => {
    const p = ProfileData.parse({ roles: [{ id: 'a', title: 'Consultant', start: null, end: null, status: 'CONFIRMED' }] });
    expect(experienceDurations(p, now)).toMatchObject({ domain: { months: 0 }, undated: ['Consultant'] });
  });
});

describe('readiness to submit (CF-11, CF-12)', () => {
  const complete = () => {
    const fields: Record<string, unknown> = {};
    for (const q of policy.questions) for (const f of q.fields) if (f !== 'roles') fields[f] = field('CONFIRMED');
    return ProfileData.parse({ fields, roles: [{ id: 'r', title: 'KYC analyst', start: '2016-01', end: null, status: 'CONFIRMED' }] });
  };
  it('a fully confirmed profile can be submitted', () => {
    expect(readiness(policy, complete(), criteria)).toMatchObject({ canSubmit: true, unconfirmed: [], requiredGaps: [] });
  });
  it('proposed facts must be confirmed first', () => {
    const p = complete();
    p.fields.domain_years = field('PROPOSED', 12) as never;
    expect(readiness(policy, p, criteria)).toMatchObject({ canSubmit: false, unconfirmed: ['Years in the domain (self-reported)'] });
  });
  it('an unknown required answer is allowed but explained; nothing defaults to zero', () => {
    const p = complete();
    p.fields['criterion:kyc'] = field('UNKNOWN', null) as never;
    const r = readiness(policy, p, criteria);
    expect(r.canSubmit).toBe(true);
    expect(r.requiredGaps).toEqual(['Requirement: Hands-on KYC casework']);
    expect(ProfileData.parse(p).fields['criterion:kyc']?.value).toBeNull();
  });
  it('a skipped optional question is not a gap', () => {
    const p = complete();
    p.fields.evidence_available = field('SKIPPED', null) as never;
    expect(readiness(policy, p, criteria).requiredGaps).toEqual([]);
  });
  it('impossible date ranges need a neutral clarification before submitting', () => {
    const p = complete();
    p.roles.push({ ...p.roles[0]!, id: 'x', title: 'Auditor', start: '2020-05', end: '2019-01' });
    expect(readiness(policy, p, criteria)).toMatchObject({ canSubmit: false, problems: ['Auditor: the end month is before the start month'] });
  });
});
