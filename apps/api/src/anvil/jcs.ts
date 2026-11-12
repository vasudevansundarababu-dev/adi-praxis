import { createHash } from 'node:crypto';

/**
 * RFC 8785 (JCS) canonical JSON and its SHA-256, as agreed with Anvil for every generic identity hash (Anvil's four
 * confirmations, 11 Nov 2026): keys sorted by UTF-16 code units, no whitespace, ECMAScript number formatting, no
 * Unicode normalisation, arrays in order, omitted differs from empty. Values that RFC 8785 cannot represent are
 * refused rather than coerced: non-finite numbers, lone surrogates, `undefined` inside arrays, and anything that is
 * not plain JSON.
 */
export class JcsError extends Error {}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function str(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new JcsError('JCS cannot encode a lone surrogate');
  return JSON.stringify(s);
}

export function jcs(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return str(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new JcsError('JCS cannot encode a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => {
        if (v === undefined) throw new JcsError('JCS cannot encode undefined in an array');
        return jcs(v);
      })
      .join(',')}]`;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new JcsError('JCS encodes plain JSON objects only');
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${str(k)}:${jcs(v)}`).join(',')}}`;
  }
  throw new JcsError(`JCS cannot encode ${typeof value}`);
}

export const jcsBytes = (value: unknown) => Buffer.from(jcs(value), 'utf8');

/** lowercase_hex(SHA256(UTF8(RFC8785(value)))). */
export const jcsSha256 = (value: unknown) => createHash('sha256').update(jcs(value), 'utf8').digest('hex');

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
