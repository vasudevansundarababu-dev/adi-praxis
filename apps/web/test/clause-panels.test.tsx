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
