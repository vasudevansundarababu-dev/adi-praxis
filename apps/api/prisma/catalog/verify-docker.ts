import { defaultStudioAnswers, type BundleTaskMeta, type HarborBlueprint } from '@praxis/shared';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle } from '../../src/harbor/bundle';
import { readTarGz } from '../../src/harbor/tar';
import { catalogBlueprints } from './index';

/**
 * On-demand proof for C4 (not the production runner, which Stream 2 owns): builds each catalog bundle with the
 * default answers and runs its verifiers in `docker run --network=none` for the null agent and for the oracle.
 *
 *   pnpm --filter @praxis/api exec tsx prisma/catalog/verify-docker.ts
 *
 * Runtime contract used here and by the generated files: the bundle is extracted to a root, `HARBOR_ROOT` points
 * at it, the oracle runs `bash solution/solve.sh`, then `python3 -m pytest eval/test_verifiers.py` writes the
 * score to `$HARBOR_REWARD_PATH`.
 */

export const VERIFY_IMAGE = process.env.HARBOR_VERIFY_IMAGE || 'praxis-harbor-verify:local';
const DOCKERFILE = 'FROM python:3.12-slim\nRUN pip install --no-cache-dir pytest==8.3.5\n';

export function dockerAvailable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
}

/** Builds the verifier image once (the build needs network for pip; every run is --network=none). */
export function ensureVerifyImage(): void {
  if (spawnSync('docker', ['image', 'inspect', VERIFY_IMAGE], { stdio: 'ignore' }).status === 0) return;
  execFileSync('docker', ['build', '-q', '-t', VERIFY_IMAGE, '-'], { input: DOCKERFILE, stdio: ['pipe', 'ignore', 'inherit'] });
}

export function catalogMeta(bp: HarborBlueprint): BundleTaskMeta {
  return {
    externalTaskId: `VERIFY-${bp.studio_id}`,
    title: bp.domain_meta.title,
    templateId: '00000000-0000-4000-8000-000000000000',
    templateVersion: bp.template_meta.version,
    executionMode: bp.template_meta.modes[0]!,
    dataClassification: 'SYNTHETIC',
  };
}

/** `agentScript` (tests only) is a shell script run in place of an agent, to prove partial and hard-fail scores. */
export function runInDocker(bundle: Uint8Array, mode: 'null-agent' | 'oracle' | { agentScript: string }): { score: number; log: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'praxis-verify-'));
  try {
    for (const e of readTarGz(bundle)) {
      const file = path.join(root, e.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, e.data);
      chmodSync(file, e.mode);
    }
    if (typeof mode === 'object') writeFileSync(path.join(root, 'agent.sh'), mode.agentScript);
    const agent = mode === 'oracle' ? 'bash solution/solve.sh && ' : typeof mode === 'object' ? 'bash agent.sh && ' : '';
    const script = `${agent}python3 -m pytest -q -p no:cacheprovider eval/test_verifiers.py; true`;
    const user = typeof process.getuid === 'function' ? [`--user=${process.getuid()}:${process.getgid!()}`] : [];
    const run = spawnSync(
      'docker',
      [
        'run', '--rm', '--network=none', '--read-only', '--tmpfs=/tmp', '--memory=1g', '--cpus=1', ...user,
        `--volume=${root}:/task`, '--workdir=/task',
        '--env=HARBOR_ROOT=/task', '--env=HARBOR_REWARD_PATH=/task/logs/verifier/reward.txt', '--env=PYTHONDONTWRITEBYTECODE=1',
        '--entrypoint=sh', VERIFY_IMAGE, '-c', script,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    const log = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    let reward: string;
    try {
      reward = readFileSync(path.join(root, 'logs/verifier/reward.txt'), 'utf8');
    } catch {
      throw new Error(`No reward written (${JSON.stringify(mode)}):\n${log}`);
    }
    return { score: Number.parseFloat(reward), log };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureVerifyImage();
  let failed = false;
  for (const { workflowName, blueprint } of catalogBlueprints()) {
    const { bytes, sha256 } = buildBundle(blueprint, defaultStudioAnswers(blueprint), catalogMeta(blueprint));
    const nul = runInDocker(bytes, 'null-agent');
    const oracle = runInDocker(bytes, 'oracle');
    const ok = nul.score === 0 && oracle.score === 1;
    failed ||= !ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${workflowName}: null agent ${nul.score.toFixed(2)}, oracle ${oracle.score.toFixed(2)} (bundle ${sha256.slice(0, 12)})`);
    if (!ok) console.log(nul.log, oracle.log);
  }
  process.exitCode = failed ? 1 : 0;
}
