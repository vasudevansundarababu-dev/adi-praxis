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
    <div className="min-h-screen">
      {process.env.PRAXIS_DEMO === '1' && (
        <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
          Demo environment: synthetic data only. Candidate sign-in and identity checks are simulated.
        </p>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" aria-label="ADI Praxis home">
            <NavBrand />
          </Link>
          <nav aria-label="Main" className="flex gap-4 text-sm">
            {navFor(user.roles).map((item) => (
              <Link key={item.href} href={item.href} className="text-link hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-fg-muted">
              {user.name} · {user.roles.join(', ')}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <div className="h-1 bg-brand-gradient" aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
