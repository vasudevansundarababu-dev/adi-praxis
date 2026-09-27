import Image from 'next/image';
import Link from 'next/link';
import mark from '@praxis/shared/brand/praxis-mark-512.png';
import { getMe } from '@/lib/api';
import { SignOut } from './sign-out';

/** Top navigation: mark + "ADI Praxis" (SPEC branding) and the account menu. */
export async function Header() {
  const me = await getMe();
  return (
    <header className="border-b border-line">
      {process.env.PRAXIS_DEMO === '1' && <DemoBanner />}
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
        <Link href={me ? '/home' : '/'} className="flex items-center gap-2 font-semibold">
          <Image src={mark} alt="" width={28} height={28} className="rounded" />
          ADI Praxis
        </Link>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/opportunities" className="text-link hover:underline">
            Opportunities
          </Link>
          {me ? <SignOut /> : <Link href="/sign-in" className="text-link hover:underline">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}

function DemoBanner() {
  return (
    <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
      Demo environment: synthetic data, simulated sign-in and identity check. Do not enter real personal information.
    </p>
  );
}
