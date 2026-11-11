import { registerProfile } from './registry';
import { AML_PROFILE } from './profiles/aml-transaction-monitoring-alerts';
import { KYB_PROFILE } from './profiles/kyb-and-beneficial-ownership';
import { KYC_PROFILE } from './profiles/kyc-onboarding-and-refresh';
import { NOISE_CANCELLING_PROFILE } from './profiles/noise-cancelling-phone-launch';
import { OMNICHANNEL_PROFILE } from './profiles/omnichannel-creative-and-locale-compliance';

export * from './schema';
export * from './helpers';
export * from './registry';
export * from './contract';
export { sampleProfileOutput } from './sample';
export { AML_PROFILE, KYB_PROFILE, KYC_PROFILE, NOISE_CANCELLING_PROFILE, OMNICHANNEL_PROFILE };

/** Wave 1 templates (AUTHORING-V2.1-PLAN §4). */
export const WAVE1_PROFILES = [KYC_PROFILE, KYB_PROFILE, AML_PROFILE, OMNICHANNEL_PROFILE, NOISE_CANCELLING_PROFILE] as const;

for (const p of WAVE1_PROFILES) {
  const r = registerProfile(p);
  if (!r.ok) console.error(`Template profile ${p.profileId} is unsupported: ${r.problems.join('; ')}`);
}
export * from './planner';
