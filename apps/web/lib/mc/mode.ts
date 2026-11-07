/**
 * Where the Meta-Compiler screens get their data. `mock` serves the Stream 2 routes (architecture §5) from an
 * in-process mock (lib/mc/mock-backend.ts) until they land; `live` calls the API. Switching to the real routes means
 * changing only this default (or setting NEXT_PUBLIC_META_COMPILER_API=live) and deleting the mock.
 */
export type McApiMode = 'mock' | 'live';

export const MC_API_MODE: McApiMode = process.env.NEXT_PUBLIC_META_COMPILER_API === 'live' ? 'live' : 'mock';

/** Browser base path for Meta-Compiler calls. Both bases serve the same paths. */
export const MC_BROWSER_BASE = MC_API_MODE === 'live' ? '/api/v1' : '/api/mc-mock';
