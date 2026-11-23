import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PanelSaveStatus, rubricBlockers, scoreExample, weightTarget } from '@/components/work/rubric-editor';
import { FormSaveContext } from '@/components/work/save-bar';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** D-029: the form uses the template's weight total (25 for Golden KYC v6), and the criterion panel shows its save state. */
const KEYS = [{ key: 'passCondition', label: 'Pass', points: 5, required: true }, { key: 'partialCredit', label: 'Partial', points: 2, required: true }, { key: 'failCondition', label: 'Fail', points: 0, required: true }];
const FIVE = ['identification_verification', 'screening', 'decision', 'next_action', 'evidence'];
const view = (weightTotal: number | null | undefined) => ({ template: { id: 't', version: 6, scale: 'five_two_zero', scoreKeys: KEYS, fixedSet: true, wholeTaskRule: '', criterionFailureSupported: true, weightsFromTemplate: true, ...(weightTotal !== undefined ? { weightTotal } : {}) }, criteria: FIVE.map((id) => ({ id })) }) as never;
const field = { key: 'criteria', type: 'criterion', label: 'Criteria' } as never;
const items = FIVE.map((id) => ({ id, name: id, weight: 5, passCondition: 'p', partialCredit: 'q', failCondition: 'f' }));

describe('form weight total and panel save status', () => {
  it('five weights of 5 raise no weight blocker when the template total is 25; the old 100 is gone', () => {
    expect(weightTarget(view(25), field)).toBe(25);
    expect(rubricBlockers(view(25), field, items).filter((b) => b.message.includes('Weights'))).toEqual([]);
    expect(rubricBlockers(view(25), field, items.map((i, n) => (n === 0 ? { ...i, weight: 4 } : i))).map((b) => b.message)).toContain('Weights add up to 24; they must add up to exactly 25 for this template.');
    expect(weightTarget(view(null), field)).toBeNull();
    expect(scoreExample(5, KEYS)).toBe('Example with this template’s 5 criteria: 3 pass × 5 = 15, 1 partial × 2 = 2, 1 fail × 0 = 0, so 17 of 25.');
  });

  it('the criterion panel says when the form was saved and offers Save now', () => {
    const html = renderToStaticMarkup(
      <FormSaveContext.Provider value={{ state: { kind: 'saved', at: '2026-11-23T22:14:44.000Z' } as never, flush: async () => true }}>
        <PanelSaveStatus detail={{ kind: 'idle' }} />
      </FormSaveContext.Provider>,
    );
    expect(html).toContain('Save now');
    expect(html).toMatch(/Saved at \d{1,2}:\d{2}/);
    expect(renderToStaticMarkup(<PanelSaveStatus detail={{ kind: 'error' }} />)).toContain('This criterion’s details were not saved. Try again.');
  });
});
