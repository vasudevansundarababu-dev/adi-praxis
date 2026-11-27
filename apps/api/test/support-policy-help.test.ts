import { POLICY_PAGE_HELP, policyHelpSections } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { rankParagraphs } from '../src/support/assistant';
import { HELP_VERSION, STAFF_HELP } from '../src/support/help-pack';

// Policy page help (26 Nov 2026): one source for the Support Bot and the page, in plain words for a PM.
describe('Policy page help', () => {
  it('is part of the staff help pack the bot reads', () => {
    expect(STAFF_HELP).toContain(POLICY_PAGE_HELP);
    expect(HELP_VERSION).toMatch(/^help\/3/);
  });

  it('covers every checklist step, the terms, the library details, every next action, Confirm all ready, export and AI', () => {
    const headings = policyHelpSections().map((s) => s.heading);
    for (const h of [
      'POLICY CHECKLIST STEP 1, DOCUMENTS',
      'POLICY CHECKLIST STEP 2, FACTS',
      'POLICY CHECKLIST STEP 3, AI SUGGESTIONS',
      'POLICY CHECKLIST STEP 4, REVIEW',
      'POLICY CHECKLIST STEP 5, EXPORT',
      'WHAT IS A FACT',
      'WHAT IS A VARIABLE',
      'WHAT IS A CONDITION ("WHEN IT APPLIES")',
      'LIBRARY DETAILS',
      'IN FORCE FROM, AND INHERITANCE',
      'READY TO CONFIRM, AND "CONFIRM ALL READY"',
      'WHY AI SUGGESTIONS ARE NOT APPROVAL',
    ])
      expect(headings).toContain(h);
    // Every next action the queue can show (review-queue NEXT_ACTIONS) has its paragraph.
    for (const a of ['Set when it applies', 'Fill in library details', 'Set the in-force date', 'Link to a source quote', 'Check the quote', 'Answer the open question', 'Complete the rule', 'Say how it changes the version before', 'Approve the definition it depends on first', 'Check Studio']) expect(headings.some((h) => h.toLowerCase().includes(a.toLowerCase()))).toBe(true);
    for (const part of ['Kind:', 'Issuer:', 'Jurisdiction:', 'Subject:', 'Scope:']) expect(POLICY_PAGE_HELP).toContain(part);
    expect(POLICY_PAGE_HELP).toContain('us_person');
    expect(POLICY_PAGE_HELP).toContain('product == teen_joint');
  });

  it('explains "To fix" and "Next problem" on the rule page (owner, 27 Nov 2026), and the bot finds them', () => {
    const headings = policyHelpSections().map((s) => s.heading);
    expect(headings).toContain('"TO FIX" ON THE RULE PAGE');
    expect(headings).toContain('"NEXT PROBLEM" ON THE RULE PAGE');
    expect(rankParagraphs(STAFF_HELP, 'how do I get to the field I need to fix on a rule', 2).join(' ')).toMatch(/"TO FIX" ON THE RULE PAGE|"NEXT PROBLEM" ON THE RULE PAGE/);
    expect(rankParagraphs(STAFF_HELP, 'what does the next problem button do', 2)[0]).toMatch(/^"NEXT PROBLEM" ON THE RULE PAGE/);
  });

  it('uses no internal product names', () => {
    expect(POLICY_PAGE_HELP).not.toMatch(/Praxis|Anvil|ADI-Labs/);
  });

  it('the offline bot finds the right paragraph for the owner\'s two questions', () => {
    const top = (q: string) => rankParagraphs(STAFF_HELP, q, 3).map((p) => p.split('.')[0]!.trim());
    expect(top('what is a fact')[0]).toBe('WHAT IS A FACT');
    expect(top('what does Set when it applies mean')[0]).toBe('NEXT ACTION "SET WHEN IT APPLIES"');
  });
});
