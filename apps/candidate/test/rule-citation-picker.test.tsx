import { emptyOutput, MARKETING_CAMPAIGN_TASK2_PROFILE, TemplateProfileSchema, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryView } from '@/components/work/policy-picker';
import { ProfileEditor } from '@/components/work/profile-editor';
import { RuleCitationPicker, citationFromRule, locatorText, ruleOf } from '@/components/work/rule-citation-picker';
import type { TaskView } from '@/lib/work-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * D21 (QA, 16 Nov 2026): S4 "Applicable rules" on a form that cites rules (the shared `policy_citation` field, e.g.
 * Marketing) lets the author pick the project's published rules: exact rule version, quotation and locator come from
 * the library and can't be typed. KYC v7's document picker is unchanged. Synthetic library; no network.
 */
const MKT = MARKETING_CAMPAIGN_TASK2_PROFILE as TemplateProfile;
const S4 = MKT.sections.find((s) => s.key === 'S4')!;
const field = S4.fields.find((f) => f.type === 'policy_citation')!;
const V7 = TemplateProfileSchema.parse((JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } }).authoring.profile) as TemplateProfile;
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const LIB: LibraryView = {
  setVersion: 1,
  documents: [
    {
      documentVersionId: 'dv1',
      title: 'Veyra campaign rules',
      jurisdiction: null,
      category: 'Company rules',
      effectiveFrom: null,
      policyId: 'doc-1',
      version: 'rs1.d1',
      publicationRef: 'project rule set v1',
      sha256: 'c'.repeat(64),
      rules: [
        { ruleKey: 'R-POL-01', ruleVersionId: 'rv-1', title: 'SKU evidence', requirement: 'Claims need exact SKU evidence.', marking: 'Mandatory', appliesWhen: null, quote: 'Claims need exact SKU evidence.', locator: { page: 1, line: 2 } },
        { ruleKey: 'R-POL-13', ruleVersionId: 'rv-13', title: 'Corpus is not demand', requirement: 'Corpus counts are not demand.', marking: null, appliesWhen: null, quote: null, locator: null },
      ],
    },
  ],
};
const noteInput = (sub: { key: string }, item: Record<string, unknown>) => <textarea aria-label={sub.key} defaultValue={String(item[sub.key] ?? '')} />;

describe('S4 rule picker (D21)', () => {
  it('builds a citation from a published rule: key, exact version, locator and quotation from the library', () => {
    const doc = LIB.documents[0]!;
    expect(citationFromRule(field, doc, doc.rules[0]!)).toMatchObject({ ruleId: 'R-POL-01', ruleVersion: 'rv-1', locator: 'Veyra campaign rules · page 1 · line 2', quote: 'Claims need exact SKU evidence.', rationale: '', hardFailure: false });
    // No quotation or locator in the library: the requirement and the document title stand in (never typed).
    expect(citationFromRule(field, doc, doc.rules[1]!)).toMatchObject({ ruleVersion: 'rv-13', locator: 'Veyra campaign rules', quote: 'Corpus counts are not demand.' });
    expect(locatorText('section 3.2', 'Doc')).toBe('Doc · section 3.2');
    expect(ruleOf(LIB, { ruleVersion: 'rv-13' })?.rule.ruleKey).toBe('R-POL-13');
    expect(ruleOf(LIB, { ruleVersion: 'typed-by-hand' })).toBeNull();
  });

  it('shows picked rules read-only and only the notes as editable; a typed rule is flagged to pick again', () => {
    const picked = citationFromRule(field, LIB.documents[0]!, LIB.documents[0]!.rules[0]!);
    const html = renderToStaticMarkup(<RuleCitationPicker taskId="t" field={field} value={[picked, { ruleId: 'PR1', ruleVersion: 'v1', locator: 'section 3.2', quote: 'typed' }]} onChange={() => undefined} readOnly={false} initialLibrary={LIB} renderNote={noteInput} />);
    const t = text(html);
    expect(t).toContain('Add rule');
    expect(t).toContain('SKU evidence Published');
    expect(t).toContain('Rule version 🔒 rv-1 (rule set v1)');
    expect(t).toContain('Quotation 🔒 Claims need exact SKU evidence.');
    expect(t).toContain('Not in the project’s library Pick it again from the library');
    expect(html).not.toMatch(/aria-label="(ruleId|ruleVersion|locator|quote)"/);
    expect(html).toMatch(/aria-label="rationale"/);
  });

  it('empty state: no published rules, nothing to type', () => {
    const t = text(renderToStaticMarkup(<RuleCitationPicker taskId="t" field={field} value={[]} onChange={() => undefined} readOnly={false} initialLibrary={{ setVersion: null, documents: [] }} renderNote={noteInput} />));
    expect(t).toContain('This project has no published rules yet.');
    expect(t).not.toContain('Add rule');
  });
});

describe('the S4 picker each form gets', () => {
  const task = (profile: TemplateProfile, formV2: boolean): TaskView =>
    ({ id: '00000000-0000-4000-8000-000000000011', status: 'IN_PROGRESS', taskType: 'AUTHORING', brief: null, isOpenSlot: false, assignedAt: null, submittedAt: null, activeSeconds: 0, revision: 1, projectId: 'p', projectName: 'Synthetic', tptMinutes: 45, definition: 'generic', template: { workflow: profile.catalogWorkflowName, domain: 'Marketing', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null }, input: {}, output: emptyOutput(profile), coverageTags: null, checks: null, readOnly: false, review: null, formV2 }) as TaskView;
  const s4 = (profile: TemplateProfile, formV2: boolean) => renderToStaticMarkup(<ProfileEditor task={task(profile, formV2)} profile={profile} onSubmitted={() => undefined} initialSection={profile.sections.findIndex((s) => s.key === 'S4')} initialRubric={null} initialLibrary={LIB} />);

  it('Marketing: the project’s published rules to pick, not typed rows', () => {
    const html = s4(MKT, true);
    expect(html).toContain('data-rule-picker');
    expect(text(html)).toContain('Add rule');
    expect(html).not.toContain('data-policy-picker');
  });

  it('KYC v7 keeps its document picker (“Add policy”); with the flag off the form is unchanged', () => {
    const v7 = s4(V7, true);
    expect(v7).toContain('data-policy-picker');
    expect(v7).not.toContain('data-rule-picker');
    expect(s4(MKT, false)).not.toContain('data-rule-picker');
  });
});
