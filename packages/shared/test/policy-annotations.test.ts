import { describe, expect, it } from 'vitest';
import {
  PolicyRuleBody, RuleAnnotation, annotationFlags, annotationText, isOpenClarification, ruleApplicability,
} from '../src';

/** Policy rule annotations: shared schema, applicability per application (AC9), flags (AC8), contract file. */
const ann = (over: Partial<RuleAnnotation> = {}) => RuleAnnotation.parse({ classification: 'obligation', marking: 'mandatory', appliesWhen: 'Always, within the workflow scope', why: 'Required.', responsibleActor: 'agent', applicationTypes: { kind: 'all', items: [] }, jurisdictions: { kind: 'listed', items: ['US'] }, deadline: { kind: 'none' }, evidence: { status: 'stated' }, ...over });

describe('ruleApplicability: from the application’s own attributes (AC9)', () => {
  const caJoint = ann({ marking: 'mandatory_when_applicable', applicationTypes: { kind: 'listed', items: ['adult_joint', 'teen_joint'] }, jurisdictions: { kind: 'listed', items: ['US-CA'] } });
  const nyOnly = ann({ jurisdictions: { kind: 'listed', items: ['US-NY'] } });
  const federal = ann();

  it('a California Joint application gets the Joint requirements and California rules, whatever state the examples use', () => {
    const app = { applicationType: 'adult_joint', governingState: 'CA' };
    expect(ruleApplicability(caJoint, app)).toBe('trigger_to_check');
    expect(ruleApplicability(federal, app)).toBe('applies');
    expect(ruleApplicability(nyOnly, app)).toBe('out_of_scope');
    // The same rules for a New York individual: the California joint rule is out of scope, federal still applies.
    expect(ruleApplicability(caJoint, { applicationType: 'individual', governingState: 'NY' })).toBe('out_of_scope');
    expect(ruleApplicability(federal, { applicationType: 'individual', governingState: 'US-NY' })).toBe('applies');
  });

  it('unknown scope or missing application facts stay unknown, never out of scope', () => {
    expect(ruleApplicability(ann({ jurisdictions: { kind: 'unknown', items: [] } }), { applicationType: 'adult_joint', governingState: 'CA' })).toBe('unknown');
    expect(ruleApplicability(caJoint, { applicationType: 'adult_joint', governingState: null })).toBe('unknown');
    expect(ruleApplicability(undefined, { applicationType: 'adult_joint', governingState: 'CA' })).toBe('unknown');
    expect(ruleApplicability(ann({ marking: 'needs_clarification' }), { applicationType: 'individual', governingState: 'CA' })).toBe('unknown');
  });

  it('distinguishes other roles, permitted options and effective dates', () => {
    expect(ruleApplicability(ann({ marking: 'other_responsibility', responsibleActor: 'bank_operations' }), { applicationType: 'individual', governingState: 'TX' })).toBe('other_role');
    expect(ruleApplicability(ann({ marking: 'permitted_option' }), { applicationType: 'individual', governingState: 'TX' })).toBe('trigger_to_check');
    expect(ruleApplicability(federal, { applicationType: 'individual', governingState: 'TX', asOfDate: '2025-06-01' }, { from: '2026-01-01', to: null })).toBe('out_of_scope');
  });
});

describe('flags and text (AC8)', () => {
  it('lists unknown details, clarification, open questions, duplicates and unresolved links', () => {
    const a = ann({ classification: 'unresolved', marking: 'needs_clarification', appliesWhen: null, responsibleActor: 'unknown', deadline: { kind: 'unknown', text: null, measuredFrom: null }, openQuestions: ['Which ID list applies?'], links: [{ ruleKey: 'R-X', relation: 'duplicate_of', note: null }, { ruleKey: 'R-DEF', relation: 'uses_definition', note: null }] });
    const f = annotationFlags(a, { known: new Set(['R-X']) });
    expect(f.map((x) => x.code)).toEqual(['UNKNOWN_FIELD', 'NEEDS_CLARIFICATION', 'OPEN_QUESTION', 'DUPLICATE', 'UNRESOLVED_LINK']);
    expect(f[0]!.message).toBe('Unknown: classification, when it applies, responsible actor, deadline.');
    expect(annotationFlags(undefined)[0]!.code).toBe('NOT_ANNOTATED');
    expect(isOpenClarification(a)).toBe(true);
  });

  it('writes a readable explanation from the structured fields, saying what is unknown', () => {
    expect(annotationText(ann({ marking: 'mandatory_when_applicable', appliesWhen: 'A foreign passport is selected for the identification route', why: 'Accepting the passport is permitted; “only with” makes the check compulsory.' }))).toContain('marked Mandatory when applicable. Applies when: A foreign passport is selected');
    expect(annotationText(null)).toContain('Treat applicability as unknown');
  });

  it('a body without an annotation parses without one (old hashes and digests stay the same)', () => {
    const b = PolicyRuleBody.parse({ title: 'T', requirement: 'R' });
    expect(Object.keys(b)).not.toContain('annotation');
  });
});
