import { randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, type CandidateCitation, type CandidateRule } from '@praxis/shared';
import type { PolicyConfig } from '../../config';
import { lineOf } from '../document-reader';
import { toCandidate } from './normalise';
import { ProviderError, type ExtractionAdapter, type ExtractionInput, type ProfileSnapshot, type ProviderResult } from './types';

type Fetch = typeof fetch;

/** Gemini Flash on Vertex, standard paid tier (USD per 1M tokens, checked 9 Nov 2026); Layout Parser per page. */
const GEMINI_USD_PER_M_INPUT = 0.3;
const GEMINI_USD_PER_M_OUTPUT = 2.5;
const LAYOUT_PARSER_USD_PER_PAGE = 0.01;
const TEXT_CHUNK_LINES = 40;

export interface Chunk {
  id: string;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
}

/**
 * Google option (owner D-G1, architecture A4): Document AI Layout Parser (location us, online imageless mode, which
 * accepts up to 30 pages) chunks PDF/DOCX with page spans; TXT/MD are chunked by Praxis by line ranges. A pinned
 * Gemini Flash model on Vertex (us-central1) extracts rules against the canonical schema, citing chunk IDs. Praxis
 * then maps chunk IDs back to pages/lines and checks each quote. Synchronous: the result is returned from submit.
 */
export class GoogleLayoutGeminiAdapter implements ExtractionAdapter {
  readonly provider = 'google' as const;
  private auth: GoogleAuth | undefined;
  constructor(
    private readonly cfg: Pick<PolicyConfig, 'live' | 'google'>,
    private readonly http: Fetch = fetch,
    private readonly token?: () => Promise<string>,
  ) {}

  availability(): string[] {
    const p: string[] = [];
    if (!this.cfg.live) p.push('Live extraction is switched off in this environment.');
    if (!this.cfg.google.projectId) p.push('The Google Cloud project (VERTEX_PROJECT_ID) is not configured.');
    if (!/^projects\/[^/]+\/locations\/[a-z0-9-]+\/processors\/[A-Za-z0-9]+$/.test(this.cfg.google.processor)) p.push('The Document AI Layout Parser processor is not configured.');
    if (!/flash/i.test(this.cfg.google.geminiModel)) p.push('The Gemini model must be a pinned Flash model.');
    return p;
  }

  async submit(input: ExtractionInput, profile: ProfileSnapshot) {
    let chunks: Chunk[];
    let layoutPages = 0;
    let layoutRaw: unknown = null;
    if (input.format === 'pdf' || input.format === 'docx') {
      const out = await this.layoutParse(input);
      chunks = out.chunks;
      layoutRaw = out.raw;
      layoutPages = input.pageCount;
    } else {
      chunks = textChunks(input.text);
    }
    if (!chunks.length) throw new ProviderError('The document produced no text chunks.', false);
    const model = String(profile.config.model ?? this.cfg.google.geminiModel);
    const gen = await this.generate(model, chunks);
    const result = normaliseGemini(gen.json, chunks, input);
    const usd = layoutPages * LAYOUT_PARSER_USD_PER_PAGE + (gen.inputTokens * GEMINI_USD_PER_M_INPUT + gen.outputTokens * GEMINI_USD_PER_M_OUTPUT) / 1e6;
    return {
      operationId: `google-${randomUUID()}`,
      result: {
        ...result,
        raw: { layout: layoutRaw, gemini: gen.raw, model, chunks: chunks.map((c) => ({ id: c.id, pageStart: c.pageStart, pageEnd: c.pageEnd, lineStart: c.lineStart, lineEnd: c.lineEnd })) },
        usage: { pages: layoutPages || null, credits: null, inputTokens: gen.inputTokens, outputTokens: gen.outputTokens, actualUsd: Math.round(usd * 10000) / 10000 },
      },
    };
  }

  async getStatus() {
    return { status: 'succeeded' as const };
  }

  async getResult(): Promise<ProviderResult> {
    throw new ProviderError('Google results are returned at submission.', false);
  }

  async cleanup() {
    return 'not_applicable' as const;
  }

  private async bearer() {
    if (this.token) return this.token();
    this.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return (await (await this.auth.getClient()).getAccessToken()).token ?? '';
  }

  private async post(url: string, body: unknown, label: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.http(url, { method: 'POST', headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new ProviderError(`${label} request failed: ${(e as Error).name}`, true);
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new ProviderError(`${label} returned HTTP ${res.status}.`, res.status === 429 || res.status >= 500, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
    return res.json();
  }

  private async layoutParse(input: ExtractionInput): Promise<{ chunks: Chunk[]; raw: unknown }> {
    const loc = this.cfg.google.location;
    const url = `https://${loc}-documentai.googleapis.com/v1/${this.cfg.google.processor}:process`;
    const body = {
      rawDocument: { content: input.bytes.toString('base64'), mimeType: input.mediaType.split(';')[0] },
      imagelessMode: true,
      processOptions: { layoutConfig: { chunkingConfig: { chunkSize: 500, includeAncestorHeadings: true } } },
    };
    const raw = (await this.post(url, body, 'Document AI')) as { document?: { chunkedDocument?: { chunks?: Array<{ chunkId?: string; content?: string; pageSpan?: { pageStart?: number; pageEnd?: number } }> } } };
    const chunks = (raw.document?.chunkedDocument?.chunks ?? [])
      .filter((c) => typeof c.content === 'string' && c.content.trim())
      .map((c, i) => ({ id: c.chunkId || `c${i + 1}`, text: c.content!, pageStart: c.pageSpan?.pageStart ?? null, pageEnd: c.pageSpan?.pageEnd ?? null, lineStart: null, lineEnd: null }));
    return { chunks, raw: { chunkCount: chunks.length } };
  }

  private async generate(model: string, chunks: Chunk[]) {
    const g = this.cfg.google;
    const url = `https://${g.geminiLocation}-aiplatform.googleapis.com/v1/projects/${g.projectId}/locations/${g.geminiLocation}/publishers/google/models/${model}:generateContent`;
    const doc = chunks.map((c) => `<chunk id="${c.id}">\n${c.text}\n</chunk>`).join('\n');
    const body = {
      systemInstruction: { parts: [{ text: `${EXTRACTION_PROMPT}\nPut the IDs of the chunks that contain each sourceQuote in sourceRefs.` }] },
      contents: [{ role: 'user', parts: [{ text: `<document>\n${doc}\n</document>` }] }],
      // responseJsonSchema is marked deprecated in favour of responseFormat but still supported; switch when responseFormat supports JSON schema output.
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseJsonSchema: EXTRACTION_JSON_SCHEMA, maxOutputTokens: 32_768 },
    };
    const raw = (await this.post(url, body, 'Gemini')) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    const c = raw.candidates?.[0];
    if (!c) throw new ProviderError('Gemini returned no candidate.', false);
    const text = (c.content?.parts ?? []).map((p) => p.text ?? '').join('');
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      json,
      truncated: c.finishReason === 'MAX_TOKENS',
      raw: { finishReason: c.finishReason ?? null, modelVersion: raw.modelVersion ?? null, usage: raw.usageMetadata ?? null, output: json ?? text.slice(0, 20_000) },
      inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}

/** TXT/MD chunks by line ranges, so citations get exact line numbers. */
export function textChunks(text: string): Chunk[] {
  const lines = text.split('\n');
  const out: Chunk[] = [];
  for (let i = 0; i < lines.length; i += TEXT_CHUNK_LINES) {
    const slice = lines.slice(i, i + TEXT_CHUNK_LINES).join('\n');
    if (slice.trim()) out.push({ id: `L${i + 1}`, text: slice, pageStart: null, pageEnd: null, lineStart: i + 1, lineEnd: Math.min(lines.length, i + TEXT_CHUNK_LINES) });
  }
  return out;
}

/** Maps Gemini output (shaped by EXTRACTION_JSON_SCHEMA) and chunk refs to canonical candidates. */
export function normaliseGemini(json: unknown, chunks: Chunk[], input: Pick<ExtractionInput, 'text' | 'format'>): ProviderResult {
  const rules = json && typeof json === 'object' && Array.isArray((json as { rules?: unknown }).rules) ? ((json as { rules: unknown[] }).rules) : null;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const candidates: CandidateRule[] = [];
  let dropped = 0;
  for (const r of rules ?? []) {
    const rec = (r ?? {}) as { sourceQuote?: unknown; sourceRefs?: unknown };
    const refs = Array.isArray(rec.sourceRefs) ? rec.sourceRefs.filter((x): x is string => typeof x === 'string' && byId.has(x)) : [];
    const chunk = refs.length ? byId.get(refs[0]!) : undefined;
    const citations: CandidateCitation[] = [];
    if (typeof rec.sourceQuote === 'string' && rec.sourceQuote.trim()) {
      let lineStart = chunk?.lineStart ?? null;
      let lineEnd = chunk?.lineEnd ?? null;
      if (input.format !== 'pdf' && input.format !== 'docx') {
        const at = input.text.indexOf(rec.sourceQuote);
        if (at >= 0) {
          lineStart = lineOf(input.text, at);
          lineEnd = lineOf(input.text, at + rec.sourceQuote.length - 1);
        }
      }
      citations.push({ fieldPath: 'requirement', role: 'supports', quote: rec.sourceQuote.slice(0, 4000), page: input.format === 'pdf' ? (chunk?.pageStart ?? null) : null, chunkId: chunk?.id ?? null, lineStart, lineEnd, confidence: null });
    }
    const c = toCandidate(r, citations);
    if (c) candidates.push(c);
    else dropped++;
  }
  return { raw: json, candidates, partial: rules === null || dropped > 0, usage: { pages: null, credits: null, inputTokens: null, outputTokens: null, actualUsd: null } };
}
