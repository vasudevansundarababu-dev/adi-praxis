import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LibraryDetailsEditor, libraryForm, libraryBody } from '@/components/policy/library-details';
import { LibrarySetupPanel, documentLibraryProblem } from '@/components/policy/library-setup';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * KYC Judgment v1 console gaps a–d (coordinator, 25 Nov 2026: the PM must never need API calls): (a) the rule page sets
 * the condition and library details; (b) each document's kind, ISO jurisdiction and capture; (c) loading the
 * environment's fact catalog; (d) exporting the policy library (C1) with a download. Synthetic data only.
 */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const BODY = {
  title: 'Taxpayer ID',
  requirement: 'Each U.S. person must give a taxpayer ID.',
  condition: { fact: 'us_person', op: 'eq', value: true },
  library: { kind: 'regulation', issuer: 'federal', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening', customer_types: ['individual'] } },
} as never;

describe('(a) rule page: condition and library details', () => {
  it('turns the body into the form and back; "always" is a null condition; bad JSON or values are named, never saved', () => {
    const f = libraryForm(BODY);
    expect(f).toMatchObject({ kind: 'regulation', issuer: 'federal', jurisdiction: 'US', subject: 'party', process: 'account_opening', customerTypes: ['individual'], always: false });
    expect(JSON.parse(f.condition)).toEqual({ fact: 'us_person', op: 'eq', value: true });
    const back = libraryBody(BODY, f);
    expect(back.problems).toEqual([]);
    expect(back.body).toMatchObject({ condition: { fact: 'us_person', op: 'eq', value: true }, library: { kind: 'regulation', scope: { process: 'account_opening', customer_types: ['individual'] } } });
    expect(libraryBody(BODY, { ...f, always: true }).body).toMatchObject({ condition: null });
    expect(libraryBody(BODY, { ...f, condition: '{not json' }).problems.join(' ')).toContain('The condition is not valid JSON');
    expect(libraryBody(BODY, { ...f, jurisdiction: 'California' }).problems.join(' ')).toContain('ISO code');
    expect(libraryBody(BODY, { ...f, changeKind: 'tightens', changeSummary: '' }).problems.join(' ')).toContain('summary');
    // A change and a scenario-only effect travel when set.
    expect(libraryBody(BODY, { ...f, effectiveMode: 'scenario_only', changeKind: 'tightens', changeSummary: 'Shorter window.' }).body).toMatchObject({ library: { effectiveMode: 'scenario_only', change: { kind: 'tightens', summary: 'Shorter window.' } } });
  });

  it('a rule may define a derived fact (us_person from citizenship alone, Option A); a bad definition is named', () => {
    const f = { ...libraryForm(BODY), definesId: 'us_person', definesDefinition: '{"fact":"citizenship","op":"in","value":["US"]}' };
    expect(libraryBody(BODY, f).body).toMatchObject({ library: { defines: { id: 'us_person', type: 'boolean', definition: { fact: 'citizenship', op: 'in', value: ['US'] } } } });
    expect(libraryBody(BODY, { ...f, definesDefinition: 'nope' }).problems.join(' ')).toContain('The definition is not valid JSON');
    expect(libraryForm({ ...(BODY as object), library: { defines: { id: 'us_person', type: 'boolean', definition: { fact: 'citizenship', op: 'in', value: ['US'] } } } } as never)).toMatchObject({ definesId: 'us_person' });
  });

  it('renders labelled controls and says an approved rule becomes a new draft', () => {
    const html = renderToStaticMarkup(<LibraryDetailsEditor projectId="p" ruleId="r" contentHash={'a'.repeat(64)} body={BODY} approved />);
    const t = text(html);
    expect(t).toContain('Library details');
    expect(t).toContain('Applies always within its process');
    expect(t).toContain('saving makes a new draft version');
    expect(a11yProblems(html)).toEqual([]);
  });
});

describe('(b)–(d) library setup on the Policies page', () => {
  const docs = [
    { id: 'd1', title: 'Federal KYC policy', jurisdiction: 'US', libraryKind: 'official_text', captureSourceUrl: 'https://example.invalid/f', captureDownloadedOn: '2026-11-20' },
    { id: 'd2', title: 'California text', jurisdiction: 'CA', libraryKind: null, captureSourceUrl: null, captureDownloadedOn: null },
  ];
  it('each document shows its kind, jurisdiction and capture, and what C1 still needs', () => {
    expect(documentLibraryProblem(docs[0]!)).toBeNull();
    expect(documentLibraryProblem(docs[1]!)).toBe('Set the kind (official text or bank policy) and an ISO jurisdiction such as US-CA.');
    expect(documentLibraryProblem({ ...docs[1]!, libraryKind: 'official_text', jurisdiction: 'US-CA' })).toBe('An official text needs where and when it was downloaded.');
  });

  it('offers loading the environment’s catalog, exporting the library and downloading each export', () => {
    const html = renderToStaticMarkup(<LibrarySetupPanel projectId="p" documents={docs} catalog={{ version: null, catalogId: null }} exports={[{ revision: 1, exportId: 'plx-1', sha256: 'b'.repeat(64), rules: 12, versions: 14, at: '2026-11-25T12:00:00Z' }]} />);
    const t = text(html);
    expect(t).toContain('Library setup');
    expect(t).toContain('Load the environment’s fact catalog');
    expect(t).toContain('Export policy library (C1)');
    expect(t).toContain('Federal KYC policy');
    expect(t).toContain('Set the kind (official text or bank policy)');
    expect(html).toContain('href="/api/v1/projects/p/policy/library-exports/1"');
    expect(t).toContain('Revision 1 · 12 rules, 14 versions');
    expect(a11yProblems(html)).toEqual([]);
  });
});
