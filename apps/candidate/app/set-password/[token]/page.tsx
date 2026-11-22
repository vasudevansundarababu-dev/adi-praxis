import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { SignInShell } from '@/components/brand';
import { SetPasswordForm } from '@/components/forge/password-forms';

export const metadata: Metadata = { title: { absolute: pageTitle('Set your password') }, referrer: 'no-referrer' };

/** MVP1 step 6: the one-time link emailed when a PM or Admin assigns a new person (or by Forgot password). */
export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <SignInShell title="Set your password">
      <p className="mt-2 text-sm text-fg-muted">Choose the password you will use with your email address to sign in to Authoring.</p>
      <SetPasswordForm token={token} />
    </SignInShell>
  );
}
