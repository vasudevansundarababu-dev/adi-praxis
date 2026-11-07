import { HarborBlueprint, defaultStudioAnswers, type BundleTaskMeta, type StudioAnswers } from '@praxis/shared';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { generatorFixture, generatorFixtureInput } from '../../../packages/shared/test/blueprint-fixture';
import { BundleError, agentView, agentVisibleFiles, buildBundle } from '../src/harbor/bundle';
import { readTarGz, writeTar } from '../src/harbor/tar';

const meta: BundleTaskMeta = {
  externalTaskId: 'TASK-MKTG-901',
  title: 'Synthetic quiet-phone launch',
  templateId: '00000000-0000-4000-8000-000000000001',
  templateVersion: 1,
  executionMode: 'HERMETIC_MCP',
  dataClassification: 'SYNTHETIC',
};

function smeAnswers(): StudioAnswers {
  const bp = generatorFixture();
  return {
    ...defaultStudioAnswers(bp),
    inputs: { queries: 'query\nquiet phone deal\n', brief: '# Brief\n' },
    oracleRows: [
      { cells: ['quiet phone deal', 'BUY'], tag: 'BUY' },
      { cells: ['phone case free', 'IGNORE'], tag: 'IGNORE' },
    ],
  };
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('C3 Harbor bundle (D-20)', () => {
  it('uses the PRD §6.3 layout and marks eval/* and solution/* hidden', () => {
    const b = buildBundle(generatorFixture(), smeAnswers(), meta);
    expect(b.manifest.map((e) => [e.path, e.hidden])).toEqual([
      ['environment/mcp_mock.py', false],
      ['eval/ground_truth/keyword_intent.csv', true],
      ['eval/test_verifiers.py', true],
      ['instruction.md', false],
      ['solution/ground_truth/keyword_intent.csv', true],
      ['solution/solve.sh', true],
      ['task.json', false],
      ['workspace/inputs/brief.md', false],
      ['workspace/inputs/queries.csv', false],
    ]);
    const files = new Map(readTarGz(b.bytes).map((e) => [e.path, e]));
    for (const m of b.manifest) {
      expect(sha(files.get(m.path)!.data), m.path).toBe(m.sha256);
      expect(files.get(m.path)!.data.length).toBe(m.size);
    }
    expect(new TextDecoder().decode(files.get('eval/ground_truth/keyword_intent.csv')!.data)).toBe('keyword,intent,sme_tag\nquiet phone deal,BUY,BUY\nphone case free,IGNORE,IGNORE\n');
    expect(JSON.parse(new TextDecoder().decode(files.get('task.json')!.data)).task).toEqual({
      external_task_id: 'TASK-MKTG-901',
      title: 'Synthetic quiet-phone launch',
      template_id: meta.templateId,
      template_version: 1,
      data_classification: 'SYNTHETIC',
    });
  });

  it('same input gives the same bytes and SHA-256; any change gives a new hash', () => {
    const a = buildBundle(generatorFixture(), smeAnswers(), meta);
    const b = buildBundle(HarborBlueprint.parse(JSON.parse(JSON.stringify(generatorFixtureInput()))), smeAnswers(), { ...meta });
    expect(b.sha256).toBe(a.sha256);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
    expect(a.sha256).toBe(sha(a.bytes));
    expect(buildBundle(generatorFixture(), { ...smeAnswers(), sliders: { k_half: 13000 } }, meta).sha256).not.toBe(a.sha256);
    expect(buildBundle(generatorFixture(), smeAnswers(), { ...meta, externalTaskId: 'TASK-MKTG-902' }).sha256).not.toBe(a.sha256);
  });

  it('pins the uncompressed archive bytes (golden hash)', () => {
    const tar = gunzipSync(buildBundle(generatorFixture(), smeAnswers(), meta).bytes);
    expect(sha(tar)).toMatchInlineSnapshot(`"466acf39f796baef7ba001f51315ba43049314daf57a61ca73776ffe126972f0"`);
  });

  it('writes a fixed gzip header: no file name, mtime 0, Unix OS byte', () => {
    const { bytes } = buildBundle(generatorFixture(), smeAnswers(), meta);
    expect([...bytes.subarray(0, 4)]).toEqual([0x1f, 0x8b, 8, 0]);
    expect([...bytes.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(bytes[9]).toBe(3);
  });

  it.skipIf(!hasPython)('is a standard ustar archive: sorted, mtime 0, uid/gid 0, 0755 only for solve.sh', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'praxis-bundle-'));
    const file = path.join(dir, 'b.tar.gz');
    writeFileSync(file, buildBundle(generatorFixture(), smeAnswers(), meta).bytes);
    const script = 'import json,sys,tarfile\nt=tarfile.open(sys.argv[1])\nprint(json.dumps([[m.name,m.mtime,m.uid,m.gid,m.uname,m.gname,oct(m.mode),m.isfile()] for m in t.getmembers()]))';
    const members = JSON.parse(execFileSync('python3', ['-c', script, file], { encoding: 'utf8' })) as [string, number, number, number, string, string, string, boolean][];
    expect(members.map((m) => m[0])).toEqual([...members.map((m) => m[0])].sort());
    for (const [name, mtime, uid, gid, uname, gname, mode, isFile] of members) {
      expect([mtime, uid, gid, uname, gname, isFile]).toEqual([0, 0, 0, '', '', true]);
      expect(mode).toBe(name === 'solution/solve.sh' ? '0o755' : '0o644');
    }
  });

  it('the tar writer splits long paths into prefix and name, and refuses unsafe paths', () => {
    const long = `${'d'.repeat(120)}/${'f'.repeat(90)}.txt`;
    const data = new TextEncoder().encode('x');
    expect(readTarGz(new Uint8Array(gzipSync(writeTar([{ path: long, data, mode: 0o644 }])))).map((e) => e.path)).toEqual([long]);
    for (const bad of ['/abs', 'a/../b', 'a//b', 'sp ace', 'é']) expect(() => writeTar([{ path: bad, data, mode: 0o644 }])).toThrow();
    expect(() => writeTar([{ path: 'a', data, mode: 0o644 }, { path: 'a', data, mode: 0o644 }])).toThrow(/duplicate/);
  });

  it('refuses dropzone or oracle paths outside their roots and a missing solve.sh', () => {
    const escape = generatorFixture();
    escape.step_2_data_panels.public_dropzones[0]!.target_path = '/workspace/inputs/../../eval/ground_truth/x.csv';
    expect(() => buildBundle(escape, smeAnswers(), meta)).toThrow(BundleError);
    const intoEval = generatorFixture();
    intoEval.step_2_data_panels.public_dropzones[0]!.target_path = '/eval/ground_truth/keyword_intent.csv';
    expect(() => buildBundle(intoEval, smeAnswers(), meta)).toThrow(BundleError);
    const oracle = generatorFixture();
    oracle.step_2_data_panels.oracle_annotator.target_path = '/workspace/inputs/answers.csv';
    expect(() => buildBundle(oracle, smeAnswers(), meta)).toThrow(BundleError);
    const noSolve = generatorFixture();
    noSolve.authored_content.solve_sh = '  ';
    expect(() => buildBundle(noSolve, smeAnswers(), meta)).toThrow(/solve\.sh/);
  });
});

describe('C3 agent view never includes hidden paths (D-21)', () => {
  const bundle = buildBundle(generatorFixture(), smeAnswers(), meta);

  it('agentView keeps only task.json, instruction.md and workspace/inputs/*', () => {
    const view = agentView(bundle.manifest);
    expect(view.map((e) => e.path)).toEqual(['instruction.md', 'task.json', 'workspace/inputs/brief.md', 'workspace/inputs/queries.csv']);
    expect(view.some((e) => e.hidden || /^(eval|solution)\//.test(e.path))).toBe(false);
  });

  it('agentView drops hidden entries even when a manifest is mislabelled', () => {
    const forged = bundle.manifest.map((e) => ({ ...e, hidden: false }));
    expect(agentView(forged).map((e) => e.path).filter((p) => /^(eval|solution)\//.test(p))).toEqual([]);
  });

  it('agent-visible files carry no ground truth, verifier code or solution', () => {
    const files = agentVisibleFiles(generatorFixture(), smeAnswers(), meta);
    expect(files.map((f) => f.path)).toEqual(agentView(bundle.manifest).map((e) => e.path));
    const all = files.map((f) => f.content).join('\n');
    for (const secret of ['sme_tag', '/eval', 'eval/', 'solution/', 'solve.sh', 'MILESTONE_BODIES', 'f1_set_match(', 'echo solved']) expect(all).not.toContain(secret);
  });
});
