import { GoogleAuth } from 'google-auth-library';

/** D2 step 3: one narration track per chapter, as 16-bit mono WAV so its length is known exactly. */
export interface NarrationSynthesizer {
  readonly voice: string;
  synthesize(text: string): Promise<{ audio: Buffer; seconds: number }>;
}

const SAMPLE_RATE = 24_000;

/** Length of a 16-bit mono PCM WAV (the 44-byte header Text-to-Speech returns for LINEAR16). */
export function wavSeconds(wav: Buffer, sampleRate = SAMPLE_RATE): number {
  return Math.max(0, wav.length - 44) / (sampleRate * 2);
}

/** A silent WAV of this length (the mock narration). */
export function silentWav(seconds: number, sampleRate = SAMPLE_RATE): Buffer {
  const data = Math.round(seconds * sampleRate) * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Cloud Text-to-Speech `text:synthesize`, one Chirp 3 HD voice, LINEAR16 at 24 kHz. */
export class CloudTextToSpeech implements NarrationSynthesizer {
  private auth: GoogleAuth | undefined;
  constructor(readonly voice: string, private readonly opts: { projectId: string; fetch?: Fetch; token?: () => Promise<string> }) {}
  async synthesize(text: string) {
    this.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = this.opts.token ? await this.opts.token() : ((await (await this.auth.getClient()).getAccessToken()).token ?? '');
    const res = await (this.opts.fetch ?? (fetch as unknown as Fetch))('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': this.opts.projectId },
      body: JSON.stringify({ input: { text }, voice: { languageCode: this.voice.slice(0, 5), name: this.voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Text-to-Speech call failed (${res.status})`);
    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) throw new Error('Text-to-Speech returned no audio');
    const audio = Buffer.from(body.audioContent, 'base64');
    return { audio, seconds: wavSeconds(audio) };
  }
}

/** Silence at about 150 words a minute: lengths are realistic, nothing is called. */
export class MockNarration implements NarrationSynthesizer {
  readonly voice = 'mock-voice';
  readonly texts: string[] = [];
  async synthesize(text: string) {
    this.texts.push(text);
    const seconds = Math.max(3, Math.round((text.split(/\s+/).length / 150) * 60));
    const audio = silentWav(Math.min(seconds, 2));
    return { audio, seconds };
  }
}
