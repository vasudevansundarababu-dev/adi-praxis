'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { PAGE_SIZE, parsePage, slicePage, withPage, type Paged } from '../pagination';

const EVENT = 'forge:urlchange';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** The URL with `param` set to `page` (removed on page 1), keeping the path, other parameters and the hash. */
export function urlWithPage(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, page: number, param = 'page'): string {
  const search = withPage(loc.search, page, param);
  return `${loc.pathname}${search === '?' ? '' : search}${loc.hash}`;
}

/**
 * The page of a client-side table, kept in the URL (`?page=`) so back and refresh keep it (D24). Uses the History API,
 * which Next.js keeps in step with its router, so no server round trip. Use a distinct `param` for a second table.
 */
export function useUrlPage(param = 'page'): [number, (page: number, opts?: { replace?: boolean }) => void] {
  const page = useSyncExternalStore(
    subscribe,
    () => parsePage(new URLSearchParams(window.location.search).get(param)),
    () => 1,
  );
  const set = useCallback(
    (next: number, opts: { replace?: boolean } = {}) => {
      const url = urlWithPage(window.location, next, param);
      if (opts.replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
      window.dispatchEvent(new Event(EVENT));
    },
    [param],
  );
  return [page, set];
}

/**
 * One page of `rows` for a client-side table, with the page in the URL. When `resetKey` changes (a new search or
 * filter) the table goes back to page 1. `total` is the filtered total, for the "Showing 10 of 50" count.
 */
export function usePagedRows<T>(rows: readonly T[], opts: { param?: string; resetKey?: unknown; pageSize?: number } = {}): Paged<T> & { setPage: (page: number) => void } {
  const [page, setPage] = useUrlPage(opts.param);
  const last = useRef(opts.resetKey);
  useEffect(() => {
    if (Object.is(last.current, opts.resetKey)) return;
    last.current = opts.resetKey;
    if (page !== 1) setPage(1, { replace: true });
  }, [opts.resetKey, page, setPage]);
  return { ...slicePage(rows, page, opts.pageSize ?? PAGE_SIZE), setPage };
}
