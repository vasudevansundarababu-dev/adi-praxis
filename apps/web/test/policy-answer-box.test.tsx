import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AnswerBox } from '@/components/policy/answer-box';
import { answersTo, openChanges, type AnswerDto } from '@/components/policy/answer-logic';

/** Owner and Jose, 27 Nov 2026: the answer box under an open question, and "Fill from my answer" (AI) behind its switch. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const Q = 'Should the rule cover remote openings?';
const answer = (o: Partial<AnswerDto> = {}): AnswerDto => ({ id: 'a1', ruleVersionId: 'v1', question: Q, answer: 'Mobile licences are fine for both branch and remote.', answeredBy: 'Jose Ruiz', answeredAt: '2026-11-27T16:00:00Z', aiStatus: 'none', aiMessage: null, changes: [], costUsd: null, accepted: [], ...o });
const box = (answers: AnswerDto[], aids = { fieldLinks: true, aiAnswer: true, aiPaused: false }) => renderToStaticMarkup(<AnswerBox projectId="p" ruleId="r" contentHash="h" question={Q} answers={answers} aids={aids} />).replace(/&#x27;|&quot;/g, '"');

describe('answer box', () => {
  it('a plain answer box that saves verbatim; "Fill from my answer" only when the AI answer is on', () => {
    const on = box([]);
    expect(on).toContain('data-answer-box');
    expect(on).toContain('Your answer');
    expect(on).toContain('Saved exactly as you type it, with your name and the time.');
    expect(on).toContain('>Save answer</button>');
    expect(on).toContain('Fill from my answer (AI)');
    const off = box([], { fieldLinks: true, aiAnswer: false, aiPaused: false });
    expect(off).toContain('>Save answer</button>');
    expect(off).not.toContain('Fill from my answer');
  });

  it('says plainly when the AI budget for today is used up; the answer box still works', () => {
    const paused = box([], { fieldLinks: true, aiAnswer: true, aiPaused: true });
    expect(paused).toContain('AI answers are paused for today (budget reached)');
    expect(paused).not.toContain('Fill from my answer (AI)');
    expect(paused).toContain('>Save answer</button>');
  });

  it('shows the answer exactly as typed, who and when, and each proposal before → after with Accept, Reject, Show field and Accept all', () => {
    const html = box([answer({ aiStatus: 'proposed', changes: [{ field: 'channels', before: 'not set', after: 'branch, remote', reason: 'both named' }, { field: 'jurisdiction', before: 'not set', after: 'US', reason: '' }] })]);
    expect(html).toContain('✓ Answered by Jose Ruiz, 2026-11-27 16:00 UTC');
    expect(html).toContain('Mobile licences are fine for both branch and remote.</blockquote>');
    expect(html).toContain('<span class="font-medium">Channels:</span> <span class="line-through">not set</span> → <strong>branch, remote</strong>');
    for (const s of ['>Accept</button>', '>Reject</button>', '>Show field</button>', 'Accept all (2)']) expect(html).toContain(s);
  });

  it('an accepted change says so; the AI’s plain message shows when it could not map the answer', () => {
    const html = box([answer({ aiStatus: 'unmapped', aiMessage: 'I couldn’t tell which channel you meant.', changes: [{ field: 'channels', before: 'not set', after: 'branch', reason: '' }], accepted: ['channels'] })]);
    expect(html).toContain('I couldn’t tell which channel you meant.');
    expect(html).toContain('>Accepted</span>');
    expect(html).not.toContain('Accept all');
  });

  it('answers are matched to their question; rejected and accepted changes are not pending', () => {
    const a = answer({ changes: [{ field: 'channels', before: '', after: '', reason: '' }, { field: 'issuer', before: '', after: '', reason: '' }, { field: 'kind', before: '', after: '', reason: '' }], accepted: ['issuer'] });
    expect(answersTo([a, answer({ id: 'a2', question: 'Other?' })], Q)).toHaveLength(1);
    expect(openChanges(a, new Set(['a1:kind'])).map((c) => c.field)).toEqual(['channels']);
  });
});
