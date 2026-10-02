import type { RequisitionState, SmeTier } from '@praxis/shared';

/** Response shapes of the M10 internal API (apps/api/src/routes/supply-internal.ts). */

export interface PartnerContact {
  name: string;
  email: string;
  role?: string;
}

export interface PartnerRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  businessVerification: 'PENDING' | 'VERIFIED' | 'REJECTED';
  contacts: PartnerContact[];
  allowedDomains: string[];
  allowedTiers: SmeTier[];
  feeTermsVersion: string | null;
  createdAt: string;
  users?: number;
  clients?: number;
  submissions?: number;
}

export interface PartnerDetail extends Omit<PartnerRow, 'users' | 'clients' | 'submissions'> {
  users: { id: string; email: string; name: string; status: string; mustChangePassword: boolean; lastLoginAt: string | null }[];
  clients: { id: string; clientId: string; scopes: string[]; environment: string; rotatedAt: string | null; revokedAt: string | null; createdAt: string }[];
  webhooks: { id: string; url: string; events: string[]; environment: string; status: string }[];
}

export interface RequisitionDto {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  summary: string;
  domain: string;
  tier: SmeTier;
  tierLabel: string;
  headcount: number;
  startDate: string | null;
  durationWeeks: number | null;
  hoursPerWeek: number | null;
  location: string | null;
  jurisdictions: string[];
  languages: string[];
  minimumRequirements: { minYears: number; qualifications: string[]; licenceRequired: boolean; notes: string };
  allowedPartnerIds: string[];
  directChannel: boolean;
  submissionDeadline: string | null;
  maxPerPartner: number | null;
  guidelinesPackageId: string | null;
  guidelinesVersion: number | null;
  rateCardId: string | null;
  payRoute: 'DIRECT' | 'VIA_PARTNER';
  state: RequisitionState;
  createdAt: string;
  updatedAt: string;
  submissions?: number;
  counts?: Record<string, number>;
}

export interface SubmissionRow {
  id: string;
  name: string;
  email: string;
  country: string | null;
  partner: { id: string; name: string } | null;
  channel: string;
  state: string;
  screen: string;
  screenReasons: string[] | null;
  duplicateReason: string | null;
  inviteAccepted: boolean;
  submittedAt: string;
}

export interface GuidelinesPackageRow {
  id: string;
  domain: string;
  taskFamily: string;
  name: string;
  versions: { id: string; version: number; status: string; publishedTiers: SmeTier[]; major: boolean; createdAt: string }[];
}

export interface RateCardRow {
  id: string;
  name: string;
  version: number;
  currency: 'USD' | 'INR';
  perTask: Partial<Record<'AUTHORING' | 'ANNOTATION' | 'RL_REVIEW', string>>;
  hourlyRate: string | null;
  weeklyCap: string | null;
  createdAt: string;
}
