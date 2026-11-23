import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SmeNeedsPanel, type NeedRow } from '@/components/projects/rlgym-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** Owner, 22 Nov 2026: Send to Studio looked "always disabled"; the panel now says why under the summary box. */
const NEED: NeedRow = {
  id: '00000000-0000-4000-8000-000000000031',
  taskId: '00000000-0000-4000-8000-000000000032',
  taskTitle: 'Custodian KYC',
  kind: 'new_case_kind',
  content: { context: 'Trust account', twist: 'Two custodians', expectedOutcome: 'Refer', complexity: 'hard', archetype: 'refer' },
  state: 'open',
  mergedIntoId: null,
  rejectReason: null,
  summary: null,
  studioItemId: null,
  studioState: null,
  createdAt: '2026-11-22T00:00:00.000Z',
};
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('SME needs: why Send to Studio is disabled', () => {
  it('asks for a summary while the box is empty, linked to the box', () => {
    const html = renderToStaticMarkup(<SmeNeedsPanel projectId="p" needs={[NEED]} studioConnected />);
    expect(text(html)).toContain('Write a short summary (3 characters or more) to send.');
    expect(html).toContain(`aria-describedby="need-${NEED.id}-hint"`);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send to Studio/);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says Studio is not connected when that is the reason', () => {
    expect(text(renderToStaticMarkup(<SmeNeedsPanel projectId="p" needs={[NEED]} studioConnected={false} />))).toContain('Studio isn’t connected, so needs can’t be sent yet.');
  });
});
