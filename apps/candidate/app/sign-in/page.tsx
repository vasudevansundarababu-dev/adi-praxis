import { safeReturnPath } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/brand';
import { SignInForm } from '@/components/sign-in-form';
import { getForgeSettings, getMeSafe } from '@/lib/api';
import { signInVariant } from '@/lib/forge';

export const metadata: Metadata = { title: { absolute: pageTitle('Sign in') } };

/** C01 — Sign in. Continue with Google only; no password and no Apple button that pretends to work. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnPath((await searchParams).returnTo ?? null, '');
  const [me, forge] = await Promise.all([getMeSafe(), getForgeSettings()]);
  if (me) redirect(forge.newFlow ? '/home' : returnTo || '/home');
  return (
    <SignInShell title="Sign in to Authoring">
      {forge.newFlow ? (
        <p className="mt-2 text-sm text-fg-muted">
          Sign in with the email you gave your recruitment agency{signInVariant(forge) === 'password' ? ' and your password' : ''}. You&apos;ll see the tasks assigned to you.
        </p>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">
          We invite subject-matter experts to write realistic, synthetic tasks. We check your identity to protect
          the contributor community, and we ask about your relevant experience to match you with suitable work.
        </p>
      )}
      <SignInForm newFlow={forge.newFlow} variant={signInVariant(forge)} returnTo={returnTo} googleClientId={process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ''} demo={process.env.PRAXIS_DEMO === '1'} />
      <p className="mt-6 text-xs text-fg-muted">
        By continuing you agree to the <Link href="/terms" className="text-link underline">contributor terms</Link> and
        the <Link href="/privacy" className="text-link underline">privacy notice</Link>.
        {signInVariant(forge) === 'password' ? ' We store only a secure hash of your password, never the password itself.' : ' We only ask Google for your sign-in; we never access Gmail, Drive or contacts.'}
      </p>
    </SignInShell>
  );
}
