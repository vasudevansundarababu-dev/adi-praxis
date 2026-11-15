import type { ForgeTermsView } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { WelcomeForm } from '@/components/forge/welcome-form';
import { api, getForgeSettings, getMeSafe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Before you start') } };

/** MVP1 first sign-in: a one-time Before you start screen. Later sign-ins go straight to Home. */
export default async function WelcomePage() {
  if (!(await getMeSafe())) redirect('/sign-in');
  if (!(await getForgeSettings()).newFlow) redirect('/home');
  const { data } = await api<ForgeTermsView & { declarationV2?: boolean }>('/me/forge/terms');
  if (data?.accepted) redirect('/home');
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Before you start</h1>
      <p className="mt-1 text-sm text-fg-muted">Once only, the first time you sign in.</p>
      {data ? <WelcomeForm terms={data.terms} declarationV2={data.declarationV2 === true} /> : <p role="alert" className="card mt-6 p-4 text-sm">We couldn&apos;t load the terms. Please reload the page.</p>}
    </main>
  );
}
