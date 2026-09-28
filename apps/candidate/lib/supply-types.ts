/** Shapes returned by the M10 candidate routes (apps/api/src/routes/cert-candidate.ts, payments.ts, supply-candidate.ts). */

export type CertState = 'NOT_STARTED' | 'IN_TRAINING' | 'TEST_READY' | 'IN_TEST' | 'PASSED' | 'RETAKE_AVAILABLE' | 'REVIEW_REQUIRED' | 'NOT_CERTIFIED' | 'EXPIRED';
export type LicenceStatus = 'NOT_SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface CertificationCard {
  id: string;
  domain: string;
  tier: 'EXPERT' | 'REVIEWER_SME' | 'ANNOTATOR';
  tierLabel: string;
  state: CertState;
  attemptsUsed: number;
  retakeAvailableAt: string | null;
  reviewReason: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  licenceRequired: boolean;
  licenceStatus: LicenceStatus | null;
}

export interface CourseModule {
  id: string;
  position: number;
  title: string;
  completed: boolean;
  locked: boolean;
  explanation?: string;
  goodExamples?: string[];
  badExamples?: string[];
  practice?: { prompt: string; answer: string; feedback: string }[];
  citations?: string[];
  quiz?: { question: string; options: string[] }[];
}

export interface CourseView {
  certificationId: string;
  tier: CertificationCard['tier'];
  tierLabel: string;
  title: string;
  state: CertState;
  modules: CourseModule[];
}

export interface ModuleResult {
  passed: boolean;
  alreadyDone: boolean;
  feedback: string[];
  state: CertState;
}

export type ItemType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'LABEL' | 'ORDERING' | 'SEVERITY' | 'TRAJECTORY_REVIEW' | 'JUSTIFICATION' | 'CRITIQUE' | 'AUTHORING';

export interface TestItem {
  id: string;
  number: number;
  itemType: ItemType;
  competency: string;
  stem: string;
  content: { options?: string[]; steps?: { id: string; text: string }[]; rubric?: { criterion: string; weight: number }[] };
}

export type Answer = string | string[];

export interface AttemptInProgress {
  attemptId: string;
  attemptNo: number;
  status: 'IN_PROGRESS';
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  answers: Record<string, Answer>;
  items: TestItem[];
}

export type Band = 'Strong' | 'Meets' | 'Developing' | 'Below';

export interface AttemptResult {
  attemptId: string;
  attemptNo: number;
  status: string;
  submittedAt: string | null;
  result: 'PASS' | 'FAIL' | 'PENDING_REVIEW';
  sections: Record<string, Band>;
}

export interface TestView {
  certification: { id: string; state: CertState; retakeAvailableAt?: string | null; attemptsUsed?: number };
  attempt: AttemptInProgress | AttemptResult | null;
}

export const isInProgress = (a: TestView['attempt']): a is AttemptInProgress => !!a && a.status === 'IN_PROGRESS' && 'items' in a;

export interface PayeeView {
  required: boolean;
  status: 'NOT_REQUIRED' | 'NOT_STARTED' | 'PENDING' | 'READY' | 'BLOCKED';
  provider: string | null;
  payoutCurrency: string | null;
  reason: string | null;
}

export interface EarningsView {
  balance: Record<string, { earned: string; paid: string; inPayment: string; unpaid: string }>;
  minimumPayout: Record<string, string>;
  entries: { id: string; amount: string; currency: string; kind: 'TASK' | 'RL_REVIEW' | 'HOURS' | 'REVERSAL'; taskId: string | null; reason: string | null; earnedAt: string; status: 'PAID' | 'IN_PAYMENT' | 'UNPAID' }[];
  payouts: { id: string; week: string; amount: string; currency: string; status: 'PENDING' | 'HELD' | 'SUBMITTED' | 'PAID' | 'FAILED' | 'RETURNED'; holdReason: string | null; fx: { payoutCurrency: string; rate: string; payoutAmount: string } | null }[];
}

export interface RequisitionView {
  id: string;
  title: string;
  summary: string | null;
  domain: string;
  tier: CertificationCard['tier'];
  tierLabel: string;
  hoursPerWeek: number | null;
  durationWeeks: number | null;
  startDate: string | null;
  languages: string[];
  jurisdictions: string[];
  minimumRequirements: Partial<{ minYears: number; qualifications: string[]; licenceRequired: boolean; notes: string }>;
}

export interface AssessmentItem {
  attemptId: string;
  itemId: string;
  domain: string;
  stem: string;
  rubric: { criterion: string; weight: number }[];
  answer: unknown;
  recommendation?: { score: number; rationale: string; model?: string } | null;
}

export interface ExpertReviewItem {
  id: string;
  competency: string;
  itemType: ItemType;
  stemPattern: string;
  citation: string;
  samples: { stem: string; content: TestItem['content'] }[];
}

/** Candidate-facing wording for each certification state. */
export const CERT_STATE: Record<CertState, [string, string]> = {
  NOT_STARTED: ['Not started', ''],
  IN_TRAINING: ['Course in progress', 'pill-info'],
  TEST_READY: ['Ready for the test', 'pill-info'],
  IN_TEST: ['Test in progress', 'pill-warning'],
  PASSED: ['Certified', 'pill-success'],
  RETAKE_AVAILABLE: ['Retake available', 'pill-warning'],
  REVIEW_REQUIRED: ['With a person for review', 'pill-info'],
  NOT_CERTIFIED: ['Not certified this time', ''],
  EXPIRED: ['Expired', 'pill-warning'],
};

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
