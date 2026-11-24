import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyPicker } from '@/components/work/benchmark-fields';
import { a11yProblems } from './a11y';

/** E-001 §6b (owner, 24 Nov 2026): "Focus on edge case" by family and variant. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\\s+/g, ' ');
const FAMILIES = {
  source: 'catalog' as const,
  fallbackReason: null,
  items: [
    {
      familyId: 'expired_id',
      name: 'Expired ID',
      description: 'An identity document that is not valid on the application date.',
      archetype: 'missing_doc',
      complexity: 'single_hop',
      variants: [
        { variantId: 'expired_document', tag: 'expired_document', name: 'Expired passport', description: '', boundary: null, state: 'available', hasOutcome: true, needsConfirmation: true },
        { variantId: 'expires_today', tag: 'expires_today', name: 'Expires today', description: '', boundary: 'expires on the application date', state: 'available', hasOutcome: true, needsConfirmation: false },
        { variantId: 'expires_in_30', tag: 'expires_in_30', name: 'Expires within 30 days', description: '', boundary: null, state: 'waiting_outcome', hasOutcome: false, needsConfirmation: true },
      ],
    },
  ],
};

describe('Family picker', () => {
  it('lists families; a chosen family shows its variants, which count, and which wait for an SME outcome', () => {
    const html = renderToStaticMarkup(<FamilyPicker families={FAMILIES} familyId="expired_id" variants="all" editable onFamily={() => undefined} onVariants={() => undefined} />);
    const t = text(html);
    expect(t).toContain('Focus on edge-case family (optional)');
    expect(t).toContain('Expired ID — 3 variants, Missing document or detail');
    expect(t).toContain('Every variant that counts, including ones added later');
    expect(t).toContain('Expires today (boundary: expires on the application date)');
    expect(t).toContain('waiting for an SME outcome, so it can’t count yet');
    expect(t).toContain('outcome carried over, not yet confirmed by a person');
    expect(a11yProblems(html)).toEqual([]);
  });
});
