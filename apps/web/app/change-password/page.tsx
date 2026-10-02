import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { SignOutButton } from '@/components/shell-controls';
import { ChangePasswordForm } from '@/components/users/change-password-form';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Change password' };

/** Console users change their password here; anyone with a temporary password is sent here until they do. */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-brand-charcoal px-4 py-10 text-fg">
      <div className="w-full max-w-sm">
        <FullLogo />
        <h1 className="mt-8 text-center text-lg font-semibold">{user.mustChangePassword ? 'Choose your own password' : 'Change password'}</h1>
        <p className="mt-1 text-center text-sm text-fg-muted">
          {user.mustChangePassword
            ? `Welcome, ${user.name.split(' ')[0]}. You signed in with a temporary password; choose your own to continue.`
            : `Signed in as ${user.email}. Your other sessions are signed out when you save.`}
        </p>
        <ChangePasswordForm endpoint="/auth/change-password" done="/" />
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          {!user.mustChangePassword && (
            <Link href="/" className="text-link underline">
              Back to the console
            </Link>
          )}
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
