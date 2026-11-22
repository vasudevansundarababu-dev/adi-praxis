import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SendNeed } from '@/components/work/send-need';
import { a11yProblems } from './a11y';

/** New RL Gym part 4 (owner, 22 Nov 2026): the author's only new control, a collapsed "Send a need to PM" card. */
describe('Send a need to PM', () => {
  it('is a collapsed card with the two kinds, a note and Send to PM; it is accessible', () => {
    const html = renderToStaticMarkup(<SendNeed taskId="t1" readOnly={false} />);
    expect(html).toMatch(/^<details/);
    expect(html).toContain('Send a need to PM');
    expect(html).toContain('More data');
    expect(html).toContain('New edge case');
    expect(html).toContain('It does not change your task.');
    expect(html).toMatch(/>Send to PM<\/button>/);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a read-only task shows sent needs but no form', () => {
    expect(renderToStaticMarkup(<SendNeed taskId="t1" readOnly />)).not.toContain('Send to PM</button>');
  });

  it('the task page adds only this card; the workbench, AI assist and policy controls stay as they were', () => {
    const page = readFileSync(new URL('../app/tasks/[id]/page.tsx', import.meta.url), 'utf8');
    expect(page).toContain('<SendNeed taskId={data.id} readOnly={data.readOnly} />');
    for (const kept of ['<TaskAids', '<TaskRules', '<PolicyProposals', '<TaskPage task={data} newFlow={newFlow} />']) expect(page).toContain(kept);
  });
});
