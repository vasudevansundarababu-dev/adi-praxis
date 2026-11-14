import { describe, expect, it } from 'vitest';
import { caseSelectorSlots, emptyOutput, getFieldValue, KYB_PROFILE, setFieldValue, withSlotCase } from '../src';

/** One task per case-selector value (owner, 13 Nov 2026): slot generation and the editor's pre-fill. */
describe('case selector slots', () => {
  const sel = { field: 'governing_state', source: 'S1.governingState', values: ['CA', 'NY'] };

  it('one required, non-open slot per value, in order, carrying its value', () => {
    const slots = caseSelectorSlots(sel, { fieldLabel: 'Governing state', labelOf: (v) => ({ CA: 'California' })[v] });
    expect(slots.map((s) => [s.tags, s.isOpen, s.required, s.case])).toEqual([
      [{ governing_state: 'CA' }, false, true, { field: 'governing_state', source: 'S1.governingState', value: 'CA' }],
      [{ governing_state: 'NY' }, false, true, { field: 'governing_state', source: 'S1.governingState', value: 'NY' }],
    ]);
    expect(slots[0]!.brief).toBe('Governing state: California (CA). Write this reusable task for California only; set Governing state to CA.');
    expect(slots[1]!.brief).toContain('Governing state: NY.');
  });

  it("the editor pre-fills the slot's value only into an empty field, and only for a field the form has", () => {
    const title = KYB_PROFILE.sections.find((s) => s.key === 'S1')!.fields.find((f) => f.key === KYB_PROFILE.titleField)!;
    const c = { source: `S1.${title.key}`, value: 'NY' };
    const filled = withSlotCase(KYB_PROFILE, emptyOutput(KYB_PROFILE), c);
    expect(getFieldValue(KYB_PROFILE, filled, 'S1', title)).toBe('NY');
    const typed = setFieldValue(KYB_PROFILE, emptyOutput(KYB_PROFILE), 'S1', title.key, 'Already chosen');
    expect(withSlotCase(KYB_PROFILE, typed, c)).toBe(typed);
    const blank = emptyOutput(KYB_PROFILE);
    expect(withSlotCase(KYB_PROFILE, blank, { source: 'S1.noSuchField', value: 'NY' })).toBe(blank);
    expect(withSlotCase(KYB_PROFILE, blank, null)).toBe(blank);
  });
});
