import { PageQuery, pageWindow, type PageInfo } from '@praxis/shared';
import { z } from 'zod';
import type { InternalActor } from '../auth/actor';
import type { SearchType } from '../search/sources';

/**
 * Server-side paging for lists that can grow large (D24): optional `page`, `pageSize` and `q`. Without `page` a list
 * endpoint returns every row, as before, so existing callers keep working.
 */
export const PagedQuery = PageQuery.extend({ q: z.string().max(200).optional() });

/** The page fields a paged response adds next to `items` (absent when the caller did not ask for a page). */
export const PageInfoFields = {
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  total: z.number().int().optional(),
  pageCount: z.number().int().optional(),
};

/** The ids a console search matches (the same search as the lists' search bar). */
export type IdSearch = (actor: InternalActor, type: SearchType, q: string) => Promise<string[]>;

/** Prisma skip/take for the requested page, or nothing when no page was asked for. */
export function pageArgs(query: { page?: number; pageSize?: number }, total: number): { skip?: number; take?: number; info?: PageInfo } {
  if (!query.page) return {};
  const w = pageWindow(query.page, total, query.pageSize);
  return { skip: w.skip, take: w.take, info: { page: w.page, pageSize: w.pageSize, total: w.total, pageCount: w.pageCount } };
}
