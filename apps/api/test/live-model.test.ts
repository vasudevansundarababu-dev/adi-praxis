import { afterEach, describe, expect, it, vi } from 'vitest';
import { VertexConversationAssistant } from '../src/tasks/conversation/assistant';

const input = { workflow: 'KYC onboarding and refresh', current: {}, slot: { brief: 'SECRET-CASE-TEXT' }, history: [{ speaker: 'AUTHOR', content: 'SECRET-ANSWER-TEXT' }], policy: null, previousUnresolved: [] };
const proposal = { reply: 'ok', question: 'Which evidence is missing?', changes: [], ruleLinks: [], unresolved: [] };

describe('Authoring v2.1 live Vertex chatbot guards (fake client, no network)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the configured model, makes exactly one call and logs usage without prompt or answer text', async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(proposal) }], usage: { input_tokens: 1200, output_tokens: 80 } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const a = new VertexConversationAssistant({ projectId: 'p', region: 'global', model: 'claude-sonnet-5-5', client: { messages: { create } } as never });
    expect(a.model).toBe('claude-sonnet-5-5');
    await a.propose(input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ event: 'llm.call', provider: 'vertex', feature: 'authoring-conversation', model: 'claude-sonnet-5-5', ok: true, inputTokens: 1200, outputTokens: 80 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('sends only parameters that Sonnet 5.5 and Haiku 5.5 accept, and reads text past thinking blocks', async () => {
    for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
      const create = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(proposal) }], usage: { input_tokens: 10, output_tokens: 5 } });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await expect(new VertexConversationAssistant({ projectId: 'p', region: 'global', model, client: { messages: { create } } as never }).propose(input)).resolves.toMatchObject({ question: 'Which evidence is missing?' });
      const body = create.mock.calls[0]![0];
      expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
      for (const rejected of ['thinking', 'tool_choice', 'temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(rejected);
    }
  });

  it('defaults to Claude Sonnet 5.5', () => {
    expect(new VertexConversationAssistant({ projectId: 'p', region: 'global', client: { messages: { create: vi.fn() } } as never }).model).toBe('claude-sonnet-5-5');
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
