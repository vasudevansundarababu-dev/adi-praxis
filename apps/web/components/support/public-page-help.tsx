'use client';

import { PublicHelp } from '@praxis/shared/ui/public-help';
import { usePathname } from 'next/navigation';

/**
 * D-109 / D-110 (owner, 27 Nov 2026): the sign-in and change-password pages sit outside the console layout, so they
 * show the fixed public help for the page (no Support Bot, no model call).
 */
export function PublicPageHelp() {
  const path = usePathname() ?? '/login';
  return <PublicHelp app="console" path={path} />;
}
