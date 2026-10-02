import { roleLabel } from '@praxis/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavBrand } from '@/components/brand';
import { SignOutButton, ThemeToggle } from '@/components/shell-controls';
import { getCurrentUser } from '@/lib/api';
import { MainNav } from '@/components/main-nav';
import { SupportBot } from '@/components/support/support-bot';
import { navGroupsFor } from '@/lib/nav';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  // A temporary password from an Admin must be replaced first (the API refuses everything else until then).
  if (user.mustChangePassword) redirect('/change-password');

  return (
    <div className="min-h-screen bg-surface">
      {process.env.PRAXIS_DEMO === '1' && (
        <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
          {process.env.PRAXIS_ENV_LABEL ?? 'Demo environment'}: synthetic data only. Candidate sign-in and identity checks are simulated.
          {process.env.PRAXIS_BUILD && <span className="ml-2 font-mono">Build {process.env.PRAXIS_BUILD}</span>}
        </p>
      )}
      <header className="sticky top-0 z-20 bg-brand-navy text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 pt-3 pb-2">
          <Link href="/" aria-label="ADI Praxis home">
            <NavBrand />
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">
              {user.name} · {user.roles.map(roleLabel).join(', ')}
            </span>
            <ThemeToggle />
            <Link href="/change-password" className="hidden text-white/80 hover:text-white hover:underline sm:inline">
              Change password
            </Link>
            <SignOutButton />
          </div>
        </div>
        <MainNav groups={navGroupsFor(user.roles)} />
        <div className="h-1 bg-brand-gradient" aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 pb-24">{children}</main>
      <SupportBot endpoint="/api/v1/support/ask" audience="staff" />
    </div>
  );
}
