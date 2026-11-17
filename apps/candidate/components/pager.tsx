import { withPage } from '@praxis/shared';
import { Pagination, type PaginationProps } from '@praxis/shared/ui/pagination';
import Link from 'next/link';

export { Pagination };
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The shared table pagination bar (D24) for a server page: each page is a link that keeps the other URL parameters
 * (search, filters), so back and refresh keep the page. Use `param` for a second table on one screen.
 */
export function UrlPager({ searchParams, param = 'page', ...props }: Omit<PaginationProps, 'hrefFor' | 'onPage' | 'linkAs'> & { searchParams: SearchParams; param?: string }) {
  return <Pagination {...props} linkAs={Link} hrefFor={(n) => withPage(searchParams, n, param)} />;
}

/** The shared table pagination bar (D24) for a client table paged with usePagedRows. */
export function ClientPager({ paged, ...props }: Omit<PaginationProps, 'page' | 'total' | 'shown' | 'pageSize' | 'hrefFor' | 'onPage' | 'linkAs'> & { paged: { page: number; total: number; pageSize: number; items: readonly unknown[]; setPage: (page: number) => void } }) {
  return <Pagination {...props} page={paged.page} total={paged.total} shown={paged.items.length} pageSize={paged.pageSize} onPage={paged.setPage} />;
}
