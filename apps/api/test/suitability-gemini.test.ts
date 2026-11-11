import { describe, expect, it } from 'vitest';
import { ClaudeVertexSuitabilityEvaluator, EvaluatorUnavailableError, GeminiVertexSuitabilityEvaluator, vertexSuitabilityEvaluator, type SuitabilityInput } from '../src/candidate/suitability';
import { loadConfig } from '../src/config';

const input: SuitabilityInput = {
  opportunity: { title: 'KYC Analyst', domain: 'Banking', specialty: 'KYC' },
  criteria: [{ id: 'kyc', text: 'Two years of KYC casework', kind: 'REQUIRED', evidence: '', equivalence: '' }],
  items: [{ id: 'field:domain_years', label: 'Years in the domain', value: '10 [self-reported]' }],
};
const answer = { findings: [{ criterionId: 'kyc', result: 'MET', citations: ['field:domain_years'], rationale: 'Self-reported 10 years.' }], unresolvedQuestions: [], proposedContributionRoles: ['TASK_AUTHOR'], limitations: 'Self-reported only.' };

/** A scripted Gemini drafter: never calls Vertex. */
function scripted(text: string | Error) {
  const calls: { system: string; user: string }[] = [];
  return {
    calls,
    drafter: {
      async complete(p: { system: string; user: string }) {
        calls.push(p);
        if (text instanceof Error) throw text;
        return { text, inputTokens: 1, outputTokens: 1 };
      },
    },
  };
}

describe('SUITABILITY_MODEL: Gemini option for the FLOW2 suitability assessment', () => {
  it('Gemini gets the same prompt plus the output schema, and its JSON is validated', async () => {
    const s = scripted(JSON.stringify(answer));
    const e = new GeminiVertexSuitabilityEvaluator('gemini-3.8-flash', { projectId: 'p', location: 'global', drafter: s.drafter as never });
    expect(e.modelVersion).toBe('gemini:gemini-3.8-flash');
    expect(await e.evaluate(input)).toEqual(answer);
    expect(s.calls[0]!.system).toMatch(/a human reviewer makes the selection/);
    expect(s.calls[0]!.system).toMatch(/"criterionId":\{"type":"string","enum":\["kyc"\]\}/);
    expect(s.calls[0]!.user).toContain('field:domain_years | Years in the domain: 10 [self-reported]');
  });

  it('a failed call, non-JSON or off-schema answer is a recoverable "model unavailable" error, never a result', async () => {
    for (const text of [new Error('Gemini call failed (429)'), 'not json', JSON.stringify({ findings: 'all good' })]) {
      const e = new GeminiVertexSuitabilityEvaluator('gemini-3.8-flash', { projectId: 'p', location: 'global', drafter: scripted(text).drafter as never });
      await expect(e.evaluate(input)).rejects.toBeInstanceOf(EvaluatorUnavailableError);
    }
  });

  it('the setting selects the provider; Claude Opus stays the default', () => {
    expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x/y', REDIS_URL: 'redis://x' }).SUITABILITY_MODEL).toBe('claude-opus-5');
    const opts = { projectId: 'p', location: 'global' };
    expect(vertexSuitabilityEvaluator('gemini:gemini-3.8-flash', opts)).toBeInstanceOf(GeminiVertexSuitabilityEvaluator);
    const claude = vertexSuitabilityEvaluator('claude-opus-5', opts);
    expect(claude).toBeInstanceOf(ClaudeVertexSuitabilityEvaluator);
    expect(claude.modelVersion).toBe('claude-opus-5');
    expect(vertexSuitabilityEvaluator('claude:claude-opus-4-8', opts).modelVersion).toBe('claude-opus-4-8');
  });
});
