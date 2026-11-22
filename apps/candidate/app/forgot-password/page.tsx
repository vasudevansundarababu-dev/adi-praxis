import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { SignInShell } from '@/components/brand';
import { ForgotPasswordForm } from '@/components/forge/password-forms';

export const metadata: Metadata = { title: { absolute: pageTitle('Forgot password') } };

/** MVP1 step 6: a reset link by email. */
export default function ForgotPasswordPage() {
  return (
    <SignInShell title="Forgot password">
      <p className="mt-2 text-sm text-fg-muted">Enter the email address you sign in with. We&apos;ll send you a link to choose a new password.</p>
      <ForgotPasswordForm />
    </SignInShell>
  );
}
