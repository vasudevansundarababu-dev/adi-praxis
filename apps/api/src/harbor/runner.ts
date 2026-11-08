import type { RunnerMode, RunnerResult } from '@praxis/shared';
import { GoogleAuth } from 'google-auth-library';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { ObjectStorage, SignedUrlStorage } from '../candidate/storage';
import type { Config } from '../config';

/**
 * HarborRunner (architecture section 6, AD-04): grades a stored bundle with the null agent (changes nothing) or the
 * oracle (`solution/solve.sh`), both scored by `eval/test_verifiers.py`. Untrusted code never runs in Praxis
 * processes: only in the sandbox job (staging, production) or a locked-down local container.
 */
export interface HarborRunner {
  readonly kind: 'mock' | 'docker' | 'job';
  run(bundleRef: string, mode: RunnerMode): Promise<RunnerRun>;
}

/**
 * `RunnerResult` plus the text files the run left under `/workspace/outputs/`, keyed by their path relative to it.
 * The post-commit judge grades the oracle run's deliverables from these. Kept in apps/api: the frozen contract has no
 * outputs field. Runners that cannot return files leave it undefined.
 */
export type RunnerRun = RunnerResult & { outputs?: Record<string, string> };

/** Caps what a runner returns as output files (total characters across files). */
export const MAX_RUNNER_OUTPUT_CHARS = 150_000;

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
  constructor(
    private readonly storage: ObjectStorage,
    private readonly forced: Partial<Record<RunnerMode, number>> = {},
    private readonly forcedOutputs: Partial<Record<RunnerMode, Record<string, string>>> = {},
  ) {}
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerRun> {
    const bytes = await this.storage.get(bundleRef);
    const files = readTarGz(bytes);
    const verifiers = (files.get('eval/test_verifiers.py')?.toString('utf8') ?? '').includes('def test_');
    const solve = (files.get('solution/solve.sh')?.toString('utf8') ?? '').trim().length > 0;
    const natural = mode === 'null-agent' ? (verifiers ? 0 : 1) : verifiers && solve ? 1 : 0;
    const score = this.forced[mode] ?? natural;
    const log = [`mock runner: ${mode} on ${bundleRef}`, `files: ${[...files.keys()].join(', ')}`, `verifiers: ${verifiers ? 'present' : 'missing'}; solve.sh: ${solve ? 'present' : 'missing'}`, `score: ${score.toFixed(2)}`].join('\n');
    return { score, log, runnerRef: `mock:${sha(bytes).slice(0, 12)}:${mode}`, outputs: this.forcedOutputs[mode] ?? (mode === 'oracle' ? mockOracleOutputs(files) : {}) };
  }
}

/** The mock oracle "writes" each judged deliverable as its checklist text, so the mock judge awards full points. */
function mockOracleOutputs(files: Map<string, Buffer>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, data] of files) {
    if (!p.startsWith('eval/judge/') || !p.endsWith('.json')) continue;
    const spec = JSON.parse(data.toString('utf8')) as { deliverable_path: string; criteria: { text: string }[] };
    const rel = spec.deliverable_path.replace(/^\/workspace\/outputs\//, '');
    out[rel] = `${out[rel] ?? ''}${spec.criteria.map((c) => c.text).join('\n')}\n`;
  }
  return out;
}

const OUTPUTS_MARKER = '@@PRAXIS_OUTPUTS@@';

/** Splits the grading script's stdout into the pytest part and the JSON map of output files after the marker. */
export function splitOutputs(stdout: string): { text: string; outputs: Record<string, string> | undefined } {
  const at = stdout.lastIndexOf(OUTPUTS_MARKER);
  if (at < 0) return { text: stdout, outputs: undefined };
  const parsed = z.record(z.string(), z.string()).safeParse((() => { try { return JSON.parse(stdout.slice(at + OUTPUTS_MARKER.length).trim()); } catch { return null; } })());
  return { text: stdout.slice(0, at), outputs: parsed.success ? parsed.data : undefined };
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
python -m pytest -q -p no:cacheprovider eval/test_verifiers.py 2>&1 | tail -n 200
echo "${OUTPUTS_MARKER}"
python - <<'PY'
import json, os
root, out, left = "/workspace/outputs", {}, ${MAX_RUNNER_OUTPUT_CHARS}
for d, dirs, names in os.walk(root):
    dirs.sort()
    for n in sorted(names):
        try:
            text = open(os.path.join(d, n), encoding="utf-8").read()[:left]
        except (OSError, UnicodeDecodeError):
            continue
        out[os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/")] = text
        left -= len(text)
print(json.dumps(out))
PY`;

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
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerRun> {
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
      const { text, outputs } = splitOutputs(r.stdout);
      const log = `${text}\n${r.stderr}`.trim();
      return { score: pytestScore(text), log, runnerRef: `docker:${name}`, outputs };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const Operation = z.object({ name: z.string(), done: z.boolean().optional(), error: z.object({ message: z.string().optional() }).passthrough().optional(), metadata: z.object({ name: z.string().optional() }).passthrough().optional() });
const Execution = z.object({ name: z.string(), completionTime: z.string().optional(), succeededCount: z.number().optional(), failedCount: z.number().optional(), cancelledCount: z.number().optional(), conditions: z.array(z.object({ type: z.string(), state: z.string().optional(), message: z.string().optional() })).optional() });
const JobResult = z.object({ score: z.number().min(0).max(1), log: z.string().max(1_000_000).default(''), outputs: z.record(z.string(), z.string().max(MAX_RUNNER_OUTPUT_CHARS)).optional() });

/** Signed URLs live a little longer than the job's own timeout (queueing plus the 120 s task limit). */
const SIGNED_URL_SECONDS = 600;

/**
 * Staging and production: starts the Cloud Run job `praxis-harbor-verify` (its own service account with no storage or
 * project roles, no route to the internet, no Praxis secrets) through the Cloud Run Admin API v2. The job gets a signed
 * GET URL for the bundle and a signed PUT URL for a fresh `results/` key, which the grading wrapper hides from task
 * code. The worker waits for the execution, then reads the result object.
 */
export class SandboxJobRunner implements HarborRunner {
  readonly kind = 'job' as const;
  private auth: GoogleAuth | undefined;
  readonly jobName: string;
  constructor(private readonly opts: { storage: SignedUrlStorage; job: string; projectId: string; region: string; baseUrl?: string; fetch?: Fetch; token?: () => Promise<string>; pollMs?: number; timeoutMs?: number }) {
    if (!opts.job) throw new Error('SandboxJobRunner needs HARBOR_VERIFY_JOB');
    this.jobName = opts.job.startsWith('projects/') ? opts.job : `projects/${opts.projectId}/locations/${opts.region}/jobs/${opts.job}`;
  }
  private async call(method: string, url: string, body?: unknown): Promise<unknown> {
    this.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = this.opts.token ? await this.opts.token() : ((await (await this.auth.getClient()).getAccessToken()).token ?? '');
    const res = await (this.opts.fetch ?? (fetch as unknown as Fetch))(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new RunnerError(`Cloud Run API ${method} failed (${res.status})`);
    return res.json();
  }
  async run(bundleRef: string, mode: RunnerMode): Promise<RunnerRun> {
    const base = (this.opts.baseUrl ?? 'https://run.googleapis.com').replace(/\/$/, '');
    const resultKey = `results/${sha(Buffer.from(`${bundleRef}:${mode}:${randomUUID()}`)).slice(0, 32)}.json`;
    const [bundleUrl, resultUrl] = await Promise.all([
      this.opts.storage.signedUrl(bundleRef, 'read', { expiresInSeconds: SIGNED_URL_SECONDS }),
      this.opts.storage.signedUrl(resultKey, 'write', { expiresInSeconds: SIGNED_URL_SECONDS, contentType: 'application/json' }),
    ]);
    const env = [{ name: 'PRAXIS_BUNDLE_URL', value: bundleUrl }, { name: 'PRAXIS_RESULT_URL', value: resultUrl }];
    const op = Operation.parse(await this.call('POST', `${base}/v2/${this.jobName}:run`, { overrides: { containerOverrides: [{ args: [bundleRef, mode, resultKey], env }], taskCount: 1 } }));
    if (op.error) throw new RunnerError(`The verification job could not start: ${op.error.message ?? 'unknown error'}`);
    const execution = op.metadata?.name;
    if (!execution) throw new RunnerError('The Cloud Run API did not return an execution name');
    // Poll the execution (readable with run.viewer on this job only) rather than the operation (project-wide).
    const deadline = Date.now() + (this.opts.timeoutMs ?? 300_000);
    let ex = Execution.parse(await this.call('GET', `${base}/v2/${execution}`));
    while (!ex.completionTime) {
      if (Date.now() > deadline) throw new RunnerError('The verification job did not finish in time');
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));
      ex = Execution.parse(await this.call('GET', `${base}/v2/${execution}`));
    }
    if (!ex.succeededCount) {
      const why = ex.conditions?.find((c) => c.state === 'CONDITION_FAILED')?.message;
      throw new RunnerError(`The verification job failed${why ? `: ${why}` : ''}`);
    }
    let raw: Buffer;
    try {
      raw = await this.opts.storage.get(resultKey);
    } catch {
      throw new RunnerError('The verification job wrote no result');
    }
    const result = JobResult.safeParse((() => { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } })());
    await this.opts.storage.delete(resultKey).catch(() => undefined);
    if (!result.success) throw new RunnerError('The verification job wrote an invalid result');
    return { score: result.data.score, log: result.data.log, runnerRef: ex.name, outputs: result.data.outputs };
  }
}

/** Runner from config (HARBOR_RUNNER): mock by default, docker for manual local runs, the sandbox job when deployed. */
export function defaultRunner(config: Config, storage: ObjectStorage): HarborRunner {
  const mc = config.metaCompiler;
  if (mc.runner === 'job') {
    if (!('signedUrl' in storage)) throw new Error('HARBOR_RUNNER=job needs Cloud Storage (signed URLs for the sandbox job)');
    return new SandboxJobRunner({ storage: storage as SignedUrlStorage, job: mc.verifyJob, projectId: config.GCS_PROJECT_ID, region: config.HARBOR_VERIFY_REGION });
  }
  if (mc.runner === 'docker') return new DockerRunner({ storage });
  return new MockRunner(storage);
}
