import type { InternalUserDto } from '@praxis/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { UserAdmin } from '@/components/users/user-admin';
import { apiGet, getCurrentUser } from '@/lib/api';
import { pageParam, queryParam, type SearchParams } from '@/lib/paging';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // D24: paged by the API (10 a page), filtered by the search bar's `?q=`.
  const q = queryParam(sp);
  const [{ status, data }, me] = await Promise.all([
    apiGet<{ items: InternalUserDto[]; page?: number; total?: number }>(`/users?page=${pageParam(sp)}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    getCurrentUser(),
  ]);
  if (status === 403 || !data || !me) notFound();
  const h = await headers();
  const signInAt = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}/login`;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        People who use the console. Add someone with their roles and pass on the temporary password through your password manager; they choose their own password when they first
        sign in. A reset signs the person out everywhere.
      </p>
      <div className="mt-6">
        <UserAdmin users={data.items} meId={me.id} signInAt={signInAt} paging={{ page: data.page ?? 1, total: data.total ?? data.items.length, searchParams: sp, query: q }} />
      </div>
    </div>
  );
}
