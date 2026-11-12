import { registerProfile } from './registry';
import { ADVERSE_MEDIA_PROFILE } from './profiles/adverse-media-review';
import { AML_PROFILE } from './profiles/aml-transaction-monitoring-alerts';
import { COMPLIANCE_MONITORING_PROFILE } from './profiles/compliance-monitoring';
import { CUSTOMER_RISK_RATING_PROFILE } from './profiles/customer-risk-rating';
import { EDD_PROFILE } from './profiles/enhanced-due-diligence';
import { FRAUD_HANDOFF_PROFILE } from './profiles/fraud-risk-and-compliance-handoffs';
import { KYB_PROFILE } from './profiles/kyb-and-beneficial-ownership';
import { KYC_PROFILE } from './profiles/kyc-onboarding-and-refresh';
import { KYC_ACCOUNT_OPENING_PROFILE } from './profiles/kyc-account-opening';
import { NOISE_CANCELLING_PROFILE } from './profiles/noise-cancelling-phone-launch';
import { OMNICHANNEL_PROFILE } from './profiles/omnichannel-creative-and-locale-compliance';
import { Q4_PAID_SEARCH_PROFILE } from './profiles/q4-global-paid-search-query-clustering';

export * from './schema';
export * from './helpers';
export * from './registry';
export * from './contract';
export { sampleProfileOutput } from './sample';
export * from './golden-pack';
export * from './template-spec';
export { GOLDEN_KYC_EXAMPLE, withRuleVersions } from './golden-kyc-example';
export { KYC_ACCOUNT_OPENING_PROFILE, KYC_V2_TOOLS, KYC_V2_RECOMMENDATIONS, KYC_V2_PRODUCTS, KYC_V2_STATES, KYC_V2_PARTY_ROLES, KYC_V2_SLOTS, KYC_V2_CRITICAL_FAILURES } from './profiles/kyc-account-opening';
export { AML_PROFILE, KYB_PROFILE, KYC_PROFILE, NOISE_CANCELLING_PROFILE, OMNICHANNEL_PROFILE };
export { ADVERSE_MEDIA_PROFILE, CUSTOMER_RISK_RATING_PROFILE, EDD_PROFILE };
export { COMPLIANCE_MONITORING_PROFILE, FRAUD_HANDOFF_PROFILE, Q4_PAID_SEARCH_PROFILE };

/** Wave 1 templates (AUTHORING-V2.1-PLAN §4). */
export const WAVE1_PROFILES = [KYC_PROFILE, KYB_PROFILE, AML_PROFILE, OMNICHANNEL_PROFILE, NOISE_CANCELLING_PROFILE] as const;

/** Wave 2 templates (AUTHORING-V2.1-PLAN §4). */
export const WAVE2_PROFILES = [ADVERSE_MEDIA_PROFILE, EDD_PROFILE, CUSTOMER_RISK_RATING_PROFILE] as const;

/** Wave 3 templates (AUTHORING-V2.1-PLAN §4). */
export const WAVE3_PROFILES = [Q4_PAID_SEARCH_PROFILE, FRAUD_HANDOFF_PROFILE, COMPLIANCE_MONITORING_PROFILE] as const;

/** Every built-in profile, in wave order. */
export const TEMPLATE_PROFILES = [...WAVE1_PROFILES, ...WAVE2_PROFILES, ...WAVE3_PROFILES] as const;

for (const p of TEMPLATE_PROFILES) {
  const r = registerProfile(p);
  if (!r.ok) console.error(`Template profile ${p.profileId} is unsupported: ${r.problems.join('; ')}`);
}

/** Alternate forms a template version may choose (`Template.profileId`). */
export const ALTERNATE_PROFILES = [KYC_ACCOUNT_OPENING_PROFILE] as const;
for (const p of ALTERNATE_PROFILES) {
  const r = registerProfile(p, { alternate: true });
  if (!r.ok) console.error(`Template profile ${p.profileId} is unsupported: ${r.problems.join('; ')}`);
}
export * from './planner';
