import type { ForgeAuthorTask, ForgeComment, ForgeHomeDto, ForgeReviewTask, SmeTaskStatus, TemplateProfile } from '@praxis/shared';

/**
 * MVP1 candidate app (docs/design/PROJECT-SCREEN-DESIGN.md, "Candidate app for MVP1"; mockup
 * docs/design/mockups/candidate-screens.html). Pure helpers shared by the pages and their tests.
 */

export const AUTHOR_STATUS_TONE: Record<SmeTaskStatus, string> = {
  New: 'pill-info',
  'In progress': 'pill-info',
  'In review': 'pill-brand',
  Rework: 'pill-warning',
  Accepted: 'pill-success',
  Rejected: 'pill-error',
};
export const REVIEW_STATUS_TONE: Record<ForgeReviewTask['status'], string> = { 'To review': 'pill-info', 'Sent back': 'pill-warning', Approved: 'pill-success' };

/** Home's filter: every status a task can show. */
export const AUTHOR_FILTERS: SmeTaskStatus[] = ['New', 'In progress', 'In review', 'Rework', 'Accepted', 'Rejected'];

/** Most urgent first: rework, then work in hand, then waiting and closed. */
const ORDER: SmeTaskStatus[] = ['Rework', 'In progress', 'New', 'In review', 'Accepted', 'Rejected'];
export function sortAuthorTasks(tasks: ForgeAuthorTask[]): ForgeAuthorTask[] {
  return [...tasks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.date.localeCompare(a.date));
}

export const filterAuthorTasks = (tasks: ForgeAuthorTask[], filter: SmeTaskStatus | '') => sortAuthorTasks(tasks).filter((t) => !filter || t.status === filter);

export interface NextStep {
  title: string;
  body: string;
  href: string | null;
  cta: string | null;
}

/** The welcome card's next step: rework first, then a task to review, then work in progress, then a new task. */
export function nextForgeStep(home: Pick<ForgeHomeDto, 'authorTasks' | 'reviewTasks'>): NextStep {
  const rework = sortAuthorTasks(home.authorTasks).find((t) => t.status === 'Rework');
  if (rework) return { title: `Fix ${rework.label}: rework requested`, body: rework.projectName, href: `/tasks/${rework.taskId}`, cta: 'Open task' };
  const review = home.reviewTasks.find((t) => t.status === 'To review');
  if (review) return { title: `Review ${review.label}`, body: review.projectName, href: `/reviews/${review.taskId}`, cta: 'Open review' };
  const going = home.authorTasks.find((t) => t.status === 'In progress');
  if (going) return { title: `Continue ${going.label}`, body: going.projectName, href: `/tasks/${going.taskId}`, cta: 'Open task' };
  const fresh = home.authorTasks.find((t) => t.status === 'New');
  if (fresh) return { title: `Start ${fresh.label}`, body: fresh.projectName, href: `/tasks/${fresh.taskId}`, cta: 'Open task' };
  return { title: 'Nothing to do right now', body: 'Your submitted tasks are being reviewed.', href: null, cta: null };
}

export const authorAction = (s: SmeTaskStatus) => (s === 'New' ? 'Start authoring →' : s === 'Rework' ? 'Fix and resubmit →' : s === 'In progress' ? 'Continue →' : 'View →');

// ── Sections and comments ──

const norm = (s: string) => s.trim().replace(/[‒-―]/g, '-').toUpperCase();
const sectionNumber = (s: string) => (/^S(\d+)$/.exec(s)?.[1] ? Number(/^S(\d+)$/.exec(s)![1]) : null);

/** Whether a comment's section (S1, or a range such as S3-S4 or S6-S8) covers the form section `key`. */
export function sectionMatches(commentSection: string, key: string): boolean {
  const c = norm(commentSection);
  const k = norm(key);
  if (c === k) return true;
  const range = /^(S\d+)-(S\d+)$/.exec(c);
  const n = sectionNumber(k);
  if (!range || n === null) return false;
  const lo = sectionNumber(range[1]!)!;
  const hi = sectionNumber(range[2]!)!;
  return n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
}

/** Comments per form section, and the comments that name no section of this form (shown in a summary at the top). */
export function placeComments(comments: ForgeComment[], sectionKeys: string[]) {
  const bySection: Record<string, ForgeComment[]> = Object.fromEntries(sectionKeys.map((k) => [k, []]));
  const unmatched: ForgeComment[] = [];
  for (const c of comments) {
    const hit = sectionKeys.filter((k) => sectionMatches(c.section, k));
    if (!hit.length) unmatched.push(c);
    for (const k of hit) bySection[k]!.push(c);
  }
  return { bySection, unmatched, flagged: sectionKeys.filter((k) => bySection[k]!.length > 0) };
}

export interface ReviewGroup {
  /** The comment's section key, as the API stores it (S1, S2, S3-S4, S5, S6-S8). */
  key: string;
  /** Shown as the heading, e.g. "S3–S4 · Rules and tools · Environment". */
  heading: string;
  sections: string[];
}

/** The design's grouping of the eight form sections for review comments (owner, 15 Nov: S1, S2, S3–S4, S5, S6–S8). */
const DESIGN_GROUPS = [['S1'], ['S2'], ['S3', 'S4'], ['S5'], ['S6', 'S7', 'S8']];

/** The Review page's comment boxes, derived from the form's sections: one per group of the design. */
export function reviewGroups(profile: Pick<TemplateProfile, 'sections'>): ReviewGroup[] {
  const keys: string[] = profile.sections.map((s) => s.key);
  const fixed = DESIGN_GROUPS.every((g) => g.every((k) => keys.includes(k))) && keys.length === 8;
  const groups = fixed ? DESIGN_GROUPS : keys.map((k) => [k]);
  return groups.map((g) => {
    const titles = g.map((k) => profile.sections.find((s) => s.key === k)!.title);
    const key = g.length === 1 ? g[0]! : `${g[0]}-${g.at(-1)}`;
    return { key, heading: `${g.length === 1 ? g[0] : `${g[0]}–${g.at(-1)}`} · ${titles.join(' · ')}`, sections: g };
  });
}

/** Comments that will be sent: only non-empty boxes, trimmed. */
export const commentsToSend = (boxes: Record<string, string>): ForgeComment[] =>
  Object.entries(boxes)
    .map(([section, text]) => ({ section, text: text.trim() }))
    .filter((c) => c.text.length > 0);

/** Inline error for a Reviewer decision, or null when it can be sent. */
export function reviewDecisionProblem(decision: 'PASS' | 'REWORK', boxes: Record<string, string>, o: { needsDuplicate?: boolean; duplicateConfirmed?: boolean; needsCoverage?: boolean; coverageConfirmed?: boolean } = {}): string | null {
  if (decision === 'REWORK') return commentsToSend(boxes).length ? null : 'Add a comment on at least one section before sending it back.';
  if (o.needsDuplicate && !o.duplicateConfirmed) return 'Confirm that this task is distinct from the similar one before approving.';
  if (o.needsCoverage && !o.coverageConfirmed) return 'Confirm the coverage this task fills before approving.';
  return null;
}

/** Inline error on Before you start, or null when both are ticked. */
export function welcomeProblem(contributor: boolean, synthetic: boolean): string | null {
  if (contributor && synthetic) return null;
  return 'Accept both to continue.';
}
