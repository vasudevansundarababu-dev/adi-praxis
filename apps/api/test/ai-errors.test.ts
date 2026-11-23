import { describe, expect, it } from 'vitest';
import { aiErrorForLog, aiFailureKind, aiUnavailableMessage } from '../src/lib/ai-errors';

/** D-020 (owner, 23 Nov 2026): AI provider failures in plain English, with manual work still available. */
const RAPT = new Error('{"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)","error_subtype":"invalid_rapt"}');

describe('AI provider errors', () => {
  it('names the cause: expired sign-in, quota, timeout, anything else', () => {
    expect(aiFailureKind(RAPT)).toBe('signin_expired');
    expect(aiFailureKind(new Error('Could not load the default credentials.'))).toBe('signin_expired');
    expect(aiFailureKind(new Error('Gemini call failed (401)'))).toBe('signin_expired');
    expect(aiFailureKind(new Error('Gemini call failed (429)'))).toBe('quota');
    expect(aiFailureKind(new Error('RESOURCE_EXHAUSTED'))).toBe('quota');
    expect(aiFailureKind(new Error('Gemini call timed out'))).toBe('timeout');
    expect(aiFailureKind(new Error('wrapper', { cause: RAPT }))).toBe('signin_expired');
    expect(aiFailureKind(new Error('The model did not return JSON.'))).toBe('other');
  });

  it('the message is plain, says what to do, and never shows the provider text', () => {
    const m = aiUnavailableMessage(RAPT, 'The policy assistant', 'Nothing was changed; you can edit the rule by hand.', 'fallback');
    expect(m).toBe('The policy assistant can’t reach the AI service: the Google sign-in for AI on this computer has expired. Ask an admin to sign in again. Nothing was changed; you can edit the rule by hand.');
    expect(m).not.toMatch(/invalid_|rapt|grant/);
    expect(aiUnavailableMessage(new Error('(429)'), 'Help', 'Keep going by hand.', 'fallback')).toBe('Help is busy or over its AI usage limit. Try again in a few minutes. Keep going by hand.');
    expect(aiUnavailableMessage(new Error('bad JSON'), 'Help', 'x', 'fallback')).toBe('fallback');
    expect(aiErrorForLog(RAPT)).toContain('invalid_rapt');
  });
});
