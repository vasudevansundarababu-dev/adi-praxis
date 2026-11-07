import type { StudioConfigResponse } from '@praxis/shared';

/** api.ts exports the StudioConfigResponse schema without its type. */
export type StudioConfig = ReturnType<typeof StudioConfigResponse.parse>;
