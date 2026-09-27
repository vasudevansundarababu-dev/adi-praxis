import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavBrand } from '@/components/brand';
import { SignOutButton, ThemeToggle } from '@/components/shell-controls';
import { getCurrentUser } from '@/lib/api';
import { navFor } from '@/lib/nav';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-surface">
      {process.env.PRAXIS_DEMO === '1' && (
        <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
          Demo environment: synthetic data only. Candidate sign-in and identity checks are simulated.
        </p>
      )}
      <header className="sticky top-0 z-20 bg-brand-navy text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 pt-3 pb-2">
          <Link href="/" aria-label="ADI Praxis home">
            <NavBrand />
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">
              {user.name} · {user.roles.map((r) => (r === 'PM' ? 'PM' : r[0] + r.slice(1).toLowerCase())).join(', ')}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm">
          {navFor(user.roles).map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 rounded-lg px-2 py-1.5 whitespace-nowrap text-white/85 hover:bg-white/10 hover:text-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="h-1 bg-brand-gradient" aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
