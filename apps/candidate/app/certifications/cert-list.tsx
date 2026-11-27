'use client';

import { usePagedRows } from '@praxis/shared/ui/use-page';
import type { ReactNode } from 'react';
import { ClientPager } from '@/components/pager';

/**
 * The certification cards (UI standard 3a), 10 a page (`?page=`). A card can hold an unsaved licence form, so cards off
 * the page are hidden, never unmounted. The cards themselves are rendered by the server page.
 */
export function CertList({ cards }: { cards: { id: string; node: ReactNode }[] }) {
  const paged = usePagedRows(cards);
  const visible = new Set(paged.items.map((c) => c.id));
  return (
    <>
      <ul className="grid gap-4">
        {cards.map((c) => (
          <li key={c.id} className="card p-5" hidden={!visible.has(c.id)}>
            {c.node}
          </li>
        ))}
      </ul>
      {cards.length > 0 && <ClientPager paged={paged} noun="certifications" singular="certification" />}
    </>
  );
}
