import 'server-only';
import { parsePage, slicePage, type Paged } from '@praxis/shared';
import type { SearchType } from '@/components/search/table-search';
import { apiGet } from './api';

export type SearchParams = Record<string, string | string[] | undefined>;

/** The `?q=` search of a paged console table (D24), trimmed; '' when none. */
export function queryParam(sp: SearchParams, param = 'q'): string {
  const v = sp[param];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

/** The `?page=` of a table, 1 when absent or invalid. */
export function pageParam(sp: SearchParams, param = 'page'): number {
  return parsePage(sp[param]);
}

/**
 * The ids the console search matches for `q` (the same search as the table's search bar), or null with no query.
 * Used to filter a list the server page pages itself.
 */
export async function searchIds(type: SearchType, q: string): Promise<Set<string> | null> {
  if (!q) return null;
  const { data } = await apiGet<{ ids: string[] }>(`/search/${type}?q=${encodeURIComponent(q)}&limit=1`);
  return new Set(data?.ids ?? []);
}

/** A list filtered by the search ids (when there is a query) and paged: one page plus the filtered total. */
export function pageOf<T extends { id: string }>(items: readonly T[], sp: SearchParams, ids: Set<string> | null = null, param = 'page'): Paged<T> {
  return slicePage(ids ? items.filter((i) => ids.has(i.id)) : items, pageParam(sp, param));
}
