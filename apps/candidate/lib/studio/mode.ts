/**
 * Where these screens get their data. `live` (the default) calls the API through /api/v1. `mock` serves an in-process
 * stand-in (lib/studio/mock-backend.ts) for local UI work only: it needs NEXT_PUBLIC_META_COMPILER_API=mock and is never used in a
 * production build, so a deployed console cannot show synthetic data.
 */
export type StudioApiMode = 'mock' | 'live';

export const STUDIO_API_MODE: StudioApiMode =
  process.env.NEXT_PUBLIC_META_COMPILER_API === 'mock' && process.env.NODE_ENV !== 'production' ? 'mock' : 'live';

/** Browser base path for studio calls. Both bases serve the same paths. */
export const STUDIO_BROWSER_BASE = STUDIO_API_MODE === 'live' ? '/api/v1' : '/api/studio-mock';
