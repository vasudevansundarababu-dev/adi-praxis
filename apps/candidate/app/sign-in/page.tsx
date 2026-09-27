import { safeReturnPath } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FullLogo } from '@/components/brand';
import { SignInForm } from '@/components/sign-in-form';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Sign in') } };

/** C01 — Sign in. Continue with Google only; no password and no Apple button that pretends to work. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnPath((await searchParams).returnTo ?? null, '');
  if (await getMe()) redirect(returnTo || '/home');
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
      <FullLogo />
      <h1 className="mt-10 text-xl font-semibold">Sign in to ADI Praxis</h1>
      <p className="mt-2 text-sm text-fg-muted">
        ADI Praxis invites subject-matter experts to write realistic, synthetic tasks. We check your identity to protect
        the contributor community, and we ask about your relevant experience to match you with suitable work.
      </p>
      <SignInForm returnTo={returnTo} googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ''} />
      <p className="mt-6 text-xs text-fg-muted">
        By continuing you agree to the <Link href="/terms" className="text-link underline">contributor terms</Link> and
        the <Link href="/privacy" className="text-link underline">privacy notice</Link>. We only ask Google for your
        sign-in; we never access Gmail, Drive or contacts.
      </p>
    </main>
  );
}
