import type { ReactNode } from 'react';
import { BRAND, PRODUCT_NAME } from '../../theme/tokens';

/**
 * The ADI Labs Forge lockup: [shield] ADI LABS-FORGE │ AUTHORING (adi-labs-design shared/BRANDING.md 3; AUTHORING-SPEC
 * 3.3). `tone` "dark" sits on the navy header and sign-in page; "light" on white (PDFs, emails). `mark` is the shield
 * image, passed by each app (Next's Image is app-specific). `stacked` is the centred sign-in form.
 */
export function BrandLockup({ mark, product = PRODUCT_NAME, tone = 'dark', stacked = false }: { mark: ReactNode; product?: string; tone?: 'dark' | 'light'; stacked?: boolean }) {
  const dark = tone === 'dark';
  const word = { fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '-0.01em' };
  const name = (
    <span style={word}>
      <span style={{ color: dark ? '#ffffff' : BRAND.navy }}>ADI LABS</span>
      <span style={{ color: dark ? BRAND.purpleLight : BRAND.purple }}>-FORGE</span>
    </span>
  );
  const productText = (
    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: dark ? BRAND.productOnDark : BRAND.productOnLight }}>{product}</span>
  );
  if (stacked)
    return (
      <span className="flex flex-col items-center gap-2 text-center">
        {mark}
        <span className="text-2xl">{name}</span>
        <span className="text-sm">{productText}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-3" aria-label={`ADI Labs Forge ${product}`}>
      {mark}
      <span className="text-base leading-none" aria-hidden="true">
        {name}
      </span>
      <span aria-hidden="true" style={{ width: 1, height: 18, background: dark ? BRAND.divider : BRAND.dividerLight }} />
      <span className="text-xs leading-none" aria-hidden="true">
        {productText}
      </span>
    </span>
  );
}
