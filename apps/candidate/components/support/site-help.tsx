'use client';

import { usePathname } from 'next/navigation';
import { PublicHelp } from '@praxis/shared/ui/public-help';
import { SupportBot } from './support-bot';
import { siteHelpShown } from './site-help-logic';

/**
 * Night plan, 26 Nov 2026 (owner: "Every page has help"): the Support Bot's Help button on every signed-in SME page.
 * The task and review pages keep their own task Help ("Help for this task"), so this one is not shown there.
 */
export function SiteHelp() {
  const path = usePathname() ?? '/';
  return siteHelpShown(path) ? <SupportBot /> : null;
}

/** D-109 (owner, 27 Nov 2026): signed-out pages show their fixed public help (no Support Bot, no model call). */
export function PublicSiteHelp() {
  const path = usePathname() ?? '/';
  return <PublicHelp app="sme" path={path} />;
}
