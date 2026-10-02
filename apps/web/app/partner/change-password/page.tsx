import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { PartnerSignOutButton } from '@/components/partner/partner-login-form';
import { ChangePasswordForm } from '@/components/users/change-password-form';
import { getPartnerMe } from '@/lib/partner-api';

export const metadata: Metadata = { title: 'Change password' };

/** Partner users change their password here; anyone with a temporary password is sent here until they do. */
export default async function PartnerChangePasswordPage() {
  const me = await getPartnerMe();
  if (!me) redirect('/partner/login');
  const first = me.user.mustChangePassword;
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-brand-charcoal px-4 py-10 text-fg">
      <div className="w-full max-w-sm">
        <FullLogo />
        <h1 className="mt-8 text-center text-lg font-semibold">{first ? 'Choose your own password' : 'Change password'}</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">
          {first ? `Welcome, ${me.user.name.split(' ')[0]}. You signed in with a temporary password; choose your own to continue.` : `Signed in as ${me.user.email} (${me.partner.name}).`}
        </p>
        <ChangePasswordForm endpoint="/partner-portal/change-password" done="/partner" />
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          {!first && (
            <Link href="/partner" className="text-link underline">
              Back to the portal
            </Link>
          )}
          <PartnerSignOutButton />
        </div>
      </div>
    </main>
  );
}
