import { describe, expect, it, vi } from 'vitest';
import { TaskPolicy, type TaskPolicyData } from '@/components/policy/task-policy';
import { html, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const configured = (over: { published: boolean; sourcesComplete: boolean; sources: number }): TaskPolicyData => ({
  configured: true,
  citations: [],
  ruleSet: { id: 'rs-1', version: 1, digest: 'a'.repeat(64) },
  rules: [
    {
      rule_key: 'R-weekly_spend_cap',
      rule_version_id: 'rv-1',
      version: 1,
      title: 'Weekly spend cap',
      requirement: 'Never spend more than $20,000 in a single week.',
      requirement_type: 'prohibition',
      visibility: 'agent_visible',
      applicability_label: 'All tasks',
      exceptions: { kind: 'none', items: [] },
      evidence_needs: [],
      sources: Array.from({ length: over.sources }, () => ({ sha256: 'b'.repeat(64), quote: 'Never spend more than $20,000 in a single week.', field: 'requirement', role: 'supports', locator: { lineStart: 3, lineEnd: 3 } })),
    },
  ],
  changes: [],
  rubricVersion: '1',
  effectiveDigest: 'c'.repeat(64),
  snapshot: over.published ? { id: 's-1', version: 1, digest: 'c'.repeat(64), createdAt: '2026-11-10T00:00:00Z', current: true } : null,
  readiness: { published: over.published, sourcesComplete: over.sourcesComplete, anvil: 'Not tested' },
});

/** AC14: Praxis computes no policy verdicts. Whatever the readiness, it shows Anvil as Not tested and never a Pass. */
describe('task policy readiness (AC14)', () => {
  it.each([
    { published: true, sourcesComplete: true, sources: 1 },
    { published: false, sourcesComplete: true, sources: 1 },
    { published: true, sourcesComplete: false, sources: 0 },
  ])('shows "Anvil test: Not tested" and no Pass when published=$published, sources complete=$sourcesComplete', (state) => {
    const page = text(html(<TaskPolicy projectId="p-1" taskId="t-1" data={configured(state)} />));
    expect(page).toContain('Anvil test: Not tested');
    expect(page).not.toMatch(/\b(Pass|Passed)\b/);
  });

  it('a task without a published rule set says Not configured and shows no verdict', () => {
    const page = text(html(<TaskPolicy projectId="p-1" taskId="t-1" data={{ configured: false, anvil: 'Not tested' }} />));
    expect(page).toContain('Policy: Not configured.');
    expect(page).not.toMatch(/\b(Pass|Passed|Fail|Failed)\b/);
  });
});
