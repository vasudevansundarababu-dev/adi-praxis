import { describe, expect, it } from 'vitest';
import { OpportunityBrief, opportunityPublishProblems, safeReturnPath } from '../src';

describe('safeReturnPath (FLOW2 CF-03: unsafe external return URL rejected)', () => {
  it.each([
    ['/opportunities/abc?campaign=1', '/opportunities/abc?campaign=1'],
    ['/verify?returnTo=%2Fopportunities%2Fx', '/verify?returnTo=%2Fopportunities%2Fx'],
    ['https://evil.example/phish', '/home'],
    ['//evil.example', '/home'],
    ['/\\evil.example', '/home'],
    ['%2F%2Fevil.example', '/home'],
    ['javascript:alert(1)', '/home'],
    ['/javascript:alert(1)', '/home'],
    ['relative/path', '/home'],
    ['', '/home'],
    [null, '/home'],
    ['/ok\nSet-Cookie: x', '/home'],
    ['/' + 'a'.repeat(600), '/home'],
  ])('%s -> %s', (raw, expected) => expect(safeReturnPath(raw as string | null)).toBe(expected));
});

describe('opportunity publish rules', () => {
  it('requires the parts a candidate must read before committing', () => {
    const empty = OpportunityBrief.parse({ title: '', summary: '', domain: '', specialty: '' });
    const problems = opportunityPublishProblems(empty, []);
    expect(problems.join(' | ')).toMatch(/Title.*Summary.*Domain.*contribution role.*What we will ask.*What not to disclose.*criterion/);
  });
  it('never invents compensation: it defaults to null', () => {
    expect(OpportunityBrief.parse({ title: 't', summary: 's', domain: 'd', specialty: 'x' }).compensation).toBeNull();
  });
});

describe('time zones (onboarding preferences)', () => {
  it('lists current IANA names, e.g. Asia/Kolkata, and maps older ones browsers still report', async () => {
    const { IANA_TIME_ZONES, canonicalTimeZone } = await import('../src');
    expect(IANA_TIME_ZONES).toContain('Asia/Kolkata');
    for (const old of ['Asia/Calcutta', 'Asia/Saigon', 'Europe/Kiev', 'Asia/Katmandu', 'Asia/Rangoon', 'America/Godthab']) {
      expect(IANA_TIME_ZONES).not.toContain(old);
      expect(IANA_TIME_ZONES).toContain(canonicalTimeZone(old));
    }
    expect(canonicalTimeZone('Europe/London')).toBe('Europe/London');
    expect([...IANA_TIME_ZONES]).toEqual([...IANA_TIME_ZONES].sort());
  });
});
