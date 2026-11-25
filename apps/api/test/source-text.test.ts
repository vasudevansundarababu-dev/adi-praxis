import { describe, expect, it } from 'vitest';
import { sourcePassage } from '../src/policy/source-text';

/**
 * KYC Judgment v1 C1 `source_text` (owner, 25 Nov 2026): the verbatim passage with enough context to stand alone, never
 * a fragment like "3 . an address ;". Synthetic text only.
 */
const DOC = [
  'Synthetic customer identification policy',
  '',
  'The bank must verify the identity of each customer before opening an account. Records are kept for five years.',
  '',
  'Before opening an account, the bank must obtain at a minimum:',
  '1 . a name ;',
  '2 . a date of birth ;',
  '3 . an address ;',
  '4 . an identification number .',
  '',
  'Minors are opened by a custodian.',
].join('\n');

describe('source_text: the verbatim passage with its context', () => {
  it('a quote inside a sentence gives the whole sentence, word for word', () => {
    expect(sourcePassage(DOC, 'verify the identity of each customer')).toBe('The bank must verify the identity of each customer before opening an account.');
  });

  it('a list item gives the whole list with the line that introduces it', () => {
    expect(sourcePassage(DOC, '3 . an address ;')).toBe(['Before opening an account, the bank must obtain at a minimum:', '1 . a name ;', '2 . a date of birth ;', '3 . an address ;', '4 . an identification number .'].join('\n'));
    // Spacing in the stored quote may differ from the document.
    expect(sourcePassage(DOC, '3 .  an address ;')).toContain('Before opening an account');
  });

  it('a short sentence gives its paragraph; an exact locator is used; a quote not in the text is returned as it is', () => {
    expect(sourcePassage(DOC, 'opened by a custodian')).toBe('Minors are opened by a custodian.');
    const at = DOC.indexOf('Records are kept');
    expect(sourcePassage(DOC, 'Records are kept', { charStart: at, charEnd: at + 16 })).toBe('The bank must verify the identity of each customer before opening an account. Records are kept for five years.');
    expect(sourcePassage(DOC, 'not in the document')).toBe('not in the document');
  });
});
