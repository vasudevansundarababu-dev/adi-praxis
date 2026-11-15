import Image from 'next/image';
import logo from '@praxis/shared/brand/praxis-logo-cropped.png';
import mark from '@praxis/shared/brand/praxis-mark-512.png';

/**
 * Full ADI Forge logo (mark and wordmark), for sign-in and public pages (dark backgrounds only: "ADI" is white).
 * No tagline: the old ADI-Labs tagline is not used (legal, 15 Nov 2026).
 * The PNG has a near-charcoal background; `lighten` blends it into the page until a transparent logo is supplied.
 */
export function FullLogo() {
  return (
    <div className="flex flex-col items-center">
      <Image src={logo} alt="ADI Forge" priority className="h-auto w-56 mix-blend-lighten" />
    </div>
  );
}

/** ADI Forge mark plus the product name, for each app's top navigation. */
export function NavBrand() {
  return (
    <span className="flex items-center gap-2">
      <Image src={mark} alt="" width={28} height={28} className="rounded" />
      <span className="font-semibold">ADI Forge</span>
    </span>
  );
}
