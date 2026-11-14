/**
 * Synthetic SME personas for QA (owner, 14 Nov 2026: "get 10-15 profiles which match the requirement" for the KYC and
 * Marketing tasks). Every person, employer type and history here is invented: no real people or employers. Names keep
 * the `SYNTHETIC QA` prefix so they are never mistaken for real applicants.
 *
 * Answers go through the same profile form a real candidate uses; the assessment and the Reviewer's decision still run.
 */
export type Track = 'KYC' | 'MARKETING';

export interface Persona {
  email: string;
  name: string;
  track: Track;
  country: string;
  timezone: string;
  /**
   * Profile form answers by field key (FIELD_DEFS); `criterion` answers every published-requirement question. Choice
   * questions keep only the values that are among their options (exact strings), so lists mix option values with
   * free-text detail used when the question is open. Unlisted fields fall back to a neutral synthetic answer.
   */
  fields: Record<string, string | number | string[]>;
  role: { title: string; employerType: string; start: string };
}

/** Which track a template belongs to, from its workflow and domain names; null when neither fits. */
export function trackOf(workflowName: string, domainName: string): Track | null {
  const s = `${workflowName} ${domainName}`;
  if (/\bkyc\b|know your customer|customer due diligence|\bcdd\b|\baml\b/i.test(s)) return 'KYC';
  if (/marketing|campaign|brand/i.test(s)) return 'MARKETING';
  return null;
}

/** Exact option values of the default banking question policy (packages/shared profile.ts). */
const KYC_OPTIONS = ['KYC / onboarding', 'Enhanced due diligence', 'Sanctions review', 'Compliance testing'];
const STATE_NAME: Record<string, string> = { CA: 'California', NY: 'New York', TX: 'Texas', FL: 'Florida', IL: 'Illinois' };

const kyc = (n: number, state: string, tz: string, title: string, years: number, focus: string[], segments: string[], example: string, employerType: string, authority: string[]): Persona => ({
  email: `kyc${String(n).padStart(2, '0')}@praxis.test`,
  name: `SYNTHETIC QA KYC SME ${String(n).padStart(2, '0')} (${state})`,
  track: 'KYC',
  country: 'US',
  timezone: tz,
  fields: {
    specialties: [...KYC_OPTIONS, ...focus],
    compliance_areas: [...KYC_OPTIONS, 'Customer Identification Program (31 CFR 1020.220)', 'Beneficial ownership (31 CFR 1010.230)', 'OFAC screening'],
    domain_years: years,
    specialty_years: Math.max(3, years - 2),
    decision_authority: authority,
    jurisdictions: ['United States', `US-${state}`, STATE_NAME[state]!],
    criterion: `${title}, about ${years} years in US bank KYC (${STATE_NAME[state]}): CIP, beneficial ownership, CDD and EDD, OFAC screening. For example: ${example}`,
    customer_segments: segments,
    work_example: example,
    escalation_boundaries: 'Missing or inconsistent identity evidence goes back to the customer as a request for information; sanctions hits, PEP matches and unclear ownership go to the BSA Officer the same day.',
    quality_checks: 'Four-eyes review on high-risk files, monthly QA sampling against the bank procedure, and findings tracked to closure.',
    tools_methods: ['Core banking onboarding workflow', 'Sanctions screening tool', 'Documentary and non-documentary ID checks', 'Risk rating model'],
    contribution_roles: ['TASK_AUTHOR'],
    evidence_available: 'Synthetic QA account: no evidence files.',
    hours_per_week: 20,
    start_availability: 'Immediately',
    conflicts: 'None. Synthetic QA account.',
  },
  role: { title, employerType, start: `${2026 - years}-01` },
});

const mkt = (n: number, title: string, years: number, focus: string[], segments: string[], example: string, authority: string[]): Persona => ({
  email: `mkt${String(n).padStart(2, '0')}@praxis.test`,
  name: `SYNTHETIC QA Marketing SME ${String(n).padStart(2, '0')}`,
  track: 'MARKETING',
  country: 'US',
  timezone: 'America/Chicago',
  fields: {
    specialties: ['Marketing campaign planning', ...focus],
    compliance_areas: ['Claims substantiation review', 'Consent and opt-out handling (CAN-SPAM, TCPA)', 'Brand and legal sign-off'],
    domain_years: years,
    specialty_years: Math.max(3, years - 2),
    decision_authority: authority,
    jurisdictions: ['United States'],
    criterion: `${title}, about ${years} years in US consumer marketing: campaign briefs, channel plans, claims review and results tracking. For example: ${example}`,
    customer_segments: segments,
    work_example: example,
    escalation_boundaries: 'Unsupported claims, missing consent records or regulated-product wording go to legal review before anything ships.',
    quality_checks: 'Pre-launch checklist, peer review of copy and targeting, and post-campaign results against the agreed KPIs.',
    tools_methods: ['Campaign brief and channel plan', 'A/B testing', 'Marketing analytics dashboards', 'Audience segmentation'],
    contribution_roles: ['TASK_AUTHOR'],
    evidence_available: 'Synthetic QA account: no evidence files.',
    hours_per_week: 20,
    start_availability: 'Immediately',
    conflicts: 'None. Synthetic QA account.',
  },
  role: { title, employerType: 'Synthetic consumer brand', start: `${2026 - years}-01` },
});

export const PERSONAS: Persona[] = [
  kyc(1, 'CA', 'America/Los_Angeles', 'KYC Operations Manager', 12, ['Elder financial abuse escalation'], ['Retail deposit accounts', 'Joint and custodial accounts'], 'Opening a joint checking account for two adults where one ID is expired: verify both holders, request a current ID, and record the decision against the CIP rule.', 'Synthetic regional bank', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  kyc(2, 'CA', 'America/Los_Angeles', 'Senior EDD Analyst', 9, ['Enhanced due diligence', 'Cannabis-related business review'], ['Small business accounts', 'Money services businesses'], 'A cash-intensive small business with an LLC owner: identify every 25% owner and the control person, rate the risk, and decide whether EDD applies.', 'Synthetic community bank', ['Prepared cases', 'Reviewed others’ work']),
  kyc(3, 'NY', 'America/New_York', 'AML Compliance Officer', 15, ['Transaction-monitoring investigation', 'NYDFS Part 504 controls'], ['Commercial accounts', 'Correspondent relationships'], 'A new commercial client with wires to a high-risk jurisdiction: screen owners against OFAC, set the risk rating and escalate for senior approval.', 'Synthetic money-center bank', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  kyc(4, 'NY', 'America/New_York', 'KYC Refresh Team Lead', 8, ['Periodic KYC refresh'], ['Private banking', 'Trust accounts'], 'Refreshing a trust account whose trustee changed: re-verify the new trustee, update beneficial ownership and note what evidence is still missing.', 'Synthetic private bank', ['Prepared cases', 'Reviewed others’ work']),
  kyc(5, 'TX', 'America/Chicago', 'Branch Operations Manager', 11, ['Customer onboarding', 'Foreign national onboarding'], ['Retail deposit accounts', 'Foreign national customers'], 'A foreign national with a passport and no US address opens a savings account: apply documentary plus non-documentary checks and record the reason for the account.', 'Synthetic regional bank', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  kyc(6, 'FL', 'America/New_York', 'BSA/AML Analyst', 7, ['CTR and structuring review', 'Real-estate LLC onboarding'], ['LLC real-estate purchasers', 'Small business accounts'], 'An LLC buying residential property in cash: identify every 10% owner, record the source of funds and decide whether the case needs a CTR or escalation.', 'Synthetic community bank', ['Prepared cases', 'Reviewed others’ work']),
  kyc(7, 'IL', 'America/Chicago', 'KYC Quality Assurance Lead', 10, ['Quality assurance testing', 'Biometric ID check governance'], ['Retail deposit accounts', 'Minor and custodial accounts'], 'A custodial account for a minor opened by a guardian: verify the guardian under CIP, confirm authority, and check the biometric consent record before the face match.', 'Synthetic Chicago-based bank', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  kyc(8, 'IL', 'America/Chicago', 'Commercial Onboarding Specialist', 13, ['Beneficial ownership', 'Currency exchange onboarding'], ['Commercial accounts', 'Money services businesses'], 'A currency exchange business applies for an operating account: confirm state licensing, identify owners, rate the risk high and set monitoring conditions.', 'Synthetic Chicago-based bank', ['Prepared cases', 'Reviewed others’ work']),
  mkt(1, 'Campaign Marketing Manager', 10, ['Email and lifecycle marketing'], ['Consumer retail', 'Subscription products'], 'A spring email campaign for a subscription product: segment the list, write two subject-line variants, check opt-out and claims wording, and set the success metric.', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  mkt(2, 'Brand Marketing Lead', 12, ['Brand positioning', 'Product launch'], ['Consumer packaged goods'], 'Launching a new snack line: write the positioning statement, pick channels, and route every health claim through substantiation before sign-off.', ['Prepared cases', 'Reviewed others’ work']),
  mkt(3, 'Performance Marketing Specialist', 7, ['Paid search and social', 'Marketing analytics'], ['E-commerce', 'Direct-to-consumer brands'], 'A paid social test with a fixed budget: define audiences, set the A/B split, pick the KPI and decide when to stop the losing variant.', ['Approved outcomes', 'Reviewed others’ work', 'Advised the team']),
  mkt(4, 'Content Marketing Strategist', 8, ['Content strategy', 'Regulated-industry marketing'], ['Financial services', 'Healthcare'], 'A blog and social series for a bank product: plan the topics, keep rate and fee statements accurate, and send product claims to compliance.', ['Prepared cases', 'Reviewed others’ work']),
];

export const personaByEmail = (email: string) => PERSONAS.find((p) => p.email === email.toLowerCase());
