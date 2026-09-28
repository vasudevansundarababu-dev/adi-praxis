import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MockPayeeFinish } from '@/components/pay/mock-payee-finish';

export const metadata: Metadata = { title: { absolute: pageTitle('Payout provider (simulated)') } };

/**
 * LOCAL DEVELOPMENT AND DEMO ONLY: stands in for the payout provider's hosted onboarding (the API's payout mock links
 * here). No details are collected. Not available in real production.
 */
export default async function MockPayeeOnboardingPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.PRAXIS_DEMO !== '1') notFound();
  const { ref } = await searchParams;
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <section className="card p-6 text-sm">
        <p className="pill pill-warning">Simulated payout provider</p>
        <h1 className="mt-3 text-2xl font-semibold">Payment set-up</h1>
        <p className="mt-2 text-fg-muted">
          In a real environment this is the payout provider’s secure page, where you add a tax form and payout method. Here nothing is collected. Do not enter real details.
        </p>
        {ref && <p className="mt-3 font-mono text-xs text-fg-muted">Reference {ref}</p>}
        <MockPayeeFinish />
        <Link href="/payments" className="mt-3 inline-block text-sm underline">
          Cancel and go back
        </Link>
      </section>
    </main>
  );
}
