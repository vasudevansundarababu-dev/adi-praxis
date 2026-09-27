import type { Metadata } from 'next';
import { ApiClients, type ApiClientRow } from '@/components/tasks/api-clients';
import { apiGet, getCurrentUser } from '@/lib/api';
import { NoAccess } from '@/components/no-access';

export const metadata: Metadata = { title: 'API clients' };

export default async function ApiClientsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) return <NoAccess need="Admins" />;
  const { data } = await apiGet<{ items: ApiClientRow[] }>('/api-clients');
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">API clients</h1>
      <p className="mt-1 text-sm text-fg-muted">Keys for client systems that push annotation inputs, and for RL Gym. A key is shown once; only its hash is stored.</p>
      <ApiClients initial={data?.items ?? []} />
    </div>
  );
}
