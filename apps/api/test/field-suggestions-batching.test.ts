import { describe, expect, it } from 'vitest';
import type { TemplateProfileField } from '@praxis/shared';
import type { CallOptions, Completer } from '../src/policy/rule-assistant';
import {
  FieldSuggesterTimeoutError,
  FieldSuggesterUnavailableError,
  ModelFieldSuggester,
  SUGGEST_BATCH,
  SUGGEST_MAX_FIELDS,
  SUGGEST_MAX_OUTPUT,
  SUGGEST_TIMEOUT_MS,
  type SuggestContext,
  type SuggestField,
} from '../src/tasks/suggestions/assistant';

/**
 * D31: a large section is asked for in small batches, run in parallel, each with a short limit, so the request answers
 * before the candidate app's 30 s proxy limit; a timeout is reported as its own error. A fake completer, never a model.
 */
const ctx: SuggestContext = { workflow: 'Marketing', section: { key: 'S2', title: 'Brief' }, slot: { brief: null, caseLabel: null }, rules: [], authorText: [], again: false };
const fields = (n: number): SuggestField[] =>
  Array.from({ length: n }, (_, i) => ({ key: `f${i + 1}`, field: { key: `f${i + 1}`, label: `Field ${i + 1}`, type: 'long_text' } as TemplateProfileField }));
const keysIn = (user: string) => [...user.matchAll(/^key: (\w+);/gm)].map((m) => m[1]!);

class FakeCompleter implements Completer {
  calls: { keys: string[]; max: number; opts?: CallOptions }[] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(private readonly answer: (keys: string[], call: number) => Promise<string> | string = (keys) => JSON.stringify({ items: keys.map((key) => ({ key, value: `text for ${key}` })) })) {}
  async complete(_system: string, user: string, max: number, opts?: CallOptions) {
    const keys = keysIn(user);
    const n = this.calls.push({ keys, max, opts });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return await this.answer(keys, n);
    } finally {
      this.inFlight--;
    }
  }
}

describe('ModelFieldSuggester batching (D31)', () => {
  it('splits a large section into parallel batches with a short time limit and a small output cap', async () => {
    const llm = new FakeCompleter();
    const out = await new ModelFieldSuggester('fake', llm).suggest(fields(40), ctx);
    // At most 30 fields per request, as before; in batches of 8, all at once.
    expect(llm.calls.map((c) => c.keys.length)).toEqual([8, 8, 8, 6]);
    expect(llm.calls.flatMap((c) => c.keys)).toEqual(fields(SUGGEST_MAX_FIELDS).map((f) => f.key));
    expect(llm.maxInFlight).toBe(4);
    for (const c of llm.calls) {
      expect(c.keys.length).toBeLessThanOrEqual(SUGGEST_BATCH);
      expect(c.max).toBe(SUGGEST_MAX_OUTPUT);
      expect(c.opts).toEqual({ quick: true, timeoutMs: SUGGEST_TIMEOUT_MS });
    }
    expect(SUGGEST_TIMEOUT_MS).toBeLessThan(30_000);
    expect(out.map((o) => o.key)).toEqual(fields(30).map((f) => f.key));
  });

  it('a small section is one call; an answer for a key outside the batch is dropped', async () => {
    const llm = new FakeCompleter((keys) => JSON.stringify({ items: [...keys, 'other'].map((key) => ({ key, value: 'x' })) }));
    const out = await new ModelFieldSuggester('fake', llm).suggest(fields(3), ctx);
    expect(llm.calls).toHaveLength(1);
    expect(out.map((o) => o.key)).toEqual(['f1', 'f2', 'f3']);
  });

  it('one slow batch leaves only its fields without a suggestion', async () => {
    const llm = new FakeCompleter((keys, n) => {
      if (n === 2) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return JSON.stringify({ items: keys.map((key) => ({ key, value: 'x' })) });
    });
    const out = await new ModelFieldSuggester('fake', llm).suggest(fields(16), ctx);
    expect(out.map((o) => o.key)).toEqual(fields(8).map((f) => f.key));
  });

  it('when every batch times out the error says so (Gemini and Claude timeouts)', async () => {
    for (const err of [new Error('Gemini call timed out'), Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })]) {
      const llm = new FakeCompleter(() => {
        throw err;
      });
      await expect(new ModelFieldSuggester('fake', llm).suggest(fields(12), ctx)).rejects.toBeInstanceOf(FieldSuggesterTimeoutError);
    }
  });

  it('other failures stay "unavailable", not "timed out"', async () => {
    const llm = new FakeCompleter(() => 'not json');
    const err = await new ModelFieldSuggester('fake', llm).suggest(fields(4), ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FieldSuggesterUnavailableError);
    expect(err).not.toBeInstanceOf(FieldSuggesterTimeoutError);
    const down = new FakeCompleter(() => {
      throw new Error('Gemini HTTP 429');
    });
    const err2 = await new ModelFieldSuggester('fake', down).suggest(fields(4), ctx).catch((e: unknown) => e);
    expect(err2).not.toBeInstanceOf(FieldSuggesterTimeoutError);
  });
});
