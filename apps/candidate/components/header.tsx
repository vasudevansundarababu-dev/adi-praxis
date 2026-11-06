import Image from 'next/image';
import Link from 'next/link';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import { getMe } from '@/lib/api';
import { smeSupplyEnabled } from '@/lib/features';
import { SignOut } from './sign-out';

/** Top navigation: mark + "ADI Praxis" (SPEC branding) and the account menu. */
export async function Header() {
  const me = await getMe();
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-bg/85 backdrop-blur">
      {process.env.PRAXIS_DEMO === '1' && <DemoBanner />}
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
        <Link href={me ? '/home' : '/'} className="flex items-center gap-2 font-semibold">
          <Image src={mark} alt="" width={28} height={28} className="rounded" />
          ADI Praxis
        </Link>
        <nav className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
          <Link href="/opportunities" className="text-link hover:underline">
            Opportunities
          </Link>
          {me && smeSupplyEnabled() && (
            <>
              <Link href="/certifications" className="text-link hover:underline">
                Certifications
              </Link>
              <Link href="/payments" className="text-link hover:underline">
                Payments
              </Link>
            </>
          )}
          <Link href="/tutorials" className="text-link hover:underline">
            Tutorials
          </Link>
          {me ? <SignOut /> : <Link href="/sign-in" className="btn btn-primary !px-3 !py-1.5">Sign in</Link>}
        </nav>
      </div>
      <div className="h-0.5 bg-brand-gradient" aria-hidden />
    </header>
  );
}

function DemoBanner() {
  return (
    <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-white dark:text-black">
      {process.env.PRAXIS_ENV_LABEL ?? 'Demo environment'}: synthetic data, simulated sign-in and identity check. Do not enter real personal information.
      {process.env.PRAXIS_BUILD && <span className="ml-2 font-mono">Build {process.env.PRAXIS_BUILD}</span>}
    </p>
  );
}
