import { afterEach, describe, expect, it, vi } from 'vitest';
import { VertexConversationAssistant } from '../src/tasks/conversation/assistant';

const input = { workflow: 'KYC onboarding and refresh', current: {}, slot: { brief: 'SECRET-CASE-TEXT' }, history: [{ speaker: 'AUTHOR', content: 'SECRET-ANSWER-TEXT' }], policy: null, previousUnresolved: [] };
const proposal = { reply: 'ok', question: 'Which evidence is missing?', changes: [], ruleLinks: [], unresolved: [] };

describe('Authoring v2.1 live Vertex chatbot guards (fake client, no network)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the configured model, makes exactly one call and logs usage without prompt or answer text', async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(proposal) }], usage: { input_tokens: 1200, output_tokens: 80 } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const a = new VertexConversationAssistant({ projectId: 'p', region: 'global', model: 'claude-sonnet-5', client: { messages: { create } } as never });
    expect(a.model).toBe('claude-sonnet-5');
    await a.propose(input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].model).toBe('claude-sonnet-5');
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ event: 'llm.call', provider: 'vertex', feature: 'authoring-conversation', model: 'claude-sonnet-5', ok: true, inputTokens: 1200, outputTokens: 80 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('logs a failed call and rethrows it without retrying', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const a = new VertexConversationAssistant({ projectId: 'p', region: 'global', client: { messages: { create } } as never });
    await expect(a.propose(input)).rejects.toThrow('timeout');
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({ ok: false, error: 'APIConnectionTimeoutError' });
  });
});
