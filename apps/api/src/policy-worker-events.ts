/**
 * D-089 (26 Nov 2026): the policy worker's scope. It dispatches only these outbox events, onto its own queue, so it
 * never takes (and silently completes) an event another handler in the full worker owns, and it runs none of the full
 * worker's maintenance (bundle-deletion sweep, dataset verification, supply and pay jobs).
 */
export const POLICY_EVENT_NAMES: readonly string[] = ['policy.extraction_requested', 'policy.annotation_requested', 'policy.enrichment_requested'];
export const POLICY_EVENTS_QUEUE = 'policy-events';
