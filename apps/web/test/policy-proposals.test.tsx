import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProposalReview, type ProposalRow } from '@/components/policy/proposal-review';
import { ReviewPolicySources, type ReviewPolicySourcesData } from '@/components/tasks/review-policy-sources';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  id: 'p1',
  projectId: 'proj1',
  projectName: 'KYC pilot',
  title: 'KYC Refresh Standard',
  category: 'BANK_POLICY',
  issuer: 'Synthetic Bank',
  versionLabel: 'v3',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  jurisdiction: null,
  reason: 'My task cites the refresh period.',
  proposer: 'Ada Author',
  fileName: 'kyc-standard.txt',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  pageCount: 1,
  readable: true,
  flags: [],
  status: 'PENDING',
  createdAt: '2026-11-12T09:00:00Z',
  ...over,
});

describe('Wave 3: policy proposal review in the console', () => {
  it('shows who proposed what and why, the file and its hash, and an accessible decision form', () => {
    const html = renderToStaticMarkup(<ProposalReview p={row()} />);
    expect(html).toContain('KYC pilot · Bank policy · proposed by Ada Author');
    expect(html).toContain('My task cites the refresh period.');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('/api/v1/projects/proj1/policy/proposals/p1/file');
    expect(html).toContain('Its rules still need extraction, rule review and PM publication.');
    expect(html).toContain('Reason (the SME sees this)');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('presents intake flags as advice and explains why a sensitive or unreadable file cannot be accepted', () => {
    const sensitive = renderToStaticMarkup(<ProposalReview p={row({ flags: [{ code: 'SENSITIVE_DATA_SUSPECTED', message: 'Possible real personal or account data was found.' }] })} />);
    expect(sensitive).toContain('Praxis’s advice, not a decision');
    expect(sensitive).toContain('Possible real personal or account data was found.');
    expect(sensitive).toContain('Show Praxis’s reading (redacted)');
    expect(sensitive).toContain('return it so the SME can upload a synthetic copy');
    const unreadable = renderToStaticMarkup(<ProposalReview p={row({ readable: false, flags: [{ code: 'UNREADABLE', message: 'Praxis could not read text.' }] })} />);
    expect(unreadable).not.toContain('Show Praxis’s reading');
    expect(unreadable).toContain('upload a readable copy');
    expect(a11yProblems(unreadable)).toEqual([]);
  });
});

describe('Wave 3: policy sources on the review page', () => {
  const d: ReviewPolicySourcesData = {
    configured: true,
    basis: { kind: 'SNAPSHOT', version: 2, digest: 'd'.repeat(64), at: '2026-11-12T10:00:00Z', ruleSetVersion: 3 },
    changedSinceSnapshot: true,
    rules: [
      { ruleVersionId: 'r1', ruleKey: 'R-REFRESH', version: 1, title: 'Refresh period', requirement: 'Refresh high-risk files every 12 months.', visibility: 'agent_visible', applicability: 'Applies as written', inForce: true, linkedSteps: ['S2'], sources: [{ document: 'KYC Refresh Standard', category: 'BANK_POLICY', documentVersion: 1, fileName: 'kyc.txt', origin: 'SME_PROPOSAL', sha256: 'b'.repeat(64), role: 'supports', quote: 'Analysts must refresh high-risk customer files every 12 months.', locator: { page: 1, lineStart: 2, lineEnd: 2 } }] },
      { ruleVersionId: 'r2', ruleKey: 'R-SOURCES', version: 1, title: 'Record sources', requirement: 'Record every source.', visibility: 'evaluator_only', applicability: null, inForce: false, linkedSteps: [], sources: [] },
    ],
    taskChanges: [{ id: 'c1', ruleVersionId: 'r1', type: 'STRICTER', requirement: 'Refresh every 6 months for this case.', reason: 'Sanctions nexus.' }],
  };

  it('shows each rule with its quoted source, page and line, labels evaluator-only rules and warns about a newer rule set', () => {
    const html = renderToStaticMarkup(<ReviewPolicySources d={d} />);
    expect(html).toContain('Frozen policy snapshot 2 (project rule set 3)');
    expect(html).toContain('The project has published new rules since this snapshot.');
    expect(html).toContain('Analysts must refresh high-risk customer files every 12 months.');
    expect(html).toContain('KYC Refresh Standard v1, page 1, line 2');
    expect(html).toContain('proposed by an SME and accepted');
    expect(html).toContain('Linked by the SME to step S2');
    expect(html).toContain('Task change (stricter):');
    expect(html).toContain('Evaluator only: hidden from the SME and the agent');
    expect(html).toContain('Not in force today');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says plainly when the project has no published rules', () => {
    const html = renderToStaticMarkup(<ReviewPolicySources d={{ configured: false, basis: null, changedSinceSnapshot: false, rules: [], taskChanges: [] }} />);
    expect(html).toContain('This project has no published policy rules.');
  });
});
