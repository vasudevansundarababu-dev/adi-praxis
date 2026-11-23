import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClauseNotes } from '@/components/work/clause-notes';

/** E-002 §4.1.5: S4 shows when each approved clause applies; "Setup needed" is shown, never hidden; nothing for projects without conditions. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('S4 clause notes (SME)', () => {
  it('shows the condition in plain words and setup needed', () => {
    const t = text(renderToStaticMarkup(<ClauseNotes taskId="t" initial={[{ clauseId: 'R-CA-JOINT', version: 2, title: 'CA joint ID', condition: { fact: 'governing_state', op: 'eq', value: 'CA' }, conditionText: 'Governing state is CA', status: 'setup_needed', missingFacts: ['governing_state'] }]} />));
    expect(t).toContain('applies when Governing state is CA');
    expect(t).toContain('Setup needed: the template doesn’t supply governing_state yet');
  });

  it('renders nothing when no clause has a condition (today’s tasks look as before)', () => {
    expect(renderToStaticMarkup(<ClauseNotes taskId="t" initial={[{ clauseId: 'R-1', version: 1, title: 'x', condition: null, conditionText: 'Applies wherever…', status: 'available', missingFacts: [] }]} />)).toBe('');
  });
});
