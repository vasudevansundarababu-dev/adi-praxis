import type { NeedDto } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { SmeNeedsTab } from '../components/forge/sme-needs';
import { PROJECT_TABS } from '../lib/forge-console';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

/** New RL Gym part 4: the PM's SME needs tab. */
const P = '00000000-0000-4000-8000-000000000001';
const need = (n: number, over: Partial<NeedDto> = {}): NeedDto => ({ id: `00000000-0000-4000-8000-00000000001${n}`, projectId: P, taskId: null, kind: 'more_data', note: `Need ${n}`, raisedBy: 'AUTHOR', raisedByName: null, createdAt: '2026-11-22T10:00:00.000Z', state: 'open', studioItemId: null, closedReason: null, lastError: null, ...over });

describe('SME needs tab', () => {
  it('is a project tab; open needs can be selected; sent ones show the Studio item; authors are shown by role', () => {
    expect(PROJECT_TABS.map((t) => t.label)).toContain('SME needs');
    const m = html(<SmeNeedsTab projectId={P} connected initial={[need(1), need(2, { state: 'sent', studioItemId: 'inb-0042', raisedBy: 'REVIEWER', raisedByName: 'Jamie Okafor' }), need(3, { state: 'rejected', closedReason: 'Out of scope.' })]} />);
    const t = text(m);
    expect(m.match(/type="checkbox"/g)).toHaveLength(1);
    expect(t).toContain('Studio item inb-0042');
    expect(t).toContain('Reviewer · Jamie Okafor');
    expect(t).toContain('Author');
    expect(t).toContain('Out of scope.');
    expect(m).toMatch(/<button[^>]*disabled=""[^>]*>Send to Studio<\/button>/);
    expect(a11yProblems(m)).toEqual([]);
  });

  it('says when Studio is not connected; a failed send shows its error', () => {
    const m = html(<SmeNeedsTab projectId={P} connected={false} initial={[need(1, { lastError: { code: 'NETWORK', message: 'Studio could not be reached.' } })]} />);
    expect(text(m)).toContain('Studio isn’t connected yet');
    expect(text(m)).toContain('Last send failed: NETWORK Studio could not be reached.');
  });
});
