import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/brand';
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
    <SignInShell
      title={first ? 'Choose your own password' : 'Change password'}
      footer={
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          {!first && (
            <Link href="/partner" className="text-white underline">
              Back to the portal
            </Link>
          )}
          <PartnerSignOutButton />
        </div>
      }
    >
      <p className="mt-1 text-center text-sm text-fg-muted">
        {first ? `Welcome, ${me.user.name.split(' ')[0]}. You signed in with a temporary password; choose your own to continue.` : `Signed in as ${me.user.email} (${me.partner.name}).`}
      </p>
      <ChangePasswordForm endpoint="/partner-portal/change-password" done="/partner" />
    </SignInShell>
  );
}
