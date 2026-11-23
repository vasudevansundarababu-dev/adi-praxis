import { CoverageCheck } from '@praxis/shared';
import { StudioClient, studioConnected } from './studio-client';

/**
 * E-001 §4 / E-002 §5: Studio's coverage check (coverage-check.v1), which Authoring's Validate shows on needs and tasks.
 * Studio owns the endpoint (POST /api/v1/coverage-checks, Studio commits 547d1db, 61f3631, a957322): a read, same auth as
 * the inbox, one of environment_version_id or seed_family (Validate uses seed_family: the newest qualified version of the
 * data family), optional edge_cases and clauses. Without STUDIO_SEED_FAMILY, NotConnectedCoverageClient says so plainly.
 */
export interface CoverageRequest {
  template: { id: string; version: number };
  edge_case_tags: string[];
  /** The template's own edge-case entries for those tags (template.v1 edgeCase shape). */
  edge_cases?: Record<string, unknown>[];
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

/** The live check: Studio's coverage endpoint through the Studio client, for one data family (seed_family). */
export class HttpCoverageClient implements StudioCoverageClient {
  readonly connected = true;
  constructor(private readonly studio: Pick<StudioClient, 'coverageCheck'>, private readonly seedFamily: string) {}
  async check(req: CoverageRequest): Promise<CoverageResult> {
    const body: Record<string, unknown> = { seed_family: this.seedFamily, clauses: req.clauses };
    if (req.edge_cases?.length) body.edge_cases = req.edge_cases;
    const r = await this.studio.coverageCheck(body);
    if (!r.ok) return { ok: false, message: r.kind === 'unavailable' && r.httpStatus !== 404 ? `Studio could not run the coverage check just now (${r.message}). Try again.` : `Studio refused the coverage check: ${r.message}` };
    const parsed = CoverageCheck.safeParse(r.data);
    return parsed.success ? { ok: true, result: parsed.data } : { ok: false, message: 'Studio’s coverage answer did not match coverage-check.v1.' };
  }
}

/** The coverage client the app uses: a test double when given, else the live client when Studio and a data family are configured. */
export function coverageFromConfig(config: { STUDIO_API_URL: string; STUDIO_INBOX_KEY: string; STUDIO_TENANT_ID: string; STUDIO_ACTOR_ID: string; STUDIO_ACTOR_ROLES: string; STUDIO_SEED_FAMILY: string }, fetchImpl?: ConstructorParameters<typeof StudioClient>[1]): StudioCoverageClient | null {
  const st = { apiUrl: config.STUDIO_API_URL, key: config.STUDIO_INBOX_KEY, tenantId: config.STUDIO_TENANT_ID, actorId: config.STUDIO_ACTOR_ID, actorRoles: config.STUDIO_ACTOR_ROLES };
  return studioConnected(st) && config.STUDIO_SEED_FAMILY ? new HttpCoverageClient(new StudioClient(st, fetchImpl), config.STUDIO_SEED_FAMILY) : null;
}
