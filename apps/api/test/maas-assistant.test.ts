import { afterEach, describe, expect, it, vi } from 'vitest';

// Contract tests for the Vertex MaaS open-model adapter (handover chapter 11, authoring v2.1 Wave 3). Fake fetch and
// token only: no test may reach Google. GoogleAuth is mocked so any credentials lookup would be visible here.
// A plain recording class (not vi.fn), so vi.restoreAllMocks in afterEach cannot reset its behaviour.
const adc = vi.hoisted(() => ({ constructed: [] as unknown[], tokenCalls: 0 }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    constructor(opts: unknown) { adc.constructed.push(opts); }
    async getClient() { return { getAccessToken: async () => { adc.tokenCalls++; return { token: 'adc-test-token' }; } }; }
  },
}));
const vertexCtor = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/vertex-sdk', () => ({ AnthropicVertex: vertexCtor }));

import { loadConfig } from '../src/config';
import { authoringChatbotProvider } from '../src/routes/model-providers';
import {
  authoringAssistant, CONVERSATION_SYSTEM, MAAS_MAX_OUTPUT_TOKENS, maasChatEndpoint, parseAuthoringModel, VertexMaasConversationAssistant,
} from '../src/tasks/conversation/assistant';

const input = { workflow: 'KYC onboarding and refresh', current: {}, slot: { brief: 'SECRET-CASE-TEXT' }, history: [{ speaker: 'AUTHOR', content: 'SECRET-ANSWER-TEXT' }], policy: null, previousUnresolved: [] };
const proposal = { reply: 'ok', question: 'Which evidence is missing?', changes: [], ruleLinks: [], unresolved: [] };
const MODEL = 'openai/gpt-oss-120b-maas';
// Config parsing only: nothing connects to these URLs.
const env = (extra: Record<string, string> = {}) => ({ DATABASE_URL: 'postgresql://unused@localhost:1/unused', REDIS_URL: 'redis://localhost:1', ...extra });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const completion = (content: unknown, finish_reason: string | null = 'stop', usage: unknown = { prompt_tokens: 900, completion_tokens: 60, completion_tokens_details: { reasoning_tokens: 25 } }) =>
  ok({ id: 'chatcmpl-1', model: MODEL, choices: [{ index: 0, finish_reason, message: { role: 'assistant', content } }], usage });
const maas = (fetch: ReturnType<typeof vi.fn>, location = 'us-central1') => new VertexMaasConversationAssistant(MODEL, { projectId: 'qa-project', location, fetch: fetch as never, token: async () => 'test-token' });
const lastLog = (log: ReturnType<typeof vi.spyOn>) => JSON.parse(log.mock.calls.at(-1)![0] as string);

describe('Vertex MaaS open-model chatbot adapter (fake fetch, no network)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the OpenAI-compatible chat completions endpoint once with the facilitator prompt, model id and JSON output', async () => {
    const fetch = vi.fn().mockResolvedValue(completion(JSON.stringify(proposal)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(maas(fetch).propose(input)).resolves.toEqual(proposal);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/qa-project/locations/us-central1/endpoints/openapi/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-token', 'content-type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'response_format', 'stream', 'temperature']);
    expect(body).toMatchObject({ model: MODEL, max_tokens: MAAS_MAX_OUTPUT_TOKENS, response_format: { type: 'json_object' }, stream: false });
    expect(body.messages).toEqual([{ role: 'system', content: CONVERSATION_SYSTEM }, { role: 'user', content: JSON.stringify(input) }]);
    expect(lastLog(log)).toEqual({ event: 'llm.call', provider: 'vertex-maas', vendor: 'maas', feature: 'authoring-conversation', model: MODEL, ok: true, latencyMs: expect.any(Number), inputTokens: 900, outputTokens: 60, reasoningTokens: 25 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-token');
  });

  it('uses the global host for location global', () => {
    expect(maasChatEndpoint('qa-project', 'global')).toBe('https://aiplatform.googleapis.com/v1/projects/qa-project/locations/global/endpoints/openapi/chat/completions');
  });

  it('reads only the message content (reasoning returned separately is ignored) and accepts text content parts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const withReasoning = vi.fn().mockResolvedValue(ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', reasoning_content: 'thinking about evidence', content: JSON.stringify(proposal) } }] }));
    await expect(maas(withReasoning).propose(input)).resolves.toEqual(proposal);
    const parts = vi.fn().mockResolvedValue(completion([{ type: 'text', text: JSON.stringify(proposal) }]));
    await expect(maas(parts).propose(input)).resolves.toEqual(proposal);
  });

  it('fails closed on malformed JSON or an answer outside the proposal schema, logging INVALID_OUTPUT, never retrying or repairing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fenced = vi.fn().mockResolvedValue(completion('```json\n' + JSON.stringify(proposal) + '\n```'));
    await expect(maas(fenced).propose(input)).rejects.toThrow(SyntaxError);
    expect(fenced).toHaveBeenCalledTimes(1);
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'INVALID_OUTPUT', inputTokens: 900, outputTokens: 60 });
    const odd = vi.fn().mockResolvedValue(completion('{"answer":"the reference solution"}'));
    await expect(maas(odd).propose(input)).rejects.toThrow();
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'INVALID_OUTPUT' });
    const approval = vi.fn().mockResolvedValue(completion(JSON.stringify({ ...proposal, approved: true })));
    await expect(maas(approval).propose(input)).rejects.toThrow();
    const empty = vi.fn().mockResolvedValue(completion(null));
    await expect(maas(empty).propose(input)).rejects.toThrow();
  });

  it('fails closed when the output is truncated (finish_reason length) or there is no choice', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(maas(vi.fn().mockResolvedValue(completion('{"reply":"cut', 'length'))).propose(input)).rejects.toThrow('length');
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'INCOMPLETE_OUTPUT', provider: 'vertex-maas' });
    await expect(maas(vi.fn().mockResolvedValue(ok({ choices: [] }))).propose(input)).rejects.toThrow('no choice');
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'NO_CHOICE' });
  });

  it('fails closed on an HTTP error or a network failure, logging the error name only, without retrying', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const denied = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'SECRET-ECHO' } }) });
    await expect(maas(denied).propose(input)).rejects.toThrow('429');
    expect(denied).toHaveBeenCalledTimes(1);
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'VertexMaasError', provider: 'vertex-maas' });
    const down = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(maas(down).propose(input)).rejects.toThrow('aborted');
    expect(down).toHaveBeenCalledTimes(1);
    expect(lastLog(log)).toMatchObject({ ok: false, error: 'TimeoutError' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
  });

  it('refuses an oversized context before calling the model', async () => {
    const fetch = vi.fn();
    await expect(maas(fetch).propose({ ...input, slot: { brief: 'x'.repeat(170_000) } })).rejects.toThrow('exceeds limit');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a model id that is not <publisher>/<model>', () => {
    expect(() => new VertexMaasConversationAssistant('gpt-oss-120b', { projectId: 'p', location: 'global' })).toThrow('publisher');
    expect(() => loadConfig(env({ AUTHORING_MODEL: 'maas:gpt-oss-120b' }))).toThrow('maas:<publisher>/<model>');
    expect(loadConfig(env({ AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas' })).AUTHORING_MODEL).toBe('maas:openai/gpt-oss-120b-maas');
  });
});

describe('AUTHORING_MODEL=maas:<publisher>/<model> selection, admin listing and credentials', () => {
  afterEach(() => vi.restoreAllMocks());
  const base = { VERTEX_PROJECT_ID: 'qa-project', VERTEX_LOCATION: 'global', assistantMode: 'vertex' as const };

  it('parses the maas prefix and keeps the default model unchanged', () => {
    expect(parseAuthoringModel('maas:openai/gpt-oss-120b-maas')).toEqual({ vendor: 'maas', model: 'openai/gpt-oss-120b-maas' });
    expect(loadConfig(env()).AUTHORING_MODEL).toBe('claude-sonnet-5-5');
    expect(loadConfig(env()).AUTHORING_MAAS_LOCATION).toBe('');
  });

  it('builds the MaaS adapter in AUTHORING_MAAS_LOCATION, else VERTEX_LOCATION; mock mode never builds it', () => {
    const regional = authoringAssistant({ ...base, AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas', AUTHORING_MAAS_LOCATION: 'us-central1' });
    expect(regional).toBeInstanceOf(VertexMaasConversationAssistant);
    expect(regional.model).toBe('openai/gpt-oss-120b-maas');
    expect((regional as VertexMaasConversationAssistant).endpoint()).toContain('https://us-central1-aiplatform.googleapis.com/v1/projects/qa-project/locations/us-central1/');
    expect((authoringAssistant({ ...base, AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas' }) as VertexMaasConversationAssistant).endpoint()).toContain('https://aiplatform.googleapis.com/v1/projects/qa-project/locations/global/');
    expect(authoringAssistant({ ...base, assistantMode: 'mock', AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas' }).model).toBe('mock-conversation-no-model');
  });

  it('is listed by GET /admin/model-providers as vertex-maas with its location', () => {
    expect(authoringChatbotProvider({ assistantMode: 'vertex', AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas', AUTHORING_MAAS_LOCATION: 'us-central1', VERTEX_LOCATION: 'global' })).toEqual({ authoringChatbotProvider: 'vertex-maas', authoringChatbotLocation: 'us-central1' });
    expect(authoringChatbotProvider({ assistantMode: 'vertex', AUTHORING_MODEL: 'claude-sonnet-5-5', AUTHORING_MAAS_LOCATION: 'us-central1', VERTEX_LOCATION: 'global' })).toEqual({ authoringChatbotProvider: 'vertex', authoringChatbotLocation: 'global' });
    expect(authoringChatbotProvider({ assistantMode: 'mock', AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas', AUTHORING_MAAS_LOCATION: '', VERTEX_LOCATION: 'global' })).toEqual({ authoringChatbotProvider: 'mock', authoringChatbotLocation: null });
  });

  it('does not look up Google credentials when built; the ADC token is fetched on the first call only', async () => {
    adc.constructed.length = 0; adc.tokenCalls = 0; vertexCtor.mockClear();
    const a = authoringAssistant({ ...base, AUTHORING_MODEL: 'maas:openai/gpt-oss-120b-maas' });
    new VertexMaasConversationAssistant(MODEL, { projectId: 'p', location: 'global' });
    expect(adc.constructed).toEqual([]);
    expect(adc.tokenCalls).toBe(0);
    expect(vertexCtor).not.toHaveBeenCalled();

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValue(completion(JSON.stringify(proposal)));
    const live = new VertexMaasConversationAssistant(MODEL, { projectId: 'p', location: 'global', fetch: fetch as never });
    await live.propose(input);
    await live.propose(input);
    expect(adc.constructed).toEqual([{ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }]);
    expect(adc.tokenCalls).toBe(2);
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe('Bearer adc-test-token');
    expect(a).toBeInstanceOf(VertexMaasConversationAssistant);
  });
});
