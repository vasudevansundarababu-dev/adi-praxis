import type { Metadata } from 'next';
import { FailureCodes, type Code } from '@/components/rl/failure-codes';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'Failure reason codes' };

export default async function FailureCodesPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) return <NoAccess need="Admins" />;
  const { data } = await apiGet<{ items: Code[] }>('/failure-reason-codes');
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Failure reason codes</h1>
      <p className="mt-1 text-sm text-fg-muted">Codes Validators attach to failures in RL reviews. Deactivating a code hides it from new reviews; past verdicts keep it.</p>
      <FailureCodes initial={data?.items ?? []} />
    </div>
  );
}
