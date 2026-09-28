/** Response shapes of apps/api/src/routes/payments.ts. */

export interface PayoutItemDto {
  id: string;
  smeUserId: string;
  amount: string;
  currency: string;
  entries: number;
  status: string;
  holdReason: string | null;
  providerPaymentRef: string | null;
  fx: { currency?: string; rate?: string | number; amount?: string } | null;
  failureReason: string | null;
}

export interface ReportLine {
  smeUserId: string;
  currency: string;
  amount: string;
  reason: string;
}

export interface PayRunDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  confirmedBy: string | null;
  approvals: { userId: string; at: string; singleApprover: boolean }[] | null;
  totals: Record<string, string> | null;
  report: { held?: ReportLine[]; carried?: ReportLine[] } | null;
  providerBatchRef: string | null;
  submittedAt: string | null;
  items?: PayoutItemDto[];
}

export interface EarningDto {
  id: string;
  smeUserId: string;
  amount: string;
  currency: string;
  kind: string;
  sourceType: string | null;
  sourceId: string | null;
  requisitionId: string | null;
  rateCardVersion: number | null;
  reversesId: string | null;
  reason: string | null;
  earnedAt: string;
}

export interface PayoutExceptionDto {
  id: string;
  reportDate: string;
  kind: string;
  paymentRef: string | null;
  payoutItemId: string | null;
  detail: Record<string, unknown> | null;
  status: 'OPEN' | 'RESOLVED';
  note: string | null;
}

export interface StatementDto {
  id: string;
  partnerId: string;
  period: string;
  status: string;
  totals: Record<string, string> | null;
  issuedAt: string;
  lines: { candidateId: string | null; partnerRef: string | null; amount: string; currency: string; feeTermsVersion: string | null; note: string | null; reverses: string | null; at: string }[];
}

export const totalsText = (t: Record<string, string> | null | undefined) => {
  const e = Object.entries(t ?? {});
  return e.length ? e.map(([c, a]) => `${c} ${a}`).join(' · ') : '—';
};
