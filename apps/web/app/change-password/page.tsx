import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/brand';
import { SignOutButton } from '@/components/shell-controls';
import { ChangePasswordForm } from '@/components/users/change-password-form';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Change password' };

/** Console users change their password here; anyone with a temporary password is sent here until they do. */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <SignInShell
      title={user.mustChangePassword ? 'Choose your own password' : 'Change password'}
      footer={
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          {!user.mustChangePassword && (
            <Link href="/" className="text-white underline">
              Back to the console
            </Link>
          )}
          <SignOutButton />
        </div>
      }
    >
      <p className="mt-1 text-center text-sm text-fg-muted">
        {user.mustChangePassword
          ? `Welcome, ${user.name.split(' ')[0]}. You signed in with a temporary password; choose your own to continue.`
          : `Signed in as ${user.email}. Your other sessions are signed out when you save.`}
      </p>
      <ChangePasswordForm endpoint="/auth/change-password" done="/" />
    </SignInShell>
  );
}
