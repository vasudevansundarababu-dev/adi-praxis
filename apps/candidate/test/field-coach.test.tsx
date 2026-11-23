import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FieldCoach } from '@/components/work/field-coach';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D-027: "Show an example" and "Check this" under each free-text field; nothing changes until the SME clicks. */
describe('field coach (SME form)', () => {
  it('offers an example always and a check once there is text', () => {
    const empty = renderToStaticMarkup(<FieldCoach taskId="t" section="S1" field="trigger" label="Workflow trigger" value="" onUse={() => undefined} />);
    expect(empty).toContain('Show an example');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Check this/);
    const filled = renderToStaticMarkup(<FieldCoach taskId="t" section="S1" field="trigger" label="Workflow trigger" value="A new application is submitted." onUse={() => undefined} />);
    expect(filled).not.toMatch(/<button[^>]*disabled=""[^>]*>Check this/);
    expect(filled).toContain('aria-label="Check what you wrote in Workflow trigger"');
    expect(a11yProblems(filled)).toEqual([]);
  });
});
