import { notFound } from 'next/navigation';
import { DevIdentitySimulator } from '@/components/dev-identity';

/** LOCAL DEVELOPMENT AND DEMO ONLY: stands in for Stripe's hosted identity flow. Not available in real production. */
export default async function DevIdentityPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.PRAXIS_DEMO !== '1') notFound();
  return <DevIdentitySimulator sessionId={(await params).sessionId} returnUrl={(await searchParams).returnTo ?? '/verify'} />;
}
