import { GOLDEN_KYC_EXAMPLE, GOLDEN_MARKETING_EXAMPLE, KYC_ACCOUNT_OPENING_PROFILE, MARKETING_CAMPAIGN_TASK2_PROFILE, getFieldValue, type SectionKey, type TemplateProfile } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuthoredForm, wrapClass } from '@/components/forge/task-page';
import { a11yProblems } from './a11y';
import { text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * D29 (owner, 17 Nov 2026): on the console task (approval) page, the Marketing task's record tables ran past the
 * card's right edge: S4 Applicable rules had 13 columns, 5 of them empty in every row; S2's 64-character checksums
 * could not wrap. Empty columns are now left out and named; long unbroken values wrap; dates never wrap.
 * Golden Marketing (VEYRA Hush One) and KYC examples; synthetic data.
 */
const field = (p: TemplateProfile, section: string, key: string) => p.sections.find((s) => s.key === section)!.fields.find((f) => f.key === key)!;
const table = (m: string, key: string) => m.slice(m.indexOf(`data-record-table="${key}"`), m.indexOf('</table>', m.indexOf(`data-record-table="${key}"`)));
const heads = (m: string) => [...m.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((x) => x[1]);

describe('D29: record tables on the task approval page fit the card', () => {
  const mk = renderToStaticMarkup(<AuthoredForm profile={MARKETING_CAMPAIGN_TASK2_PROFILE} output={GOLDEN_MARKETING_EXAMPLE as Record<string, unknown>} />);

  it('Marketing S4 Applicable rules: columns empty in every row are left out and named under the table', () => {
    const rules = field(MARKETING_CAMPAIGN_TASK2_PROFILE, 'S4', 'policies');
    const rows = getFieldValue(MARKETING_CAMPAIGN_TASK2_PROFILE, GOLDEN_MARKETING_EXAMPLE, 'S4' as SectionKey, rules) as Record<string, unknown>[];
    expect(rows.length).toBe(8);
    const h = heads(table(mk, 'policies'));
    expect(h).toEqual(['#', 'Rule ID', 'Rule version', 'Source page / clause', 'Quotation', 'Applies to step / role', 'Applicability rationale']);
    expect(text(mk)).toContain('Empty in every row, not shown: Conflict or exception.');
  });

  it('as in QA: grading settings go in the row’s Details, rule-version UUIDs are shortened, tables span the card', () => {
    const live = structuredClone(GOLDEN_MARKETING_EXAMPLE) as unknown as { sections: { S4: { policies: Record<string, unknown>[] } } };
    live.sections.S4.policies.forEach((r, i) => Object.assign(r, { ruleVersion: `3f2a9c1${i}-6b4e-4d2a-9f1c-0a7e5b8c4d2${i}`, hardFailure: false, outputField: 'case_outcome', comparison: '', expectedValue: '' }));
    const m = renderToStaticMarkup(<AuthoredForm profile={MARKETING_CAMPAIGN_TASK2_PROFILE} output={live as unknown as Record<string, unknown>} />);
    const t = table(m, 'policies');
    expect(heads(t)).toEqual(['#', 'Rule ID', 'Rule version', 'Source page / clause', 'Quotation', 'Applies to step / role', 'Applicability rationale']);
    expect(t).toContain('<span class="font-mono" title="3f2a9c10-6b4e-4d2a-9f1c-0a7e5b8c4d20">3f2a9c10…</span>');
    expect(text(t)).toContain('POL-01 Details Output field · grading setting case_outcome Hard failure · grading setting No');
    // The table's label and value span both grid columns; a plain value keeps the 12rem label column.
    expect(m).toMatch(/<dt class="font-medium text-fg-muted sm:col-span-2">Applicable rules<\/dt><dd class="min-w-0 sm:col-span-2"><div class="min-w-0" data-record-table="policies">/);
    expect(m).toMatch(/<dt class="font-medium text-fg-muted">Title<\/dt><dd class="min-w-0">/);
    expect(a11yProblems(m)).toEqual([]);
  });

  it('Marketing S2: the checksum wraps anywhere; dates never wrap; ordinary text wraps between words', () => {
    const refs = table(mk, 'sourceRefs');
    expect(refs).toMatch(/\[overflow-wrap:anywhere\][^>]*>1d2efdaa4dcd3f9d1f0818959c4b683590a67bc4e1d3c7b74fc33cd2e195c75c</);
    expect(wrapClass('2027-01-04')).toBe('whitespace-nowrap');
    expect(wrapClass('1d2efdaa4dcd3f9d1f0818959c4b683590a67bc4e1d3c7b74fc33cd2e195c75c')).toContain('[overflow-wrap:anywhere]');
    expect(wrapClass('Offer US-LAUNCH v3: free carry pouch')).toBe('whitespace-pre-wrap break-words');
  });

  it('tables scroll inside their own bordered box on narrow screens, never the page; accessible', () => {
    expect(mk).toContain('max-w-full overflow-x-auto rounded-md border border-hairline');
    expect(mk).not.toContain('min-w-[8rem]');
    expect(a11yProblems(mk)).toEqual([]);
  });

  it('KYC: every column with a value is still shown; nothing is lost', () => {
    const kyc = renderToStaticMarkup(<AuthoredForm profile={KYC_ACCOUNT_OPENING_PROFILE} output={GOLDEN_KYC_EXAMPLE as Record<string, unknown>} />);
    for (const s of KYC_ACCOUNT_OPENING_PROFILE.sections)
      for (const f of s.fields) {
        const v = getFieldValue(KYC_ACCOUNT_OPENING_PROFILE, GOLDEN_KYC_EXAMPLE, s.key as SectionKey, f);
        if (f.type === 'criterion' || !Array.isArray(v) || !v.every((x) => x && typeof x === 'object')) continue;
        const shown = heads(table(kyc, f.key));
        for (const sub of f.itemFields ?? []) {
          const filled = (v as Record<string, unknown>[]).some((r) => r[sub.key] !== undefined && r[sub.key] !== null && r[sub.key] !== '' && !(Array.isArray(r[sub.key]) && (r[sub.key] as unknown[]).length === 0));
          expect(shown.includes(sub.label), `${s.key}.${f.key}.${sub.key}`).toBe(filled);
        }
      }
  });
});
