import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TutorialCard, TutorialChapter } from '@praxis/shared';

const run = promisify(execFile);

export const CLIP_SECONDS = 8;
export const CLIPS_PER_CHAPTER = 2;
/** The title card is on screen alone for this long before the field cards start. */
const TITLE_SECONDS = 3;
/** Each field card stays at least this long. */
const CARD_SECONDS = 4;

export interface ChapterMedia {
  title: string;
  narration: string;
  cards: TutorialCard[];
  clips: Buffer[];
  audio: Buffer;
  audioSeconds: number;
}

/** D2 step 4: one MP4 with chapter markers, plus WebVTT captions from the narration. */
export interface Stitcher {
  stitch(chapters: ChapterMedia[]): Promise<{ video: Buffer; captions: string; chapters: TutorialChapter[]; durationSeconds: number }>;
}

/** A chapter lasts long enough for its clips, its narration (plus a beat) and its field cards. Whole seconds. */
export function chapterSeconds(c: { audioSeconds: number; cards: unknown[] }): number {
  return Math.ceil(Math.max(CLIP_SECONDS * CLIPS_PER_CHAPTER, c.audioSeconds + 1, TITLE_SECONDS + c.cards.length * CARD_SECONDS));
}

/** Chapter markers: where each chapter starts, in seconds. */
export function chapterMarkers(chapters: { title: string; audioSeconds: number; cards: unknown[] }[]): { markers: TutorialChapter[]; durationSeconds: number } {
  let at = 0;
  const markers = chapters.map((c) => {
    const m = { title: c.title, at };
    at += chapterSeconds(c);
    return m;
  });
  return { markers, durationSeconds: at };
}

const vttTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

/** Captions: each chapter's narration split into sentences, timed by length across that chapter's narration. */
export function captionsVtt(chapters: { narration: string; audioSeconds: number; cards: unknown[]; title: string }[]): string {
  const { markers } = chapterMarkers(chapters);
  const cues: string[] = [];
  chapters.forEach((c, i) => {
    const sentences = c.narration.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    const total = sentences.reduce((n, s) => n + s.length, 0) || 1;
    let t = markers[i]!.at;
    for (const s of sentences) {
      const d = (s.length / total) * Math.max(c.audioSeconds, 1);
      cues.push(`${vttTime(t)} --> ${vttTime(t + d)}\n${s.replace(/-->/g, '→')}`);
      t += d;
    }
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** Hard-wraps text for ffmpeg drawtext, which does not wrap. */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
/** A card's on-screen text, short enough for its box (at most about 8 lines at 1280×720). */
export function cardText(card: TutorialCard): string {
  return [wrap(cut(card.label, 60), 60), wrap(cut(card.need, 240), 80), card.example ? wrap(cut(`Good answer: ${card.example}`, 160), 80) : ''].filter(Boolean).join('\n\n');
}

const FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'];

/**
 * Stitches with ffmpeg (installed in the API/worker image). All on-screen words come from text files written from the
 * validated script, so nothing in the script is parsed as a filter. Each chapter: the two clips, then the last frame
 * held, a title bar, and the field cards one after another; the narration underneath. Segments share one encoding,
 * so they are joined without re-encoding, with MP4 chapter metadata.
 */
export class FfmpegStitcher implements Stitcher {
  constructor(private readonly opts: { ffmpeg?: string; font?: string; timeoutMs?: number } = {}) {}

  private font() {
    const f = this.opts.font ?? FONTS.find((x) => existsSync(x));
    if (!f) throw new Error('No font found for the tutorial cards (install fonts-dejavu-core)');
    return f;
  }

  async stitch(chapters: ChapterMedia[]) {
    const dir = await mkdtemp(path.join(tmpdir(), 'tutorial-'));
    const ffmpeg = (args: string[]) => run(this.opts.ffmpeg ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: this.opts.timeoutMs ?? 10 * 60_000, maxBuffer: 16 * 1024 * 1024 });
    try {
      const font = this.font();
      const { markers, durationSeconds } = chapterMarkers(chapters);
      const segments: string[] = [];
      for (const [i, c] of chapters.entries()) {
        const d = chapterSeconds(c);
        const inputs: string[] = [];
        for (const [j, clip] of c.clips.entries()) {
          const f = path.join(dir, `c${i}_${j}.mp4`);
          await writeFile(f, clip);
          inputs.push('-i', f);
        }
        const wav = path.join(dir, `n${i}.wav`);
        await writeFile(wav, c.audio);
        inputs.push('-i', wav);
        const titleFile = path.join(dir, `t${i}.txt`);
        await writeFile(titleFile, wrap(c.title, 60));
        const draw = [`drawbox=x=0:y=0:w=iw:h=90:color=0x2B1B4D@0.85:t=fill`, `drawtext=fontfile=${font}:textfile=${titleFile}:x=40:y=28:fontsize=36:fontcolor=white`];
        const slot = c.cards.length ? (d - TITLE_SECONDS) / c.cards.length : 0;
        for (const [k, card] of c.cards.entries()) {
          const f = path.join(dir, `k${i}_${k}.txt`);
          await writeFile(f, cardText(card));
          const a = (TITLE_SECONDS + k * slot).toFixed(2);
          const b = (TITLE_SECONDS + (k + 1) * slot).toFixed(2);
          draw.push(`drawbox=x=40:y=ih-330:w=iw-80:h=290:color=black@0.7:t=fill:enable='between(t,${a},${b})'`);
          draw.push(`drawtext=fontfile=${font}:textfile=${f}:x=64:y=h-310:fontsize=24:line_spacing=8:fontcolor=white:enable='between(t,${a},${b})'`);
        }
        const n = c.clips.length;
        const scaled = c.clips.map((_, j) => `[${j}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=24[v${j}]`);
        const graph = [...scaled, `${c.clips.map((_, j) => `[v${j}]`).join('')}concat=n=${n}:v=1:a=0[vc]`, `[vc]tpad=stop_mode=clone:stop_duration=${d}[vp]`, `[vp]${draw.join(',')}[vout]`, `[${n}:a]aresample=48000,apad[aout]`].join(';');
        const seg = path.join(dir, `s${i}.mp4`);
        await ffmpeg([...inputs, '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-t', String(d), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '24', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', seg]);
        segments.push(seg);
      }
      const list = path.join(dir, 'list.txt');
      await writeFile(list, segments.map((s) => `file '${s}'`).join('\n'));
      const meta = path.join(dir, 'meta.txt');
      const esc = (s: string) => s.replace(/[=;#\\\n]/g, (ch) => (ch === '\n' ? ' ' : `\\${ch}`));
      await writeFile(meta, [';FFMETADATA1', ...markers.flatMap((m, i) => ['[CHAPTER]', 'TIMEBASE=1/1', `START=${m.at}`, `END=${markers[i + 1]?.at ?? durationSeconds}`, `title=${esc(m.title)}`])].join('\n'));
      const out = path.join(dir, 'tutorial.mp4');
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', out]);
      return { video: await readFile(out), captions: captionsVtt(chapters), chapters: markers, durationSeconds };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** No ffmpeg: placeholder bytes with the real chapter timing and captions. Local, tests and CI. */
export class MockStitcher implements Stitcher {
  readonly calls: ChapterMedia[][] = [];
  async stitch(chapters: ChapterMedia[]) {
    this.calls.push(chapters);
    const { markers, durationSeconds } = chapterMarkers(chapters);
    return { video: Buffer.from(`mock-video:${chapters.length}`), captions: captionsVtt(chapters), chapters: markers, durationSeconds };
  }
}
