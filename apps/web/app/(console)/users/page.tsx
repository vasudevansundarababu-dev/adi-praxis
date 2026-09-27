import type { InternalUserDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage() {
  const { status, data } = await apiGet<{ items: InternalUserDto[] }>('/users');
  if (status === 403 || !data) notFound();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="mt-6 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Roles</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.roles.join(', ')}</td>
                <td className="px-4 py-2">{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
