import type { Metadata } from 'next';
import Link from 'next/link';
import { DirectoryView } from '@/components/templates/directory/directory-view';
import { McHeader } from '@/components/templates/mc-header';
import { getCurrentUser } from '@/lib/api';
import { mcServer } from '@/lib/mc/server';
import { queryParam, searchIds, type SearchParams } from '@/lib/paging';

export const metadata: Metadata = { title: 'Templates' };

/** Screen 1 (PRD §5.1). No New template or Add domain controls (S1-12, S1-13): workflows come from the seed or Save Variant. */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [sp, user, { data, status }] = await Promise.all([searchParams, getCurrentUser(), mcServer.directory()]);
  const domain = typeof sp.domain === 'string' ? sp.domain : undefined;
  const q = queryParam(sp);
  const matchIds = await searchIds('templates', q);
  const isAdmin = user!.roles.includes('ADMIN');
  return (
    <div>
      <McHeader isAdmin={isAdmin} />
      <h1 className="mt-4 text-2xl font-semibold">Harbor Templates Directory</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {isAdmin
          ? 'Templates by domain, as released from Studio. Open a version to view it, and publish or retire it. Templates are changed only in Studio.'
          : 'Published workflow templates you can create projects from.'}
      </p>
      {data ? (
        <DirectoryView data={data} domainFilter={domain} searchParams={sp} query={q} matchIds={matchIds} />
      ) : (
        <p role="alert" className="mt-6 text-error">
          Could not load the templates directory ({status}). Try again in a moment.
        </p>
      )}
    </div>
  );
}
