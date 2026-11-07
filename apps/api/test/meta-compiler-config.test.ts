import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://x/y', REDIS_URL: 'redis://x' } as NodeJS.ProcessEnv;

describe('Meta-Compiler configuration (architecture section 10, NFR-08a, NFR-09)', () => {
  it('defaults: mock runner, no live AI, no caps, real data off', () => {
    const m = loadConfig({ ...base }).metaCompiler;
    expect(m).toMatchObject({ liveAi: false, costCapUsd: null, dailyBudgetUsd: null, codegenEnabled: false, realDataEnabled: false, runner: 'mock' });
    expect(m.models.map((x) => x.provider)).toEqual(['claude', 'gemini']);
  });

  it('refuses live AI locally, in demo and in tests', () => {
    const live = { META_COMPILER_LIVE_AI: 'true', VERTEX_PROJECT_ID: 'p', GENERATION_COST_CAP_USD: '5', GENERATION_DAILY_BUDGET_USD: '50' };
    expect(() => loadConfig({ ...base, ...live })).toThrow(/only allowed in staging or production/);
    expect(() => loadConfig({ ...base, ...live, APP_ENV: 'demo', MOCK_SECRET: 'x'.repeat(40) })).toThrow(/only allowed in staging or production/);
    expect(() => loadConfig({ ...base, ...live, APP_ENV: 'staging', NODE_ENV: 'test' })).toThrow(/only allowed in staging or production/);
  });

  it('refuses live AI in staging without both caps or without Vertex', () => {
    const staging = { ...base, APP_ENV: 'staging', HARBOR_VERIFY_JOB: 'praxis-harbor-verify', META_COMPILER_LIVE_AI: 'true', VERTEX_PROJECT_ID: 'p' };
    expect(() => loadConfig({ ...staging, GENERATION_COST_CAP_USD: '5' })).toThrow(/needs GENERATION_COST_CAP_USD and GENERATION_DAILY_BUDGET_USD/);
    expect(() => loadConfig({ ...staging, VERTEX_PROJECT_ID: '', GENERATION_COST_CAP_USD: '5', GENERATION_DAILY_BUDGET_USD: '50' })).toThrow(/needs VERTEX_PROJECT_ID/);
    expect(loadConfig({ ...staging, GENERATION_COST_CAP_USD: '5', GENERATION_DAILY_BUDGET_USD: '50' }).metaCompiler).toMatchObject({ liveAi: true, costCapUsd: 5, dailyBudgetUsd: 50, runner: 'job' });
  });

  it('rejects bad caps, bad model lists and FULL_CODE without live AI', () => {
    expect(() => loadConfig({ ...base, GENERATION_COST_CAP_USD: '-1' })).toThrow(/positive number/);
    expect(() => loadConfig({ ...base, META_COMPILER_MODELS: 'openai:gpt' })).toThrow(/claude:<model> or gemini:<model>/);
    expect(() => loadConfig({ ...base, META_COMPILER_CODEGEN_ENABLED: 'true' })).toThrow(/needs META_COMPILER_LIVE_AI/);
  });

  it('runner: the job when one is named, otherwise the mock; docker never in staging or production', () => {
    expect(() => loadConfig({ ...base, HARBOR_RUNNER: 'job' })).toThrow(/needs HARBOR_VERIFY_JOB/);
    expect(loadConfig({ ...base, APP_ENV: 'staging', HARBOR_VERIFY_JOB: 'praxis-harbor-verify' }).metaCompiler.runner).toBe('job');
    expect(loadConfig({ ...base, APP_ENV: 'staging' }).metaCompiler.runner).toBe('mock');
    expect(() => loadConfig({ ...base, APP_ENV: 'staging', HARBOR_RUNNER: 'docker' })).toThrow(/local development only/);
  });
});
