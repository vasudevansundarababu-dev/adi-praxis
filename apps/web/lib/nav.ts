import type { InternalRole } from '@praxis/shared';

export interface NavItem {
  label: string;
  href: string;
  roles: InternalRole[];
  /** M10: shown only when SME_SUPPLY_ENABLED is on in this app's environment (docs/SME-SUPPLY.md section 13). */
  smeSupply?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

/**
 * Console areas by role, as a two-level menu: groups on the top row, the chosen group's pages on the second row.
 * A group is shown when the user can open at least one of its pages; a one-page group links straight to that page.
 */
export const NAV_GROUPS: NavGroup[] = [
  { key: 'home', label: 'Home', items: [{ label: 'Home', href: '/', roles: ['ADMIN', 'PM', 'REVIEWER', 'FINANCE'] }] },
  {
    key: 'projects',
    label: 'Projects',
    items: [
      { label: 'Projects', href: '/projects', roles: ['ADMIN', 'PM'] },
      { label: 'Templates', href: '/templates', roles: ['ADMIN', 'PM'] },
      { label: 'Approved exports', href: '/dataset', roles: ['ADMIN'] },
      { label: 'Requisitions', href: '/requisitions', roles: ['ADMIN', 'PM', 'REVIEWER'], smeSupply: true },
    ],
  },
  {
    key: 'reviews',
    label: 'Reviews',
    items: [
      { label: 'Applications', href: '/review/applications', roles: ['REVIEWER', 'ADMIN'] },
      { label: 'Task reviews', href: '/review/tasks', roles: ['REVIEWER', 'ADMIN'] },
      { label: 'RL reviews', href: '/review/rl', roles: ['REVIEWER', 'ADMIN'] },
      { label: 'Identity reviews', href: '/review/identity', roles: ['REVIEWER', 'ADMIN'] },
      { label: 'Conflicts', href: '/review/conflicts', roles: ['REVIEWER', 'ADMIN'] },
    ],
  },
  {
    key: 'certification',
    label: 'Certification',
    items: [
      { label: 'Guidelines', href: '/guidelines', roles: ['ADMIN', 'REVIEWER'], smeSupply: true },
      { label: 'Certification reviews', href: '/certifications', roles: ['REVIEWER', 'ADMIN'], smeSupply: true },
    ],
  },
  { key: 'partners', label: 'Partners', items: [{ label: 'Partners', href: '/partners', roles: ['ADMIN'], smeSupply: true }] },
  { key: 'payments', label: 'Payments', items: [{ label: 'Payments', href: '/payments/pay-runs', roles: ['FINANCE', 'ADMIN', 'PM'], smeSupply: true }] },
  {
    key: 'admin',
    label: 'Admin',
    items: [
      { label: 'Users', href: '/users', roles: ['ADMIN'] },
      { label: 'Taxonomy', href: '/taxonomy', roles: ['ADMIN'] },
      { label: 'Terms', href: '/terms', roles: ['ADMIN'] },
      { label: 'Failure codes', href: '/failure-codes', roles: ['ADMIN'] },
      { label: 'API clients', href: '/api-clients', roles: ['ADMIN'] },
    ],
  },
  // Captioned videos and the user guide (docs/user-guide), for every console role.
  { key: 'tutorials', label: 'Tutorials', items: [{ label: 'Tutorials', href: '/tutorials', roles: ['ADMIN', 'PM', 'REVIEWER', 'FINANCE'] }] },
];

/** Every page, flat (older callers and tests). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const smeSupplyOn = () => ['true', '1'].includes(process.env.SME_SUPPLY_ENABLED ?? '');

const visible = (i: NavItem, roles: InternalRole[], smeSupply: boolean) => (smeSupply || !i.smeSupply) && i.roles.some((r) => roles.includes(r));

export const navFor = (roles: InternalRole[], smeSupply = smeSupplyOn()) => NAV_ITEMS.filter((i) => visible(i, roles, smeSupply));

/** The groups this user can see, each with only the pages they can open. */
export const navGroupsFor = (roles: InternalRole[], smeSupply = smeSupplyOn()): NavGroup[] =>
  NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => visible(i, roles, smeSupply)) })).filter((g) => g.items.length > 0);

/** The group a path belongs to: the page whose href is the longest prefix of the path. */
export function activeGroup(groups: NavGroup[], pathname: string): NavGroup | null {
  let best: { g: NavGroup; len: number } | null = null;
  for (const g of groups) {
    for (const i of g.items) {
      const base = i.href === '/payments/pay-runs' ? '/payments' : i.href;
      const match = base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`);
      if (match && (!best || base.length > best.len)) best = { g, len: base.length };
    }
  }
  return best?.g ?? null;
}
