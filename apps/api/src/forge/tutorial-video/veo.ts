import { GoogleAuth } from 'google-auth-library';

/** D2 step 2: one short, text-free video clip from a scene prompt. Bytes are returned; nothing is written to a bucket. */
export interface ClipGenerator {
  readonly model: string;
  generate(prompt: string, seconds: number): Promise<Buffer>;
}

export class ClipError extends Error {
  override name = 'ClipError';
  /** True when Veo's safety filter refused the prompt (retrying the same prompt is pointless; a fresh one may pass). */
  constructor(message: string, readonly filtered = false) {
    super(message);
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Prompt additions that keep on-screen words out of the clip: every word a user sees is drawn by us from the script. */
export const NEGATIVE_PROMPT = 'text, letters, words, numbers, captions, subtitles, logos, watermark, brand names, readable documents, screens with text, faces, recognisable people';

/**
 * Vertex Veo through `predictLongRunning`, polled with `fetchPredictOperation`. 720p, 16:9, video only, one sample, no
 * people. Credentials come from ADC on the first call only.
 */
export class VertexVeoClipGenerator implements ClipGenerator {
  private auth: GoogleAuth | undefined;
  constructor(
    readonly model: string,
    private readonly opts: { projectId: string; location: string; fetch?: Fetch; token?: () => Promise<string>; pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> },
  ) {}

  private base() {
    const { projectId, location } = this.opts;
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${this.model}`;
  }

  private async post(url: string, body: unknown) {
    this.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = this.opts.token ? await this.opts.token() : ((await (await this.auth.getClient()).getAccessToken()).token ?? '');
    const res = await (this.opts.fetch ?? (fetch as unknown as Fetch))(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new ClipError(`Veo call failed (${res.status})`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async generate(prompt: string, seconds: number): Promise<Buffer> {
    const started = await this.post(`${this.base()}:predictLongRunning`, {
      instances: [{ prompt }],
      parameters: { durationSeconds: seconds, aspectRatio: '16:9', resolution: '720p', generateAudio: false, sampleCount: 1, personGeneration: 'dont_allow', negativePrompt: NEGATIVE_PROMPT },
    });
    const operationName = started.name;
    if (typeof operationName !== 'string') throw new ClipError('Veo returned no operation');
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = Date.now() + (this.opts.timeoutMs ?? 10 * 60_000);
    for (;;) {
      await sleep(this.opts.pollMs ?? 10_000);
      const op = (await this.post(`${this.base()}:fetchPredictOperation`, { operationName })) as {
        done?: boolean;
        error?: { message?: string };
        response?: { videos?: { bytesBase64Encoded?: string }[]; raiMediaFilteredCount?: number; raiMediaFilteredReasons?: string[] };
      };
      if (op.done) {
        if (op.error) throw new ClipError(`Veo failed: ${op.error.message ?? 'unknown error'}`);
        const b64 = op.response?.videos?.[0]?.bytesBase64Encoded;
        if (!b64) throw new ClipError('Veo filtered the clip', (op.response?.raiMediaFilteredCount ?? 0) > 0);
        return Buffer.from(b64, 'base64');
      }
      if (Date.now() > deadline) throw new ClipError('Veo timed out');
    }
  }
}

/** Deterministic stand-in bytes: never a call. Local, tests and CI. */
export class MockClipGenerator implements ClipGenerator {
  readonly model = 'mock-veo';
  readonly prompts: string[] = [];
  constructor(private readonly fail?: (prompt: string, attempt: number) => ClipError | null) {}
  async generate(prompt: string, seconds: number) {
    this.prompts.push(prompt);
    const err = this.fail?.(prompt, this.prompts.filter((p) => p === prompt).length);
    if (err) throw err;
    return Buffer.from(`mock-clip:${seconds}s:${prompt}`);
  }
}
