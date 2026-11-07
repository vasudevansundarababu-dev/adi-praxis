import type { RunnerMode, RunnerResult } from '@praxis/shared';
import { GoogleAuth } from 'google-auth-library';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';

/**
 * HarborRunner (architecture section 6, AD-04): grades a stored bundle with the null agent (changes nothing) or the
 * oracle (`solution/solve.sh`), both scored by `eval/test_verifiers.py`. Untrusted code never runs in Praxis
 * processes: only in the sandbox job (staging, production) or a locked-down local container.
 */
export interface HarborRunner {
  readonly kind: 'mock' | 'docker' | 'job';
  run(bundleRef: string, mode: RunnerMode): Promise<RunnerResult>;
}

export class RunnerError extends Error {}

/** Reads a (ustar) .tar.gz into path → bytes. Rejects absolute paths and `..` so nothing can escape a target dir. */
export function readTarGz(bytes: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(bytes);
  const out = new Map<string, Buffer>();
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, b: number) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 500) ? `${str(345, 500)}/` : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = str(156, 157) || '0';
    if (name.startsWith('/') || name.split('/').includes('..')) throw new RunnerError(`Unsafe path in bundle: ${name}`);
    if (type === '0') out.set(name, Buffer.from(tar.subarray(off + 512, off + 512 + size)));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Tests and CI: deterministic scores from the bundle's contents. The null agent scores 0.00 when verifiers exist (an
 * empty verifier would let it pass: 1.00); the oracle scores 1.00 when there are verifiers and a non-empty solve.sh.
 * `forced` pins a score per mode to exercise the deploy gates.
 */
export class MockRunner implements HarborRunner {
  readonly kind = 'mock' as const;
  constructor(private readonly storage: ObjectStorage, private readonly forced: Partial<Record<RunnerMode, number>> = {}) {}
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerResult> {
    const bytes = await this.storage.get(bundleRef);
    const files = readTarGz(bytes);
    const verifiers = (files.get('eval/test_verifiers.py')?.toString('utf8') ?? '').includes('def test_');
    const solve = (files.get('solution/solve.sh')?.toString('utf8') ?? '').trim().length > 0;
    const natural = mode === 'null-agent' ? (verifiers ? 0 : 1) : verifiers && solve ? 1 : 0;
    const score = this.forced[mode] ?? natural;
    const log = [`mock runner: ${mode} on ${bundleRef}`, `files: ${[...files.keys()].join(', ')}`, `verifiers: ${verifiers ? 'present' : 'missing'}; solve.sh: ${solve ? 'present' : 'missing'}`, `score: ${score.toFixed(2)}`].join('\n');
    return { score, log, runnerRef: `mock:${sha(bytes).slice(0, 12)}:${mode}` };
  }
}

export type Exec = (cmd: string, args: string[], opts: { timeoutMs: number }) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const execFile: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout = (stdout + d).slice(-200_000)));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-200_000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, stdout, stderr })));
  });

/** Inside the container: copy the read-only task to /tmp, run solve.sh for the oracle, then grade with pytest. */
const GRADE = `set -u
cp -r /task /tmp/work && cd /tmp/work
if [ "$1" = "oracle" ]; then sh solution/solve.sh || echo "solve.sh exited with $?"; fi
python -m pytest -q -p no:cacheprovider eval/test_verifiers.py 2>&1 | tail -n 200`;

/** Score from pytest's summary line: passed / (passed + failed + errors). No tests collected scores 0. */
export function pytestScore(output: string): number {
  const n = (k: string) => Number(output.match(new RegExp(`(\\d+) ${k}`))?.[1] ?? 0);
  const passed = n('passed');
  const total = passed + n('failed') + n('error') + n('errors');
  return total === 0 ? 0 : Math.round((passed / total) * 100) / 100;
}

/** Local development only: the verifier image with no network, a read-only root file system and resource limits. */
export class DockerRunner implements HarborRunner {
  readonly kind = 'docker' as const;
  constructor(private readonly opts: { storage: ObjectStorage; image?: string; exec?: Exec; timeoutMs?: number }) {}
  dockerArgs(dir: string, mode: RunnerMode, name: string): string[] {
    return [
      'run', '--rm', '--name', name,
      '--network=none', '--read-only', '--tmpfs', '/tmp:rw,size=64m',
      '--memory', '1g', '--cpus', '1', '--pids-limit', '256', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '-v', `${dir}:/task:ro`,
      this.opts.image ?? 'praxis-harbor-verify:local',
      'sh', '-c', GRADE, 'grade', mode,
    ];
  }
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerResult> {
    const files = readTarGz(await this.opts.storage.get(bundleRef));
    const dir = await mkdtemp(path.join(tmpdir(), 'praxis-bundle-'));
    try {
      for (const [p, data] of files) {
        const target = path.join(dir, p);
        if (!target.startsWith(dir + path.sep)) throw new RunnerError(`Unsafe path in bundle: ${p}`);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data);
      }
      const name = `praxis-verify-${randomUUID().slice(0, 12)}`;
      const r = await (this.opts.exec ?? execFile)('docker', this.dockerArgs(dir, mode, name), { timeoutMs: this.opts.timeoutMs ?? 120_000 });
      const log = `${r.stdout}\n${r.stderr}`.trim();
      return { score: pytestScore(r.stdout), log, runnerRef: `docker:${name}` };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const Operation = z.object({ name: z.string(), done: z.boolean().optional(), error: z.object({ message: z.string().optional() }).passthrough().optional(), metadata: z.object({ name: z.string().optional() }).passthrough().optional() });
const JobResult = z.object({ score: z.number().min(0).max(1), log: z.string().max(1_000_000).default('') });

/**
 * Staging and production: starts the Cloud Run job `praxis-harbor-verify` (its own service account, no egress, no
 * Praxis secrets) through the Cloud Run Admin API v2 with the bundle key as argument, waits for the execution, then
 * reads the result object it wrote under `results/`.
 */
export class SandboxJobRunner implements HarborRunner {
  readonly kind = 'job' as const;
  private auth: GoogleAuth | undefined;
  readonly jobName: string;
  constructor(private readonly opts: { storage: ObjectStorage; job: string; projectId: string; region: string; baseUrl?: string; fetch?: Fetch; token?: () => Promise<string>; pollMs?: number; timeoutMs?: number }) {
    if (!opts.job) throw new Error('SandboxJobRunner needs HARBOR_VERIFY_JOB');
    this.jobName = opts.job.startsWith('projects/') ? opts.job : `projects/${opts.projectId}/locations/${opts.region}/jobs/${opts.job}`;
  }
  private async call(method: string, url: string, body?: unknown) {
    this.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = this.opts.token ? await this.opts.token() : ((await (await this.auth.getClient()).getAccessToken()).token ?? '');
    const res = await (this.opts.fetch ?? (fetch as unknown as Fetch))(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new RunnerError(`Cloud Run API ${method} failed (${res.status})`);
    return Operation.parse(await res.json());
  }
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerResult> {
    const base = (this.opts.baseUrl ?? 'https://run.googleapis.com').replace(/\/$/, '');
    const resultKey = `results/${sha(Buffer.from(`${bundleRef}:${mode}:${randomUUID()}`)).slice(0, 32)}.json`;
    let op = await this.call('POST', `${base}/v2/${this.jobName}:run`, { overrides: { containerOverrides: [{ args: [bundleRef, mode, resultKey] }], taskCount: 1 } });
    const deadline = Date.now() + (this.opts.timeoutMs ?? 300_000);
    while (!op.done) {
      if (Date.now() > deadline) throw new RunnerError('The verification job did not finish in time');
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));
      op = await this.call('GET', `${base}/v2/${op.name}`);
    }
    if (op.error) throw new RunnerError(`The verification job failed: ${op.error.message ?? 'unknown error'}`);
    const result = JobResult.safeParse(JSON.parse((await this.opts.storage.get(resultKey)).toString('utf8')));
    if (!result.success) throw new RunnerError('The verification job wrote an invalid result');
    return { score: result.data.score, log: result.data.log, runnerRef: op.metadata?.name ?? op.name };
  }
}

/** Runner from config (HARBOR_RUNNER): mock by default, docker for manual local runs, the sandbox job when deployed. */
export function defaultRunner(config: Config, storage: ObjectStorage): HarborRunner {
  const mc = config.metaCompiler;
  if (mc.runner === 'job') return new SandboxJobRunner({ storage, job: mc.verifyJob, projectId: config.GCS_PROJECT_ID, region: 'us-central1' });
  if (mc.runner === 'docker') return new DockerRunner({ storage });
  return new MockRunner(storage);
}
