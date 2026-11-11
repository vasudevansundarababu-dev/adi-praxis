import { afterEach, describe, expect, it, vi } from 'vitest';

// No test may construct the real Vertex SDK client: its constructor starts a Google credentials lookup (CI has none).
const vertexCtor = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/vertex-sdk', () => ({ AnthropicVertex: vertexCtor }));
import { authoringAssistant, CONVERSATION_SYSTEM, GeminiConversationAssistant, parseAuthoringModel, VertexConversationAssistant } from '../src/tasks/conversation/assistant';

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

describe('Authoring v2.1 Gemini fallback for the chatbot (fake fetch, no network)', () => {
  afterEach(() => vi.restoreAllMocks());
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const gemini = (fetch: ReturnType<typeof vi.fn>) => new GeminiConversationAssistant('gemini-2.5-flash', { projectId: 'qa-project', location: 'global', fetch, token: async () => 'test-token' });

  it('calls Vertex generateContent once with the facilitator prompt, JSON output and the same proposal schema', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 } }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(gemini(fetch).propose(input)).resolves.toMatchObject({ question: 'Which evidence is missing?' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://aiplatform.googleapis.com/v1/projects/qa-project/locations/global/publishers/google/models/gemini-2.5-flash:generateContent');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe(CONVERSATION_SYSTEM);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 24000 });
    expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({ event: 'llm.call', vendor: 'gemini', model: 'gemini-2.5-flash', ok: true, inputTokens: 900, outputTokens: 60 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('handles Gemini 3.8 Flash thinking: skips thought parts and the thought signature, keeps only the answer text', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValue(ok({
      modelVersion: 'gemini-3.8-flash',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Thinking about which evidence is missing…', thought: true }, { text: JSON.stringify(proposal), thoughtSignature: 'c2lnbmF0dXJl' }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 40, thoughtsTokenCount: 78 },
    }));
    await expect(new GeminiConversationAssistant('gemini-3.8-flash', { projectId: 'qa-project', location: 'global', fetch, token: async () => 't' }).propose(input)).resolves.toMatchObject({ question: 'Which evidence is missing?' });
  });

  it('fails closed when thinking uses up the output budget (MAX_TOKENS)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"reply":"cut' }] } }] }));
    await expect(gemini(fetch).propose(input)).rejects.toThrow('MAX_TOKENS');
  });

  it('fails closed on an HTTP error or an answer outside the proposal schema, logging without retrying', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const denied = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(gemini(denied).propose(input)).rejects.toThrow('429');
    expect(denied).toHaveBeenCalledTimes(1);
    const odd = vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"answer":"the reference solution"}' }] } }] }));
    await expect(gemini(odd).propose(input)).rejects.toThrow();
    expect(log.mock.calls.map((c) => JSON.parse(c[0] as string).ok)).toEqual([false, false]);
  });

  it('AUTHORING_MODEL picks the provider; without a Vertex project the honest mock is used', () => {
    expect(parseAuthoringModel('gemini:gemini-2.5-flash')).toEqual({ vendor: 'gemini', model: 'gemini-2.5-flash' });
    expect(parseAuthoringModel('claude-sonnet-5-5')).toEqual({ vendor: 'claude', model: 'claude-sonnet-5-5' });
    expect(parseAuthoringModel('claude:claude-haiku-5-5')).toEqual({ vendor: 'claude', model: 'claude-haiku-5-5' });
    const base = { VERTEX_PROJECT_ID: 'p', VERTEX_LOCATION: 'global' };
    expect(authoringAssistant({ ...base, assistantMode: 'vertex', AUTHORING_MODEL: 'gemini:gemini-2.5-flash' })).toBeInstanceOf(GeminiConversationAssistant);
    expect(authoringAssistant({ ...base, assistantMode: 'vertex', AUTHORING_MODEL: 'claude-sonnet-5-5' })).toBeInstanceOf(VertexConversationAssistant);
    expect(authoringAssistant({ ...base, assistantMode: 'mock', AUTHORING_MODEL: 'gemini:gemini-2.5-flash' }).model).toBe('mock-conversation-no-model');
  });
});

describe('no credentials lookup when the chatbot is only built', () => {
  it('creates the Vertex client on the first call, not when the assistant is constructed', () => {
    vertexCtor.mockClear();
    authoringAssistant({ VERTEX_PROJECT_ID: 'p', VERTEX_LOCATION: 'global', assistantMode: 'vertex', AUTHORING_MODEL: 'claude-sonnet-5-5' });
    new VertexConversationAssistant({ projectId: 'p', region: 'global' });
    expect(vertexCtor).not.toHaveBeenCalled();
  });
});
