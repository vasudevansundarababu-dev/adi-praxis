import Link from 'next/link';

/** One thing waiting for this person (GET /me/inbox or /me/forge/inbox). */
export interface InboxItem {
  kind: string;
  title: string;
  detail: string;
  href: string;
  count: number;
}

/**
 * D-004 (owner, 23 Nov 2026): the header bell. A count of what is waiting, and a short list linking to where each item
 * is done. Items disappear when the work is done; there is no read state. Server-rendered, no script needed.
 */
export function InboxBell({ items, unavailable = false }: { items: InboxItem[]; unavailable?: boolean }) {
  const n = items.length;
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-white/90 hover:bg-white/10 [&::-webkit-details-marker]:hidden" aria-label={unavailable ? 'Inbox could not be loaded' : n ? `Inbox, ${n} waiting` : 'Inbox, nothing waiting'}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && <span className="rounded-full bg-warning px-1.5 text-xs font-semibold tabular-nums text-black">{n}</span>}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-2 text-fg shadow-lg">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Waiting for you</p>
        {unavailable ? (
          <p className="px-2 py-1 text-sm text-fg-muted">The inbox could not be loaded. Reload the page to try again.</p>
        ) : n === 0 ? (
          <p className="px-2 py-1 text-sm text-fg-muted">Nothing is waiting for you right now.</p>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {items.map((i, k) => (
              <li key={`${i.kind}-${i.href}-${k}`}>
                <Link href={i.href} className="block rounded px-2 py-1.5 text-sm hover:bg-line/40">
                  <span className="block font-medium">{i.title}</span>
                  <span className="block truncate text-xs text-fg-muted">{i.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
