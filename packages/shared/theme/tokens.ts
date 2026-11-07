/**
 * ADI Praxis design tokens (SPEC: Branding). Brand colours are sampled from the logo and must not change.
 * Semantic tokens pick accessible shades per theme: silver (#8597A3) and brand blue fail WCAG AA as text on
 * white, so light-theme secondary text and links use darker derived shades. Status colours (error, warning,
 * success) are standard and distinct from brand teal (SPEC: Branding rules), with lighter shades in dark.
 */
export const brand = {
  navy: '#0A2170',
  blue: '#2A80D0',
  teal: '#3FAC95',
  silver: '#8597A3',
  charcoal: '#212227',
  gradient: 'linear-gradient(90deg, #0A2170 0%, #2A80D0 50%, #3FAC95 100%)',
} as const;

export const semantic = {
  light: {
    bg: '#FFFFFF',
    surface: '#F5F7FA',
    text: '#0A2170', // navy, 14.3:1 on white
    textMuted: '#5B6B77', // darker silver, 5.5:1 on white
    border: '#8597A3',
    link: '#1D68B0', // darker brand blue, 5.7:1 on white
    focus: '#2A80D0',
    primary: '#0A2170',
    onPrimary: '#FFFFFF',
    accent: '#3FAC95',
    error: '#B91C1C',
    warning: '#B45309',
    success: '#15803D',
  },
  dark: {
    bg: '#212227',
    surface: '#2A2C33',
    text: '#E6EAEE', // 13.1:1 on charcoal
    textMuted: '#8A9CA8', // derived silver, also readable on elevated dark cards
    border: '#3A3D46',
    link: '#5AA3E6', // 5.9:1 on charcoal
    focus: '#5AA3E6',
    primary: '#5AA3E6',
    onPrimary: '#212227',
    accent: '#3FAC95',
    // Lighter shades so status text stays readable on charcoal.
    error: '#F87171',
    warning: '#FBBF24',
    success: '#4ADE80',
  },
} as const;

export const TAGLINE = 'Intelligence Beyond Boundaries';
export const PRODUCT_NAME = 'ADI Praxis';

/** Page titles read "<Screen> · ADI Praxis". */
export const pageTitle = (screen: string) => `${screen} · ${PRODUCT_NAME}`;
