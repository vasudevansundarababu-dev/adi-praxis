import { z } from 'zod';

/**
 * Table paging (D24, owner QA 17 Nov 2026): every console and candidate-app table shows 10 rows per page, with
 * Previous, page numbers (an ellipsis for long ranges) and Next, and a "Showing 10 of 50 users" count. The page lives
 * in the URL (`?page=`). Lists that can grow large are paged by the API; small fixed lists are paged in the browser.
 */
export const PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

/** Optional `page` / `pageSize` query on a list endpoint. Without `page` the endpoint returns every row, as before. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** What a paged endpoint adds next to `items`. `total` is the filtered total (after any search). */
export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}
export type Paged<T> = { items: T[] } & PageInfo;

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** A page number from a URL value: a positive whole number, or 1. */
export function parsePage(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** The page clamped into range, so a stale `?page=9` on a list that shrank shows its last page. */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, pageSize));
}

/** One page of an in-memory list, with the page info. */
export function slicePage<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): Paged<T> {
  const total = items.length;
  const current = clampPage(page, total, pageSize);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageSize, total, pageCount: pageCount(total, pageSize) };
}

/** Page info for a database query: `skip` and `take` for Prisma, given the total. */
export function pageWindow(page: number, total: number, pageSize = PAGE_SIZE) {
  const current = clampPage(page, total, pageSize);
  return { skip: (current - 1) * pageSize, take: pageSize, page: current, pageSize, total, pageCount: pageCount(total, pageSize) };
}

export type PageButton = number | 'ellipsis';

/**
 * The page numbers to show: always the first and last, a window around the current page, and an ellipsis for each
 * gap. As in the owner's reference: page 5 of 99 → 1 2 3 4 5 … 99; page 50 of 99 → 1 … 49 50 51 … 99; page 97 of 99 →
 * 1 … 95 96 97 98 99. At most 7 entries.
 */
export function pageButtons(page: number, count: number): PageButton[] {
  if (count <= 7) return Array.from({ length: Math.max(1, count) }, (_, i) => i + 1);
  const current = Math.min(Math.max(1, page), count);
  if (current <= 5) return [1, 2, 3, 4, 5, 'ellipsis', count];
  if (current >= count - 4) return [1, 'ellipsis', count - 4, count - 3, count - 2, count - 1, count];
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', count];
}

/** "Showing 10 of 50 users". `noun` is the plural; one row of one is "Showing 1 of 1 user" when `singular` is given. */
export function showingText(shown: number, total: number, noun: string, singular?: string): string {
  return `Showing ${shown} of ${total} ${total === 1 && singular ? singular : noun}`;
}

/** A URL search string with `page` set (dropped on page 1), keeping every other parameter. */
export function withPage(search: string | URLSearchParams | Record<string, string | string[] | undefined>, page: number, param = 'page'): string {
  const params = toParams(search);
  if (page <= 1) params.delete(param);
  else params.set(param, String(page));
  const s = params.toString();
  return s ? `?${s}` : '?';
}

/** A URL search string with a search query set and paging reset to page 1 (a new search starts at the top). */
export function withQuery(search: string | URLSearchParams | Record<string, string | string[] | undefined>, q: string, opts: { param?: string; pageParam?: string } = {}): string {
  const params = toParams(search);
  const key = opts.param ?? 'q';
  if (q.trim()) params.set(key, q);
  else params.delete(key);
  params.delete(opts.pageParam ?? 'page');
  const s = params.toString();
  return s ? `?${s}` : '?';
}

function toParams(search: string | URLSearchParams | Record<string, string | string[] | undefined>): URLSearchParams {
  if (typeof search === 'string' || search instanceof URLSearchParams) return new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  return params;
}

/**
 * True when every word of the query appears in one of the fields (case-insensitive). Used by table searches such as
 * Assign people (D23): first name, last name, email and skills.
 */
export function matchesQuery(fields: ReadonlyArray<string | null | undefined>, q: string | null | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join(' \u0000 ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
