import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { answerBody, draftOf, EdgeOutcomesPanel, type EdgeOutcomesState } from '@/components/projects/edge-outcomes-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

/** E-001 §6b (owner, 24 Nov 2026): edge-case outcomes on Project → Benchmark. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const FIELDS = [{ name: 'recommendation', label: 'Recommendation', help: '', required: true, allowedValues: ['approve', 'request_information'] }, { name: 'request_type', label: 'Request type', help: '', required: false, allowedValues: ['current_id'] }];
const STATE: EdgeOutcomesState = {
  catalog: { source: 'catalog', fallbackReason: null, environmentKey: 'golden-kyc-openenv', revision: 4, outcomeFields: FIELDS },
  waiting: [{ familyId: 'expired_id', familyName: 'Expired ID', variantId: 'expired_document', name: 'Expired passport', boundary: null, migrated: true, inBatch: false }],
  people: [{ smeUserId: 's1', name: 'Michael Duffy' }],
  batches: [{ id: 'b1', requestId: 'orq-1', answerer: 'admin', assigneeSmeUserId: null, secondCheck: false, note: null, dueBy: null, state: 'open', sentAt: null, sendError: null, items: [{ id: 'i1', familyName: 'Expired ID', variantId: 'expired_document', name: 'Expired passport', description: '', boundary: null, proposedOutcome: { decision: 'request_information', fields: { request_type: 'current_id' }, rationale: 'Ask for a current ID.', evidence: [] }, answer: null, answeredAt: null }] }],
};

describe('Edge-case outcomes panel', () => {
  it('lists waiting variants, makes a batch for an SME or for the Admin, and prefills a carried-over outcome to confirm', () => {
    const html = renderToStaticMarkup(<EdgeOutcomesPanel projectId="p" state={STATE} />);
    const t = text(html);
    expect(t).toContain('Expired ID · Expired passport · outcome carried over: confirm or change it');
    expect(t).toContain('I answer as Admin, for an SME');
    expect(t).toContain('Second check by another person');
    expect(t).toContain('Make a batch of 1');
    expect(t).toContain('Batch orq-1 · answered as Admin · Being answered · 0 of 1 answered');
    expect(html).toContain('Ask for a current ID.');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('turns a confirmed draft into decision, other fields, rationale and evidence lines', () => {
    const d = draftOf(STATE.batches[0]!.items[0]!);
    expect(d).toMatchObject({ verdict: 'confirm', decision: 'request_information', fields: { request_type: 'current_id' } });
    expect(answerBody({ ...d, evidence: 'expiry date\n\n document.read ' }, FIELDS)).toEqual({ verdict: 'confirm', decision: 'request_information', fields: { request_type: 'current_id' }, rationale: 'Ask for a current ID.', evidence: ['expiry date', 'document.read'] });
    expect(answerBody({ ...d, verdict: 'cannot_decide', rationale: ' Need the file. ' }, FIELDS)).toEqual({ verdict: 'cannot_decide', rationale: 'Need the file.' });
  });
});

describe('SME time on edge-case outcomes', () => {
  it('shows items, minutes and batches per week and person, with a total; says so when empty', async () => {
    const { OutcomeTimeReport } = await import('@/components/projects/edge-outcomes-panel');
    const html = renderToStaticMarkup(<OutcomeTimeReport rows={[{ week: '2026-11-23', who: 'Michael Duffy', kind: 'sme', items: 6, minutes: 18.5, batches: 1 }, { week: '2026-11-23', who: 'Owner (Admin, for an SME)', kind: 'admin', items: 12, minutes: 9, batches: 1 }]} />);
    const t = text(html);
    expect(t).toContain('2026-11-23 Michael Duffy 6 18.5 1');
    expect(t).toContain('Total 18 27.5');
    expect(a11yProblems(html)).toEqual([]);
    expect(text(renderToStaticMarkup(<OutcomeTimeReport rows={[]} />))).toContain('No outcomes answered yet.');
  });
});
