import { safeReturnPath } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { IdentityPanel } from '@/components/identity-panel';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Verify identity') } };

/** C02 — Verify identity. Status always comes from the server, never from the provider's browser redirect (CF-04). */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnPath((await searchParams).returnTo ?? null, '');
  const me = await getMe();
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(`/verify${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`)}`);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Verify your identity</h1>
      <p className="mt-2 text-fg-muted">
        We verify identity to protect the contributor community. This does not verify your professional qualifications.
      </p>
      <p className="mt-2 text-sm text-fg-muted">
        The check is run by Stripe Identity: you photograph an identity document, and may be asked for a selfie. ADI
        Praxis never stores your document images, ID number or date of birth; we only keep the result.
      </p>
      <IdentityPanel initial={me} returnTo={returnTo} />
    </main>
  );
}
