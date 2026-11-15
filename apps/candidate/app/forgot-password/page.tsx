import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { FullLogo } from '@/components/brand';
import { ForgotPasswordForm } from '@/components/forge/password-forms';

export const metadata: Metadata = { title: { absolute: pageTitle('Forgot password') } };

/** MVP1 step 6: a reset link by email. */
export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
      <FullLogo />
      <h1 className="mt-10 text-xl font-semibold">Forgot password</h1>
      <p className="mt-2 text-sm text-fg-muted">Enter the email address you sign in with. We&apos;ll send you a link to choose a new password.</p>
      <ForgotPasswordForm />
    </main>
  );
}
