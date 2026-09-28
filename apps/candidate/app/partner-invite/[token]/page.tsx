import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { RedeemPartnerInvite } from '@/components/supply/redeem-partner-invite';
import { getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Your invitation') } };

/**
 * M10a: a partner put this person forward. The link identifies the invitation, not the session, so the candidate signs
 * in with Google first; the invitation then starts (or resumes) the FLOW 2 application for the role.
 */
export default async function PartnerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/partner-invite/${token}`)}`);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <RedeemPartnerInvite token={token} />
    </main>
  );
}
