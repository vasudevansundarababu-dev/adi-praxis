import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PolicyWorkspace, PublishedVersions, type ExtractionData, type Job } from '@/components/policy/policy-workspace';
import { RulesTable, type RulesTableRule } from '@/components/policy/rules-table';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** The Policies page as approved in docs/design/mockups/policy-rules.html (owner, 15 Nov 2026): D4, D7, accept/reject, versions. */
const job = (over: Partial<Job> = {}): Job =>
  ({ id: 'j1', status: 'SUCCEEDED', provider: 'llamaextract', documentVersionId: 'dv1', document: '03-TX-KYC-state-addendum.md', documentVersion: 1, candidateCount: 54, submitted: true, estimatedUsd: 0.4, actualUsd: 0.37, error: null, createdAt: '2026-11-14T10:00:00Z', startedAt: '2026-11-14T10:00:00Z', finishedAt: '2026-11-14T10:01:00Z', ...over }) as Job;
const extraction = (): ExtractionData =>
  ({ available: true, problems: [], budget: { provider: 'llamaextract', ceilingUsd: 5, spentUsd: 3.52, usdPerPage: 0.07, exhausted: false }, batches: [{ id: 'b1', status: 'SUCCEEDED', profileId: 'llama-agentic-v1', profileRevision: 1, selectionSource: 'project', parentBatchId: null, createdAt: '2026-11-14T10:00:00Z', jobs: [job()] }] }) as unknown as ExtractionData;

const rule = (over: Partial<RulesTableRule> = {}): RulesTableRule => ({
  ruleId: 'r1',
  ruleKey: 'R-TX-DL',
  title: 'Accept Texas driver license',
  required: true,
  state: 'DRAFT',
  applied: false,
  documentIds: ['d1'],
  definitionProblems: [],
  evidenceProblems: [],
  versionId: 'v1',
  version: 1,
  contentHash: 'a'.repeat(64),
  requirement: 'The bank may accept a Texas driver license.',
  evidence: null,
  ...over,
});

describe('D7: no cost or budget figures on the Policies page', () => {
  it('an Admin sees no Cost column, no budget line and no dollar amounts', () => {
    const html = renderToStaticMarkup(<PolicyWorkspace projectId="p1" isAdmin documents={{ maxPages: 20, items: [] }} extraction={extraction()} rules={[]} preview={null} />);
    expect(html).not.toContain('>Cost<');
    expect(html).not.toContain('Budget (');
    expect(html).not.toMatch(/\$\d/);
    expect(html).toContain('>54<');
  });
});

describe('D4: the rules prompt box', () => {
  it('uses a short placeholder, offers the example as a link, and explains the disabled button', () => {
    const html = renderToStaticMarkup(<RulesTable projectId="p1" documents={[{ id: 'd1', title: '03-TX-KYC-state-addendum.md' }]} rules={[rule()]} />);
    expect(html).toContain('placeholder="Describe the tasks this template covers…"');
    expect(html).not.toMatch(/placeholder="This template is for KYC/);
    expect(html).toContain('>Use this example</button>');
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Suggest rules<\/button>/);
    expect(html).toContain('Type what the template needs');
    expect(html).toContain('Applied only');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('published versions', () => {
  it('lists each version with its rules per marking and marks older ones superseded', () => {
    const html = renderToStaticMarkup(
      <PublishedVersions
        items={[
          { id: 's3', version: 3, digest: '9e41c7b2'.padEnd(64, '0'), ruleCount: 27, createdAt: '2026-11-15T18:00:00Z', markingCounts: { permitted_option: 12, mandatory_when_applicable: 6, mandatory: 4, required_reference: 3, needs_clarification: 1, other_responsibility: 1 } },
          { id: 's2', version: 2, digest: 'b375507a'.padEnd(64, '0'), ruleCount: 27, createdAt: '2026-11-15T17:47:00Z', markingCounts: { not_annotated: 27 } },
        ]}
      />,
    );
    expect(html).toContain('Permitted option 12 · Mandatory when applicable 6 · Mandatory 4 · Required reference 3 · Needs clarification 1 · Other responsibility/scope 1');
    expect(html).toContain('Not annotated 27');
    expect(html).toContain('(superseded)');
    expect(html).toContain('it is not sent until RL Gym agrees');
    expect(a11yProblems(html)).toEqual([]);
  });
});
