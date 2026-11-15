import type { Metadata } from 'next';
import { CandidateSignInSettings } from '@/components/forge/candidate-sign-in';
import { NoAccess } from '@/components/no-access';
import { getCurrentUser, getForgeSettings } from '@/lib/api';

export const metadata: Metadata = { title: 'Candidate app sign-in' };

/** Admin → Candidate app sign-in (owner, 15 Nov). Admins change it; PMs read it. */
export default async function CandidateSignInPage() {
  const [settings, user] = await Promise.all([getForgeSettings(), getCurrentUser()]);
  if (!settings || !user) return <NoAccess need="Admins (PMs can view it)" />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Admin · Candidate app sign-in</h1>
      <p className="mt-1.5 mb-5 max-w-3xl text-sm text-fg-muted">How SMEs and Reviewers sign in to the candidate app, and whether the new flow is on. Applies to everyone at once.</p>
      <CandidateSignInSettings initial={settings} canEdit={user.roles.includes('ADMIN')} />
    </div>
  );
}
