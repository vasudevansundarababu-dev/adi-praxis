import { PublicHelpPanel } from '@praxis/shared/ui/public-help';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/** D-109 / D-110 (owner, 27 Nov 2026): the signed-out Help panel shows each term, its meaning and an example; no question box. */
const help = { title: 'Sign in', intro: 'Sign in with your email.', terms: [{ term: 'Password', meaning: 'At least 12 characters.', example: '"river lamp orbit"' }], stuck: 'Use Forgot password?.' };

describe('PublicHelpPanel', () => {
  it('closed: only the Help button', () => {
    const html = renderToStaticMarkup(<PublicHelpPanel help={help} open={false} onToggle={() => {}} />);
    expect(html).toContain('data-public-help');
    expect(html).toMatch(/>Help<\/button>/);
    expect(html).not.toContain('role="dialog"');
  });
  it('open: the terms with meaning and example, what to do if stuck, and no question box', () => {
    const html = renderToStaticMarkup(<PublicHelpPanel help={help} open onToggle={() => {}} />);
    expect(html).toContain('aria-label="Help: Sign in"');
    expect(html).toContain('<dt class="font-semibold">Password</dt>');
    expect(html).toContain('Example:</span> &quot;river lamp orbit&quot;');
    expect(html).toContain('If something goes wrong');
    expect(html).not.toMatch(/<textarea|<input/);
  });
});
