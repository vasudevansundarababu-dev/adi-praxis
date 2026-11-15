import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskAids } from '@/components/forge/task-aids';
import { SaveBar, saveStatus } from '@/components/work/save-bar';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D12 (a visible Save button on the authoring form) and D13 (Help floats), owner 15 Nov 2026. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

describe('D12: Save is always on screen', () => {
  it('a sticky action bar with Save, the save state and the bar’s other action; hidden in print', () => {
    const html = renderToStaticMarkup(
      <SaveBar state={{ kind: 'idle' }} flush={async () => true} readOnly={false}>
        <button type="button">Check and submit</button>
      </SaveBar>,
    );
    expect(html).toContain('data-save-bar');
    expect(html).toMatch(/class="sticky bottom-0[^"]*print:hidden/);
    expect(text(html)).toContain('Save All changes save automatically Check and submit');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('shows Saving…, Saved at HH:MM, or Couldn’t save, try again', () => {
    expect(saveStatus({ kind: 'saving' }, null, false)).toEqual({ text: 'Saving…', error: false });
    const at = new Date(2026, 10, 15, 14, 32).toISOString();
    expect(saveStatus({ kind: 'saved', at }, null, false).text).toMatch(/^Saved at .*:32/);
    expect(saveStatus({ kind: 'idle' }, at, false).text).toMatch(/^Saved at /);
    expect(saveStatus({ kind: 'error', message: 'x' }, null, false)).toEqual({ text: 'Couldn’t save, try again', error: true });
    expect(saveStatus({ kind: 'idle' }, null, true)).toEqual({ text: 'Couldn’t save, try again', error: true });
    // A conflict's own message stays in the header only (no duplicate text on the page).
    expect(saveStatus({ kind: 'conflict', message: 'The task changed. Reload before saving.' }, null, false)).toEqual({ text: 'Not saved: reload the page to continue', error: true });
  });

  it('a read-only task has no Save bar', () => {
    expect(renderToStaticMarkup(<SaveBar state={{ kind: 'idle' }} flush={async () => true} readOnly />)).toBe('');
  });
});

describe('D13: Help is the floating Ember mascot', () => {
  it('a fixed, labelled, focusable mascot (inline SVG) with a "Need help?" bubble, no motion when reduced, hidden in print; Tutorial stays at the top', () => {
    const html = renderToStaticMarkup(<TaskAids taskId="00000000-0000-4000-8000-000000000001" kind="author" tutorial={null} />);
    const fab = /<button[^>]*data-help-fab[^>]*>/.exec(html)![0];
    expect(fab).toContain('aria-label="Help"');
    expect(fab).toMatch(/fixed bottom-20 right-3/);
    expect(fab).toContain('focus-visible:outline');
    expect(fab).toContain('print:hidden');
    expect(html).toMatch(/<svg[^>]*viewBox="0 0 64 64"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/<img|\.png|\.gif/);
    expect(text(html)).toContain('Need help?');
    expect(html).toContain('@media (prefers-reduced-motion: reduce) { .ember-bob { animation: none } }');
    expect(text(html)).toContain('▶ Tutorial');
    expect(a11yProblems(html)).toEqual([]);
  });
});
