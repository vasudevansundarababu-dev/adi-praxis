import { describe, expect, it } from 'vitest';
import { queueFlags } from '../src/policy/review-queue';

/**
 * D-094 (owner, 26 Nov 2026): in a policy-library project (KYC Judgment) only questions that matter for the library or
 * the run drive "Answer the open question". The annotation pass's open questions are kept on the rule but no longer
 * flag it there; questions from the AI suggestions (enrichment) still do; every other project is unchanged.
 */
const body = {
  title: 'Teen joint account age',
  requirement: 'A teen joint account is for a minor aged 16 or younger.',
  requirementType: 'obligation',
  visibility: 'agent_visible',
  applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null },
  prerequisites: [],
  exceptions: { kind: 'unknown', items: [] },
  effective: { from: '2026-01-01', to: null, conditionText: null },
  precedence: [],
  evidenceNeeds: [],
  verificationHint: null,
  uncertainty: [],
  condition: null,
  library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } },
  annotation: { version: 1, marking: 'mandatory', appliesWhen: null, why: null, classification: 'obligation', responsibleActor: 'unknown', actorNote: null, applicationTypes: { kind: 'unknown', items: [] }, jurisdictions: { kind: 'unknown', items: [] }, workflowStage: null, deadline: { kind: 'unknown', text: null, measuredFrom: null }, evidence: { status: 'unknown', missing: [] }, links: [], compound: null, openQuestions: ['Which section is "elsewhere"?'] },
};
const item = { rule: { id: 'r1', ruleKey: 'R-TEEN-AGE' }, version: { id: 'v1', contentHash: 'h', body, citations: [{ fieldPath: 'requirement', role: 'supports', resolution: 'RESOLVED', documentVersion: { document: { effectiveFrom: new Date('2026-01-01') } } }] } } as never;
const ctx = (annotationQuestions: boolean, suggestions: { source: string; content: unknown }[] = []) => ({ catalog: null, approvedBefore: new Set<string>(), coverage: new Map(), suggestions: new Map([['v1:h', suggestions]]), approvedDefinitions: new Set<string>(), derivedIds: new Set<string>(), annotationQuestions }) as never;
const codes = (flags: { code: string }[]) => flags.map((f) => f.code);

describe('D-094: which open questions hold a rule back', () => {
  it('a policy-library project: an annotation question alone does not flag the rule', () => {
    expect(codes(queueFlags(item, ctx(false)))).not.toContain('open_question');
  });
  it('a policy-library project: a question from the AI suggestions still flags it', () => {
    const flags = queueFlags(item, ctx(false, [{ source: 'enrichment', content: { question: 'Does this duplicate R-TEEN-AGE-2?' } }]));
    expect(flags.find((f) => f.code === 'open_question')?.message).toBe('Does this duplicate R-TEEN-AGE-2?');
  });
  it('every other project: annotation questions flag the rule as before', () => {
    expect(queueFlags(item, ctx(true)).find((f) => f.code === 'open_question')?.message).toBe('Which section is "elsewhere"?');
  });
});
