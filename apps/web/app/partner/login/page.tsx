import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { PartnerLoginForm } from '@/components/partner/partner-login-form';
import AccessRequest from '@/components/AccessRequest';
import { getPartnerMe } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Partner sign in' };

export default async function PartnerLoginPage() {
  if (await getPartnerMe()) redirect('/partner');
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-brand-charcoal px-4 text-fg">
      <div className="w-full max-w-sm">
        <FullLogo />
        <h1 className="mt-8 text-center text-lg font-semibold">Sign in to the partner portal</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">For staffing partners who put candidates forward to ADI Praxis.</p>
        <PartnerLoginForm />
        <AccessRequest />
        <p className="mt-6 text-center text-xs text-fg-muted">No account yet? Your ADI Praxis partner manager sets one up for you.</p>
      </div>
    </main>
  );
}
