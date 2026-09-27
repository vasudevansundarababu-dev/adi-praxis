import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brand, pageTitle, semantic } from '../theme/tokens';

/** WCAG 2.x relative-luminance contrast ratio. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('theme tokens', () => {
  it('keeps the brand colours sampled from the logo (SPEC: Branding)', () => {
    expect(brand).toMatchObject({
      navy: '#0A2170',
      blue: '#2A80D0',
      teal: '#3FAC95',
      silver: '#8597A3',
      charcoal: '#212227',
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    const t = semantic[theme];
    it(`${theme}: text, secondary text and links meet WCAG AA (4.5:1) on background and surface`, () => {
      for (const fg of [t.text, t.textMuted, t.link]) {
        expect(contrast(fg, t.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, t.surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('theme.css defines the same values as tokens.ts', () => {
    const css = readFileSync(path.join(import.meta.dirname, '../theme/theme.css'), 'utf8').toLowerCase();
    for (const theme of ['light', 'dark'] as const) {
      const block = theme === 'light' ? css.slice(css.indexOf(':root {')) : css.slice(css.indexOf('.dark,'));
      const t = semantic[theme];
      expect(block).toContain(`--praxis-bg: ${t.bg.toLowerCase()}`);
      expect(block).toContain(`--praxis-text: ${t.text.toLowerCase()}`);
      expect(block).toContain(`--praxis-text-muted: ${t.textMuted.toLowerCase()}`);
      expect(block).toContain(`--praxis-link: ${t.link.toLowerCase()}`);
    }
  });

  it('page titles read "<Screen> · ADI Praxis"', () => {
    expect(pageTitle('Sign in')).toBe('Sign in · ADI Praxis');
  });
});
