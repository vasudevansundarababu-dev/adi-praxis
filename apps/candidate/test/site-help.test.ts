import { describe, expect, it } from 'vitest';
import { siteHelpShown } from '../components/support/site-help-logic';

// Night plan, 26 Nov 2026 (owner: "Every page has help"): the Help panel on every signed-in SME page; the task and
// review pages keep their own task Help instead.
describe('site-wide Help panel in the SME app', () => {
  it('shows on home, run reviews, edge-case outcomes, payments and the candidate journey', () => {
    for (const p of ['/home', '/run-reviews', '/edge-outcomes', '/payments', '/welcome', '/opportunities', '/enrollments/x/status', '/certifications', '/tutorials', '/projects/p1']) expect(siteHelpShown(p), p).toBe(true);
  });
  it('is not doubled on the task and review pages, which have task Help', () => {
    expect(siteHelpShown('/tasks/t1')).toBe(false);
    expect(siteHelpShown('/reviews/t1')).toBe(false);
  });
});
