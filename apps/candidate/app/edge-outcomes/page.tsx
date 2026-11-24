import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { redirect } from 'next/navigation';
import { EdgeOutcomes, type MyOutcomeBatch } from '@/components/forge/edge-outcomes';
import { api, getMe } from '@/lib/api';

export const metadata: Metadata = { title: { absolute: pageTitle('Edge-case outcomes') } };

/** E-001 §6b: the edge-case variants a PM asked this SME to give expected outcomes for, in one batch. */
export default async function EdgeOutcomesPage() {
  if (!(await getMe())) redirect('/sign-in');
  const { data } = await api<{ items: MyOutcomeBatch[] }>('/me/edge-outcomes');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Edge-case outcomes</h1>
      <p className="max-w-3xl text-sm text-fg-muted">
        Your PM sent these edge-case variants in one batch. For each, say what a good analyst should conclude, why, and the evidence they should cite. You can also say a variant is wrong or doesn’t count, or that you can’t decide. Your answers become the expected results the benchmark grades against; the AI agent never sees them.
      </p>
      {data ? <EdgeOutcomes batches={data.items} /> : <p className="card p-5 text-sm text-error">The batches could not be loaded. Reload the page to try again.</p>}
    </div>
  );
}
