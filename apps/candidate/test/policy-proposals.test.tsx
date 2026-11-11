import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PolicyProposals } from '@/components/work/policy-proposals';
import { a11yProblems } from './a11y';

describe('Wave 3: an SME proposes a policy document', () => {
  it('explains that a proposal is not used until accepted and published, and the form is accessible', () => {
    const html = renderToStaticMarkup(<PolicyProposals taskId="t1" readOnly={false} />);
    expect(html).toContain('Propose a policy document');
    expect(html).toContain('It is not used until an Expert or the project manager accepts it');
    expect(html).toContain('never upload real customer or employer data');
    expect(html).toContain('Why does your task need it?');
    expect(html).toContain('Bank policy');
    expect(html).toContain('Regulation or public standard');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a read-only task shows proposals but no form', () => {
    const html = renderToStaticMarkup(<PolicyProposals taskId="t1" readOnly />);
    expect(html).not.toContain('Send for review');
  });
});
