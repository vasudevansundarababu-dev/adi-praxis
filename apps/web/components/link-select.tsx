'use client';

import { useRouter } from 'next/navigation';

/**
 * UI standard 3.11 and 3a (owner, 26 Nov 2026): a filter is a dropdown, never a row of buttons. Each option is the same
 * address the old filter link went to, so the page, its server filtering and the URL work exactly as before.
 */
export function LinkSelect({ label, options, className = '' }: { label: string; options: { label: string; href: string; selected: boolean }[]; className?: string }) {
  const router = useRouter();
  const current = options.find((o) => o.selected)?.href ?? options[0]?.href ?? '';
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="text-fg-muted">{label}</span>
      <select className="rounded-md border border-line bg-surface px-2 py-1" value={current} onChange={(e) => router.push(e.target.value)}>
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
