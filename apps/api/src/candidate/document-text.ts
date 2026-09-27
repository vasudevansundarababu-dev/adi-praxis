import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { AppError } from '../lib/errors';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Below this many characters the file is treated as scanned or empty (FLOW2 C03: needs confirmed transcription). */
export const MIN_TEXT_CHARS = 40;

export type DocumentKind = 'pdf' | 'docx';

/** Identifies the file by its signature, not its name. */
export function sniff(buf: Buffer): DocumentKind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX is a ZIP container holding word/document.xml.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return 'docx';
  return null;
}

/**
 * Extracts plain text from an owner-uploaded JD. The result is untrusted source material: it is shown to the owner
 * for review and only used once confirmed (CF-07, CF-14).
 */
export async function extractDocumentText(buf: Buffer): Promise<{ kind: DocumentKind; text: string }> {
  if (buf.length > MAX_DOCUMENT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
  const kind = sniff(buf);
  if (!kind) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload a PDF or Word (.docx) file.');

  let text: string;
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const out = await extractText(pdf, { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join('\n') : out.text;
    } else {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    }
  } catch {
    throw new AppError(422, 'UNREADABLE_FILE', 'We could not read this file. Paste the text instead.');
  }
  text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < MIN_TEXT_CHARS) {
    throw new AppError(422, 'NO_TEXT_FOUND', 'This file has no readable text (it may be a scan). Paste the text instead.');
  }
  return { kind, text };
}
