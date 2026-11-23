import { optionPlainLabel, TemplateProfileSchema, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { templateGuide } from '../src/support/authoring-help';
import { TASK_SCOPE_RULES } from '../src/support/assistant';
import { avoidFromRules, ruleCheck } from '../src/tasks/coach/field-coach';

/** D-027 (owner, 23 Nov 2026): every section's help in plain words with examples; "Check this" on the SME's own text. */
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8'));
const raw = structuredClone(V7.authoring.profile);
const s1 = raw.sections.find((s: { key: string }) => s.key === 'S1');
// As in the live Golden KYC v6: complexity and archetype choices whose labels are just their codes.
s1.fields.push({ key: 'complexity', type: 'pick_list', label: 'Complexity', help: 'How many hops the task needs.', options: [{ value: 'single_hop', label: 'single_hop' }, { value: 'multi_hop', label: 'multi_hop' }] });
s1.fields.push({ key: 'archetype', type: 'pick_list', label: 'Archetype', help: 'The kind of situation the task tests.', options: [{ value: 'sanctions_near_match', label: 'sanctions_near_match' }, { value: 'missing_doc', label: 'missing_doc' }, { value: 'policy_conflict', label: 'policy_conflict' }] });
const PROFILE = TemplateProfileSchema.parse(raw) as TemplateProfile;
const S1 = { key: 'S1', title: 'Reusable assignment' };
const trigger = { section: S1, field: { key: 'trigger', label: 'Workflow trigger', help: 'New application or refresh; not one application identifier.', type: 'text' as const } };

describe('plain choices and examples in every section’s help', () => {
  it('the template guide shows plain choices with when to choose them, never codes', () => {
    const guide = templateGuide(PROFILE);
    expect(guide).toContain('Single check (Choose when one document or one check settles it.)');
    expect(guide).toContain('Multi-step (Choose when you must cross-check two or more sources before deciding.)');
    expect(guide).toContain('Possible sanctions match');
    expect(guide).toContain('Missing document or detail');
    expect(guide).toContain('Policy conflict');
    expect(guide).not.toMatch(/single_hop|multi_hop|sanctions_near_match|missing_doc|policy_conflict|adult_joint|teen_joint/);
    expect(optionPlainLabel({ value: 'adult_joint', label: 'adult_joint' })).toBe('Joint account (adults)');
    expect(optionPlainLabel({ value: 'CA', label: 'California' })).toBe('California');
  });

  it('Help is asked for a ready-to-adapt example per field and pointed to Check this', () => {
    const rules = TASK_SCOPE_RULES('TASK_AUTHOR');
    expect(rules).toContain('a short ready-to-adapt example');
    expect(rules).toContain("don't write this");
    expect(rules).toContain('press Check this');
  });
});

describe('Check this (rule-based; the model adds to it when configured)', () => {
  it('flags a case ID, name and date in the S1 trigger and proposes a reusable rewrite', () => {
    const r = ruleCheck(trigger, 'Application APP-999 for "Elena Vance" is submitted on 2026-03-14.');
    expect(r.findings[0]).toMatchObject({ kind: 'too_specific', message: expect.stringContaining('APP-999') });
    expect(r.rewrite).toBe('an application for the applicant is submitted on the application date.'.replace(/^a/, 'A'));
  });

  it('a good trigger passes; vague wording, an empty field and leaked answers are flagged', () => {
    expect(ruleCheck(trigger, 'A new individual checking-account application is submitted online, or an existing customer is due for a periodic KYC refresh.').findings).toEqual([]);
    expect(ruleCheck(trigger, '').findings[0]!.kind).toBe('missing_content');
    expect(ruleCheck({ ...trigger, field: { ...trigger.field, type: 'long_text' } }, 'Check stuff etc.').findings.map((f) => f.kind)).toEqual(['vague', 'vague']);
    expect(ruleCheck({ section: { key: 'S2', title: 'Inputs' }, field: { key: 'brief', label: 'Brief', help: '', type: 'long_text' } }, 'Review the file carefully; the expected outcome is to approve the account without delay.').findings.map((f) => f.kind)).toContain('private_content');
  });

  it('gives "don’t write this" examples from the field’s rules', () => {
    expect(avoidFromRules(trigger, 'KYC')[0]!.why).toContain('every application');
  });
});
