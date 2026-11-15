import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { FullLogo } from '@/components/brand';
import { SetPasswordForm } from '@/components/forge/password-forms';

export const metadata: Metadata = { title: { absolute: pageTitle('Set your password') }, referrer: 'no-referrer' };

/** MVP1 step 6: the one-time link emailed when a PM or Admin assigns a new person (or by Forgot password). */
export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
      <FullLogo />
      <h1 className="mt-10 text-xl font-semibold">Set your password</h1>
      <p className="mt-2 text-sm text-fg-muted">Choose the password you will use with your email address to sign in to ADI Forge.</p>
      <SetPasswordForm token={token} />
    </main>
  );
}
