import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AnvilPolicy, AnvilPolicyRef, AnvilPolicyRule, AnvilPolicySource, AnvilProject, AnvilTaskPolicyBinding, duplicateJsonKeys, ProjectPolicyManifest,
  sha256Hex, unportablePathReason, validateProjectPolicyManifest, type ManifestProblem,
} from '../src/anvil-project-policy';

/** Anvil's contract, copied unchanged into contracts/anvil/project-policy-v1/. */
const DIR = path.resolve(import.meta.dirname, '../../../contracts/anvil/project-policy-v1');
const schema = JSON.parse(readFileSync(path.join(DIR, 'schema.json'), 'utf8'));
const exampleBytes = readFileSync(path.join(DIR, 'example.json'));
const privacy = readFileSync(path.join(DIR, 'policies/privacy.txt'));
const example = () => JSON.parse(exampleBytes.toString('utf8')) as z.infer<typeof ProjectPolicyManifest>;
const enc = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const srcs = (m = new Map([['policies/privacy.txt', new Uint8Array(privacy)]])) => m;
const codes = (p: ManifestProblem[]) => p.map((x) => x.code);
const check = (m: unknown, sources = srcs(), exports?: unknown[]) => validateProjectPolicyManifest(enc(m), sources, { exports });

/** A real export envelope built the way Praxis builds one (stable JSON payload, its sha256). */
const envelope = (taskId: string, taskVersion: string, projectId = 'banking') => {
  const payload_json = JSON.stringify({ schema_version: 'praxis.anvil.task.v1', task_id: taskId, task_version: taskVersion });
  return { schema_version: 'praxis.anvil.export.v1', source: { record_id: 'r1', record_hash: 'b'.repeat(64), project_id: projectId, client_id: 'c', submission_time: '2026-11-10T00:00:00.000Z', reviewer_id: 'u', review_decision_time: '2026-11-10T00:00:00.000Z' }, payload_json, payload_sha256: createHash('sha256').update(payload_json).digest('hex') };
};

describe('sha256Hex', () => {
  it.each([[''], ['abc'], ['a'.repeat(55)], ['a'.repeat(56)], ['a'.repeat(64)], ['é ✓ 𝄞'.repeat(100)]])('matches node:crypto for %#', (s) => {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });
  it('hashes Anvil example source to its declared digest', () => expect(sha256Hex(new Uint8Array(privacy))).toBe(example().sources[0]!.sha256));
});

describe("Anvil's example.json", () => {
  it('passes the schema and every semantic check with its source bytes', () => {
    expect(ProjectPolicyManifest.safeParse(example()).success).toBe(true);
    expect(validateProjectPolicyManifest(new Uint8Array(exampleBytes), srcs())).toEqual([]);
  });

  it('its placeholder payload digest is only detected when bound to a real export', () => {
    const real = envelope('kyc', '1');
    const problems = validateProjectPolicyManifest(new Uint8Array(exampleBytes), srcs(), { exports: [real] });
    expect(problems).toEqual([expect.objectContaining({ code: 'PAYLOAD_SHA256_MISMATCH', path: '/task_bindings/0/payload_sha256' })]);
    const m = example();
    m.task_bindings[0]!.payload_sha256 = real.payload_sha256;
    expect(check(m, srcs(), [real])).toEqual([]);
  });

  it('checks the exports themselves: digest, project, missing and unbound tasks', () => {
    const m = example();
    const real = envelope('kyc', '1');
    m.task_bindings[0]!.payload_sha256 = real.payload_sha256;
    expect(codes(check(m, srcs(), []))).toEqual(['TASK_EXPORT_MISSING']);
    expect(codes(check(m, srcs(), [real, envelope('other', '1')]))).toEqual(['UNBOUND_TASK_EXPORT']);
    expect(codes(check(m, srcs(), [{ ...real, payload_sha256: 'c'.repeat(64) }]))).toContain('EXPORT_PAYLOAD_DIGEST_INVALID');
    expect(codes(check(m, srcs(), [{ ...real, source: { ...real.source, project_id: 'elsewhere' } }]))).toEqual(['PROJECT_MISMATCH']);
    expect(codes(check(m, srcs(), [{ nope: true }]))).toContain('EXPORT_INVALID');
  });
});

describe('semantic rules: each fails with its own code', () => {
  type M = ReturnType<typeof example>;
  const cases: Array<[string, (m: M) => void, string]> = [
    ['duplicate policy id+version', (m) => m.policies.push(structuredClone(m.policies[0]!)), 'DUPLICATE_POLICY'],
    ['duplicate rule id within a policy', (m) => { m.policies[0]!.rules[1]!.rule_id = 'allowed'; }, 'DUPLICATE_RULE_ID'],
    ['duplicate source id', (m) => m.sources.push({ ...m.sources[0]!, path: 'policies/other.txt' }), 'DUPLICATE_SOURCE_ID'],
    ['duplicate source path, case-insensitively', (m) => m.sources.push({ ...m.sources[0]!, id: 'source2', path: 'Policies/PRIVACY.txt' }), 'DUPLICATE_SOURCE_PATH'],
    ['duplicate task id+version', (m) => m.task_bindings.push(structuredClone(m.task_bindings[0]!)), 'DUPLICATE_TASK_BINDING'],
    ['duplicate ref in one list', (m) => m.task_bindings[0]!.policy_refs.push({ policy_id: 'privacy', version: '1' }), 'DUPLICATE_POLICY_REF'],
    ['unknown policy source', (m) => { m.policies[0]!.source_id = 'missing'; }, 'UNKNOWN_SOURCE'],
    ['unknown default ref', (m) => m.project_default_policy_refs.push({ policy_id: 'privacy', version: '2' }), 'UNKNOWN_POLICY_REF'],
    ['unknown task ref', (m) => m.task_bindings[0]!.policy_refs.push({ policy_id: 'ghost', version: '1' }), 'UNKNOWN_POLICY_REF'],
    ['default silently omitted', (m) => { m.task_bindings[0]!.policy_refs = []; }, 'DEFAULT_POLICY_OMITTED'],
    ['default applied and excluded', (m) => { m.task_bindings[0]!.excluded_project_policy_refs = [{ policy_id: 'privacy', version: '1' }]; }, 'DEFAULT_POLICY_INCLUDED_AND_EXCLUDED'],
    ['excluding a non-default', (m) => {
      m.policies.push({ ...structuredClone(m.policies[0]!), policy_id: 'extra' });
      m.task_bindings[0]!.excluded_project_policy_refs = [{ policy_id: 'extra', version: '1' }];
    }, 'EXCLUSION_NOT_DEFAULT'],
    ['declared size differs from bytes', (m) => { m.sources[0]!.size_bytes = 61; }, 'SOURCE_SIZE_MISMATCH'],
    ['declared sha256 differs from bytes', (m) => { m.sources[0]!.sha256 = '0'.repeat(64); }, 'SOURCE_SHA256_MISMATCH'],
    ['sources total over 25 MiB', (m) => {
      for (let i = 0; i < 3; i++) m.sources.push({ ...m.sources[0]!, id: `big${i}`, path: `policies/big${i}.txt`, size_bytes: 9 * 1024 * 1024 });
    }, 'SOURCES_TOTAL_TOO_LARGE'],
  ];
  it.each(cases)('%s', (_, mutate, code) => {
    const m = example();
    mutate(m);
    expect(codes(check(m))).toContain(code);
  });

  it.each([
    ['/etc/passwd', 'is absolute'], ['policies\\privacy.txt', 'backslash'], ['policies/%2e%2e/x.txt', 'URI encoding'], ['https://example.test/p.txt', 'URL'],
    ['C:/p.txt', 'drive'], ['policies/../x.txt', '".."'], ['./x.txt', '"."'], ['policies/.hidden/x.txt', 'hidden'], ['.env', 'hidden'], ['a//b.txt', 'empty'], ['a/b.txt?x=1', 'query'],
  ])('rejects unportable path %s', (p, why) => {
    expect(unportablePathReason(p)).toContain(why);
    const m = example();
    m.sources[0]!.path = p;
    expect(codes(check(m, new Map([[p, new Uint8Array(privacy)]])))).toContain('UNPORTABLE_SOURCE_PATH');
  });
  it('accepts portable nested paths', () => expect(unportablePathReason('policies/0b8c/v1.pdf')).toBeNull());

  it('source bytes: missing, undeclared and over 10 MiB', () => {
    expect(codes(check(example(), new Map()))).toEqual(['SOURCE_BYTES_MISSING']);
    expect(codes(check(example(), srcs(new Map([['policies/privacy.txt', new Uint8Array(privacy)], ['extra.txt', new Uint8Array(1)]]))))).toEqual(['UNDECLARED_SOURCE_BYTES']);
    expect(codes(check(example(), new Map([['policies/privacy.txt', new Uint8Array(10 * 1024 * 1024 + 1)]])))).toEqual(expect.arrayContaining(['SOURCE_TOO_LARGE', 'SOURCE_SIZE_MISMATCH', 'SOURCE_SHA256_MISMATCH']));
  });

  it('manifest size, encoding, JSON and schema', () => {
    expect(codes(validateProjectPolicyManifest(new Uint8Array(2 * 1024 * 1024 + 1), srcs()))).toEqual(['MANIFEST_TOO_LARGE']);
    expect(codes(validateProjectPolicyManifest(new Uint8Array([0x7b, 0xff, 0x7d]), srcs()))).toEqual(['INVALID_ENCODING']);
    expect(codes(validateProjectPolicyManifest(enc('{"schema_version":'), srcs()))).toEqual(['INVALID_JSON']);
    const m = example() as Record<string, unknown>;
    m.extra = 1;
    expect(check(m)).toEqual([expect.objectContaining({ code: 'SCHEMA_VIOLATION' })]);
  });

  it('duplicate JSON keys on the raw bytes, including escaped and nested ones', () => {
    const raw = exampleBytes.toString('utf8').replace('"name": "Fictional KYC"', '"name": "Fictional KYC", "n\\u0061me": "Other"');
    const p = validateProjectPolicyManifest(enc(raw), srcs());
    expect(p).toEqual([{ code: 'DUPLICATE_JSON_KEY', path: '/source_project/name', message: expect.any(String) }]);
    expect(duplicateJsonKeys('{"a":[{"b":1,"c":{"b":2}},{"b":3,"b":4}],"s":"{\\"a\\":1,\\"a\\":2}"}')).toEqual(['/a/1/b']);
    expect(duplicateJsonKeys('{"a":1,"a":2}')).toEqual(['/a']);
  });

  it('an empty project (no policies, sources or tasks) is valid', () => {
    const m = { ...example(), project_default_policy_refs: [], sources: [], policies: [], task_bindings: [] };
    expect(check(m, new Map())).toEqual([]);
  });
});

/**
 * Behavioural comparison with schema.json: for every object in the schema, required fields, closed objects, enums,
 * patterns, string lengths (in code points), numeric bounds and maxItems must accept and reject exactly as declared.
 */
describe('Zod schema agrees with schema.json', () => {
  type Prop = { type?: string; enum?: string[]; pattern?: string; maxLength?: number; minLength?: number; maximum?: number; minimum?: number; maxItems?: number; const?: string; items?: Prop & { $ref?: string }; $ref?: string };
  type Def = { properties: Record<string, Prop>; required: string[]; additionalProperties: boolean };
  const defs: Record<string, Def> = schema.$defs;
  const zods: Record<string, z.ZodTypeAny> = { Policy: AnvilPolicy, PolicyRef: AnvilPolicyRef, PolicyRule: AnvilPolicyRule, PolicySource: AnvilPolicySource, Project: AnvilProject, TaskPolicyBinding: AnvilTaskPolicyBinding, ProjectPolicyManifest };
  const m = example();
  const valid: Record<string, Record<string, unknown>> = {
    Policy: m.policies[0]!, PolicyRef: m.project_default_policy_refs[0]!, PolicyRule: { ...m.policies[0]!.rules[0]!, rubric_criterion_ids: ['c1'], failure_mode_ids: ['f1'] }, PolicySource: m.sources[0]!,
    Project: m.source_project, TaskPolicyBinding: { ...m.task_bindings[0]!, excluded_project_policy_refs: [] }, ProjectPolicyManifest: m,
  };
  const all: Array<[string, Def]> = [...Object.entries(defs), ['ProjectPolicyManifest', schema as Def]];

  it('covers every definition', () => expect(all.map(([n]) => n).sort()).toEqual(Object.keys(zods).sort()));

  it.each(all)('%s: required fields, closed object and optional fields', (name, def) => {
    const z = zods[name]!;
    expect(z.safeParse(valid[name]).success).toBe(true);
    expect(def.additionalProperties).toBe(false);
    expect(z.safeParse({ ...valid[name], unexpected: 1 }).success).toBe(false);
    for (const key of Object.keys(def.properties)) {
      const without = { ...valid[name] };
      delete without[key];
      expect(z.safeParse(without).success, `${name}.${key} required=${def.required.includes(key)}`).toBe(!def.required.includes(key));
    }
  });

  it.each(all)('%s: enums, patterns, lengths, bounds and array limits', (name, def) => {
    const z = zods[name]!;
    const ok = (key: string, v: unknown) => z.safeParse({ ...valid[name], [key]: v }).success;
    for (const [key, p] of Object.entries(def.properties)) {
      if (p.const !== undefined) {
        expect(ok(key, p.const)).toBe(true);
        expect(ok(key, `${p.const}x`)).toBe(false);
      }
      if (p.enum) {
        for (const e of p.enum) expect(ok(key, e), `${name}.${key}=${e}`).toBe(true);
        expect(ok(key, 'not-in-enum')).toBe(false);
      }
      const strings = p.type === 'string' ? [p] : p.items?.type === 'string' ? [p.items] : [];
      for (const s of strings) {
        const wrap = (v: string) => (s === p ? v : [v]);
        if (s.pattern) {
          const re = new RegExp(s.pattern, 'u');
          const samples = ['a', 'A1', '0', 'a'.repeat(80), 'a'.repeat(81), '_a', '-a', '.a', 'a b', 'a/b', 'a\n', 'é', 'a'.repeat(64), 'f'.repeat(64), 'F'.repeat(64), 'g'.repeat(64), '0'.repeat(63), 'x.y-z_1'];
          for (const v of samples) expect(ok(key, wrap(v)), `${name}.${key} pattern on ${JSON.stringify(v)}`).toBe(re.test(v));
        }
        if (s.maxLength !== undefined) {
          expect(ok(key, wrap('𝄞'.repeat(s.maxLength)))).toBe(true);
          expect(ok(key, wrap('a'.repeat(s.maxLength + 1)))).toBe(false);
        }
        if (s.minLength !== undefined) expect(ok(key, wrap(''))).toBe(s.minLength === 0);
      }
      if (p.type === 'integer') {
        expect(ok(key, p.maximum)).toBe(true);
        expect(ok(key, p.maximum! + 1)).toBe(false);
        expect(ok(key, p.minimum)).toBe(true);
        expect(ok(key, p.minimum! - 1)).toBe(false);
        expect(ok(key, 1.5)).toBe(false);
      }
      if (p.type === 'array' && p.maxItems !== undefined) {
        const item = Array.isArray(valid[name]![key]) && (valid[name]![key] as unknown[]).length ? (valid[name]![key] as unknown[])[0] : undefined;
        if (item !== undefined && name !== 'ProjectPolicyManifest') {
          expect(ok(key, Array(p.maxItems + 1).fill(item)), `${name}.${key} maxItems`).toBe(false);
        }
        const shape = (zods[name] as unknown as { shape: Record<string, { _def: { maxLength?: { value: number }; innerType?: { _def: { maxLength?: { value: number } } } } }> }).shape[key]!;
        expect((shape._def.maxLength ?? shape._def.innerType?._def.maxLength)?.value, `${name}.${key} maxItems`).toBe(p.maxItems);
      }
    }
  });
});
