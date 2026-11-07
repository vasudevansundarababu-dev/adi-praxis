/**
 * Escaping helpers for the generators. Blueprint and SME text is always data: it reaches Python only as string
 * literals and Markdown only escaped or inside a fence, so no input can change the structure of a generated file.
 */

/** JSON with object keys sorted at every level, 2-space indent and a trailing newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Splits on every line break Python, Markdown or a browser would honour. */
export function splitLines(s: string): string[] {
  return s.split(/\r\n|[\r\n\u2028\u2029\u0085\v\f]/);
}

/** A double-quoted, ASCII-only Python string literal. */
export function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\U${cp.toString(16).padStart(8, '0')}`;
  }
  return `${out}"`;
}

function pyNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Non-finite numbers cannot be written to Python');
  return Object.is(n, -0) ? '0' : String(n);
}

/** A Python literal for JSON-like data. Dict keys are sorted; nested items go one per line. */
export function pyValue(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return pyNumber(value);
  if (typeof value === 'string') return pyStr(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${inner}${pyValue(v, indent + 4)},`).join('\n')}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${inner}${pyStr(k)}: ${pyValue(obj[k], indent + 4)},`).join('\n')}\n${pad}}`;
  }
  throw new Error(`Unsupported value for Python: ${typeof value}`);
}

/** A unique Python identifier suffix for an arbitrary id (letters, digits and _ only). */
export function pyIdent(id: string, taken: Set<string>): string {
  const base = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'item';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

// Text is always placed after a prefix on its line, so block markers (-, +, 1.) need no escape.
const MD_SPECIAL = /[\\`*_{}[\]#|~<>&]/g;

/** One line of literal text in Markdown: line breaks become spaces, Markdown and HTML punctuation is escaped. */
export function mdInline(s: string): string {
  return splitLines(s)
    .join(' ')
    .trim()
    .replace(MD_SPECIAL, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : `\\${c}`));
}

function longestRun(s: string, ch: string): number {
  let best = 0;
  let run = 0;
  for (const c of s) {
    run = c === ch ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Inline code span that holds any single-line text literally. */
export function mdCode(s: string): string {
  const flat = splitLines(s).join(' ');
  const fence = '`'.repeat(longestRun(flat, '`') + 1);
  const pad = /^[`\s]|[`\s]$/.test(flat) ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/** Fenced block that holds any text literally (the fence is longer than any run of ~ inside). */
export function mdFence(s: string, info = 'text'): string {
  const fence = '~'.repeat(Math.max(3, longestRun(s, '~') + 1));
  return `${fence}${info}\n${splitLines(s).join('\n')}\n${fence}`;
}

/** RFC 4180 CSV with \n line endings and a trailing newline. */
export function csv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
