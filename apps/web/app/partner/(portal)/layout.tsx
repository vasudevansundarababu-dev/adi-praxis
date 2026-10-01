import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavBrand } from '@/components/brand';
import { PartnerSignOutButton } from '@/components/partner/partner-login-form';
import { ThemeToggle } from '@/components/shell-controls';
import { SupportBot } from '@/components/support/support-bot';
import { getPartnerMe } from '@/lib/partner-api';

/** Partner-only nav: the console nav (lib/nav.ts) never shows here, and partner sessions never open the console. */
const PARTNER_NAV = [
  { href: '/partner', label: 'Home' },
  { href: '/partner/requisitions', label: 'Requisitions' },
  { href: '/partner/candidates', label: 'Candidates' },
  { href: '/partner/statements', label: 'Statements' },
  { href: '/partner/integrations', label: 'API & webhooks' },
  { href: '/partner/tutorials', label: 'Tutorials' },
];

export default async function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getPartnerMe();
  if (!me) redirect('/partner/login');

  return (
    <div className="min-h-screen bg-surface">
      {process.env.PRAXIS_DEMO === '1' && (
        <p role="note" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
          {process.env.PRAXIS_ENV_LABEL ?? 'Demo environment'}: synthetic data only.
          {process.env.PRAXIS_BUILD && <span className="ml-2 font-mono">Build {process.env.PRAXIS_BUILD}</span>}
        </p>
      )}
      <header className="sticky top-0 z-20 bg-brand-navy text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 pt-3 pb-2">
          <Link href="/partner" aria-label="ADI Praxis partner portal home" className="flex items-center gap-2">
            <NavBrand />
            <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-white/85">Partner portal</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">
              {me.user.name} · {me.partner.name}
            </span>
            <ThemeToggle />
            <PartnerSignOutButton />
          </div>
        </div>
        <nav aria-label="Partner" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm">
          {PARTNER_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 rounded-lg px-2 py-1.5 whitespace-nowrap text-white/85 hover:bg-white/10 hover:text-white">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="h-1 bg-brand-gradient" aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 pb-24">{children}</main>
      <SupportBot endpoint="/api/v1/partner-portal/support/ask" audience="partner" />
    </div>
  );
}
