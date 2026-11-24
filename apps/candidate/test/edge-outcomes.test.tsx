import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EdgeOutcomes, type MyOutcomeBatch } from '@/components/forge/edge-outcomes';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** E-001 §6b (owner, 24 Nov 2026): the SME's edge-case outcomes, in one batch. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const BATCH: MyOutcomeBatch = {
  id: 'b1', requestId: 'orq-1', answerer: 'sme', assigneeSmeUserId: 's1', secondCheck: true, note: 'Two quick ones, please.', dueBy: '2026-11-26', state: 'open', sentAt: null, sendError: null, projectName: 'KYC November',
  outcomeFields: [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowedValues: ['approve', 'refer'] }],
  items: [{ id: 'i1', familyName: "Minor's TIN", variantId: 'tin_applied', name: 'Has applied for a TIN', description: 'The parent shows the TIN application receipt.', boundary: null, proposedOutcome: null, answer: null, answeredAt: null }],
};

describe('Edge-case outcomes (SME app)', () => {
  it('shows the batch, its due date and second check, each variant with the answer form; submit waits for every answer', () => {
    const html = renderToStaticMarkup(<EdgeOutcomes batches={[BATCH]} />);
    const t = text(html);
    expect(t).toContain('KYC November · 1 variant · Being answered');
    expect(t).toContain('0 of 1 answered · due 2026-11-26 · another person checks your answers before they are used');
    expect(t).toContain("Minor's TIN · Has applied for a TIN");
    for (const v of ['Confirm the outcome', 'Wrong, or doesn’t count', 'Can’t decide', 'Evidence the analyst should cite']) expect(t).toContain(v);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Submit for the second check<\/button>/);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says so when nothing is waiting', () => {
    expect(text(renderToStaticMarkup(<EdgeOutcomes batches={[]} />))).toContain('No edge-case outcomes are waiting for you.');
  });
});
