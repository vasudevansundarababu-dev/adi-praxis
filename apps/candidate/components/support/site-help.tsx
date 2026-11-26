'use client';

import { usePathname } from 'next/navigation';
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
