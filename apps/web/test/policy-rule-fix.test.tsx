import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EDIT_FORM_FIELDS, FIX_ANCHOR, FLAG_FIELDS, fixItems, questionField, splitQuestions, stillMissing, type FixField } from '@/components/policy/fix-logic';
import { FixList, NextProblemBar } from '@/components/policy/fix-nav';
import { LibraryDetailsEditor } from '@/components/policy/library-details';

/**
 * Owner, 27 Nov 2026: "highlight the fix next to the field … 12 mins is going on scrolling down". Every flag the review
 * queue can raise maps to a field on the rule page, each field has its anchor, and the hint goes away once it is fixed.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const flag = (code: string, message = 'msg') => ({ code, message });
const EXAMPLES: Record<string, { code: string; message: string }> = {
  condition_not_set: flag('condition_not_set'),
  condition_invalid: flag('condition_invalid', 'Unknown fact "xyz".'),
  condition_not_quoted: flag('condition_not_quoted'),
  library_incomplete: flag('library_incomplete', 'Missing for the policy library: kind, issuer, jurisdiction, subject, scope.'),
  no_effective_date: flag('no_effective_date'),
  not_ready: flag('not_ready', 'Add the requirement.'),
  change_missing: flag('change_missing'),
  definition_not_approved: flag('definition_not_approved', 'This rule depends on us_person, whose definition rule is not approved yet.'),
  coverage_: flag('coverage_unsupported', 'Studio (env-1): unsupported.'),
  open_question: flag('open_question', 'Which jurisdiction does this cover? Does it apply when the account is opened remotely?'),
  needs_review: flag('needs_review', 'Is this a duplicate of R-TEEN-AGE?'),
  outside_scope: flag('outside_scope', 'This is about lending.'),
};
const NOT_READY_MESSAGES = [
  'Add the requirement.',
  'Choose whether this is an obligation, prohibition, permission or definition.',
  'Define where the rule applies, or mark it as applying everywhere.',
  'Set the effective scope (a date, or "always" in the condition).',
  'Link the requirement to a quote found in the source document.',
  'Link the applicability condition to a source quote.',
  'Link the listed exceptions to a source quote.',
];
const BODY = { title: 'T', requirement: 'R', requirementType: 'obligation', condition: undefined, library: {} } as unknown as import('@praxis/shared').PolicyRuleBody;

describe('flag → field map', () => {
  it('every flag code the queue raises maps to fields that each have an anchor on the rule page', () => {
    for (const [code, f] of Object.entries(EXAMPLES)) {
      const items = fixItems({ queueFlags: [f], body: { library: {} } });
      expect(items.length, code).toBeGreaterThan(0);
      for (const i of items) {
        expect(FLAG_FIELDS[code], code).toContain(i.field);
        expect(FIX_ANCHOR[i.field], `${code} → ${i.field}`).toMatch(/^[a-z-]+$/);
        expect(i.hint.length, code).toBeGreaterThan(10);
      }
    }
    expect(Object.keys(FLAG_FIELDS).sort()).toEqual(Object.keys(EXAMPLES).sort());
  });

  it('library_incomplete gives one item per part the server lists as missing, and a bad jurisdiction its own', () => {
    const items = fixItems({ queueFlags: [flag('library_incomplete', 'Missing for the policy library: issuer, subject, scope. XX is not a country.')], body: { library: { kind: 'policy', jurisdiction: 'XX' } as never } });
    expect(items.map((i) => i.field)).toEqual(['issuer', 'jurisdiction', 'subject', 'process']);
    expect(items.find((i) => i.field === 'jurisdiction')!.label).toBe('Jurisdiction is not a real code');
    const missing = fixItems({ queueFlags: [flag('library_incomplete', 'Missing for the policy library: jurisdiction.')], body: { library: { kind: 'policy', issuer: 'bank', subject: 'party', scope: { process: 'account_opening' } } as never } });
    expect(missing).toEqual([expect.objectContaining({ field: 'jurisdiction', hint: 'Jurisdiction is missing. Enter US for federal or bank rules, or US-CA for California.' })]);
  });

  it('every server check message behind not_ready maps to its own field (not the status card)', () => {
    const items = fixItems({ queueFlags: [flag('not_ready', NOT_READY_MESSAGES.join(' '))], definitionProblems: NOT_READY_MESSAGES.slice(0, 4), evidenceProblems: NOT_READY_MESSAGES.slice(4), body: { library: {} } });
    expect(items.map((i) => i.field).sort()).toEqual(['applies', 'effective', 'quotes', 'quotes', 'quotes', 'requirement', 'type'].sort());
  });

  it('the condition-quote problem says it in plain words, with how to fix it', () => {
    const [i] = fixItems({ queueFlags: [EXAMPLES.condition_not_quoted!], body: { library: {} } });
    expect(i!.field).toBe('quotes');
    expect(i!.hint).toMatch(/^No source quote says when this rule applies\. .*“When it applies”.*“Applies always within its process”/);
  });

  it('open questions are split and placed beside the field they are about', () => {
    expect(splitQuestions(EXAMPLES.open_question!.message)).toHaveLength(2);
    const items = fixItems({ queueFlags: [EXAMPLES.open_question!], body: { library: {} } });
    expect(items.map((i) => i.field)).toEqual(['jurisdiction', 'process']);
    expect(items[0]!.question).toBe('Which jurisdiction does this cover?');
    expect(questionField('Is this rule a duplicate?')).toBe('status');
  });

  it('the hint goes away once the field is filled in (a jurisdiction must be a real code)', () => {
    expect(stillMissing('issuer', '')).toBe(true);
    expect(stillMissing('issuer', 'bank')).toBe(false);
    expect(stillMissing('jurisdiction', 'XX')).toBe(true);
    expect(stillMissing('jurisdiction', 'US-CA')).toBe(false);
  });
});

describe('anchors on the page', () => {
  it('Library details has an anchor, an amber outline and a hint for each of its fields', () => {
    const fixes = fixItems({ queueFlags: [EXAMPLES.library_incomplete!, EXAMPLES.condition_not_set!, EXAMPLES.change_missing!], body: { library: {} } });
    const html = renderToStaticMarkup(<LibraryDetailsEditor projectId="p" ruleId="r" contentHash={'a'.repeat(64)} body={{ ...BODY, library: {} }} approved={false} fixes={fixes} />);
    for (const f of ['kind', 'issuer', 'jurisdiction', 'subject', 'process', 'change', 'condition'] as FixField[]) {
      expect(html, f).toContain(`id="${FIX_ANCHOR[f]}"`);
      expect(html, f).toContain(`data-fix-hint="${f}"`);
    }
    expect(html).toMatch(/id="lib-jurisdiction" class="[^"]*outline-warning/);
    expect(html).toContain('Jurisdiction is missing. Enter US for federal or bank rules, or US-CA for California.');
  });

  it('without problems Library details has no outline and no hint', () => {
    const html = renderToStaticMarkup(<LibraryDetailsEditor projectId="p" ruleId="r" contentHash={'a'.repeat(64)} body={{ ...BODY, library: {} }} approved={false} />);
    expect(html).not.toContain('outline-warning');
    expect(html).not.toContain('data-fix-hint');
  });

  it('the edit form fields carry their anchors (the form loads in the browser; checked in e2e rule-fix-nav)', () => {
    const src = readFileSync(new URL('../components/policy/rule-review.tsx', import.meta.url), 'utf8');
    for (const f of EDIT_FORM_FIELDS) expect(src, f).toContain(`'${FIX_ANCHOR[f]}'`);
    expect(readFileSync(new URL('../components/policy/rule-library-view.tsx', import.meta.url), 'utf8')).toContain('data-edit-form');
  });

  it('"To fix" links each problem to its field; the bar says "Ready to approve" when nothing is left', () => {
    const fixes = fixItems({ queueFlags: [EXAMPLES.condition_not_set!, EXAMPLES.no_effective_date!], body: { library: {} } });
    const list = renderToStaticMarkup(<FixList fixes={fixes} />);
    expect(list).toContain('To fix (2)');
    expect(list).toContain('href="#fix-condition"');
    expect(list).toContain('href="#fix-effective"');
    const bar = renderToStaticMarkup(<NextProblemBar fixes={fixes} queueHref="/q" />);
    expect(bar).toContain('Next problem');
    expect(bar).toContain('(1 of 2)');
    const ready = renderToStaticMarkup(<NextProblemBar fixes={[]} queueHref="/q" />);
    expect(ready).toContain('Ready to approve');
    expect(ready).toContain('href="/q"');
    expect(renderToStaticMarkup(<FixList fixes={[]} />)).toBe('');
  });
});
