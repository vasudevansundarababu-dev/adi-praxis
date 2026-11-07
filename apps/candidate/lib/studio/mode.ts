/**
 * Where the studio gets its data. `mock` serves the Stream 2 studio routes (architecture §5) from an in-process mock
 * (lib/studio/mock-backend.ts) until they land; `live` calls the API. Switching means setting
 * NEXT_PUBLIC_META_COMPILER_API=live (or changing this default) and deleting the mock.
 */
export type StudioApiMode = 'mock' | 'live';

export const STUDIO_API_MODE: StudioApiMode = process.env.NEXT_PUBLIC_META_COMPILER_API === 'live' ? 'live' : 'mock';

/** Browser base path for studio calls. Both bases serve the same paths. */
export const STUDIO_BROWSER_BASE = STUDIO_API_MODE === 'live' ? '/api/v1' : '/api/studio-mock';
