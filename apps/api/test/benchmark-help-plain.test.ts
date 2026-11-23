import { archetypePlain, businessNotes, complexityPlain, edgeCaseOptionLabel } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { benchmarkHelp } from '../src/forge/task-help';
import { BENCHMARK_HELP } from '../src/support/help-pack';
import { TASK_SCOPE_RULES } from '../src/support/assistant';

/** D-025 (owner, 23 Nov 2026): Benchmark help in business language, from the live template, never stale, no codes. */
const EDGE = [
  { tag: 'sanctions_dob_mismatch', archetype: 'sanctions_near_match', complexity: 'multi_hop', products: ['individual', 'adult_joint', 'teen_joint', 'custodial'], context: 'Applicant APP-999 (Elena Vance) applies for an individual checking account.', twist: 'Sanctions screening returns a name match for "Elena Vance", but the sanctioned individual\'s date of birth is 1962-04-11 while our applicant\'s is 1991-09-03.' },
  { tag: 'minor_without_tin', archetype: 'missing_doc', complexity: 'single_hop', products: ['teen_joint', 'custodial'], context: 'A parent opens a teen joint account with their 15-year-old.', twist: 'The minor has no taxpayer ID on file.' },
  { tag: 'passport_only', archetype: 'missing_doc', complexity: 'single_hop', products: ['individual', 'adult_joint'], context: 'An adult applies for an individual account online.', twist: 'The only document is a passport; nothing proves the residential address.' },
  { tag: 'expired_document', archetype: 'missing_doc', complexity: 'single_hop', products: ['individual', 'adult_joint', 'teen_joint', 'custodial'], context: "A joint applicant uploads a driver's licence.", twist: 'It expired before the application date.' },
];
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8'));
const template = { lineageId: 'l', version: 6, anvilSpec: { ...V7, authoring: { ...V7.authoring, edge_cases: EDGE } } };
const RAW = /sanctions_near_match|multi_hop|single_hop|missing_doc|sanctions_dob_mismatch|minor_without_tin|passport_only|expired_document|D-0\d\d/;

describe('Benchmark help in plain business language', () => {
  it('names each of the four edge cases plainly, with the business topic it is about', () => {
    expect(EDGE.map(edgeCaseOptionLabel)).toEqual([
      'Sanctions date of birth mismatch — Possible sanctions match, multi-step',
      'Minor without TIN — Missing document or detail, single check',
      'Passport only — Missing document or detail, single check',
      'Expired document — Missing document or detail, single check',
    ]);
    expect(EDGE.map((e) => businessNotes(e).map((n) => n.topic))).toEqual([['Sanctions screening'], ['Taxpayer ID (TIN) for every account holder'], ['Address verification (CIP)'], ['Expired identity document']]);
    expect(complexityPlain('multi_hop')?.meaning).toContain('cross-check two or more sources');
    expect(archetypePlain('a_new_kind')).toBe('A new kind');
  });

  it('Help’s context has the live edge cases in plain words, the benchmark’s availability, and no raw codes', () => {
    const ctx = benchmarkHelp({ benchmark: { edgeCase: 'expired_document', version: 1 }, output: { sections: { S1: { archetype: 'missing_doc', complexity: 'single_hop' } } }, project: { template } as never }, new Map([['expired_document', 'supported'], ['sanctions_dob_mismatch', 'needs_environment_change']]));
    const b = ctx.benchmark!;
    expect(b.edgeCases).toHaveLength(4);
    expect(b.edgeCases[3]).toMatchObject({ dropdownLabel: 'Expired document — Missing document or detail, single check', kindOfProblem: 'Missing document or detail', checkingNeeded: 'Single check: one document or one check settles it', benchmarkCases: expect.stringContaining('has practice cases') });
    expect(b.edgeCases[3]!.businessNotes[0]!.usualOutcome).toContain('current, unexpired ID');
    expect(b.edgeCases[0]!.businessNotes[0]!.whyItMatters).toContain('false negative');
    expect(b.edgeCases[1]!.appliesTo).toEqual(['teen joint accounts', 'custodial accounts']);
    expect(b).toMatchObject({ focus: 'Expired document — Missing document or detail, single check', archetype: 'Missing document or detail', complexity: 'Single check' });
    expect(JSON.stringify(b)).not.toMatch(RAW);
  });

  it('the help pack has no stale guidance or internal IDs; the rules forbid codes and ask for business context and examples', () => {
    expect(BENCHMARK_HELP).not.toMatch(/D-0\d\d|leave Focus on edge case on None for now|edge-case tags|case_selector|RL Gym runs/);
    expect(BENCHMARK_HELP).toContain('Example of picking one');
    expect(BENCHMARK_HELP).toContain('Example of leaving None');
    const rules = TASK_SCOPE_RULES('TASK_AUTHOR');
    expect(rules).toContain('Never show internal codes or keys');
    expect(rules).toContain('a short worked example');
  });
});
