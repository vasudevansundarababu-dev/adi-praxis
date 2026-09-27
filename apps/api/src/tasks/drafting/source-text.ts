import { findSensitive } from '../../candidate/sensitive';
import { extractDocumentText, MAX_DOCUMENT_BYTES, MIN_TEXT_CHARS, sniff } from '../../candidate/document-text';
import { AppError } from '../../lib/errors';
import { scanForRealData } from '../synthetic-scan';

/**
 * Text from a task source (docs/TASK-DRAFTING.md section 3): PDF, DOCX, plain text, or WebVTT/SRT captions. The file
 * type comes from the bytes, never the name. Caption timestamps and cue numbers are removed; speaker labels stay.
 */
export type SourceFormat = 'pdf' | 'docx' | 'txt' | 'vtt' | 'srt';
export const SOURCE_CONTENT_TYPES: Record<SourceFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  vtt: 'text/vtt',
  srt: 'application/x-subrip',
};

const TIMING = /^\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}.*$/;

/** Plain text: valid UTF-8, no NUL bytes, and mostly printable. */
function asText(buf: Buffer): string | null {
  if (buf.includes(0)) return null;
  const s = buf.toString('utf8');
  if (s.includes('�')) return null;
  const printable = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return printable.length / Math.max(1, s.length) > 0.98 ? s.replace(/^﻿/, '') : null;
}

function captionsToText(s: string): string {
  return s
    .split(/\r?\n/)
    .filter((l) => !/^WEBVTT/.test(l) && !/^NOTE\b/.test(l) && !TIMING.test(l) && !/^\d+\s*$/.test(l))
    .map((l) => l.replace(/<\/?v(?:\s[^>]*)?>/g, (m) => (m.startsWith('</') ? '' : `${m.slice(3, -1).trim()}: `)).replace(/<[^>]+>/g, ''))
    .join('\n');
}

const tidy = (t: string) => t.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

export async function extractSourceText(buf: Buffer): Promise<{ format: SourceFormat; text: string }> {
  if (buf.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
  if (sniff(buf)) {
    const { kind, text } = await extractDocumentText(buf).catch((err: unknown) => {
      if (err instanceof AppError && err.code === 'NO_TEXT_FOUND') throw new AppError(422, 'NO_TEXT_FOUND', 'This file has no readable text (it may be a scanned image). Upload a text PDF, a Word file or a text file.');
      throw err;
    });
    return { format: kind, text };
  }
  const raw = asText(buf);
  if (raw === null) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, Word (.docx), text (.txt) or caption (.vtt, .srt) file.');
  const format: SourceFormat = /^﻿?WEBVTT/.test(raw) ? 'vtt' : /^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2},\d{3}\s*-->/.test(raw) ? 'srt' : 'txt';
  const text = tidy(format === 'txt' ? raw : captionsToText(raw));
  if (text.length < MIN_TEXT_CHARS) throw new AppError(422, 'NO_TEXT_FOUND', 'This file has too little text to draft from.');
  return { format, text };
}

export interface SourceFlag {
  kind: string;
  line: number;
  /** The line with the finding masked, so the author can find it without the value being stored. */
  preview: string;
}

/**
 * Likely real identifiers in a source (section 3.3): checksum-valid IBANs and cards, national IDs, labelled passport
 * and company numbers, real emails and phones. Returns masked previews for the author and the raw values the drafter
 * must never reproduce (kept in memory only).
 */
export function scanSource(text: string): { flags: SourceFlag[]; forbidden: string[] } {
  const flags: SourceFlag[] = [];
  const forbidden = new Set<string>();
  text.split('\n').forEach((line, i) => {
    const kinds = new Set<string>();
    let masked = line;
    for (const f of scanForRealData({ line })) {
      kinds.add(f.kind);
      if (!f.excerpt.endsWith('…')) {
        forbidden.add(f.excerpt);
        masked = masked.split(f.excerpt).join('[…]');
      }
    }
    // Emails and phones are judged by the synthetic-data scan above, which accepts reserved and fictitious ones.
    for (const m of findSensitive(line).filter((x) => x.kind !== 'EMAIL' && x.kind !== 'PHONE')) {
      kinds.add(m.kind);
      forbidden.add(m.value);
    }
    if (!kinds.size) return;
    for (const v of forbidden) masked = masked.split(v).join('[…]');
    flags.push({ kind: [...kinds].join(', '), line: i + 1, preview: masked.length > 160 ? `${masked.slice(0, 157)}…` : masked });
  });
  return { flags, forbidden: [...forbidden].filter((v) => v.length >= 4) };
}
