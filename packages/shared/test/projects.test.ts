import { describe, expect, it } from 'vitest';
import {
  computeProjectFigures,
  effectiveCoverage,
  filterProblems,
  SEED_DEMOGRAPHIC_ATTRIBUTES,
  submitProblems,
  workingDays,
  type ProjectForSubmit,
  type SubmitContext,
} from '../src';

describe('workingDays (Mon–Fri, inclusive)', () => {
  it.each([
    ['2026-10-05', '2026-10-09', 5], // Mon–Fri
    ['2026-10-05', '2026-10-11', 5], // Mon–Sun
    ['2026-10-03', '2026-10-04', 0], // Sat–Sun
    ['2026-10-09', '2026-10-12', 2], // Fri–Mon
    ['2026-10-05', '2026-10-05', 1], // same Monday
    ['2026-10-01', '2026-12-31', 66],
    ['2026-10-10', '2026-10-01', 0], // end before start
  ])('%s to %s = %i', (s, e, n) => expect(workingDays(s, e)).toBe(n));
});

describe('computed fields (SPEC FLOW 1)', () => {
  it('SPEC example: 50 distinct tasks, cap 4 -> 13 authors', () => {
    const f = computeProjectFigures({ taskMode: 'AUTHORING', distinctTarget: 50, maxPerExpert: 4, hoursPerWorkerDay: 4 });
    expect(f.requiredAuthors).toBe(13);
  });

  it('required workers is the larger of authors and the effort-based count', () => {
    // 50 tasks x 90 min = 75 h; 4 h/day x 5 days = 20 h per worker -> 4 workers; authors 13 wins.
    const base = { taskMode: 'AUTHORING' as const, distinctTarget: 50, maxPerExpert: 4, tptMinutes: 90, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-10-09' };
    expect(computeProjectFigures(base)).toMatchObject({ tasks: 50, totalEffortHours: 75, workingDays: 5, requiredWorkers: 13 });
    // Cap 50 -> 1 author; effort needs ceil(75 / 20) = 4.
    expect(computeProjectFigures({ ...base, maxPerExpert: 50 }).requiredWorkers).toBe(4);
  });

  it('annotation uses the task count and has no author minimum', () => {
    const f = computeProjectFigures({ taskMode: 'ANNOTATION', taskCount: 1000, tptMinutes: 6, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-10-16', wagePerTask: 2.5 });
    // 1000 x 6 / 60 = 100 h; 4 x 10 = 40 h per worker -> 3
    expect(f).toMatchObject({ tasks: 1000, requiredAuthors: null, totalEffortHours: 100, workingDays: 10, requiredWorkers: 3, labourBudget: 2500 });
  });

  it('an exact fit does not round up an extra worker', () => {
    const f = computeProjectFigures({ taskMode: 'ANNOTATION', taskCount: 40, tptMinutes: 60, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-10-09' });
    expect(f.requiredWorkers).toBe(2);
  });

  it('warns above 500 workers and leaves figures null when inputs are missing', () => {
    const big = computeProjectFigures({ taskMode: 'ANNOTATION', taskCount: 100000, tptMinutes: 60, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-10-09' });
    expect(big.requiredWorkers).toBe(5000);
    expect(big.warnings[0]).toMatch(/more than 500/);
    expect(computeProjectFigures({ taskMode: 'AUTHORING', hoursPerWorkerDay: 4 })).toMatchObject({ tasks: null, requiredWorkers: null, labourBudget: null });
  });
});

describe('coverage quotas', () => {
  const template = {
    coverageDimensions: { dimensions: [{ key: 'risk', label: 'Risk', values: ['high', 'low'] }], cells: [{ tags: { risk: 'high' }, quota: 2, required: true }, { tags: { risk: 'low' }, quota: 1, required: false }] },
    edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }, { name: 'Nominee director', quota: 1, required: false }],
  };
  it('counts required cell and edge-case slots', () => {
    expect(effectiveCoverage(template, null).requiredSlots).toBe(3);
  });
  it('PMs may raise quotas', () => {
    const r = effectiveCoverage(template, { cells: [{ tags: { risk: 'high' }, quota: 5 }], edgeCases: [{ name: 'pep link', quota: 2 }] });
    expect(r.requiredSlots).toBe(7);
    expect(r.problems).toEqual([]);
  });
  it('PMs cannot drop below the template minimum or add unknown cells', () => {
    const r = effectiveCoverage(template, { cells: [{ tags: { risk: 'high' }, quota: 1 }, { tags: { risk: 'mid' }, quota: 1 }], edgeCases: [] });
    expect(r.problems).toHaveLength(2);
  });
});

describe('demographic filters against the seed taxonomy', () => {
  const attr = (key: string) => SEED_DEMOGRAPHIC_ATTRIBUTES.find((a) => a.key === key)! as Parameters<typeof filterProblems>[0];
  it('seed has the SPEC attributes (no age band) with standard lists', () => {
    // SPEC's 8 minus age band (decided 26 Sep 2026: FLOW2-SME section 9 forbids matching on age).
    expect(SEED_DEMOGRAPHIC_ATTRIBUTES.map((a) => a.key)).toEqual([
      'country', 'city_radius', 'languages', 'education_level', 'domain_experience_years', 'availability_hours_week', 'time_zone',
    ]);
    expect((attr('country').allowedValues as unknown[]).length).toBe(249);
    expect((attr('languages').allowedValues as { languages: unknown[] }).languages.length).toBe(184);
  });
  it('accepts valid filters of each type', () => {
    expect(filterProblems(attr('country'), { attributeKey: 'country', operator: 'IN', values: ['GB', 'IN'], required: true })).toEqual([]);
    expect(filterProblems(attr('city_radius'), { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS', values: { city: 'London', radiusKm: 50 }, required: false })).toEqual([]);
    expect(filterProblems(attr('languages'), { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'C1' }], required: true })).toEqual([]);
    expect(filterProblems(attr('domain_experience_years'), { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 5 }, required: true })).toEqual([]);
  });
  it('rejects bad values, operators and out-of-range numbers', () => {
    expect(filterProblems(attr('country'), { attributeKey: 'country', operator: 'IN', values: ['XX'], required: true })).toHaveLength(1);
    expect(filterProblems(attr('country'), { attributeKey: 'country', operator: 'GTE', values: ['GB'], required: true })).toHaveLength(1);
    expect(filterProblems(attr('domain_experience_years'), { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 80 }, required: true })).toHaveLength(1);
    expect(filterProblems(attr('city_radius'), { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS', values: { city: 'Paris', radiusKm: 900 }, required: true })).toHaveLength(1);
    expect(filterProblems(attr('languages'), { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'Z9' }], required: true })).toHaveLength(1);
  });
});

describe('submit validation', () => {
  const ctx: SubmitContext = {
    template: { offerable: true, taskModes: ['AUTHORING'], coverageDimensions: {}, edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }] },
    attributes: SEED_DEMOGRAPHIC_ATTRIBUTES as SubmitContext['attributes'],
    jobDescription: { wagePerTask: 40 },
    maxTaskCount: 100000,
  };
  const valid: ProjectForSubmit = {
    name: 'KYC Q4', taskMode: 'AUTHORING', taskCount: null, distinctTarget: 50, maxPerExpert: 4, coverageQuotas: null,
    tptMinutes: 90, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-12-18',
    demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }],
  };
  it('a complete project has no problems', () => {
    expect(submitProblems(valid, ctx).problems).toEqual([]);
  });
  it.each([
    [{ tptMinutes: null }, /TPT/],
    [{ startDate: null }, /Start date/],
    [{ endDate: '2026-10-05' }, /after the start date/],
    [{ demographicFilters: [] }, /at least one demographic filter/],
    [{ distinctTarget: null }, /Distinct-task target is required/],
    [{ maxPerExpert: 60 }, /between 1 and the target/],
    [{ distinctTarget: 200000 }, /at most 100000/],
    [{ taskMode: 'ANNOTATION' as const }, /does not allow annotation/],
    [{ demographicFilters: [{ attributeKey: 'height', operator: 'IN' as const, values: ['tall'], required: true }] }, /Unknown demographic attribute/],
  ])('%j is rejected', (patch, msg) => {
    expect(submitProblems({ ...valid, ...patch }, ctx).problems.join(' | ')).toMatch(msg);
  });
  it('requires a JD and a still-offerable template', () => {
    const r = submitProblems(valid, { ...ctx, jobDescription: null, template: { ...ctx.template, offerable: false } });
    expect(r.problems.join(' | ')).toMatch(/job description/);
    expect(r.problems.join(' | ')).toMatch(/no longer available/);
  });
  it('the target must cover the required edge cases', () => {
    expect(submitProblems({ ...valid, distinctTarget: 1, maxPerExpert: 1, coverageQuotas: { cells: [], edgeCases: [{ name: 'PEP link', quota: 3 }] } }, ctx).problems.join()).toMatch(/at least 3/);
  });
});
