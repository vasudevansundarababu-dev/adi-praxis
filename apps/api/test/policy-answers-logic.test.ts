import { conditionLabel, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { answerCostUsd, applyChanges, checkedProposal, startOfBudgetDay, StubAnswerFiller } from '../src/policy/answers';

/**
 * Owner and Jose, 27 Nov 2026: "Fill from my answer". The model's proposal is checked against the library's values and
 * the fact catalog; a fact the catalog doesn't have is never proposed; nothing is applied until accepted. Database-free.
 */
const CATALOG = { version: 'c@1', facts: [{ id: 'process', type: 'enum', allowed_values: ['account_opening'], description: 'Process' }, { id: 'channel', type: 'enum', allowed_values: ['branch', 'remote'], description: 'Channel' }] } as unknown as FactCatalog;
const BODY = PolicyRuleBody.parse({ title: 'Mobile licences', requirement: 'A mobile driver licence is accepted as ID.', library: { kind: 'policy', subject: 'party', scope: { process: 'account_opening' } } });
const label = (c: unknown) => conditionLabel(c as never, CATALOG);

describe('checked proposal', () => {
  it('keeps valid changes with before → after in plain words', () => {
    const r = checkedProposal({ changes: [{ field: 'jurisdiction', value: 'US', reason: 'federal' }, { field: 'channels', value: ['branch', 'remote'], reason: 'both' }, { field: 'condition', value: null, reason: 'always' }], cannot: null }, BODY, CATALOG, label);
    expect(r.message).toBeNull();
    expect(r.changes).toEqual([
      { field: 'jurisdiction', before: 'not set', after: 'US', value: 'US', reason: 'federal' },
      { field: 'channels', before: 'not set', after: 'branch, remote', value: ['branch', 'remote'], reason: 'both' },
      { field: 'condition', before: 'not set', after: 'always applies within its process', value: null, reason: 'always' },
    ]);
  });

  it('never proposes a fact the catalog does not have, and says so in plain words', () => {
    const r = checkedProposal({ changes: [{ field: 'condition', value: { fact: 'licence_type', op: 'eq', value: 'mobile' } }] }, BODY, CATALOG, label);
    expect(r.changes).toEqual([]);
    expect(r.message).toContain('I couldn’t map when it applies (licence_type)');
  });

  it('a condition over catalog facts is proposed in plain words', () => {
    const r = checkedProposal({ changes: [{ field: 'condition', value: { fact: 'channel', op: 'in', value: ['branch', 'remote'] } }] }, BODY, CATALOG, label);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]!.after).toBe(label({ fact: 'channel', op: 'in', value: ['branch', 'remote'] }));
  });

  it('drops values outside the library vocabulary and passes on the model’s own "cannot"', () => {
    const r = checkedProposal({ changes: [{ field: 'channels', value: ['mobile_app'] }, { field: 'issuer', value: 'FINCEN' }], cannot: 'I couldn’t tell which channel you meant.' }, BODY, CATALOG, label);
    expect(r.changes).toEqual([]);
    expect(r.message).toBe('I couldn’t tell which channel you meant. I couldn’t map the channel, the issuer from your answer to an allowed value; fill them by hand.');
  });

  it('ignores unknown fields, quotes and changes to the same value; says when nothing changes', () => {
    const r = checkedProposal({ changes: [{ field: 'quote', value: 'x' }, { field: 'process', value: 'account_opening' }] }, BODY, CATALOG, label);
    expect(r.changes).toEqual([]);
    expect(r.message).toBe('Your answer doesn’t change any field I can fill. Your answer is saved.');
  });

  it('normalises a jurisdiction and refuses a code that is not real', () => {
    expect(checkedProposal({ changes: [{ field: 'jurisdiction', value: 'California' }] }, BODY, CATALOG, label).changes[0]!.value).toBe('US-CA');
    expect(checkedProposal({ changes: [{ field: 'jurisdiction', value: 'Atlantis' }] }, BODY, CATALOG, label).changes).toEqual([]);
  });
});

describe('scope needs a process', () => {
  it('channels on a rule without a process are not proposed alone; with the process proposed too they are', () => {
    const bare = PolicyRuleBody.parse({ title: 't', requirement: 'r', library: { kind: 'policy' } });
    const alone = checkedProposal({ changes: [{ field: 'channels', value: ['branch'] }] }, bare, CATALOG, label);
    expect(alone.changes).toEqual([]);
    expect(alone.message).toBe('I can set the channels once the rule has a Process: choose the Process in Library details (for example account opening), then fill from your answer again.');
    const both = checkedProposal({ changes: [{ field: 'process', value: 'account_opening' }, { field: 'channels', value: ['branch'] }] }, bare, CATALOG, label);
    expect(both.changes.map((c) => c.field)).toEqual(['process', 'channels']);
    expect(PolicyRuleBody.safeParse(applyChanges(bare, both.changes)).success).toBe(true);
  });
});

describe('accepting changes', () => {
  it('applies only the accepted changes to the body; quotes are not part of the body', () => {
    const next = applyChanges(BODY, [{ field: 'channels', value: ['branch', 'remote'] }, { field: 'condition', value: null }, { field: 'jurisdiction', value: 'US' }]);
    expect(next.library).toEqual({ kind: 'policy', subject: 'party', jurisdiction: 'US', scope: { process: 'account_opening', channels: ['branch', 'remote'] } });
    expect(next.condition).toBeNull();
    expect(next.requirement).toBe(BODY.requirement);
    expect(PolicyRuleBody.safeParse(next).success).toBe(true);
  });
});

describe('stub, cost and budget day', () => {
  it('the stub reads simple patterns and says plainly when it cannot', async () => {
    const s = new StubAnswerFiller();
    const input = (answer: string) => ({ question: 'q?', answer, rule: { ruleKey: 'R', title: 't', requirement: 'r', library: null, condition: null, effectiveFrom: null }, catalog: CATALOG });
    expect((await s.fill(input('Mobile licences are fine for both branch and remote.'))).raw).toEqual({ changes: [{ field: 'channels', value: ['branch', 'remote'], reason: 'The answer names the channels.' }] });
    expect((await s.fill(input('Not sure.'))).raw).toEqual({ changes: [], cannot: 'I couldn’t tell which field your answer is about.' });
  });

  it('cost is tokens × the model’s price', () => {
    expect(answerCostUsd('gemini:gemini-3.8-flash', 2000, 400)).toBe(0.0016); // 2000 × $0.30/M + 400 × $2.50/M
    expect(answerCostUsd('stub-answer-fill-1', 0, 0)).toBe(0);
  });

  it('the budget day starts at midnight US Central', () => {
    expect(startOfBudgetDay(new Date('2026-11-27T15:30:00Z')).toISOString()).toBe('2026-11-27T06:00:00.000Z');
    expect(startOfBudgetDay(new Date('2026-11-27T03:00:00Z')).toISOString()).toBe('2026-11-26T06:00:00.000Z');
  });
});
