import 'server-only';
import { cookies } from 'next/headers';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Server-side call to the partner portal API (`/api/v1/partner-portal/*`). It forwards the browser's cookies, so the
 * partner session cookie `praxis_partner` reaches the API; console and candidate sessions never satisfy these routes.
 */
export async function partnerGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_BASE}/api/v1/partner-portal${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

// ── Response shapes (mirror apps/api/src/routes/partner-portal.ts) ──

export type PartnerMe = {
  user: { id: string; email: string; name: string; mustChangePassword: boolean };
  partner: { id: string; name: string; allowedDomains: string[]; allowedTiers: string[] };
};

export async function getPartnerMe(): Promise<PartnerMe | null> {
  const { data } = await partnerGet<PartnerMe>('/me');
  return data;
}

export type MinimumRequirements = { minYears: number; qualifications: string[]; licenceRequired: boolean; notes: string };

export type GuidelinesSummary = { name: string; taskFamily: string; version: number; sections: string[] };
export type CourseOutline = {
  title: string;
  tier: string;
  tierLabel: string;
  modules: { position: number; title: string }[];
  test: { questions: number; timeLimitMinutes: number; authoringTask: boolean } | null;
};

export type PartnerRequisition = {
  id: string;
  title: string;
  summary: string;
  domain: string;
  tier: string;
  tierLabel: string;
  headcount: number;
  startDate: string | null;
  durationWeeks: number | null;
  hoursPerWeek: number | null;
  location: string | null;
  jurisdictions: string[];
  languages: string[];
  minimumRequirements: MinimumRequirements;
  directChannel: boolean;
  submissionDeadline: string | null;
  maxPerPartner: number | null;
  guidelinesVersion: number | null;
  payRoute: 'DIRECT' | 'VIA_PARTNER';
  state: 'DRAFT' | 'OPEN' | 'PAUSED' | 'FILLED' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  /** Only on the list: live candidates this partner has submitted. */
  submitted?: number;
  /** Present when the API includes the partner-facing guidelines view (the Partner API v1 detail does). */
  guidelinesSummary?: GuidelinesSummary | null;
  courseOutline?: CourseOutline | null;
};

export type CandidateHistoryEntry = { dimension: string; from: string | null; to: string; reason: string | null; at: string };

export type PartnerCandidate = {
  candidateId: string;
  partnerRef: string | null;
  requisitionId: string;
  requisitionTitle?: string;
  name: string;
  channel: string;
  sandbox: boolean;
  duplicateReason: string | null;
  ownerUntil: string | null;
  inviteExpiresAt: string | null;
  inviteAccepted: boolean;
  states: Record<string, string>;
  history: CandidateHistoryEntry[];
  submittedAt: string;
};

export type PartnerStatement = {
  id: string;
  period: string;
  status: string;
  totals: Record<string, string>;
  issuedAt: string;
  lines: {
    candidateId: string | null;
    partnerRef: string | null;
    amount: string;
    currency: string;
    feeTermsVersion: string | null;
    note: string | null;
    reverses: string | null;
    at: string;
  }[];
};

export type PartnerApiClient = {
  id: string;
  clientId: string;
  scopes: string[];
  environment: 'SANDBOX' | 'LIVE';
  rotatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type PartnerWebhook = { id: string; url: string; events: string[]; environment: 'SANDBOX' | 'LIVE'; status: string; createdAt: string };

export type PartnerWebhookDelivery = {
  id: string;
  eventId: string;
  eventType: string;
  url: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  replayOf: string | null;
  createdAt: string;
};
