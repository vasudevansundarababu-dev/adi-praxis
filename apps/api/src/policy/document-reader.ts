import { inflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import type { PolicyFormat } from '@praxis/shared';
import { AppError } from '../lib/errors';

export const MAX_POLICY_BYTES = 10 * 1024 * 1024;
/** One text "page" for limits and estimates: 600 tokens at ~4 characters per token (LlamaExtract's text-page unit). */
export const TEXT_PAGE_CHARS = 2400;

export interface ReadPolicyDocument {
  format: PolicyFormat;
  mediaType: string;
  text: string;
  /** Text per original page (PDF only); empty for formats without original pages. */
  pages: string[];
  pageCount: number;
  pageCountMethod: 'pdf_pages' | 'docx_app_xml' | 'text_estimate';
  locatorGranularity: 'page' | 'line';
}

const MEDIA = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
} as const;

/** Identifies the format by content; the file name only separates Markdown from plain text. */
export function sniffPolicyFormat(buf: Buffer, fileName: string): PolicyFormat | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return zipEntry(buf, 'word/document.xml') ? 'docx' : null;
  if (buf.includes(0)) return null;
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) return null;
  return /\.(md|markdown)$/i.test(fileName) ? 'md' : 'txt';
}

export const estimateTextPages = (text: string) => Math.max(1, Math.ceil(text.length / TEXT_PAGE_CHARS));

/**
 * Reads a policy upload, counts pages and enforces the page limit (owner D-L2). PDF pages are real pages; DOCX uses
 * the page count Word stored in docProps/app.xml, else the text estimate; TXT/MD always use the text estimate.
 */
export async function readPolicyDocument(buf: Buffer, fileName: string, maxPages: number): Promise<ReadPolicyDocument> {
  if (buf.length === 0) throw new AppError(422, 'EMPTY_FILE', 'The file is empty.');
  if (buf.length > MAX_POLICY_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
  const format = sniffPolicyFormat(buf, fileName);
  if (!format) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload a PDF, Word (.docx), plain text or Markdown file. Databases, spreadsheets, images and archives are not supported.');

  let text = '';
  let pages: string[] = [];
  let pageCount: number;
  let pageCountMethod: ReadPolicyDocument['pageCountMethod'] = 'text_estimate';
  try {
    if (format === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const out = await extractText(pdf, { mergePages: false });
      pages = (Array.isArray(out.text) ? out.text : [out.text]).map(normalise);
      text = pages.join('\n\n');
      pageCount = out.totalPages;
      pageCountMethod = 'pdf_pages';
    } else if (format === 'docx') {
      text = normalise((await mammoth.extractRawText({ buffer: buf })).value);
      const stored = docxPageCount(buf);
      pageCount = stored ?? estimateTextPages(text);
      pageCountMethod = stored ? 'docx_app_xml' : 'text_estimate';
    } else {
      text = normalise(buf.toString('utf8').replace(/^\uFEFF/, ''));
      pageCount = estimateTextPages(text);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = String((e as Error)?.message ?? '');
    if (/password|encrypt/i.test(msg)) throw new AppError(422, 'ENCRYPTED_FILE', 'This file is password protected. Upload an unprotected copy.');
    throw new AppError(422, 'UNREADABLE_FILE', 'We could not read this file. Paste the text instead.');
  }
  if (pageCount > maxPages) {
    throw new AppError(422, 'TOO_MANY_PAGES', `This document has ${pageCount} pages${pageCountMethod === 'text_estimate' ? ' (estimated from its length)' : ''}. The limit is ${maxPages} pages per document; split it into smaller documents.`);
  }
  if (text.trim().length === 0) throw new AppError(422, 'NO_TEXT_FOUND', 'This file has no readable text (it may be a scan). Paste the text instead.');
  return { format, mediaType: MEDIA[format], text, pages, pageCount, pageCountMethod, locatorGranularity: format === 'pdf' ? 'page' : 'line' };
}

function normalise(s: string) {
  return s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function docxPageCount(buf: Buffer): number | null {
  const xml = zipEntry(buf, 'docProps/app.xml')?.toString('utf8');
  const m = xml?.match(/<Pages>(\d+)<\/Pages>/);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** Reads one entry from a ZIP via its central directory (stored or deflated). Null when absent or malformed. */
export function zipEntry(buf: Buffer, name: string): Buffer | null {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (entryName === name) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: 5 * 1024 * 1024 });
        } catch {
          return null;
        }
      }
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** 1-based line number of a character offset, for text-span citations. */
export function lineOf(text: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
