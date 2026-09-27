import type { InternalRole } from '@praxis/shared';

export interface NavItem {
  label: string;
  href: string;
  roles: InternalRole[];
}

/** Console areas by role. Later milestones add Templates (M1), Projects (M2), Review queue (M3+). */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['ADMIN', 'PM', 'REVIEWER'] },
  { label: 'Users', href: '/users', roles: ['ADMIN'] },
];

export const navFor = (roles: InternalRole[]) => NAV_ITEMS.filter((i) => i.roles.some((r) => roles.includes(r)));
