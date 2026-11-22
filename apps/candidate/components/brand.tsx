import Image from 'next/image';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import { BrandLockup } from '@praxis/shared/ui/brand-lockup';

/**
 * Sign-in and other unauthenticated pages (AUTHORING-SPEC 3.4): on the navy page, centred, the shield, "ADI LABS-FORGE"
 * and "AUTHORING". The full logo (navy text) is for light backgrounds only (PDFs, emails), so it is not used here.
 */
export function FullLogo() {
  // A navy panel, so the lockup reads on the navy sign-in page and on the candidate app's light pages alike.
  return (
    <div className="flex justify-center rounded-xl bg-brand-navy px-6 py-6">
      <BrandLockup stacked mark={<Image src={mark} alt="ADI Labs Forge" width={104} height={104} priority />} />
    </div>
  );
}

/** The header lockup [shield] ADI LABS-FORGE │ AUTHORING on the navy bar. */
export function NavBrand() {
  return <BrandLockup mark={<Image src={mark} alt="" width={30} height={30} />} />;
}
