import { TemplateProfileSchema, type ItemField, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthoredForm, FieldValue } from '@/components/forge/task-page';
import { text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * D17 (owner, 16 Nov 2026): the S7 rubric, read-only on the PM/Admin task page, fits the page: only #, Criterion /
 * what is assessed, the score levels, Weight and Critical are columns; technical evaluator fields are in Details (D9);
 * the table scrolls inside its own box. KYC v7 synthetic fixture.
 */
const V7 = JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } };
const PROFILE = TemplateProfileSchema.parse(V7.authoring.profile) as TemplateProfile;
const FIELD = PROFILE.sections.find((s) => s.key === 'S7')!.fields.find((f) => f.type === 'criterion')! as ItemField;
const ITEMS = [
  { id: 'identification_parties', name: 'All parties identified', weight: 5, passCondition: 'Every owner, signer and authorised party is identified with their role', partialCredit: 'Most parties identified', failCondition: 'Parties missed or invented', critical: false, evidenceRefs: ['S5.1'], evaluatorKind: 'golden-kyc-rubric-v1', evaluatorVersion: '1', outputField: '', comparison: '', expectedValue: '' },
  { id: 'decision', name: 'Recommendation', weight: 5, passCondition: 'Matches the evidence and policy', partialCredit: 'Weakly supported', failCondition: '', critical: true, evidenceRefs: [], evaluatorKind: 'golden-kyc-rubric-v1', evaluatorVersion: '1' },
];

describe('D17: read-only rubric table', () => {
  const html = renderToStaticMarkup(<FieldValue field={FIELD} value={ITEMS} />);
  const header = text(html.slice(html.indexOf('<thead'), html.indexOf('</thead>')));

  it('has only the owner’s columns', () => {
    expect(header).toBe('# Criterion · what is assessed Pass · 5 Partial · 2 Fail · 0 Weight Critical');
    for (const technical of ['Evaluator kind', 'Evaluator version', 'Output field', 'Comparison', 'Evidence or rule links', 'Whole-task failure']) expect(header).not.toContain(technical);
    expect((html.match(/<th /g) ?? []).length).toBe(7);
  });

  it('shows each criterion’s text, weight and critical; technical fields only in Details; missing text flagged', () => {
    const t = text(html);
    expect(t).toContain('1 All parties identified identification_parties Details');
    expect(t).toContain('Evaluator kind · from the template golden-kyc-rubric-v1');
    expect(html).toMatch(/<details[^>]*>.*Evaluator kind/s);
    expect(t).toContain('2 Recommendation decision');
    expect(t).toMatch(/Weakly supported Missing 5 Yes/);
  });

  it('scrolls inside its own box on narrow screens; the form leaves room for the floating Help button', () => {
    expect(html).toMatch(/data-criterion-table[^>]*|class="[^"]*overflow-x-auto[^"]*"[^>]*data-criterion-table/);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('table-fixed');
    const form = renderToStaticMarkup(<AuthoredForm profile={PROFILE} output={{ profile: { id: PROFILE.profileId, version: PROFILE.version }, sections: { S7: { criteria: ITEMS } } }} />);
    expect(form).toMatch(/class="pb-24" data-authored-form/);
    expect(form).toContain('<dd class="min-w-0">');
  });
});
