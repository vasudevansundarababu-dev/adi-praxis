import type { InternalRole } from '@praxis/shared';

export interface NavItem {
  label: string;
  href: string;
  roles: InternalRole[];
}

/** Console areas by role. The Review queue arrives with later milestones. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['ADMIN', 'PM', 'REVIEWER'] },
  { label: 'Projects', href: '/projects', roles: ['ADMIN', 'PM'] },
  { label: 'Templates', href: '/templates', roles: ['ADMIN', 'PM'] },
  { label: 'Taxonomy', href: '/taxonomy', roles: ['ADMIN'] },
  { label: 'Users', href: '/users', roles: ['ADMIN'] },
];

export const navFor = (roles: InternalRole[]) => NAV_ITEMS.filter((i) => i.roles.some((r) => roles.includes(r)));
