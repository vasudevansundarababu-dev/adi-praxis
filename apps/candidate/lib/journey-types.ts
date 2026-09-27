export interface EnrollmentStatusView {
  id: string;
  status: string;
  statusText: string;
  title: string;
  message: string | null;
  informationRequest: string | null;
  scope: { domain: string; specialty: string | null; jurisdictions: string[]; languages: string[]; contributionRoles: string[]; expiresAt: string | null } | null;
  onboardingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | null;
  canAmend: boolean;
  canRequestReview: boolean;
  canWithdraw: boolean;
}

export interface OnboardingItem {
  key: string;
  kind: 'confirm' | 'terms' | 'conflicts' | 'guidance' | 'preferences';
  title: string;
  description: string;
  done: boolean;
  data: unknown;
  terms: { title: string; version: number; body: string; sha256: string; placeholder: boolean } | null;
}

export interface OnboardingView {
  enrollmentId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';
  blockReason: string | null;
  scope: EnrollmentStatusView['scope'];
  items: OnboardingItem[];
}

export interface AssignmentCard {
  id: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELED' | 'HANDED_OFF';
  revision: number;
  title: string;
  domain: string;
  specialty: string;
  jurisdictions: string[];
  languages: string[];
  contributionRoles: string[];
  expectedOutput: string;
  effort: string | null;
  deadline: string | null;
  compensation: string | null;
  confidentiality: string;
  requirementsVersion: number;
  currentRequirementsVersion: number;
  expiresAt: string | null;
  declineReason: string | null;
}
