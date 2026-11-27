import { describe, expect, it } from 'vitest';
import { tutorialsEnabled, withoutTutorials } from '../src/tutorials-switch';

/** Owner, 27 Nov 2026: one switch hides the Tutorials page until the videos are regenerated. */
describe('TUTORIALS_ENABLED', () => {
  it('is off unless "true" or "1"', () => {
    expect(tutorialsEnabled({})).toBe(false);
    expect(tutorialsEnabled({ TUTORIALS_ENABLED: 'false' })).toBe(false);
    expect(tutorialsEnabled({ TUTORIALS_ENABLED: 'yes' })).toBe(false);
    expect(tutorialsEnabled({ TUTORIALS_ENABLED: 'true' })).toBe(true);
    expect(tutorialsEnabled({ TUTORIALS_ENABLED: ' TRUE ' })).toBe(true);
    expect(tutorialsEnabled({ TUTORIALS_ENABLED: '1' })).toBe(true);
  });
  it('withoutTutorials drops the TUTORIALS paragraph and the menu mention, and keeps the rest', () => {
    const text = 'MENU. Home, Projects, Admin and Tutorials. More.\n\nTUTORIALS. Videos.\n\nOTHER. Kept.';
    expect(withoutTutorials(text)).toBe('MENU. Home, Projects and Admin. More.\n\nOTHER. Kept.');
  });
});
