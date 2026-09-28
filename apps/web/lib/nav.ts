import type { InternalRole } from '@praxis/shared';

export interface NavItem {
  label: string;
  href: string;
  roles: InternalRole[];
  /** M10: shown only when SME_SUPPLY_ENABLED is on in this app's environment (docs/SME-SUPPLY.md section 13). */
  smeSupply?: boolean;
}

/** Console areas by role. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['ADMIN', 'PM', 'REVIEWER', 'FINANCE'] },
  { label: 'Projects', href: '/projects', roles: ['ADMIN', 'PM'] },
  { label: 'Templates', href: '/templates', roles: ['ADMIN', 'PM'] },
  { label: 'Taxonomy', href: '/taxonomy', roles: ['ADMIN'] },
  { label: 'Applications', href: '/review/applications', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Task reviews', href: '/review/tasks', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'RL reviews', href: '/review/rl', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Identity reviews', href: '/review/identity', roles: ['REVIEWER', 'ADMIN'] },
  { label: 'Conflicts', href: '/review/conflicts', roles: ['REVIEWER', 'ADMIN'] },
  // M10 SME supply (docs/SME-SUPPLY.md): hidden with SME_SUPPLY_ENABLED off; the pages also say so if reached directly.
  { label: 'Requisitions', href: '/requisitions', roles: ['ADMIN', 'PM', 'REVIEWER'], smeSupply: true },
  { label: 'Certifications', href: '/certifications', roles: ['REVIEWER', 'ADMIN'], smeSupply: true },
  { label: 'Guidelines', href: '/guidelines', roles: ['ADMIN', 'REVIEWER'], smeSupply: true },
  { label: 'Partners', href: '/partners', roles: ['ADMIN'], smeSupply: true },
  { label: 'Payments', href: '/payments/pay-runs', roles: ['FINANCE', 'ADMIN', 'PM'], smeSupply: true },
  { label: 'Terms', href: '/terms', roles: ['ADMIN'] },
  { label: 'API clients', href: '/api-clients', roles: ['ADMIN'] },
  { label: 'Failure codes', href: '/failure-codes', roles: ['ADMIN'] },
  { label: 'Users', href: '/users', roles: ['ADMIN'] },
];

const smeSupplyOn = () => ['true', '1'].includes(process.env.SME_SUPPLY_ENABLED ?? '');

export const navFor = (roles: InternalRole[], smeSupply = smeSupplyOn()) => NAV_ITEMS.filter((i) => (smeSupply || !i.smeSupply) && i.roles.some((r) => roles.includes(r)));
