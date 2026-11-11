import { z } from 'zod';
import { PraxisExportEnvelope } from './praxis-contract';

/**
 * Anvil's per-Project policy manifest, `praxis.anvil.project_policy.v1` (contracts/anvil/project-policy-v1/). The Zod
 * schema mirrors Anvil's `schema.json` (closed objects, same patterns, enums and limits; string lengths count Unicode
 * code points as JSON Schema does). `validateProjectPolicyManifest` adds the semantic checks JSON Schema cannot express.
 * Browser-safe: no Node APIs (SHA-256 is implemented below).
 */
export const PROJECT_POLICY_SCHEMA_VERSION = 'praxis.anvil.project_policy.v1';
export const PROJECT_POLICY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
export const PROJECT_POLICY_SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const PROJECT_POLICY_MEDIA_TYPES = ['text/plain', 'text/markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const PROJECT_POLICY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const PROJECT_POLICY_VISIBILITIES = ['agent_instruction', 'evaluator_only'] as const;
const MIB = 1024 * 1024;
export const PROJECT_POLICY_LIMITS = { sourceBytes: 10 * MIB, totalSourceBytes: 25 * MIB, manifestBytes: 2 * MIB } as const;

const codePoints = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};
const id = z.string().regex(PROJECT_POLICY_ID_PATTERN);
const sha = z.string().regex(PROJECT_POLICY_SHA256_PATTERN);
const text = z.string().superRefine((s, ctx) => {
  const n = codePoints(s);
  if (n < 1) ctx.addIssue({ code: 'custom', message: 'Must not be empty' });
  if (n > 20000) ctx.addIssue({ code: 'custom', message: 'Must be at most 20000 characters' });
});

export const AnvilPolicyRef = z.object({ policy_id: id, version: id }).strict();
export const AnvilPolicyRule = z.object({
  rule_id: id,
  requirement: text,
  source_location: text,
  severity: z.enum(PROJECT_POLICY_SEVERITIES),
  visibility: z.enum(PROJECT_POLICY_VISIBILITIES),
  rubric_criterion_ids: z.array(id).max(100).optional(),
  failure_mode_ids: z.array(id).max(100).optional(),
}).strict();
export const AnvilPolicy = z.object({ policy_id: id, version: id, title: text, source_id: id, rules: z.array(AnvilPolicyRule).max(500) }).strict();
export const AnvilPolicySource = z.object({
  id,
  path: z.string().superRefine((s, ctx) => {
    const n = codePoints(s);
    if (n < 1 || n > 240) ctx.addIssue({ code: 'custom', message: 'Must be 1 to 240 characters' });
  }),
  media_type: z.enum(PROJECT_POLICY_MEDIA_TYPES),
  size_bytes: z.number().int().min(0).max(PROJECT_POLICY_LIMITS.sourceBytes),
  sha256: sha,
}).strict();
export const AnvilProject = z.object({ id, version: id, name: text }).strict();
export const AnvilTaskPolicyBinding = z.object({
  task_id: id,
  task_version: id,
  payload_sha256: sha,
  policy_refs: z.array(AnvilPolicyRef).max(100),
  excluded_project_policy_refs: z.array(AnvilPolicyRef).max(100).optional(),
}).strict();
export const ProjectPolicyManifest = z.object({
  schema_version: z.literal(PROJECT_POLICY_SCHEMA_VERSION),
  source_project: AnvilProject,
  project_default_policy_refs: z.array(AnvilPolicyRef).max(100),
  sources: z.array(AnvilPolicySource).max(100),
  policies: z.array(AnvilPolicy).max(100),
  task_bindings: z.array(AnvilTaskPolicyBinding).max(10000),
}).strict();
export type ProjectPolicyManifest = z.infer<typeof ProjectPolicyManifest>;
export type AnvilPolicyRef = z.infer<typeof AnvilPolicyRef>;

/** One validation finding. `path` is a JSON Pointer into the manifest (or `sources/<path>`, `exports/<n>`). */
export interface ManifestProblem {
  code: ManifestProblemCode;
  path: string;
  message: string;
}
export const MANIFEST_PROBLEM_CODES = [
  'MANIFEST_TOO_LARGE', 'INVALID_ENCODING', 'INVALID_JSON', 'DUPLICATE_JSON_KEY', 'SCHEMA_VIOLATION',
  'DUPLICATE_POLICY', 'DUPLICATE_RULE_ID', 'DUPLICATE_SOURCE_ID', 'DUPLICATE_SOURCE_PATH', 'DUPLICATE_TASK_BINDING', 'DUPLICATE_POLICY_REF',
  'UNKNOWN_SOURCE', 'UNKNOWN_POLICY_REF', 'UNPORTABLE_SOURCE_PATH',
  'DEFAULT_POLICY_OMITTED', 'DEFAULT_POLICY_INCLUDED_AND_EXCLUDED', 'EXCLUSION_NOT_DEFAULT',
  'SOURCE_TOO_LARGE', 'SOURCES_TOTAL_TOO_LARGE', 'SOURCE_BYTES_MISSING', 'SOURCE_SIZE_MISMATCH', 'SOURCE_SHA256_MISMATCH', 'UNDECLARED_SOURCE_BYTES',
  'EXPORT_INVALID', 'EXPORT_PAYLOAD_DIGEST_INVALID', 'PROJECT_MISMATCH', 'TASK_EXPORT_MISSING', 'PAYLOAD_SHA256_MISMATCH', 'UNBOUND_TASK_EXPORT',
] as const;
export type ManifestProblemCode = (typeof MANIFEST_PROBLEM_CODES)[number];

const pointer = (parts: Array<string | number>) => (parts.length ? '/' + parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '');

/**
 * Portable relative path (README): `/`-separated segments; no absolute path, drive letter, URL scheme, query or fragment,
 * backslash, percent (URI) encoding, empty segment, `.`/`..` or hidden (dot-prefixed) segment, or control character.
 */
export function unportablePathReason(path: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'contains a control character';
  if (path.includes('\\')) return 'contains a backslash';
  if (path.includes('%')) return 'contains URI encoding (%)';
  if (path.includes(':')) return 'looks like a URL or drive letter (contains ":")';
  if (/[?#]/.test(path)) return 'contains a URL query or fragment';
  if (path.startsWith('/')) return 'is absolute';
  for (const seg of path.split('/')) {
    if (seg === '') return 'has an empty segment';
    if (seg === '.' || seg === '..') return 'has a "." or ".." segment';
    if (seg.startsWith('.')) return 'has a hidden segment';
    if (seg !== seg.trim()) return 'has a segment with leading or trailing spaces';
  }
  return null;
}

/**
 * Finds duplicate keys in a JSON text that JSON.parse already accepted (JSON.parse silently keeps the last one).
 * Keys are compared after unescaping, so `"a"` and `"a"` are the same key.
 */
export function duplicateJsonKeys(json: string): string[] {
  type Frame = { obj: boolean; keys: Set<string>; expectKey: boolean; index: number; key: string | null; path: Array<string | number> };
  const out: string[] = [];
  const stack: Frame[] = [];
  const here = (): Array<string | number> => {
    const top = stack.at(-1);
    if (!top) return [];
    return [...top.path, ...(top.obj ? (top.key === null ? [] : [top.key]) : [top.index])];
  };
  for (let i = 0; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') {
      let j = i + 1;
      while (json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      const value = JSON.parse(json.slice(i, j + 1)) as string;
      const top = stack.at(-1);
      if (top?.obj && top.expectKey) {
        if (top.keys.has(value)) out.push(pointer([...top.path, value]));
        top.keys.add(value);
        top.key = value;
        top.expectKey = false;
      }
      i = j;
    } else if (c === '{' || c === '[') {
      stack.push({ obj: c === '{', keys: new Set(), expectKey: c === '{', index: 0, key: null, path: here() });
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ',') {
      const top = stack.at(-1)!;
      if (top.obj) top.expectKey = true;
      else top.index++;
    }
  }
  return out;
}

/** SHA-256 (FIPS 180-4) as lowercase hex. Synchronous and dependency-free so the validator runs anywhere. */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15]!, w2 = W[t - 2]!;
      W[t] = (W[t - 16]! + (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) + W[t - 7]! + (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[];
    for (let t = 0; t < 64; t++) {
      const t1 = (h! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[t]! + W[t]!) >>> 0;
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a!) >>> 0; H[1] = (H[1]! + b!) >>> 0; H[2] = (H[2]! + c!) >>> 0; H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0; H[5] = (H[5]! + f!) >>> 0; H[6] = (H[6]! + g!) >>> 0; H[7] = (H[7]! + h!) >>> 0;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

const refKey = (r: AnvilPolicyRef) => `${r.policy_id}@${r.version}`;

export interface ValidateOptions {
  /**
   * The `praxis.anvil.export.v1` envelopes this manifest accompanies. When given, every binding must match an export
   * of the same task id and version byte for byte (`payload_sha256`), and every export must be bound. Without them the
   * payload digest can only be checked for shape, which is why Anvil's placeholder digest passes on its own.
   */
  exports?: unknown[];
}

/**
 * Validates a manifest as Anvil will: size, UTF-8, JSON with no duplicate keys, the schema, then the semantic rules in
 * the contract README (unique identities, resolved references, complete default/exclusion lists, portable paths, size
 * limits and exact source bytes). Returns every problem found; an empty list means valid.
 */
export function validateProjectPolicyManifest(manifestBytes: Uint8Array, sources: Map<string, Uint8Array>, opts: ValidateOptions = {}): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const add = (code: ManifestProblemCode, path: Array<string | number> | string, message: string) => problems.push({ code, path: typeof path === 'string' ? path : pointer(path), message });

  if (manifestBytes.length > PROJECT_POLICY_LIMITS.manifestBytes) {
    add('MANIFEST_TOO_LARGE', [], `The manifest is ${manifestBytes.length} bytes; the limit is ${PROJECT_POLICY_LIMITS.manifestBytes}.`);
    return problems;
  }
  let textValue: string;
  try {
    textValue = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  } catch {
    add('INVALID_ENCODING', [], 'The manifest is not valid UTF-8.');
    return problems;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textValue);
  } catch (e) {
    add('INVALID_JSON', [], `The manifest is not valid JSON: ${(e as Error).message}`);
    return problems;
  }
  for (const p of duplicateJsonKeys(textValue)) add('DUPLICATE_JSON_KEY', p, 'This key appears more than once in the same object.');

  const parsed = ProjectPolicyManifest.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) add('SCHEMA_VIOLATION', i.path as Array<string | number>, i.message);
    return problems;
  }
  const m = parsed.data;

  // Sources: unique ids and (case-insensitive) paths, portable paths, limits and exact bytes.
  const sourceIds = new Set<string>();
  const sourcePaths = new Set<string>();
  let declaredTotal = 0;
  m.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) add('DUPLICATE_SOURCE_ID', ['sources', i, 'id'], `Source id ${s.id} is declared more than once.`);
    sourceIds.add(s.id);
    const lower = s.path.toLowerCase();
    if (sourcePaths.has(lower)) add('DUPLICATE_SOURCE_PATH', ['sources', i, 'path'], `Source path ${s.path} is declared more than once (paths compare case-insensitively).`);
    sourcePaths.add(lower);
    const why = unportablePathReason(s.path);
    if (why) add('UNPORTABLE_SOURCE_PATH', ['sources', i, 'path'], `Source path ${why}.`);
    declaredTotal += s.size_bytes;
    const bytes = sources.get(s.path);
    if (!bytes) {
      add('SOURCE_BYTES_MISSING', ['sources', i], `No bytes were supplied for ${s.path}.`);
      return;
    }
    if (bytes.length > PROJECT_POLICY_LIMITS.sourceBytes) add('SOURCE_TOO_LARGE', ['sources', i], `${s.path} is ${bytes.length} bytes; the limit is ${PROJECT_POLICY_LIMITS.sourceBytes}.`);
    if (bytes.length !== s.size_bytes) add('SOURCE_SIZE_MISMATCH', ['sources', i, 'size_bytes'], `${s.path} is ${bytes.length} bytes, not the declared ${s.size_bytes}.`);
    if (sha256Hex(bytes) !== s.sha256) add('SOURCE_SHA256_MISMATCH', ['sources', i, 'sha256'], `The bytes of ${s.path} do not hash to the declared sha256.`);
  });
  if (declaredTotal > PROJECT_POLICY_LIMITS.totalSourceBytes) add('SOURCES_TOTAL_TOO_LARGE', ['sources'], `Sources total ${declaredTotal} bytes; the limit is ${PROJECT_POLICY_LIMITS.totalSourceBytes}.`);
  const declaredPaths = new Set(m.sources.map((s) => s.path));
  for (const p of sources.keys()) if (!declaredPaths.has(p)) add('UNDECLARED_SOURCE_BYTES', `sources/${p}`, `Bytes were supplied for ${p}, which the manifest does not declare.`);

  // Policies: unique identity+version, unique rule ids within each, resolved source.
  const policies = new Set<string>();
  m.policies.forEach((p, i) => {
    const k = refKey(p);
    if (policies.has(k)) add('DUPLICATE_POLICY', ['policies', i], `Policy ${k} is declared more than once.`);
    policies.add(k);
    if (!sourceIds.has(p.source_id)) add('UNKNOWN_SOURCE', ['policies', i, 'source_id'], `Policy ${k} refers to source ${p.source_id}, which is not declared.`);
    const rules = new Set<string>();
    p.rules.forEach((r, j) => {
      if (rules.has(r.rule_id)) add('DUPLICATE_RULE_ID', ['policies', i, 'rules', j, 'rule_id'], `Rule ${r.rule_id} appears more than once in policy ${k}.`);
      rules.add(r.rule_id);
    });
  });

  const refList = (refs: AnvilPolicyRef[], base: Array<string | number>) => {
    const seen = new Set<string>();
    refs.forEach((r, i) => {
      const k = refKey(r);
      if (seen.has(k)) add('DUPLICATE_POLICY_REF', [...base, i], `Policy ${k} is listed more than once here.`);
      seen.add(k);
      if (!policies.has(k)) add('UNKNOWN_POLICY_REF', [...base, i], `Policy ${k} is not declared in policies.`);
    });
    return seen;
  };
  const defaults = refList(m.project_default_policy_refs, ['project_default_policy_refs']);

  // Task bindings: unique task id+version; every default either applied or explicitly excluded, never both or neither.
  const bindings = new Map<string, number>();
  m.task_bindings.forEach((b, i) => {
    const k = `${b.task_id}@${b.task_version}`;
    if (bindings.has(k)) add('DUPLICATE_TASK_BINDING', ['task_bindings', i], `Task ${k} is bound more than once.`);
    bindings.set(k, i);
    const applied = refList(b.policy_refs, ['task_bindings', i, 'policy_refs']);
    const excluded = refList(b.excluded_project_policy_refs ?? [], ['task_bindings', i, 'excluded_project_policy_refs']);
    (b.excluded_project_policy_refs ?? []).forEach((r, j) => {
      if (!defaults.has(refKey(r))) add('EXCLUSION_NOT_DEFAULT', ['task_bindings', i, 'excluded_project_policy_refs', j], `Policy ${refKey(r)} is not a project default, so it cannot be excluded.`);
    });
    for (const d of defaults) {
      if (applied.has(d) && excluded.has(d)) add('DEFAULT_POLICY_INCLUDED_AND_EXCLUDED', ['task_bindings', i], `Default policy ${d} is both applied and excluded.`);
      else if (!applied.has(d) && !excluded.has(d)) add('DEFAULT_POLICY_OMITTED', ['task_bindings', i], `Default policy ${d} is neither applied nor explicitly excluded.`);
    }
  });

  // Exact task payload binding, when the exports are at hand.
  if (opts.exports) {
    const exported = new Map<string, { sha: string; n: number }>();
    opts.exports.forEach((e, n) => {
      const env = PraxisExportEnvelope.safeParse(e);
      if (!env.success) return void add('EXPORT_INVALID', `exports/${n}`, 'Not a praxis.anvil.export.v1 envelope.');
      if (sha256Hex(env.data.payload_json) !== env.data.payload_sha256) add('EXPORT_PAYLOAD_DIGEST_INVALID', `exports/${n}`, 'The envelope payload_json does not hash to its payload_sha256.');
      if (env.data.source.project_id !== m.source_project.id) add('PROJECT_MISMATCH', `exports/${n}`, `The export belongs to project ${env.data.source.project_id}, not ${m.source_project.id}.`);
      let payload: { task_id?: unknown; task_version?: unknown };
      try {
        payload = JSON.parse(env.data.payload_json) as typeof payload;
      } catch {
        return void add('EXPORT_INVALID', `exports/${n}`, 'payload_json is not JSON.');
      }
      exported.set(`${String(payload.task_id)}@${String(payload.task_version)}`, { sha: env.data.payload_sha256, n });
    });
    m.task_bindings.forEach((b, i) => {
      const k = `${b.task_id}@${b.task_version}`;
      const e = exported.get(k);
      if (!e) add('TASK_EXPORT_MISSING', ['task_bindings', i], `No task export for ${k} accompanies this manifest.`);
      else if (e.sha !== b.payload_sha256) add('PAYLOAD_SHA256_MISMATCH', ['task_bindings', i, 'payload_sha256'], `The binding for ${k} does not match the export's payload_sha256.`);
    });
    for (const [k, e] of exported) if (!bindings.has(k)) add('UNBOUND_TASK_EXPORT', `exports/${e.n}`, `Task export ${k} has no binding in this manifest.`);
  }
  return problems;
}
