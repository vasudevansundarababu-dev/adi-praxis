import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Deterministic ustar + gzip (AD-05): entries sorted by path, mtime 0, uid/gid 0, empty owner names, fixed modes,
 * and a gzip header with no file name or time. Node's `zlib` only; no archive dependency.
 */

export interface TarEntry {
  path: string;
  data: Uint8Array;
  mode: number;
}

const BLOCK = 512;
const enc = new TextEncoder();

function octal(n: number, width: number): string {
  return `${n.toString(8).padStart(width - 1, '0')}\0`;
}

function put(header: Uint8Array, offset: number, width: number, text: string) {
  const bytes = enc.encode(text);
  if (bytes.length > width) throw new Error(`tar header field too long: ${text}`);
  header.set(bytes, offset);
}

/** Splits a path into ustar `prefix` (<= 155 bytes) and `name` (<= 100 bytes). */
function splitPath(path: string): [string, string] {
  if (path.length <= 100) return ['', path];
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    if (i <= 155 && path.length - i - 1 <= 100) return [path.slice(0, i), path.slice(i + 1)];
  }
  throw new Error(`tar path too long: ${path}`);
}

function header(e: TarEntry): Uint8Array {
  if (!/^[\x21-\x7e]+$/.test(e.path) || e.path.startsWith('/') || e.path.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`unsafe tar path: ${JSON.stringify(e.path)}`);
  }
  const h = new Uint8Array(BLOCK);
  const [prefix, name] = splitPath(e.path);
  put(h, 0, 100, name);
  put(h, 100, 8, octal(e.mode, 8));
  put(h, 108, 8, octal(0, 8));
  put(h, 116, 8, octal(0, 8));
  put(h, 124, 12, octal(e.data.length, 12));
  put(h, 136, 12, octal(0, 12));
  put(h, 148, 8, '        ');
  put(h, 156, 1, '0');
  put(h, 257, 6, 'ustar\0');
  put(h, 263, 2, '00');
  put(h, 345, 155, prefix);
  const sum = h.reduce((a, b) => a + b, 0);
  put(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

export function writeTar(entries: TarEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.path === sorted[i - 1]!.path) throw new Error(`duplicate tar path: ${sorted[i]!.path}`);
  const size = sorted.reduce((n, e) => n + BLOCK + Math.ceil(e.data.length / BLOCK) * BLOCK, 0) + 2 * BLOCK;
  const out = new Uint8Array(size);
  let at = 0;
  for (const e of sorted) {
    out.set(header(e), at);
    out.set(e.data, at + BLOCK);
    at += BLOCK + Math.ceil(e.data.length / BLOCK) * BLOCK;
  }
  return out;
}

/** gzip with a fixed header: MTIME 0, no FNAME, OS = 3 (Unix) on every platform. */
export function gzipDeterministic(data: Uint8Array): Uint8Array {
  const gz = new Uint8Array(gzipSync(data, { level: 9 }));
  gz[9] = 3;
  return gz;
}

const dec = new TextDecoder();
const field = (h: Uint8Array, offset: number, width: number) => dec.decode(h.subarray(offset, offset + width)).replace(/\0.*$/s, '');

/** Reads the regular files of a ustar archive (the format `writeTar` produces). */
export function readTar(tar: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  for (let at = 0; at + BLOCK <= tar.length; ) {
    const h = tar.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) break;
    const name = field(h, 0, 100);
    const prefix = field(h, 345, 155);
    const size = parseInt(field(h, 124, 12), 8);
    const mode = parseInt(field(h, 100, 8), 8);
    const type = field(h, 156, 1);
    if (type === '0' || type === '') out.push({ path: prefix ? `${prefix}/${name}` : name, mode, data: tar.slice(at + BLOCK, at + BLOCK + size) });
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

export function readTarGz(bytes: Uint8Array): TarEntry[] {
  return readTar(new Uint8Array(gunzipSync(bytes)));
}
