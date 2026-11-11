import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SupportBot } from '@/components/support/support-bot';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ usePathname: () => '/tasks/t1' }));

describe('help for authors (owner, 12 Nov 2026)', () => {
  it('shows an accessible Help button on the SME screens', () => {
    const html = renderToStaticMarkup(<SupportBot />);
    expect(html).toContain('Help');
    expect(a11yProblems(html)).toEqual([]);
  });
});
