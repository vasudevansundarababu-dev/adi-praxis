import { describe, expect, it, vi } from 'vitest';
import { TemplateActions } from '../components/templates/template-actions';
import { html, template, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** The authoring form a version uses. D-024 (owner, 23 Nov 2026): it comes with the Studio release and is shown read-only, also on a draft. */
describe('template authoring form', () => {
  it('a KYC draft shows its form read-only; Publish stays, New version and editing are gone (D-024)', () => {
    const markup = html(<TemplateActions template={template({ workflowName: 'KYC onboarding and refresh', status: 'DRAFT' })} hasDraft />);
    expect(markup).not.toContain('<select');
    expect(text(markup)).toContain('Authoring form:');
    expect(text(markup)).toContain('(default)');
    expect(text(markup)).toContain('Publish');
    expect(text(markup)).not.toContain('New version');
    expect(text(markup)).toContain('Templates are changed only in Studio.');
    expect(text(html(<TemplateActions template={template({ workflowName: 'KYC onboarding and refresh', status: 'PUBLISHED' })} hasDraft={false} />))).not.toContain('New version');
  });

  it('a published version shows its form read-only', () => {
    const markup = html(<TemplateActions template={template({ workflowName: 'KYC onboarding and refresh', status: 'PUBLISHED', profileId: 'kyc-account-opening' })} hasDraft={false} />);
    expect(markup).not.toContain('<select');
    expect(text(markup)).toContain('Authoring form: KYC account opening (Golden Bank reference)');
  });

  it('a draft with uploaded forms shows its own form read-only', () => {
    const markup = html(<TemplateActions template={template({ workflowName: 'Golden marketing campaign', status: 'DRAFT' })} hasDraft forms={[{ profileId: 'golden-marketing-v1', name: 'Golden marketing form', source: 'uploaded', isDefault: false }]} />);
    expect(markup).not.toContain('<select');
    expect(text(markup)).toContain('Authoring form: Default form');
  });

  it('a workflow with one form shows no choice', () => {
    expect(text(html(<TemplateActions template={template({ workflowName: 'KYB and beneficial ownership', status: 'DRAFT' })} hasDraft />))).not.toContain('Authoring form');
  });

  it('the old Phone (DM03) draft no longer offers a built-in Task2 form: the VEYRA Hush One form arrives in Anvil\'s proposal (13 Nov 2026)', () => {
    const markup = html(<TemplateActions template={template({ status: 'DRAFT' })} hasDraft />);
    expect(markup).not.toContain('value="marketing-campaign-task2"');
    expect(markup).not.toContain('value="veyra-hush-one-launch-v1"');
  });
});
