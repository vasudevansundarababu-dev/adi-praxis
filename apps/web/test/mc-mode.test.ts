import { afterEach, describe, expect, it, vi } from 'vitest';

async function modes() {
  vi.resetModules();
  const mc = await import('@/lib/mc/mode');
  const studio = await import('../../candidate/lib/studio/mode');
  return { mc: mc.MC_API_MODE, mcBase: mc.MC_BROWSER_BASE, studio: studio.STUDIO_API_MODE, studioBase: studio.STUDIO_BROWSER_BASE };
}

describe('Meta-Compiler and studio data source', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('calls the real API by default', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_COMPILER_API', '');
    expect(await modes()).toEqual({ mc: 'live', mcBase: '/api/v1', studio: 'live', studioBase: '/api/v1' });
  });

  it('serves the mock only when asked for outside production', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_COMPILER_API', 'mock');
    vi.stubEnv('NODE_ENV', 'development');
    expect(await modes()).toMatchObject({ mc: 'mock', mcBase: '/api/mc-mock', studio: 'mock', studioBase: '/api/studio-mock' });
  });

  it('never serves the mock in a production build', async () => {
    vi.stubEnv('NEXT_PUBLIC_META_COMPILER_API', 'mock');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await modes()).toMatchObject({ mc: 'live', studio: 'live' });
  });
});
