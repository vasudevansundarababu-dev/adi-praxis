'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeGroup, type NavGroup } from '@/lib/nav';

/**
 * Two-level console menu: groups on the top row; the current group's pages on a second row (only when the group has
 * more than one page). A group link opens its first page.
 */
export function MainNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? '/';
  const current = activeGroup(groups, pathname);
  const pageHref = current?.items.find((i) => {
    const base = i.href === '/payments/pay-runs' ? '/payments' : i.href;
    return base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`);
  })?.href;
  return (
    <>
      <nav aria-label="Main" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 text-sm">
        {groups.map((g) => {
          const on = current?.key === g.key;
          return (
            <Link
              key={g.key}
              href={g.items[0]!.href}
              aria-current={on ? 'true' : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 whitespace-nowrap ${on ? 'bg-white/15 font-semibold text-white' : 'text-white/85 hover:bg-white/10 hover:text-white'}`}
            >
              {g.label}
            </Link>
          );
        })}
      </nav>
      {current && current.items.length > 1 && (
        <nav aria-label={`${current.label} pages`} className="border-t border-white/10 bg-black/10">
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1.5 text-sm">
            {current.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                aria-current={pageHref === i.href ? 'page' : undefined}
                className={`shrink-0 rounded-md px-2 py-1 whitespace-nowrap ${pageHref === i.href ? 'bg-white text-brand-navy font-medium' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
              >
                {i.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
