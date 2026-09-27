import { notFound } from 'next/navigation';
import { DevIdentitySimulator } from '@/components/dev-identity';

/** LOCAL DEVELOPMENT ONLY: stands in for Stripe's hosted identity flow. Not available in production builds. */
export default async function DevIdentityPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevIdentitySimulator sessionId={(await params).sessionId} returnUrl={(await searchParams).returnTo ?? '/verify'} />;
}
