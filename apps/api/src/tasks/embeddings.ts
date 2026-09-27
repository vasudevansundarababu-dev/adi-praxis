import { GoogleAuth } from 'google-auth-library';

export const EMBEDDING_DIMENSIONS = 768;

/** Text embeddings for near-duplicate detection (SPEC: Task diversity and coverage). */
export interface EmbeddingProvider {
  readonly model: string;
  embed(text: string): Promise<number[]>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Vertex AI text embeddings (`text-embedding-005`, 768 dimensions) with application-default credentials. */
export class VertexEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  constructor(private readonly opts: { projectId: string; location: string; model: string; fetch?: Fetch; token?: () => Promise<string> }) {
    this.model = opts.model;
  }
  async embed(text: string): Promise<number[]> {
    const { projectId, location, model } = this.opts;
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
    const token = this.opts.token ? await this.opts.token() : ((await (await this.auth.getClient()).getAccessToken()).token ?? '');
    const res = await (this.opts.fetch ?? (fetch as unknown as Fetch))(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instances: [{ content: text.slice(0, 20_000), task_type: 'SEMANTIC_SIMILARITY' }], parameters: { outputDimensionality: EMBEDDING_DIMENSIONS } }),
    });
    if (!res.ok) throw new Error(`Embedding request failed (${res.status})`);
    const body = (await res.json()) as { predictions?: { embeddings?: { values?: number[] } }[] };
    const values = body.predictions?.[0]?.embeddings?.values;
    if (!values || values.length !== EMBEDDING_DIMENSIONS) throw new Error('Embedding response had an unexpected shape');
    return values;
  }
}

/**
 * Local and test stand-in: feature-hashed word unigrams and bigrams, L2-normalised. Near-identical texts score close
 * to 1 and unrelated texts near 0, so duplicate detection can be exercised offline. Not a semantic model.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'hashing-768';
  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const words = text.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? [];
    const add = (term: string, w: number) => {
      let h = 2166136261;
      for (let i = 0; i < term.length; i++) h = Math.imul(h ^ term.charCodeAt(i), 16777619);
      v[(h >>> 0) % EMBEDDING_DIMENSIONS]! += (h & 1 ? 1 : -1) * w;
    };
    words.forEach((w, i) => {
      add(w, 1);
      if (i > 0) add(`${words[i - 1]} ${w}`, 0.7);
    });
    const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
