import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindingSatisfied, praxisContractIssues, type PraxisTaskContract } from '@praxis/shared';
import { exportAnvilSeed } from '../src/policy/anvil-seed-export';
import { db, resetDb } from './helpers';

interface IndexTask { task_id: string; task: string; policy: string; policy_digest: string; policy_snapshot_id: string; review_status: string }
interface IndexProject { folder: string; policy_import: string; documents: { path: string; sha256: string; published: boolean }[]; tasks: IndexTask[] }

let out: string;
const read = <T>(rel: string): T => JSON.parse(readFileSync(path.join(out, rel), 'utf8')) as T;
const fileHash = (rel: string) => createHash('sha256').update(readFileSync(path.join(out, rel))).digest('hex');

beforeEach(async () => {
  await resetDb();
  out = mkdtempSync(path.join(tmpdir(), 'anvil-seed-'));
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

describe('Anvil SEED export', () => {
  it('writes 5 projects × 2 draft tasks whose contracts, rubrics, rules and documents agree', async () => {
    expect(await exportAnvilSeed(db, out)).toEqual({ projects: 5, tasks: 10 });
    const index = read<{ fictional: boolean; projects: IndexProject[] }>('index.json');
    expect(index.fictional).toBe(true);
    expect(index.projects).toHaveLength(5);

    for (const p of index.projects) {
      for (const d of p.documents) expect(fileHash(d.path), d.path).toBe(d.sha256);
      const published = p.documents.filter((d) => d.published);
      expect(published).toHaveLength(1);

      const manifest = read<{ schema_version: string; policies: { source: { sha256: string }; rules: { rule_id: string; evaluator?: { profile_ref: { evaluator_id: string } } }[] }[] }>(p.policy_import);
      expect(manifest.schema_version).toBe('anvil.policy-import.v1-proposed');
      expect(manifest.policies[0]!.source.sha256).toBe(published[0]!.sha256);

      for (const t of p.tasks) {
        const c = read<PraxisTaskContract>(t.task);
        expect(praxisContractIssues(c), t.task_id).toEqual([]);
        expect(c.provenance.classification).toBe('synthetic');
        expect(c.provenance.review.status).toBe('draft');
        expect(t.review_status).toBe('draft');
        expect(c.rubric.criteria.reduce((a, x) => a + x.weight_bps, 0)).toBe(10_000);
        for (const x of [...c.constraints, ...c.rubric.criteria]) expect(bindingSatisfied(x.binding, c.rubric.reference_output), `${t.task_id} ${x.id}`).toBe(true);
        const actorText = c.objective + c.evidence.filter((e) => e.visibility === 'actor').map((e) => e.content).join(' ');
        expect(actorText).not.toContain('PRIVATE-');

        const snap = read<{ snapshot_id: string; digest: string; rules: { rule_key: string; sources: { sha256: string }[] }[] }>(t.policy);
        expect([snap.snapshot_id, snap.digest]).toEqual([t.policy_snapshot_id, t.policy_digest]);
        for (const r of snap.rules) for (const s of r.sources) expect(s.sha256, r.rule_key).toBe(published[0]!.sha256);
        const keys = new Set(snap.rules.map((r) => r.rule_key));
        for (const x of c.constraints.filter((x) => x.id.startsWith('policy-'))) expect(keys.has(`R-${x.id.slice('policy-'.length)}`), `${t.task_id} ${x.id}`).toBe(true);
      }

      const linked = new Set(p.tasks.flatMap((t) => read<PraxisTaskContract>(t.task).constraints.map((x) => x.id)));
      for (const r of manifest.policies[0]!.rules) {
        expect(Boolean(r.evaluator), r.rule_id).toBe(linked.has(`policy-${r.rule_id.replace(/^R-/, '')}`));
        if (r.evaluator) expect(r.evaluator.profile_ref.evaluator_id).toBe('anvil.task-constraint-binding');
      }
    }
  });

  it('every hard constraint fails when its field is broken', async () => {
    await exportAnvilSeed(db, out);
    let tried = 0;
    for (const p of read<{ projects: IndexProject[] }>('index.json').projects) {
      for (const t of p.tasks) {
        const c = read<PraxisTaskContract>(t.task);
        for (const x of c.constraints.filter((x) => x.hard_failure)) {
          const b = x.binding;
          const broken = { ...c.rubric.reference_output };
          const v = b.value;
          if (b.kind === 'json_number_max') broken[b.field] = Number(v) + 1;
          else if (b.kind === 'json_number_min') broken[b.field] = Number(v) - 1;
          else broken[b.field] = typeof v === 'boolean' ? !v : `not-${String(v)}`;
          expect(bindingSatisfied(b, broken), `${t.task_id} ${x.id}`).toBe(false);
          tried++;
        }
      }
    }
    expect(tried).toBeGreaterThan(20);
  });
});
