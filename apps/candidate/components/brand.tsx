import Image from 'next/image';
import { TAGLINE } from '@praxis/shared/theme';
import logo from '@praxis/shared/brand/praxis-logo-cropped.png';
import mark from '@praxis/shared/brand/praxis-mark-512.png';

/**
 * Full logo (mark + wordmark) with the tagline set as text, for sign-in and public pages (dark backgrounds only).
 * The PNG has a near-charcoal background; `lighten` blends it into the page until a transparent logo is supplied.
 */
export function FullLogo() {
  return (
    <div className="flex flex-col items-center">
      <Image src={logo} alt="ADI Praxis" priority className="h-auto w-56 mix-blend-lighten" />
      <p className="mt-4 text-xs tracking-[0.3em] text-brand-silver uppercase">{TAGLINE}</p>
    </div>
  );
}

/** Infinity mark plus "ADI Praxis", for each app's top navigation. */
export function NavBrand() {
  return (
    <span className="flex items-center gap-2">
      <Image src={mark} alt="" width={28} height={28} className="rounded" />
      <span className="font-semibold">ADI Praxis</span>
    </span>
  );
}
