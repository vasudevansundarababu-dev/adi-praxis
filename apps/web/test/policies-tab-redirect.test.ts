import { describe, expect, it } from 'vitest';
import { policiesTabRedirect } from '../lib/forge-console';

describe('Policies tab for KYC Judgment projects (D-090)', () => {
  it('sends a review-queue (policy-library) project to its Policy page', () => {
    expect(policiesTabRedirect('605fed3e', 'review_queue')).toBe('/projects/605fed3e/policy');
  });
  it('keeps the old tab for every other project, and when the route is unknown', () => {
    expect(policiesTabRedirect('p1', 'apply_tick')).toBeNull();
    expect(policiesTabRedirect('p1', undefined)).toBeNull();
    expect(policiesTabRedirect('p1', null)).toBeNull();
  });
});
