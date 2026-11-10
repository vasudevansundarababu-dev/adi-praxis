import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportAnvilSeed } from '../src/policy/anvil-seed-export';
import { contentHashV2, sidecarV2 } from '../src/policy/snapshot-v2';
import { db, resetDb } from './helpers';

type Json = Record<string, unknown>;
const schema = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../contracts/praxis/policy-snapshot.v2.schema.json'), 'utf8'));
const dirs: string[] = [];
const fresh = () => { const d = mkdtempSync(path.join(tmpdir(), 'anvil-v2-')); dirs.push(d); return d; };
const read = (dir: string, rel: string) => JSON.parse(readFileSync(path.join(dir, rel), 'utf8')) as Json;
const policies = (dir: string) => (read(dir, 'index.json').projects as Array<{ documents: Array<{ path: string; sha256: string; published: boolean }>; tasks: Array<{ task_id: string; policy: string; policy_content_hash: string }> }>);

/** Required keys present and no keys outside a closed object, recursively through the v2 schema's $defs. */
function conforms(obj: Json, def: Json, where: string) {
  const d = (def.$ref ? schema.$defs[String(def.$ref).split('/').pop()!] : def) as { required: string[]; properties: Record<string, Json>; additionalProperties?: boolean };
  for (const k of d.required) expect(Object.hasOwn(obj, k), `${where}.${k} missing`).toBe(true);
  if (d.additionalProperties === false) for (const k of Object.keys(obj)) expect(Object.hasOwn(d.properties, k), `${where}.${k} not in schema`).toBe(true);
  for (const [k, p] of Object.entries(d.properties)) {
    const v = obj[k];
    if (p.pattern && typeof v === 'string') expect(v, `${where}.${k}`).toMatch(new RegExp(String(p.pattern)));
    if ('const' in p) expect(v, `${where}.${k}`).toBe(p.const);
    const item = (p.items ?? null) as Json | null;
    if (Array.isArray(v) && item?.$ref) v.forEach((x, i) => conforms(x as Json, item, `${where}.${k}[${i}]`));
    else if (v && typeof v === 'object' && !Array.isArray(v) && (p.$ref || p.additionalProperties === false)) conforms(v as Json, p, `${where}.${k}`);
  }
}

beforeEach(() => resetDb());
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('policy sidecar v2 (content identity separate from database identity)', () => {
  it('the hash is SHA-256 of RFC 8785 canonical JSON (key order, numbers and escaping)', () => {
    const rfcSort = JSON.parse('{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}');
    const canonical = '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}';
    expect(contentHashV2(rfcSort)).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
    const rfcNumbers = { numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27], literals: [null, true, false] };
    expect(contentHashV2(rfcNumbers)).toBe(createHash('sha256').update('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}').digest('hex'));
    expect(contentHashV2({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(contentHashV2({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });

  it('a reseed keeps every rule, change and snapshot content hash while every database ID changes', async () => {
    const [a, b] = [fresh(), fresh()];
    await exportAnvilSeed(db, a, { policy: 'v2' });
    await exportAnvilSeed(db, b, { policy: 'v2' });
    const pb = new Map(policies(b).flatMap((p) => p.tasks).map((t) => [t.task_id, t]));
    let rules = 0;
    for (const p of policies(a)) {
      const published = p.documents.find((d) => d.published)!;
      for (const t of p.tasks) {
        const x = read(a, t.policy);
        const y = read(b, pb.get(t.task_id)!.policy);
        conforms(x, schema, t.task_id);
        expect(x.task_ref).toBe(t.task_id);
        expect(x.content_hash).toBe(t.policy_content_hash);
        expect(y.content_hash, t.task_id).toBe(x.content_hash);
        expect((y.provenance as Json).snapshot_id).not.toBe((x.provenance as Json).snapshot_id);
        type R = Json & { sources: Array<Json & { provenance: Json }>; provenance: Json };
        const rx = x.rules as R[];
        const ry = y.rules as R[];
        for (const [i, r] of rx.entries()) {
          expect(ry[i]!.content_hash, `${t.task_id} ${String(r.rule_key)}`).toBe(r.content_hash);
          expect(ry[i]!.provenance.rule_version_id).not.toBe(r.provenance.rule_version_id);
          expect(ry[i]!.provenance.praxis_content_hash).not.toBe(r.provenance.praxis_content_hash);
          for (const s of r.sources) expect(s.document_sha256).toBe(published.sha256);
          rules++;
        }
        const cx = x.task_changes as Json[];
        const cy = y.task_changes as Json[];
        expect(cy.map((c) => c.content_hash)).toEqual(cx.map((c) => c.content_hash));
      }
    }
    expect(rules).toBeGreaterThan(20);
  });

  it('changed content gets a new hash: requirement, quote, cited document bytes and task changes', async () => {
    const out = fresh();
    await exportAnvilSeed(db, out);
    const snap = (await db.taskPolicySnapshot.findMany({ orderBy: { createdAt: 'asc' } })).find((x) => (x.content as { task_changes: unknown[] }).task_changes.length)!;
    const base = sidecarV2(snap);
    const c = snap.content as { rules: Array<Json & { sources: Json[] }>; task_changes: Json[] };
    const variant = (edit: (x: typeof c) => void) => { const x = structuredClone(c); edit(x); return sidecarV2({ ...snap, content: x }); };

    const req = variant((x) => { x.rules[0]!.requirement = `${String(x.rules[0]!.requirement)} Changed.`; });
    expect(req.rules[0]!.content_hash).not.toBe(base.rules[0]!.content_hash);
    expect(req.rules.slice(1).map((r) => r.content_hash)).toEqual(base.rules.slice(1).map((r) => r.content_hash));
    expect(req.content_hash).not.toBe(base.content_hash);

    expect(variant((x) => { x.rules[0]!.sources[0]!.quote = 'Another quote.'; }).rules[0]!.content_hash).not.toBe(base.rules[0]!.content_hash);
    expect(variant((x) => { x.rules[0]!.sources[0]!.sha256 = 'f'.repeat(64); }).rules[0]!.content_hash).not.toBe(base.rules[0]!.content_hash);
    expect(variant((x) => { x.task_changes[0]!.requirement = 'Different.'; }).content_hash).not.toBe(base.content_hash);

    // Not content: database IDs, locator positions, display label and publish time.
    const same = variant((x) => {
      x.rules[0]!.rule_id = '00000000-0000-4000-8000-000000000001';
      x.rules[0]!.sources[0]!.document_version_id = '00000000-0000-4000-8000-000000000002';
      x.rules[0]!.sources[0]!.locator = { kind: 'manual_reference' };
      x.rules[0]!.applicability_label = 'Relabelled';
    });
    expect(same.rules[0]!.content_hash).toBe(base.rules[0]!.content_hash);
    expect(sidecarV2({ ...snap, id: '00000000-0000-4000-8000-000000000003', createdAt: new Date(0) }).content_hash).toBe(base.content_hash);
  });

  it('writes the reseed example from two real seeds, and the v1 export is unchanged', async () => {
    const [v2, v1] = [fresh(), fresh()];
    await exportAnvilSeed(db, v2, { policy: 'v2' });
    const index = read(v2, 'index.json');
    expect(index).toMatchObject({ schema: 'praxis.seed-anvil-handoff.v2-proposed', policy_schema_version: 'praxis.anvil.policy.v2-proposed' });
    const ex = read(v2, String(index.hash_stability_example)) as { reseed: Json & { seed_a: Json; seed_b: Json }; changed_content: Json };
    expect(ex.reseed).toMatchObject({ database_ids_differ: true, content_hashes_equal: true });
    expect(ex.reseed.seed_a.rule_content_hash).toBe(ex.reseed.seed_b.rule_content_hash);
    expect(ex.changed_content).toMatchObject({ rule_hash_changed: true, snapshot_hash_changed: true });

    await exportAnvilSeed(db, v1);
    const t = policies(v1)[0]!.tasks[0]! as unknown as { policy: string; policy_digest: string };
    expect(read(v1, 'index.json').schema).toBe('praxis.seed-anvil-handoff.v1-proposed');
    expect(read(v1, t.policy)).toMatchObject({ schema_version: 'praxis.anvil.policy.v1-proposed', digest: t.policy_digest });
  });
});
