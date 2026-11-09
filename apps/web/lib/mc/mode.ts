/**
 * Where these screens get their data. `live` (the default) calls the API through /api/v1. `mock` serves an in-process
 * stand-in (lib/mc/mock-backend.ts) for local UI work only: it needs NEXT_PUBLIC_META_COMPILER_API=mock and is never used in a
 * production build, so a deployed console cannot show synthetic data.
 */
export type McApiMode = 'mock' | 'live';

export const MC_API_MODE: McApiMode =
  process.env.NEXT_PUBLIC_META_COMPILER_API === 'mock' && process.env.NODE_ENV !== 'production' ? 'mock' : 'live';

/** Browser base path for Meta-Compiler calls. Both bases serve the same paths. */
export const MC_BROWSER_BASE = MC_API_MODE === 'live' ? '/api/v1' : '/api/mc-mock';
