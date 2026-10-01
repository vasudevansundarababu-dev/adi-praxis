import type { InternalRole } from '@praxis/shared';

/**
 * In-app Tutorials (docs/user-guide/VIDEOS.md): captioned demo videos and the user guide. Files live in
 * apps/web/tutorials (built by e2e/demo-videos/package.mjs) and are served by /tutorials/files/<name> only to a
 * signed-in console user, or to a partner user for the partner files.
 */
export type Audience = 'staff' | 'partner';

export interface TutorialVideo {
  file: string;
  title: string;
  length: string;
  summary: string;
  /** Console roles the video is recommended for; empty = everyone. */
  roles: InternalRole[];
  audiences: Audience[];
}

export const TUTORIAL_VIDEOS: TutorialVideo[] = [
  { file: '01-getting-started.mp4', title: 'Getting started', length: '1:29', summary: 'Signing in, Home, the two-level menu and the Help button. Where partners and experts sign in.', roles: [], audiences: ['staff'] },
  { file: '02-admin.mp4', title: 'Admin', length: '3:27', summary: 'Guidelines to a published course and test; partners, users, taxonomy, terms, failure codes and API keys.', roles: ['ADMIN'], audiences: ['staff'] },
  { file: '03-program-manager.mp4', title: 'Program Manager', length: '3:47', summary: 'The project wizard, Validators, the opportunity page, a requisition, staffing and confirming the pay run.', roles: ['PM'], audiences: ['staff'] },
  { file: '04-validator.mp4', title: 'Validator', length: '2:53', summary: 'Selecting applicants, reviewing and accepting a KYC task, and an RL Gym verdict.', roles: ['REVIEWER'], audiences: ['staff'] },
  { file: '05-finance.mp4', title: 'Finance', length: '1:56', summary: 'Rate cards, earnings and holds, the weekly pay run, reconciliation and partner statements.', roles: ['FINANCE'], audiences: ['staff'] },
  { file: '06-staffing-partner.mp4', title: 'Staffing partner', length: '1:32', summary: 'Reading a requisition, putting a candidate forward, tracking them, statements and the API page.', roles: [], audiences: ['staff', 'partner'] },
  { file: '07-expert-sme.mp4', title: 'Expert (SME)', length: '8:33', summary: 'Invite, identity, profile chat, onboarding, writing a KYC task with the AI interview, the course and test, payments.', roles: [], audiences: ['staff'] },
];

export const TUTORIAL_GUIDES: Record<Audience, { file: string; title: string; summary: string }> = {
  staff: { file: 'ADI-Praxis-User-Guide.pdf', title: 'User guide (PDF)', summary: 'Every screen, step by step, one chapter per role: Admin, PM, Validator, Finance, staffing partner and expert. Also roles, user IDs and admin functions.' },
  partner: { file: 'ADI-Praxis-Partner-Guide.pdf', title: 'Partner guide (PDF)', summary: 'Signing in, reading requisitions, putting candidates forward, following them, statements, and the API and webhooks.' },
};

/** Files an audience may download: its videos and its guide. */
export function tutorialFilesFor(audience: Audience): string[] {
  return [...TUTORIAL_VIDEOS.filter((v) => v.audiences.includes(audience)).map((v) => v.file), TUTORIAL_GUIDES[audience].file];
}

/** Videos for this user's roles first (Getting started leads), then the rest. */
export function videosForRoles(roles: InternalRole[]) {
  const staff = TUTORIAL_VIDEOS.filter((v) => v.audiences.includes('staff'));
  const mine = staff.filter((v) => v.file.startsWith('01-') || v.roles.some((r) => roles.includes(r)));
  return { mine, others: staff.filter((v) => !mine.includes(v)) };
}
