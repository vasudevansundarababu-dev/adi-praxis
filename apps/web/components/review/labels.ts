const STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted · assessing',
  REVIEW_PENDING: 'Awaiting decision',
  NEEDS_INFORMATION: 'More information requested',
  SELECTED: 'Selected',
  NOT_SELECTED: 'Not selected',
  REVIEW_REQUESTED: 'Review requested',
  WITHDRAWN: 'Withdrawn',
};
const RECOMMENDATION: Record<string, string> = {
  NOT_RUN: 'Queued',
  EVALUATING: 'Assessing…',
  FIT_RECOMMENDED: 'Fit (recommended)',
  NEEDS_INFORMATION: 'Needs information',
  NOT_FIT_RECOMMENDED: 'Not fit (recommended)',
  ERROR: 'Assessment failed',
  SUPERSEDED: 'Superseded',
};
export const statusLabel = (s: string) => STATUS[s] ?? s;
export const recommendationLabel = (s: string | null) => (s ? (RECOMMENDATION[s] ?? s) : '—');
