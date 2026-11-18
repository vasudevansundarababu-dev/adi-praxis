import { AUTHORSHIP_DECLARATION, emptyOutput, getFieldValue, hashValue, sectionDigest, setFieldValue, TemplateProfileSchema, type SuggestionState, type TemplateProfile } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { failureMessage, SUGGESTION_TIMEOUT_MESSAGE } from '@/components/work/field-suggestions';
import { ProfileEditor } from '@/components/work/profile-editor';
import type { TaskView } from '@/lib/work-types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/**
 * Suggested text for every field (owner decisions 1-6, 15 Nov 2026; mockup
 * docs/design/mockups/suggested-text-and-rubric-table.html) on the KYC v7 form. Synthetic fixture; no network.
 */
const V7 = JSON.parse(readFileSync(new URL('../../api/test/fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as { authoring: { profile: unknown } };
const PROFILE = TemplateProfileSchema.parse(V7.authoring.profile) as TemplateProfile;
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const TRIGGER = 'New consumer deposit account application, or a periodic or event-driven KYC refresh of an existing account.';
const CONTEXT = 'Investigate each assigned custodial account application before recommending.';
const SCOPE = 'Custodial consumer deposit applications in every applicable governing state.';

function task(output: Record<string, unknown>, over: Partial<TaskView> = {}): TaskView {
  return { id: '00000000-0000-4000-8000-000000000020', status: 'IN_PROGRESS', taskType: 'AUTHORING', brief: null, isOpenSlot: false, assignedAt: null, submittedAt: null, activeSeconds: 0, revision: 3, projectId: 'p', projectName: 'KYC v7', tptMinutes: 45, definition: 'generic', template: { workflow: PROFILE.catalogWorkflowName, domain: 'Banking', primaryWork: null, verificationCriteria: null, humanGate: null, coverageDimensions: [], edgeCases: [], collectionSchema: null }, input: { slot: { id: 's', brief: 'Custodian', tags: {}, edgeCase: null, isOpen: false, case: { source: 'S1.applicationType', value: 'custodial', label: 'Custodian' } } }, output, coverageTags: null, checks: null, readOnly: false, review: null, formV2: false, fieldSuggestions: true, ...over } as unknown as TaskView;
}
const offered = (items: { key: string; value: unknown }[]) => ({ section: 'S1', items: items.map((i) => ({ ...i, hash: hashValue(i.value) })), model: 'mock-field-suggestions-1', generatedAt: '2026-11-15T10:00:00Z' });

describe('suggested text on the task form (FIELD_SUGGESTIONS_ENABLED)', () => {
  // S1: title written by the author, trigger taken as is, business context taken then edited; scope and the rest empty.
  let out = emptyOutput(PROFILE);
  out = setFieldValue(PROFILE, out, 'S1', 'applicationType', 'custodial');
  out = setFieldValue(PROFILE, out, 'S1', 'title', 'Custodial account (UTMA/UGMA-style) KYC');
  out = setFieldValue(PROFILE, out, 'S1', 'trigger', TRIGGER);
  out = setFieldValue(PROFILE, out, 'S1', 'businessContext', `${CONTEXT} Confirm the custodial agreement.`);
  const state: SuggestionState = {
    used: { 'S1.trigger': { hash: hashValue(TRIGGER), at: '2026-11-15T10:01:00Z', model: 'm' }, 'S1.businessContext': { hash: hashValue(CONTEXT), at: '2026-11-15T10:01:00Z', model: 'm' } },
    confirmed: {},
    offered: { S1: offered([{ key: 'trigger', value: TRIGGER }, { key: 'businessContext', value: CONTEXT }, { key: 'scope', value: SCOPE }, { key: 'language', value: 'English (en)' }]) },
  };
  const render = (o = out, s = state, section = 0, over: Partial<TaskView> = {}) => renderToStaticMarkup(<ProfileEditor task={task(o, over)} profile={PROFILE} onSubmitted={() => undefined} initialSection={section} initialSuggestions={s} />);

  it('an empty field shows its suggestion with Use, Edit then use, Suggest another and I’ll write my own', () => {
    const html = render();
    const t = text(html);
    expect(html).toContain('data-suggestion="S1.scope"');
    expect(t).toContain(`Suggested text From the template, this task and the project’s rules · no case data ${SCOPE} Use this text Edit, then use Suggest another I’ll write my own`);
    expect(html).toContain('data-suggestion="S1.language"');
    expect(t).toContain('Use all 2 suggestions in S1');
    expect(t).toContain('not from any real customer');
  });

  it('a filled field shows where its text came from, with Undo for a suggestion', () => {
    const html = render();
    expect(html).toMatch(/data-field-origin="S1.title"[^>]*>.*?Written by you/);
    expect(html).toMatch(/data-field-origin="S1.trigger"[^>]*>.*?Suggested · used as it is.*?Undo, show the suggestion again/);
    expect(html).toMatch(/data-field-origin="S1.businessContext"[^>]*>.*?Suggested · edited by you/);
    // A filled field never shows a suggestion box; the slot's case selector never gets one.
    expect(html).not.toContain('data-suggestion="S1.trigger"');
    expect(html).not.toContain('data-suggestion="S1.applicationType"');
  });

  it('each section ends with the confirmation; it is off until required fields are filled, and states how many came from suggestions', () => {
    const t = text(render());
    expect(t).toContain('I’ve read every field in S1, and it describes how this work is actually done. 2 fields here came from a suggestion. Ticking this records that you checked them and take them as your own. Fill the required fields first.');
  });

  it('a confirmation for the current content shows as confirmed; after a change it shows as stale', () => {
    const s: SuggestionState = { ...state, confirmed: { S1: { digest: sectionDigest(PROFILE, out, 'S1'), at: '2026-11-15T10:05:00Z', smeUserId: 'u' } } };
    const html = render(out, s);
    expect(html).toContain('data-confirmed-section="S1"');
    expect(text(html)).toContain('Changing a field in S1 clears this.');
    const changed = setFieldValue(PROFILE, out, 'S1', 'scope', 'Something new');
    const t2 = text(render(changed, s));
    expect(t2).toContain('You changed S1 after confirming it. Read it again and tick to confirm.');
    expect(render(changed, s)).not.toContain('data-confirmed-section="S1"');
  });

  it('S8 shows the written / as is / edited split and the authorship declaration', () => {
    const t = text(render(out, state, 7));
    expect(t).toContain('Where the text came from 1 fields written by you 1 suggestions used as they are 1 suggestions you edited');
    expect(t).toContain('0 of 8 sections confirmed.');
    expect(t).toContain(AUTHORSHIP_DECLARATION);
    expect(AUTHORSHIP_DECLARATION).toBe('This task is my work. I wrote it, or I read, changed where needed and accepted every suggested text in it. It describes how this work is really done. I didn’t paste answers from outside tools.');
  });

  it('read-only: origins are shown, no suggestion actions; with the flag off nothing changes', () => {
    const ro = text(render(out, state, 0, { readOnly: true }));
    expect(ro).toContain('Suggested · used as it is');
    expect(ro).not.toContain('Use this text');
    expect(ro).not.toContain('Use all');
    const off = text(render(out, state, 0, { fieldSuggestions: false }));
    expect(off).not.toContain('Suggested text');
    expect(off).not.toContain('Written by you');
    expect(off).not.toContain('describes how this work is actually done');
    expect(off).not.toContain(AUTHORSHIP_DECLARATION);
  });

  it('the suggestion box and confirmation are accessible', () => {
    expect(a11yProblems(render())).toEqual([]);
    expect(getFieldValue(PROFILE, out, 'S1', { key: 'scope' }) || '').toBe('');
  });

  it('D31: a slow suggestion says it took too long (API or proxy timeout), not that the service is unreachable', () => {
    expect(failureMessage({ error: 'SUGGESTIONS_TIMEOUT', message: 'The suggestion took too long. Try again.' }, true)).toBe(SUGGESTION_TIMEOUT_MESSAGE);
    expect(failureMessage({ error: 'UPSTREAM_TIMEOUT', message: 'The service took too long to answer. Please try again.' }, true)).toBe(SUGGESTION_TIMEOUT_MESSAGE);
    expect(SUGGESTION_TIMEOUT_MESSAGE).toBe('The suggestion took too long. Try again.');
    expect(failureMessage({ error: 'SUGGESTIONS_UNAVAILABLE', message: 'Suggestions are not available right now.' }, true)).toBe('Suggestions are not available right now.');
    expect(failureMessage(null, true)).toBe('Something went wrong. Try again.');
    expect(failureMessage({ error: 'UPSTREAM_TIMEOUT', message: 'The service took too long to answer. Please try again.' })).toMatch(/took too long to answer/);
  });
});
