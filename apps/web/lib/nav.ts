import type { InternalRole } from '@praxis/shared';

export interface NavItem {
  label: string;
  href: string;
  roles: InternalRole[];
}

/** Console areas by role. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['ADMIN', 'PM', 'REVIEWER'] },
  { label: 'Projects', href: '/projects', roles: ['ADMIN', 'PM'] },
  { label: 'Templates', href: '/templates', roles: ['ADMIN', 'PM'] },
  { label: 'Taxonomy', href: '/taxonomy', roles: ['ADMIN'] },
  { label: 'Applications', href: '/review/applications', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Task reviews', href: '/review/tasks', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Identity reviews', href: '/review/identity', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Conflicts', href: '/review/conflicts', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Terms', href: '/terms', roles: ['ADMIN'] },
  { label: 'API clients', href: '/api-clients', roles: ['ADMIN'] },
  { label: 'Users', href: '/users', roles: ['ADMIN'] },
];

export const navFor = (roles: InternalRole[]) => NAV_ITEMS.filter((i) => i.roles.some((r) => roles.includes(r)));
