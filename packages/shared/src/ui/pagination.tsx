import type { ComponentType, ReactNode } from 'react';
import { PAGE_SIZE, pageButtons, pageCount, showingText } from '../pagination';

/** A link component such as next/link; a plain <a> when none is given. */
export type PageLinkComponent = ComponentType<{ href: string; className?: string; 'aria-label'?: string; 'aria-current'?: 'page'; rel?: string; scroll?: boolean; children?: ReactNode }>;

export interface PaginationProps {
  /** The current page, 1-based. */
  page: number;
  /** Rows in the whole (filtered) list. */
  total: number;
  /** Rows shown on this page. */
  shown: number;
  pageSize?: number;
  /** Plural noun for the count: "Showing 10 of 50 users". */
  noun: string;
  /** Singular noun, for "Showing 1 of 1 user". */
  singular?: string;
  /** Link mode (server pages): the href of each page, e.g. "?page=3". */
  hrefFor?: (page: number) => string;
  /** Button mode (client tables): called with the chosen page. */
  onPage?: (page: number) => void;
  linkAs?: PageLinkComponent;
  /** Names the nav landmark; defaults to "<noun> pages". */
  label?: string;
  className?: string;
}

const PlainLink: PageLinkComponent = ({ children, scroll: _scroll, ...rest }) => <a {...rest}>{children}</a>;

const ITEM = 'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-medium';
const IDLE = `${ITEM} text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus`;
// The current page in the brand colour: brand navy (light) / brand blue (dark), the theme's primary, with AA contrast.
const CURRENT = `${ITEM} bg-primary text-on-primary`;
const DISABLED = `${ITEM} cursor-not-allowed text-fg-muted opacity-50`;

/**
 * The shared table pagination bar (D24): a count ("Showing 10 of 50 users"), then Previous, page numbers with an
 * ellipsis for long ranges, and Next. On narrow screens it collapses to arrows and numbers. Renders links (server
 * pages, so back and refresh keep the page) or buttons (client tables). Hook-free, so server and client components can
 * both use it.
 */
export function Pagination({ page, total, shown, pageSize = PAGE_SIZE, noun, singular, hrefFor, onPage, linkAs, label, className = '' }: PaginationProps) {
  const count = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, page), count);
  const Link = linkAs ?? PlainLink;

  const control = (target: number, body: ReactNode, opts: { ariaLabel?: string; isCurrent?: boolean; disabled?: boolean; rel?: string } = {}) => {
    if (opts.isCurrent)
      return (
        <span aria-current="page" aria-label={opts.ariaLabel} className={CURRENT}>
          {body}
        </span>
      );
    if (opts.disabled)
      return (
        <span aria-disabled="true" aria-label={opts.ariaLabel} className={DISABLED}>
          {body}
        </span>
      );
    if (hrefFor)
      return (
        <Link href={hrefFor(target)} aria-label={opts.ariaLabel} rel={opts.rel} scroll={false} className={IDLE}>
          {body}
        </Link>
      );
    return (
      <button type="button" aria-label={opts.ariaLabel} onClick={() => onPage?.(target)} className={IDLE}>
        {body}
      </button>
    );
  };

  return (
    <div className={`mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`} data-pagination>
      <p className="sr-only text-sm text-fg-muted sm:not-sr-only" role="status" aria-live="polite">
        {showingText(shown, total, noun, singular)}
      </p>
      {count > 1 && (
        <nav aria-label={label ?? `${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} pages`} className="ml-auto">
          <ul className="flex items-center gap-1">
            <li>
              {control(current - 1, (
                <>
                  <span aria-hidden="true">‹</span>
                  <span className="sr-only sm:not-sr-only">Previous</span>
                </>
              ), { ariaLabel: 'Previous page', disabled: current <= 1, rel: 'prev' })}
            </li>
            {pageButtons(current, count).map((b, i) => (
              <li key={b === 'ellipsis' ? `gap-${i}` : b}>
                {b === 'ellipsis' ? (
                  <span aria-hidden="true" className={`${ITEM} text-fg-muted`}>
                    …
                  </span>
                ) : (
                  control(b, b, { ariaLabel: `Page ${b}`, isCurrent: b === current })
                )}
              </li>
            ))}
            <li>
              {control(current + 1, (
                <>
                  <span className="sr-only sm:not-sr-only">Next</span>
                  <span aria-hidden="true">›</span>
                </>
              ), { ariaLabel: 'Next page', disabled: current >= count, rel: 'next' })}
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
