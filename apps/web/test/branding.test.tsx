import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRAND, FAMILY_NAME, PRODUCT_NAME, pageTitle } from '@praxis/shared/theme';
import { BrandLockup } from '@praxis/shared/ui/brand-lockup';
import { ChecksPanel, EdgeCaseList } from '@praxis/shared/ui/benchmark-checks';
import { templateVerifiers } from '@praxis/shared';

/**
 * Branding (adi-labs-design shared/BRANDING.md; AUTHORING-SPEC 3): every screen and the sign-in page show
 * "[shield] ADI LABS-FORGE │ AUTHORING"; browser tabs read "<Page> · Authoring · ADI Labs Forge".
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('ADI Labs Forge │ Authoring branding', () => {
  it('one product-name constant drives titles', () => {
    expect(PRODUCT_NAME).toBe('Authoring');
    expect(FAMILY_NAME).toBe('ADI Labs Forge');
    expect(pageTitle('Templates')).toBe('Templates · Authoring · ADI Labs Forge');
    for (const f of ['apps/web/app/layout.tsx', 'apps/candidate/app/layout.tsx']) expect(src(f)).toContain("template: '%s · Authoring · ADI Labs Forge'");
  });

  it('the lockup reads ADI LABS-FORGE │ AUTHORING, in the brand colours for each tone', () => {
    const dark = renderToStaticMarkup(<BrandLockup mark={<img alt="" />} />);
    expect(dark).toContain('ADI LABS');
    expect(dark).toContain('-FORGE');
    expect(dark).toContain('Authoring');
    expect(dark).toContain('text-transform:uppercase');
    expect(dark).toContain(BRAND.purpleLight);
    expect(dark).toContain('aria-label="ADI Labs Forge Authoring"');
    const light = renderToStaticMarkup(<BrandLockup tone="light" mark={<img alt="" />} />);
    expect(light).toContain(BRAND.navy);
    expect(light).toContain(BRAND.purple);
  });

  it('both apps’ headers and sign-in pages use the lockup; the shield is the mark and favicon', () => {
    expect(src('apps/web/app/(console)/layout.tsx')).toContain('<NavBrand />');
    expect(src('apps/candidate/components/header.tsx')).toContain('<NavBrand />');
    for (const f of ['apps/web/components/brand.tsx', 'apps/candidate/components/brand.tsx']) expect(src(f)).toContain('BrandLockup');
    expect(src('apps/web/app/login/page.tsx')).toContain('Sign in to Authoring');
    expect(src('apps/candidate/app/sign-in/page.tsx')).toContain('Sign in to Authoring');
    expect(src('packages/shared/theme/theme.css')).toContain('--color-brand-navy: #082044');
    expect(src('packages/shared/theme/theme.css')).toContain('.btn-primary { color: #ffffff; background: #8126af;');
    // The shield replaced the old mark under the same name, so no code path changed.
    expect(readFileSync(path.join(ROOT, 'packages/shared/brand/praxis-mark-512.png')).length).toBeGreaterThan(1000);
  });
});

describe('Studio edge cases and checks, read-only', () => {
  it('lists edge cases and groups checks by criterion with the query beside State checks', () => {
    const edges = renderToStaticMarkup(<EdgeCaseList edgeCases={[{ tag: 'sanctions_dob_mismatch', archetype: 'sanctions_near_match', complexity: 'multi_hop', products: ['individual'], context: 'Applicant applies.', twist: 'DOB differs.', source: 'inb-0045', name: null }]} />);
    expect(edges).toContain('sanctions_dob_mismatch');
    expect(edges).toContain('from inb-0045');
    const v = templateVerifiers({ authoring: { verifiers: { schema: 'adi.verifier-blocks.v1', expected_values_from: 'sme', failure_taxonomy: ['STATE_MUTATION_ERROR', 'POLICY_VIOLATION'], slots: [{ id: 'expected_recommendation', type: 'enum', choices: ['specialist_review'] }], allowed_checks: [], blocks: [{ id: 'decision.status', criterion_id: 'decision', kind: 'state', name: 'Recommendation recorded', table: 'recommendations', row: 'any', column: 'recommendation', op: 'equals', value: { slot: 'expected_recommendation' }, on_fail: 'STATE_MUTATION_ERROR', query_preview: 'SELECT recommendation FROM recommendations' }, { id: 'screening.order', criterion_id: 'screening', kind: 'process', name: 'Screen first', must_call: 'screening.check', before: 'recommend', on_fail: 'POLICY_VIOLATION' }] } } })!;
    const html = renderToStaticMarkup(<ChecksPanel checks={v} values={{ expected_recommendation: 'specialist_review' }} />);
    expect(html).toContain('Criterion decision');
    expect(html).toContain('SELECT recommendation FROM recommendations');
    expect(html).toContain('Must call screening.check before recommend');
    expect(html).toContain('on fail: POLICY_VIOLATION');
    expect(html).toContain('specialist_review');
    expect(html).not.toMatch(/<(input|select|textarea|button)/);
  });
});
