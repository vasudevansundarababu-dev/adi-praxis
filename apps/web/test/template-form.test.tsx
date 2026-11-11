import { describe, expect, it, vi } from 'vitest';
import { TemplateActions } from '../components/templates/template-actions';
import { html, template, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** KYC template version 2 (owner, 11 Nov 2026): the Admin chooses the authoring form on a draft version. */
describe('template authoring form', () => {
  it('a KYC draft offers the default workbench and the account-opening form', () => {
    const markup = html(<TemplateActions template={template({ workflowName: 'KYC onboarding and refresh', status: 'DRAFT' })} hasDraft />);
    expect(text(markup)).toContain('Authoring form');
    expect(markup).toContain('value="kyc-account-opening"');
    expect(text(markup)).toContain('KYC account opening (Golden Bank reference)');
    expect(text(markup)).toContain('(default)');
  });

  it('a published version shows its form read-only', () => {
    const markup = html(<TemplateActions template={template({ workflowName: 'KYC onboarding and refresh', status: 'PUBLISHED', profileId: 'kyc-account-opening' })} hasDraft={false} />);
    expect(markup).not.toContain('<select');
    expect(text(markup)).toContain('Authoring form: KYC account opening (Golden Bank reference)');
  });

  it('a workflow with one form shows no choice', () => {
    expect(text(html(<TemplateActions template={template({ status: 'DRAFT' })} hasDraft />))).not.toContain('Authoring form');
  });
});
