'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Payments sub-navigation, in the same pill style as the console's filter links. */
export function PaymentsTabs({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Payments" className="flex flex-wrap gap-2 text-sm">
      {items.map((i) => {
        const on = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${on ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
