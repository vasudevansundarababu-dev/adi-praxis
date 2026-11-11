import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProposalReview, type ProposalRow } from '@/components/policy/proposal-review';
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
