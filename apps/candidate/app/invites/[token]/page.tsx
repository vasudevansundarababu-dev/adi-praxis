import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { RedeemInvite } from '@/components/work/redeem-invite';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Your tasks') } };

/** SPEC FLOW 3: the link identifies the invite, not the session, so the candidate signs in first. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/invites/${token}`)}`);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <RedeemInvite token={token} />
    </main>
  );
}
