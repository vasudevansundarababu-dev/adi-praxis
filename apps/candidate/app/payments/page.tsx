import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { Earnings } from '@/components/pay/earnings';
import { PayeeSetup } from '@/components/pay/payee-setup';
import { api, getMe } from '@/lib/api';
import type { EarningsView, PayeeView } from '@/lib/supply-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Payments') } };

/** M10c: payment set-up with the payout provider (hosted by them) and what you have earned and been paid. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ returned?: string }> }) {
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent('/payments')}`);
  const { returned } = await searchParams;
  const [payee, earnings] = await Promise.all([api<PayeeView>('/me/payee'), api<EarningsView>('/me/earnings')]);
  if (payee.status === 404 && earnings.status === 404) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
        <p className="muted mt-2">Set up how you are paid, and follow what you’ve earned. Payments go out weekly for accepted work.</p>
      </section>
      {payee.data ? <PayeeSetup initial={payee.data} returned={returned === '1'} /> : <p role="alert" className="card p-4 text-sm text-error">We couldn’t load your payment set-up. Refresh the page to try again.</p>}
      {earnings.data ? <Earnings data={earnings.data} /> : <p role="alert" className="card p-4 text-sm text-error">We couldn’t load your earnings. Refresh the page to try again.</p>}
    </main>
  );
}
