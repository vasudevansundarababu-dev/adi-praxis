import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovedClausesPanel, CoveragePanel, HeldTasksPanel } from '@/components/projects/clause-panels';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** E-002 §4.1 / E-001 §4: approved clauses in plain language with "setup needed", Validate, held tasks. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('approved clauses, Validate and held tasks (console)', () => {
  it('lists each clause with when it applies and shows "Setup needed" with the missing facts', () => {
    const html = renderToStaticMarkup(
      <ApprovedClausesPanel
        projectId="p"
        clauses={[
          { clauseId: 'R-CA-JOINT', version: 2, title: 'CA joint ID', conditionText: 'Governing state is CA, and Product is one of adult_joint, teen_joint', status: 'setup_needed', missingFacts: ['governing_state'], source: { sha256: 'a'.repeat(64) } },
          { clauseId: 'R-ADDRESS', version: 1, title: 'Verify address', conditionText: 'Applies wherever the project’s approved scope applies.', status: 'available', missingFacts: [], source: null },
        ]}
        catalog={{ version: null, catalog: null }}
      />,
    );
    const t = text(html);
    expect(t).toContain('Applies when: Governing state is CA, and Product is one of adult_joint, teen_joint');
    expect(t).toContain('Setup needed');
    expect(t).toContain('Facts the template does not supply yet: governing_state');
    expect(t).toContain('Project fact catalog (not set up)');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('Validate starts with a button; held tasks can be released with a reason', () => {
    expect(text(renderToStaticMarkup(<CoveragePanel projectId="p" />))).toContain('Validate with Studio');
    const held = renderToStaticMarkup(<HeldTasksPanel projectId="p" held={[{ taskId: 't1', title: 'Custodian KYC', waitingFor: 'inb-0077' }]} />);
    expect(text(held)).toContain('Custodian KYC · waiting for inb-0077');
    expect(held).toMatch(/<button[^>]*disabled=""[^>]*>Release task/);
    expect(a11yProblems(held)).toEqual([]);
    expect(renderToStaticMarkup(<HeldTasksPanel projectId="p" held={[]} />)).toBe('');
  });
});

import { DispositionsPanel } from '@/components/projects/clause-panels';

describe('suggested dispositions (console)', () => {
  it('labels each as an AI suggestion with the three categories; only Recommended offers its condition', () => {
    const html = renderToStaticMarkup(
      <DispositionsPanel
        projectId="p"
        initial={{
          model: 'mock-dispositions-1',
          items: [
            { ruleKey: 'R-CA-JOINT', ruleId: 'r1', contentHash: 'h', disposition: 'recommended', mode: 'conditional', condition: { fact: 'governing_state', op: 'eq', value: 'CA' }, conditionText: 'Governing state is CA', bindingGaps: ['governing_state'] },
            { ruleKey: 'R-ADDR', ruleId: 'r2', contentHash: 'h', disposition: 'needs_review', question: 'Which facts decide when this applies?', bindingGaps: [] },
            { ruleKey: 'R-OUT', ruleId: 'r3', contentHash: 'h', disposition: 'outside_scope', mismatch: { quote: 'business accounts', reason: 'The project covers personal accounts only.' }, bindingGaps: [] },
          ],
        }}
      />,
    );
    const t = text(html);
    expect(t).toContain('Recommended');
    expect(t).toContain('Applies when: Governing state is CA');
    expect(t).toContain('Setup needed: the template doesn’t supply governing_state yet.');
    expect(t).toContain('Question for you: Which facts decide when this applies?');
    expect(t).toContain('“business accounts”: The project covers personal accounts only.');
    expect(html.match(/Use this condition/g)).toHaveLength(1);
    expect(a11yProblems(html)).toEqual([]);
  });
});

import { QualityPanel } from '@/components/projects/clause-panels';

describe('PM quality evaluation (console)', () => {
  it('shows precision, recall and agreement with raw numbers, discrepancy counts and the reproducibility line', () => {
    const html = renderToStaticMarkup(
      <QualityPanel
        projectId="p"
        documents={[{ versionId: 'dv1', label: 'Synthetic KYC policy v1' }]}
        sets={[{ id: 's1', documentVersionId: 'dv1', version: 2, labels: 3 }]}
        runs={[
          {
            id: 'r1',
            at: '2026-11-23T20:00:00Z',
            result: { extraction: { precision: { value: 0.667, numerator: 2, denominator: 3 }, recall: { value: 0.667, numerator: 2, denominator: 3 } }, suggestions: { agreement: { value: 0.5, numerator: 1, denominator: 2 } }, counts: { missed_obligation: 1, extra_rule: 1, merged_obligations: 0, disposition_mismatch: 1, no_suggestion: 0 }, discrepancies: [{ type: 'disposition_mismatch', labelId: 'L2', ruleKey: 'R-ADDR', expected: 'needs_review', got: 'recommended' }] },
            metadata: { document: { sha256: 'b'.repeat(64), documentVersion: 1 }, scope: { factCatalogVersion: 1 }, extraction: { provider: 'llamaextract', jobId: '12345678-aaaa' }, suggestions: { promptVersion: 'dispositions/1', model: 'gemini-3.8-flash' }, referenceSet: { version: 2, labels: 3 } },
          },
        ]}
      />,
    );
    const t = text(html);
    expect(t).toContain('Extraction precision 67% (2 of 3) · recall 67% (2 of 3) · suggestion agreement 50% (1 of 2)');
    expect(t).toContain('Missed obligation: 1 · Extra rule (not in your labels): 1 · Suggestion differs from your label: 1');
    expect(t).toContain('prompt dispositions/1, model gemini-3.8-flash · labels v2');
    expect(t).toContain('Reference labels: version 2, 3 labels.');
    expect(a11yProblems(html)).toEqual([]);
  });
});
