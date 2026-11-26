import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDetailsList } from '@/components/policy/library-setup';
import { documentLibraryProblem, documentReady } from '@/components/policy/library-logic';
import { SetupChecklist, checklistSteps, type ChecklistInput } from '@/components/policy/setup-checklist';
import { focusTarget } from '@/components/policy/focus-on-load';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * D-090 and D-092 (owner, 26 Nov 2026): the Policy page opens with a setup checklist (Documents → Facts → AI
 * suggestions → Review → Export), each step done or not with a count and one button, the next step marked; document
 * details (kind, ISO jurisdiction, source, downloaded on, in force from) stay editable. Synthetic data only.
 */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const doc = (over: Record<string, unknown> = {}) => ({ id: 'd1', title: 'Federal KYC policy', jurisdiction: 'US', libraryKind: 'official_text', captureSourceUrl: 'https://example.invalid/f', captureDownloadedOn: '2026-11-20', effectiveFrom: '2026-01-01', ...over });
const base: ChecklistInput = {
  documents: [doc(), doc({ id: 'd2', title: 'California rules', libraryKind: null, jurisdiction: null, effectiveFrom: null }), doc({ id: 'd3', title: 'Bank rules', libraryKind: 'bank_policy', captureSourceUrl: null, captureDownloadedOn: null }), doc({ id: 'd4', title: 'Addendum', libraryKind: 'bank_policy', jurisdiction: 'US-A' })],
  catalog: { version: 1, catalogId: 'kyc-judgment-openenv.facts', facts: 24 },
  drafts: 283,
  draftsWithLibrary: 0,
  enrichment: null,
  counts: { rules: 283, approved: 41, excluded: 0 },
  ready: 3,
  exports: [],
};

describe('setup checklist', () => {
  it('counts each step and marks the first step not done as Next', () => {
    const steps = checklistSteps(base);
    expect(steps.map((s) => [s.key, s.done, s.count])).toEqual([
      ['documents', false, '2 of 4 documents ready'],
      ['facts', true, '24 facts loaded (kyc-judgment-openenv.facts, version 1)'],
      ['ai', false, '0 of 283 drafts have library details'],
      ['review', false, '41 of 283 rules approved · 3 ready to confirm'],
      ['export', false, 'Not exported yet'],
    ]);
    const html = renderToStaticMarkup(<SetupChecklist steps={steps} />);
    const t = text(html);
    expect(t).toContain('Set up the policy library');
    expect((t.match(/Next/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('data-step="documents" data-done="no"');
    expect(html).toContain('href="#documents"');
    expect(html).toContain('href="#review-queue"');
    expect(html).toContain('href="#ai-suggestions"');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says plainly when the AI step has no worker; export is done only when it covers every approved rule', () => {
    expect(checklistSteps({ ...base, enrichment: { status: 'no_worker' } })[2]!.count).toContain('no worker is running');
    const exp = (rules: number) => checklistSteps({ ...base, exports: [{ revision: 2, exportId: 'x', sha256: 'a'.repeat(64), rules, versions: rules, at: '' }] })[4]!;
    expect(exp(41)).toMatchObject({ done: true, count: 'Revision 2 exported (41 rules)' });
    expect(exp(30)).toMatchObject({ done: false, count: 'Revision 2 exported (30 rules) · approvals changed since' });
  });
});

describe('document details (D-090)', () => {
  it('a document is ready with its kind, a real ISO jurisdiction, its source for official text, and an in-force date', () => {
    expect(documentReady(doc())).toBe(true);
    expect(documentReady(doc({ effectiveFrom: null }))).toBe(false);
    expect(documentLibraryProblem(doc({ jurisdiction: 'US-A' }))).toMatch(/not an ISO 3166-2 subdivision of US/);
    expect(documentLibraryProblem(doc({ jurisdiction: 'US-CA' }))).toBeNull();
  });

  it('every detail is editable, including the in-force date, with labelled controls', () => {
    const html = renderToStaticMarkup(<DocumentDetailsList projectId="p" documents={[doc(), doc({ id: 'd4', title: 'Addendum', libraryKind: 'bank_policy', jurisdiction: 'US-A', effectiveFrom: null })]} />);
    const t = text(html);
    for (const l of ['Kind', 'Jurisdiction (US, US-CA)', 'In force from', 'Downloaded from (URL)', 'Downloaded on']) expect(t).toContain(l);
    expect(html).toContain('value="2026-01-01"');
    expect(t).toContain('not an ISO 3166-2 subdivision of US');
    expect(t).toContain('✓ Ready');
    expect(t).toContain('Not ready');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('rule page focus (D-092)', () => {
  it('finds the control for a ?focus= value inside its marked area', () => {
    // A minimal stand-in for the page (the console's unit tests run without a DOM).
    const el = (id: string, control: boolean, inner: unknown = null) => ({ id, matches: () => control, querySelector: () => inner });
    const always = el('always', true);
    const nodes: Record<string, unknown> = { '[data-focus="condition"]': el('wrap', false, always), '[data-focus="library"]': el('kind', true) };
    const root = { querySelector: (s: string) => nodes[s] ?? null } as unknown as ParentNode;
    expect(focusTarget(root, 'condition')?.id).toBe('always');
    expect(focusTarget(root, 'library')?.id).toBe('kind');
    expect(focusTarget(root, 'nothing')).toBeNull();
    expect(focusTarget(root, 'x"] , [y')).toBeNull();
  });
});
