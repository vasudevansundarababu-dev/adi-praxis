import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/brand';
import { PartnerLoginForm } from '@/components/partner/partner-login-form';
import AccessRequest from '@/components/AccessRequest';
import { getPartnerMe } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Partner sign in' };

export default async function PartnerLoginPage() {
  if (await getPartnerMe()) redirect('/partner');
  return (
    <SignInShell title="Sign in to the partner portal" footer={<AccessRequest />}>
      <p className="mt-1 text-center text-sm text-fg-muted">For staffing partners who put candidates forward to Authoring.</p>
      <PartnerLoginForm />
      <p className="mt-6 text-center text-xs text-fg-muted">No account yet? Your partner manager sets one up for you.</p>
    </SignInShell>
  );
}
