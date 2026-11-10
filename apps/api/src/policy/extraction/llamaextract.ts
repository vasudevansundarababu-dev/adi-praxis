import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, type CandidateCitation, type CandidateRule } from '@praxis/shared';
import type { PolicyConfig } from '../../config';
import { toCandidate } from './normalise';
import { ProviderError, type ExtractionAdapter, type ExtractionInput, type ProfileSnapshot, type ProviderResult, type ProviderStatus } from './types';

type Fetch = typeof fetch;

/** Allowlisted hosts; a configured base URL elsewhere is refused (S2 §10 endpoint allowlist). */
const ALLOWED_HOSTS = new Set(['api.cloud.llamaindex.ai', 'api.cloud.eu.llamaindex.ai']);
/** Pay-as-you-go price per 1,000 credits (LlamaParse billing, checked 9 Nov 2026). */
export const LLAMA_USD_PER_1000_CREDITS = 1.5;

/**
 * Hosted LlamaExtract v2 (https://developers.llamaindex.ai/llamaparse/extract/api/). Upload the immutable version as an
 * extraction file, run an inline-schema job pinned to the profile's tier and version, poll, read the result with
 * citations and usage, then delete the uploaded file. Operation id = "<extractJobId>|<fileId>".
 */
export class LlamaExtractAdapter implements ExtractionAdapter {
  readonly provider = 'llamaextract' as const;
  constructor(
    private readonly cfg: Pick<PolicyConfig, 'live' | 'llamaextract'>,
    private readonly http: Fetch = fetch,
  ) {}

  availability(): string[] {
    const p: string[] = [];
    if (!this.cfg.live) p.push('Live extraction is switched off in this environment.');
    if (!this.cfg.llamaextract.apiKey) p.push('The LlamaExtract API key is not configured.');
    if (!this.cfg.llamaextract.projectId) p.push('The LlamaExtract project ID is not configured.');
    let host = '';
    try {
      host = new URL(this.cfg.llamaextract.baseUrl).host;
    } catch {
      // reported below
    }
    if (!ALLOWED_HOSTS.has(host)) p.push('The LlamaExtract base URL is not an allowed LlamaCloud endpoint.');
    return p;
  }

  async submit(input: ExtractionInput, profile: ProfileSnapshot) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mediaType.split(';')[0] }), input.fileName);
    form.append('purpose', 'extract');
    const file = (await this.call('POST', '/api/v1/beta/files', form)) as { id?: string };
    if (!file.id) throw new ProviderError('LlamaExtract did not return a file id.', false);
    const c = profile.config;
    const body = {
      file_input: file.id,
      configuration: {
        tier: c.tier ?? 'agentic',
        version: c.version ?? '2.5',
        ...(c.parseTier ? { parse_tier: c.parseTier } : {}),
        extraction_target: 'per_doc',
        data_schema: EXTRACTION_JSON_SCHEMA,
        cite_sources: true,
        confidence_scores: c.confidenceScores !== false,
        system_prompt: EXTRACTION_PROMPT,
      },
    };
    let job: { id?: string };
    try {
      job = (await this.call('POST', '/api/v2/extract', JSON.stringify(body), 'application/json')) as { id?: string };
    } catch (e) {
      await this.deleteFile(file.id).catch(() => undefined);
      throw e;
    }
    if (!job.id) throw new ProviderError('LlamaExtract did not return a job id.', false);
    return { operationId: `${job.id}|${file.id}` };
  }

  async getStatus(operationId: string): Promise<{ status: ProviderStatus; error?: string }> {
    const [jobId] = operationId.split('|');
    const j = (await this.call('GET', `/api/v2/extract/${encodeURIComponent(jobId!)}`)) as { status?: string; error_message?: string | null };
    const map: Record<string, ProviderStatus> = { PENDING: 'queued', RUNNING: 'running', COMPLETED: 'succeeded', FAILED: 'failed', CANCELLED: 'cancelled' };
    return { status: map[j.status ?? ''] ?? 'running', ...(j.error_message ? { error: String(j.error_message).slice(0, 500) } : {}) };
  }

  async getResult(operationId: string): Promise<ProviderResult> {
    const [jobId] = operationId.split('|');
    const raw = (await this.call('GET', `/api/v2/extract/${encodeURIComponent(jobId!)}`, undefined, undefined, ['extract_metadata', 'configuration', 'usage'])) as LlamaJob;
    return normaliseLlama(raw);
  }

  async cleanup(operationId: string) {
    const [, fileId] = operationId.split('|');
    if (!fileId) return 'not_applicable' as const;
    try {
      await this.deleteFile(fileId);
      return 'deleted' as const;
    } catch {
      return 'failed' as const;
    }
  }

  private deleteFile(fileId: string) {
    return this.call('DELETE', `/api/v1/beta/files/${encodeURIComponent(fileId)}`);
  }

  private async call(method: string, path: string, body?: FormData | string, contentType?: string, expand: string[] = []): Promise<unknown> {
    const url = new URL(path, this.cfg.llamaextract.baseUrl);
    if (!ALLOWED_HOSTS.has(url.host)) throw new ProviderError('LlamaExtract endpoint is not allowed.', false);
    url.searchParams.set('project_id', this.cfg.llamaextract.projectId);
    for (const e of expand) url.searchParams.append('expand', e);
    const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.llamaextract.apiKey}`, accept: 'application/json' };
    if (contentType) headers['content-type'] = contentType;
    let res: Response;
    try {
      res = await this.http(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      // A POST that never got a response may still have been accepted; GET/DELETE are safe to retry.
      throw new ProviderError(`LlamaExtract request failed: ${(e as Error).name}`, true, undefined, method === 'POST');
    }
    if (res.status === 204) return {};
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`LlamaExtract returned HTTP ${res.status}.`, retryable, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
    return res.json();
  }
}

interface LlamaCitation {
  page?: number;
  matching_text?: string;
  bounding_boxes?: unknown;
}
interface LlamaJob {
  id?: string;
  status?: string;
  extract_result?: { rules?: unknown[] } | null;
  extract_metadata?: { field_metadata?: { document_metadata?: { rules?: Array<Record<string, { citation?: LlamaCitation[]; confidence?: number }>> } } } | null;
  usage?: { credits?: number | null; extract_credits?: number | null; parse_credits?: number | null } | null;
}

/** Maps a LlamaExtract job (with expand=extract_metadata,usage) to canonical candidates. */
export function normaliseLlama(raw: LlamaJob): ProviderResult {
  const rules = Array.isArray(raw.extract_result?.rules) ? raw.extract_result!.rules : [];
  const meta = raw.extract_metadata?.field_metadata?.document_metadata?.rules ?? [];
  const candidates: CandidateRule[] = [];
  let dropped = 0;
  rules.forEach((r, i) => {
    const m = (Array.isArray(meta) && meta[i] && typeof meta[i] === 'object' ? meta[i] : {}) as Record<string, { citation?: LlamaCitation[]; confidence?: number }>;
    const citations: CandidateCitation[] = [];
    const add = (field: string, path: string) => {
      const list = m[field]?.citation;
      for (const c of Array.isArray(list) ? list : []) {
        if (!c || typeof c.matching_text !== 'string' || !c.matching_text.trim()) continue;
        citations.push({ fieldPath: path, role: field === 'exceptions' ? 'exception' : field === 'conditionText' ? 'qualifies' : 'supports', quote: c.matching_text.slice(0, 4000), page: Number.isInteger(c.page) && c.page! > 0 ? c.page! : null, chunkId: null, lineStart: null, lineEnd: null, confidence: typeof m[field]?.confidence === 'number' ? m[field]!.confidence! : null });
      }
    };
    add('sourceQuote', 'requirement');
    add('requirement', 'requirement');
    add('conditionText', 'applicability.conditionText');
    add('exceptions', 'exceptions');
    const quote = (r as { sourceQuote?: unknown })?.sourceQuote;
    if (!citations.some((c) => c.fieldPath === 'requirement') && typeof quote === 'string' && quote.trim()) {
      citations.push({ fieldPath: 'requirement', role: 'supports', quote: quote.slice(0, 4000), page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null });
    }
    const c = toCandidate(r, dedupe(citations));
    if (c) candidates.push(c);
    else dropped++;
  });
  const credits = raw.usage?.credits ?? null;
  return {
    raw,
    candidates,
    partial: dropped > 0,
    usage: { pages: null, credits, inputTokens: null, outputTokens: null, actualUsd: credits === null ? null : (credits / 1000) * LLAMA_USD_PER_1000_CREDITS },
  };
}

function dedupe(cs: CandidateCitation[]) {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = `${c.fieldPath}|${c.page}|${c.quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
