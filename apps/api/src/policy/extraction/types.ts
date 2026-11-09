import type { CandidateRule } from '@praxis/shared';

export type ProviderId = 'llamaextract' | 'google';

export interface ProfileSnapshot {
  id: string;
  provider: ProviderId;
  revision: number;
  config: Record<string, unknown>;
}

/** What an adapter is given: the immutable document version bytes plus Praxis's own text reading of it. */
export interface ExtractionInput {
  bytes: Buffer;
  fileName: string;
  format: 'pdf' | 'docx' | 'txt' | 'md';
  mediaType: string;
  text: string;
  pages: string[];
  pageCount: number;
}

export type ProviderStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProviderResult {
  raw: unknown;
  candidates: CandidateRule[];
  /** Normalised usage and cost; actualUsd null when the provider has not reported it yet. */
  usage: { pages: number | null; credits: number | null; inputTokens: number | null; outputTokens: number | null; actualUsd: number | null };
  partial: boolean;
}

/**
 * One interface for every provider (S2 §6). `submit` must return once the provider has accepted the work and given
 * an operation id; the worker records it before polling so a crash never submits twice.
 */
export interface ExtractionAdapter {
  readonly provider: ProviderId;
  /** Problems that make the adapter unusable now (missing settings, live calls off). Empty = available. */
  availability(): string[];
  /** Synchronous providers may return the result at once; the worker stores it with the operation id. */
  submit(input: ExtractionInput, profile: ProfileSnapshot): Promise<{ operationId: string; result?: ProviderResult }>;
  getStatus(operationId: string, profile: ProfileSnapshot): Promise<{ status: ProviderStatus; error?: string }>;
  getResult(operationId: string, input: ExtractionInput, profile: ProfileSnapshot): Promise<ProviderResult>;
  cleanup(operationId: string, profile: ProfileSnapshot): Promise<'deleted' | 'not_applicable' | 'failed'>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    /** The request may have been accepted (e.g. timeout after sending a submit); never resubmit automatically. */
    readonly ambiguous = false,
  ) {
    super(message);
  }
}
