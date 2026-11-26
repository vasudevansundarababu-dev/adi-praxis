import { describe, expect, it } from 'vitest';
import { isIsoJurisdiction, jurisdictionProblem } from '../src/iso-jurisdiction';

describe('D-090: real ISO 3166 jurisdictions', () => {
  it('accepts countries, US states, DC, US territories and Canadian provinces', () => {
    for (const c of ['US', 'CA', 'GB', 'MX', 'US-CA', 'US-NY', 'US-DC', 'US-PR', 'US-VI', 'CA-ON', 'CA-QC']) expect(isIsoJurisdiction(c), c).toBe(true);
  });
  it('refuses codes that only look like ISO codes, with a plain reason', () => {
    expect(jurisdictionProblem('US-A')).toMatch(/not an ISO 3166-2 subdivision of US/);
    expect(jurisdictionProblem('US-XX')).toMatch(/subdivision/);
    expect(jurisdictionProblem('XX')).toMatch(/not an ISO 3166 country/);
    expect(jurisdictionProblem('UK')).toMatch(/not an ISO 3166 country/);
    expect(jurisdictionProblem('us-ca')).toMatch(/not an ISO code/);
    expect(jurisdictionProblem('California')).toMatch(/not an ISO code/);
    expect(jurisdictionProblem('GB-ENG')).toMatch(/US and Canada only/);
    expect(jurisdictionProblem('')).toBe('No jurisdiction.');
    expect(jurisdictionProblem(null)).toBe('No jurisdiction.');
  });
});
