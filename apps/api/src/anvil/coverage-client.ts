import { CoverageCheck } from '@praxis/shared';

/**
 * E-001 §4 / E-002 §5: Studio's coverage check (coverage-check.v1), which Authoring's Validate shows on needs and tasks.
 * Studio owns the endpoint; its path, request and auth are not defined yet (asked of the Studio session on 23 Nov 2026).
 * Until they are, Authoring uses NotConnectedCoverageClient, which says so plainly. Do not invent Studio's behaviour.
 */
export interface CoverageRequest {
  template: { id: string; version: number };
  edge_case_tags: string[];
  clauses: { clause_id: string; version: number; condition: unknown }[];
}
export type CoverageResult = { ok: true; result: CoverageCheck } | { ok: false; message: string };

export interface StudioCoverageClient {
  readonly connected: boolean;
  check(req: CoverageRequest): Promise<CoverageResult>;
}

export class NotConnectedCoverageClient implements StudioCoverageClient {
  readonly connected = false;
  async check(): Promise<CoverageResult> {
    return { ok: false, message: 'Coverage check not connected yet: Studio’s coverage endpoint is not available to Authoring. Validate again once it is.' };
  }
}

/** A fixed answer, for tests and local runs (validated against coverage-check.v1). */
export class FixedCoverageClient implements StudioCoverageClient {
  readonly connected = true;
  constructor(private readonly answer: unknown) {}
  async check(): Promise<CoverageResult> {
    const r = CoverageCheck.safeParse(this.answer);
    return r.success ? { ok: true, result: r.data } : { ok: false, message: 'Studio’s coverage answer did not match coverage-check.v1.' };
  }
}
