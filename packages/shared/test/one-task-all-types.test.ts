import { describe, expect, it } from 'vitest';
import { coveredCaseValues, coveredListKey, coveredSelectorSlot, typeSpecificWording, type CaseSelector } from '../src';

/**
 * KYC Judgment v1 §16 (owner, 25 Nov 2026): one task covers all four account types. The template's case selector reads a
 * multi-select (`S1.coveredApplicationTypes`); the project gets one slot, the export sends the list, and Validate warns
 * when the task's wording names one account type.
 */
const SEL: CaseSelector = { field: 'product', source: 'S1.coveredApplicationTypes', values: ['individual', 'adult_joint', 'teen_joint', 'custodial'], labels: { individual: 'Individual account', adult_joint: 'Adult joint account', teen_joint: 'Teen joint account', custodial: 'Custodial account' } };

describe('one task for all account types', () => {
  it('one slot, no fixed case, a brief that says the task covers every type', () => {
    const s = coveredSelectorSlot(SEL, { fieldLabel: 'Covered application types' });
    expect(s).toMatchObject({ tags: {}, edgeCase: null, isOpen: false, required: true });
    expect(s.case).toBeUndefined();
    expect(s.brief).toContain('one reusable task for every Covered application types');
    expect(s.brief).toContain('Individual account, Adult joint account, Teen joint account, Custodial account');
  });

  it('the export reads the covered list from the task (only the selector’s values, in its order); the key drops "covered"', () => {
    const out = { sections: { S1: { coveredApplicationTypes: ['custodial', 'individual', 'business'] } } };
    expect(coveredCaseValues(SEL, out)).toEqual(['individual', 'custodial']);
    expect(coveredCaseValues(SEL, { sections: { S1: { coveredApplicationTypes: [] } } })).toEqual([]);
    expect(coveredCaseValues(SEL, { sections: { S1: {} } })).toBeNull();
    expect(coveredListKey(SEL.source)).toBe('application_types');
    expect(coveredListKey('S1.applicationType')).toBe('application_types');
  });

  it('warns on wording that names one account type, in any agent-visible text; never the selector field itself', () => {
    const sections = {
      S1: { title: 'Open a deposit account', coveredApplicationTypes: ['custodial'], scope: 'Check every party of the application.' },
      S5: { steps: [{ action: 'For a custodial account, check the custodian’s authority.' }, { action: 'Screen each adult joint holder.' }] },
    };
    expect(typeSpecificWording(SEL, sections)).toEqual([
      { path: 'S5.steps[0].action', term: 'custodial account' },
      { path: 'S5.steps[1].action', term: 'adult joint' },
    ]);
    // "individual" alone is ordinary English ("each individual party"): only its label counts.
    expect(typeSpecificWording(SEL, { S1: { scope: 'Assess each individual party.' } })).toEqual([]);
    expect(typeSpecificWording(SEL, { S1: { scope: 'Only for an Individual account.' } })).toEqual([{ path: 'S1.scope', term: 'individual account' }]);
  });
});
