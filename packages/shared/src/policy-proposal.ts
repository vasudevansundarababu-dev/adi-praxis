import { z } from 'zod';

/**
 * SME policy proposals (authoring v2.1 Wave 3; docs/authoring/handover-v2/07-POLICY-INGESTION-RAG.md).
 * An SME proposes a document; an assigned Expert or the project's PM/Admin decides. A proposal never becomes
 * authoritative by itself: accepting it adds a project document version whose rules still need extraction,
 * rule review and PM/Admin publication.
 */
export const POLICY_PROPOSAL_CATEGORIES = ['BANK_POLICY', 'CUSTOMER_POLICY', 'REGULATION', 'SUPPORTING_REFERENCE'] as const;
export const POLICY_QUALIFICATIONS = ['POLICY_CANDIDATE', 'SUPPORTING_REFERENCE', 'UNRELATED', 'UNREADABLE', 'SENSITIVE'] as const;
export const POLICY_PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'RETURNED', 'REJECTED'] as const;

export const CATEGORY_LABELS: Record<(typeof POLICY_PROPOSAL_CATEGORIES)[number], string> = {
  BANK_POLICY: 'Bank policy',
  CUSTOMER_POLICY: 'Customer policy',
  REGULATION: 'Regulation or public standard',
  SUPPORTING_REFERENCE: 'Supporting reference',
};

export const QUALIFICATION_LABELS: Record<(typeof POLICY_QUALIFICATIONS)[number], string> = {
  POLICY_CANDIDATE: 'Policy candidate',
  SUPPORTING_REFERENCE: 'Supporting reference',
  UNRELATED: 'Unrelated or not a policy',
  UNREADABLE: 'Unreadable',
  SENSITIVE: 'Sensitive (real data suspected)',
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The form fields sent with the file. Booleans arrive as strings in multipart. */
export const PolicyProposalMeta = z
  .object({
    title: z.string().trim().min(1).max(300),
    category: z.enum(POLICY_PROPOSAL_CATEGORIES),
    issuer: z.string().trim().max(200).nullish(),
    versionLabel: z.string().trim().max(60).nullish(),
    language: z.string().trim().max(20).nullish(),
    jurisdiction: z.string().trim().max(100).nullish(),
    effectiveFrom: date.nullish(),
    effectiveTo: date.nullish(),
    reason: z.string().trim().min(10, 'Say why your task needs this document (at least 10 characters).').max(2000),
    rightsDeclared: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true'),
  })
  .refine((m) => m.rightsDeclared, { message: 'Confirm the document is synthetic or that you may share it.', path: ['rightsDeclared'] })
  .refine((m) => !m.effectiveFrom || !m.effectiveTo || m.effectiveFrom <= m.effectiveTo, { message: 'The end date is before the start date.', path: ['effectiveTo'] });
export type PolicyProposalMeta = z.infer<typeof PolicyProposalMeta>;

/** Accept needs a qualification that can carry rules or context; reject and return need a reason the SME can read. */
export const PolicyProposalDecision = z
  .object({
    decision: z.enum(['ACCEPT', 'RETURN', 'REJECT']),
    qualification: z.enum(POLICY_QUALIFICATIONS),
    reason: z.string().trim().min(5).max(2000),
  })
  .refine((d) => d.decision !== 'ACCEPT' || d.qualification === 'POLICY_CANDIDATE' || d.qualification === 'SUPPORTING_REFERENCE', {
    message: 'Only a policy candidate or a supporting reference can be accepted.',
    path: ['qualification'],
  });
export type PolicyProposalDecision = z.infer<typeof PolicyProposalDecision>;

export interface PolicyIntakeFlag {
  code: 'UNREADABLE' | 'NO_PRESCRIPTIVE_LANGUAGE' | 'LOOKS_LIKE_NON_POLICY' | 'SENSITIVE_DATA_SUSPECTED' | 'INSTRUCTION_TEXT';
  message: string;
}

const PRESCRIPTIVE = /\b(must|shall|is required to|are required to|required|prohibited|must not|may not|should|is not permitted|are not permitted|obliged)\b/gi;
const NON_POLICY: Array<[RegExp, string]> = [
  [/\b(invoice (no|number)|amount due|bill to|remit to)\b/i, 'an invoice'],
  [/\b(account statement|opening balance|closing balance|statement period)\b/i, 'an account statement'],
  [/\b(limited time offer|buy now|subscribe today|special offer)\b/i, 'marketing material'],
];

/**
 * Deterministic intake advice for the reviewer (chapter 07: "a classifier result with reasons; human decision still
 * required"). It never rejects anything: the reviewer sees the flags and decides.
 */
export function policyIntakeFlags(text: string | null, opts: { sensitive: boolean }): PolicyIntakeFlag[] {
  const flags: PolicyIntakeFlag[] = [];
  if (text === null || text.trim().length === 0) {
    flags.push({ code: 'UNREADABLE', message: 'Praxis could not read text from this file (it may be a scan). Check the original.' });
    return flags;
  }
  const prescriptive = (text.match(PRESCRIPTIVE) ?? []).length;
  if (prescriptive < 2) flags.push({ code: 'NO_PRESCRIPTIVE_LANGUAGE', message: `Few or no requirement words (must, shall, required…) were found (${prescriptive}). It may not be a policy.` });
  for (const [re, what] of NON_POLICY) if (re.test(text)) flags.push({ code: 'LOOKS_LIKE_NON_POLICY', message: `Parts of it read like ${what}.` });
  if (opts.sensitive) flags.push({ code: 'SENSITIVE_DATA_SUSPECTED', message: 'Possible real personal or account data was found. Its text is hidden until a reviewer checks the original.' });
  if (/ignore\s+(?:all\s+|previous\s+)?(?:instructions|rules)|you are (?:now )?an? (?:ai|assistant)|system prompt/i.test(text)) {
    flags.push({ code: 'INSTRUCTION_TEXT', message: 'It contains text addressed to an AI model. Document text is treated as data, never as instructions.' });
  }
  return flags;
}
