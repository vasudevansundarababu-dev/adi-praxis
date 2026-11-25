import { ANNOTATION_ACTIONS } from './annotate-job';
import { ENRICHMENT_ACTIONS } from './enrich';

/** Audit actions that count as one policy-assistant run toward the tenant's daily cap (POLICY_AI_DAILY_CALL_CAP). */
export const POLICY_AI_ACTIONS: string[] = ['policy.rule_suggestions_requested', 'policy.rule_ai_defined', ANNOTATION_ACTIONS.suggested, ANNOTATION_ACTIONS.failed, ENRICHMENT_ACTIONS.suggested, ENRICHMENT_ACTIONS.failed];
