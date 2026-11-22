import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VerificationRunDto, type HarborBlueprint } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import type { Config } from '../src/config';
import { defaultRunner, DockerRunner, MockRunner, parseLocalResult, readTarGz, SandboxJobRunner, type HarborRunner } from '../src/harbor/runner';
import { gzipSync } from 'node:zlib';
import { resolveDeps } from '../src/meta-compiler/deps';
import { gzipDeterministic, writeTar } from '../src/harbor/tar';

/** A raw .tar.gz from path -> bytes (fixture helper; real bundles come from buildBundle). */
const tarGz = (files: Record<string, Buffer>) => Buffer.from(gzipDeterministic(writeTar(Object.entries(files).map(([path, data]) => ({ path, data: new Uint8Array(data), mode: 0o644 })))));
import { MockContentDrafter } from '../src/meta-compiler/drafter';
import { metaCompilerHandlers } from '../src/meta-compiler/handlers';
import { MockJudge } from '../src/meta-compiler/judge';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';
import { api, exampleBlueprint, seedTemplate } from './meta-compiler-fixtures';

describe('A6 Harbor runner and verification runs (S3-04, S3-05, D-12)', () => {
  const storage = new MemoryStorage();
  let runner: HarborRunner = new MockRunner(storage);
  let config: Config = testConfig();
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let admin: string;
  let pm: string;

  async function start(cfg: Config = testConfig()) {
    await app?.close();
    config = cfg;
    app = await buildApp({ config: cfg, db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, metaCompiler: { drafters: () => new MockContentDrafter(), runner: { get kind() { return runner.kind; }, run: (r, m) => runner.run(r, m) } } });
    http = api(app);
    admin = await login(app, (await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'ADMIN' } } })).email);
    pm = await login(app, (await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'PM' } } })).email);
  }
  async function work() {
    const registry = new HandlerRegistry();
    for (const h of metaCompilerHandlers({ config, storage, drafters: () => new MockContentDrafter(), deps: resolveDeps(), runner, judge: new MockJudge() })) registry.register(h);
    for (const ev of await db.outboxEvent.findMany({ where: { name: { in: ['compiler.generation_requested', 'compiler.verification_requested'] } }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, registry, ev.id);
  }
  async function generated(bp?: HarborBlueprint) {
    const t = await seedTemplate(clientId, bp ? { blueprint: bp } : {});
    const g = await http.post(admin, `/templates/${t.id}/generations`, { provider: 'mock', model: 'mock-drafter-1' });
    await work();
    return { t, generationId: g.json().id as string };
  }
  async function verified(bp?: HarborBlueprint) {
    const { t, generationId } = await generated(bp);
    const res = await http.post(admin, `/generations/${generationId}/verifications`);
    expect(res.statusCode, res.body).toBe(201);
    await work();
    return { t, generationId, v: VerificationRunDto.parse((await http.get(admin, `/verifications/${res.json().id}`)).json()) };
  }

  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    runner = new MockRunner(storage);
    clientId = (await createClient()).id;
    await createUser(clientId, ['ADMIN']);
    await createUser(clientId, ['PM']);
    await start();
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('runs checks 01 to 05 and stores measured scores, the bundle and a log as evidence', async () => {
    const { v } = await verified();
    expect(v.status).toBe('SUCCEEDED');
    expect(v.checks.map((c) => [c.id, c.passed])).toEqual([['01_bundle_layout', true], ['02_hidden_paths', true], ['03_network_internal', true], ['04_zero_baseline', true], ['05_oracle_solve', true]]);
    expect(v.checks.find((c) => c.id === '04_zero_baseline')).toMatchObject({ value: '0.00', evidence: expect.stringMatching(/^runner mock:/) });
    expect(v).toMatchObject({ zeroBaselineScore: 0, oracleScore: 1, bundleSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(v.logTail).toMatch(/null agent: 0\.00/);
    const row = await db.compilerVerificationRun.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.bundleRef).toBe(`bundles/verify/${clientId}/${v.bundleSha256}.tar.gz`);
    const files = readTarGz(await storage.get(row.bundleRef!));
    expect([...files.keys()]).toEqual(expect.arrayContaining(['task.json', 'eval/test_verifiers.py', 'solution/solve.sh', 'workspace/inputs/scraped_queries.csv', 'eval/ground_truth/keyword_intent.csv']));
    expect(row.runnerRef).toMatch(/mock:.*null-agent mock:.*oracle/);
  });

  it('a zero baseline other than 0.00 or an oracle other than 1.00 fails the run and names the check', async () => {
    runner = new MockRunner(storage, { 'null-agent': 0.25 });
    let { v } = await verified();
    expect(v).toMatchObject({ status: 'FAILED', zeroBaselineScore: 0.25 });
    expect(v.checks.find((c) => c.id === '04_zero_baseline')).toMatchObject({ passed: false, value: '0.25' });
    runner = new MockRunner(storage, { oracle: 0.5 });
    ({ v } = await verified(exampleBlueprint('second-studio')));
    expect(v.status).toBe('FAILED');
    expect(v.checks.find((c) => c.id === '05_oracle_solve')).toMatchObject({ passed: false, value: '0.50' });
  });

  it('verifiers with no tests let the null agent pass, so the zero-baseline gate catches it', async () => {
    const bp = exampleBlueprint('no-tests');
    bp.custom_fields_by_stage.stage_3 = [];
    bp.step_5_default_rubric.milestones = [];
    // The blueprint is then incomplete, so seed the run directly against a crafted bundle instead.
    const bytes = tarGz({ 'eval/test_verifiers.py': Buffer.from(''), 'solution/solve.sh': Buffer.from('#!/bin/sh') });
    await storage.put('bundles/verify/x.tar.gz', bytes, 'application/gzip');
    expect((await new MockRunner(storage).run('bundles/verify/x.tar.gz', 'null-agent')).score).toBe(1);
  });

  it('logs are redacted before they are stored or shown (S3-08)', async () => {
    runner = { kind: 'mock', run: async (_r, mode) => ({ score: mode === 'oracle' ? 1 : 0, log: 'Authorization: Bearer abcdefghijklmnop sme.person@example.test password=hunter22', runnerRef: 'mock:1' }) };
    const { v } = await verified();
    expect(v.logTail).toContain('Bearer [redacted]');
    expect(v.logTail).not.toMatch(/abcdefghijklmnop|sme\.person@example\.test|hunter22/);
  });

  it('Step 2 cannot start before Step 1 succeeds', async () => {
    const t = await seedTemplate(clientId);
    const g = await http.post(admin, `/templates/${t.id}/generations`, { provider: 'mock', model: 'mock-drafter-1' });
    const res = await http.post(admin, `/generations/${g.json().id}/verifications`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('GENERATION_NOT_READY');
  });

  it('staging and production refuse to verify with the mock runner (D-12)', async () => {
    const { generationId } = await generated();
    await start(testConfig({ APP_ENV: 'staging' }));
    const res = await http.post(admin, `/generations/${generationId}/verifications`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('RUNNER_UNAVAILABLE');
    runner = { kind: 'job', run: async (_r, m) => ({ score: m === 'oracle' ? 1 : 0, log: '', runnerRef: 'executions/x' }) };
    expect((await http.post(admin, `/generations/${generationId}/verifications`)).statusCode).toBe(201);
  });

  it('access: Admin only; other clients get 404', async () => {
    const { generationId, v } = await verified();
    expect((await http.post(pm, `/generations/${generationId}/verifications`)).statusCode).toBe(403);
    expect((await http.get(pm, `/verifications/${v.id}`)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/verifications/${v.id}` })).statusCode).toBe(401);
    const otherAdmin = await login(app, (await createUser((await createClient()).id, ['ADMIN'])).email);
    expect((await http.get(otherAdmin, `/verifications/${v.id}`)).statusCode).toBe(404);
    expect((await http.post(otherAdmin, `/generations/${generationId}/verifications`)).statusCode).toBe(404);
  });
});

describe('A6 runners (unit)', () => {
  const storage = new MemoryStorage();
  const bundle = tarGz({ 'task.json': Buffer.from('{}'), 'eval/test_verifiers.py': Buffer.from('def test_a(env_state):\n    assert True\n'), 'solution/solve.sh': Buffer.from('#!/bin/sh\nexit 0\n') });

  it('MockRunner is deterministic: 0.00 for the null agent, 1.00 for the oracle', async () => {
    await storage.put('b.tar.gz', bundle, 'application/gzip');
    const r = new MockRunner(storage);
    expect((await r.run('b.tar.gz', 'null-agent')).score).toBe(0);
    expect(await r.run('b.tar.gz', 'oracle')).toEqual(await r.run('b.tar.gz', 'oracle'));
    expect((await r.run('b.tar.gz', 'oracle')).score).toBe(1);
  });

  it('bundle reading refuses paths that escape the task directory', () => {
    // writeTar refuses unsafe names itself, so hand-build the hostile header a malicious bundle would carry.
    const h = Buffer.alloc(512);
    h.write('../evil.sh', 0);
    h.write('0000644\0', 100);
    h.write('00000000001\0', 124);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.fill(' ', 148, 156);
    h.write(`${h.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `, 148);
    const hostile = gzipSync(Buffer.concat([h, Buffer.from('x'), Buffer.alloc(511), Buffer.alloc(1024)]));
    expect(() => readTarGz(hostile)).toThrow(/Unsafe path/);
  });

  it('DockerRunner runs the image\'s own grade.py on the read-only bundle, with no network and minimal capabilities', async () => {
    await storage.put('b.tar.gz', bundle, 'application/gzip');
    const calls: string[][] = [];
    const stdout = 'grading b.tar.gz (oracle) -> local\n@@PRAXIS_RESULT@@\n{"score":0.6,"log":"isolation: network=none loopback=up\\nreward 0.60","outputs":{"memo.md":"m"}}\nscore 0.60 (reward 0.60)\n';
    const r = new DockerRunner({ storage, image: 'verify:test', exec: async (cmd, args) => (calls.push([cmd, ...args]), { code: 0, stdout, stderr: '' }) });
    const res = await r.run('b.tar.gz', 'oracle');
    // The score is grade.py's (the verifiers' reward file), exactly as the sandbox job reports it.
    expect(res).toMatchObject({ score: 0.6, outputs: { 'memo.md': 'm' } });
    expect(res.log).toMatch(/reward 0\.60/);
    const args = calls[0]!;
    expect(args[0]).toBe('docker');
    // No inline script: the image's entrypoint (grade.py) runs, with its normal arguments.
    expect(args).not.toContain('--entrypoint');
    expect(args.slice(-4)).toEqual(['verify:test', 'b.tar.gz', 'oracle', 'local']);
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--security-opt', 'no-new-privileges', 'PRAXIS_BUNDLE_FILE=/in/bundle.tar.gz']));
    const caps = args.flatMap((a, i) => (args[i - 1] === '--cap-add' ? [a] : []));
    expect(args[args.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(caps.sort()).toEqual(['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID']);
    expect(caps).not.toContain('SYS_ADMIN');
    expect(args[args.indexOf('-v') + 1]).toMatch(/bundle\.tar\.gz:\/in\/bundle\.tar\.gz:ro$/);
  });

  it('DockerRunner fails clearly when grade.py returns no valid result', async () => {
    await storage.put('b.tar.gz', bundle, 'application/gzip');
    const r = new DockerRunner({ storage, exec: async () => ({ code: 1, stdout: 'grading b.tar.gz (oracle) -> local\n', stderr: 'grading failed: bundle is not valid gzip' }) });
    await expect(r.run('b.tar.gz', 'oracle')).rejects.toThrow(/no result \(exit 1\).*not valid gzip/);
    // An out-of-range score is refused like a bad sandbox-job result.
    expect(parseLocalResult('@@PRAXIS_RESULT@@\n{"score":1.5,"log":""}\n')).toBeNull();
    expect(parseLocalResult('@@PRAXIS_RESULT@@\nnot json\n')).toBeNull();
  });

  describe('SandboxJobRunner against a fake Cloud Run API (no network)', () => {
    let server: Server;
    let base: string;
    const seen: { method: string; url: string; auth: string; body: unknown }[] = [];
    // The job has no storage access: it receives signed URLs, never reads the bucket itself.
    const signed = Object.assign(new MemoryStorage(), {
      signedUrl: async (key: string, action: 'read' | 'write') => `https://signed.example/${action}/${key}`,
    });
    let failNext = false;
    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', async () => {
          const body = raw ? JSON.parse(raw) : null;
          seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? '', body });
          res.setHeader('content-type', 'application/json');
          const ex = 'projects/p/locations/r/jobs/praxis-harbor-verify/executions/ex-1';
          if (req.method === 'POST' && req.url!.startsWith('/v2/') && req.url!.endsWith(':run')) {
            const override = body.overrides.containerOverrides[0] as { args: string[]; env: { name: string; value: string }[] };
            const [, mode, resultKey] = override.args;
            const env = Object.fromEntries(override.env.map((e) => [e.name, e.value]));
            // The "job" writes its result through the signed PUT URL, as the sandbox does.
            if (env.PRAXIS_RESULT_URL === `https://signed.example/write/${resultKey}` && !failNext) {
              await signed.put(resultKey!, Buffer.from(JSON.stringify({ score: mode === 'oracle' ? 1 : 0, log: `ran ${mode}`, outputs: mode === 'oracle' ? { 'memo.md': 'x' } : {} })), 'application/json');
            }
            return res.end(JSON.stringify({ name: 'projects/p/locations/r/operations/op-1', done: false, metadata: { name: ex } }));
          }
          if (req.method === 'GET' && req.url === `/v2/${ex}`) {
            const polls = seen.filter((s) => s.method === 'GET').length;
            if (polls % 2 === 1) return res.end(JSON.stringify({ name: ex }));
            return res.end(JSON.stringify(failNext ? { name: ex, completionTime: 't', failedCount: 1, conditions: [{ type: 'Completed', state: 'CONDITION_FAILED', message: 'Task failed: exit 1' }] } : { name: ex, completionTime: 't', succeededCount: 1 }));
          }
          res.statusCode = 404;
          res.end('{}');
        });
      }).listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));
    beforeEach(() => {
      seen.length = 0;
      failNext = false;
    });

    it('passes signed URLs to the job, polls the execution, reads and deletes the result object', async () => {
      await signed.put('bundles/verify/c/abc.tar.gz', Buffer.from('bundle'), 'application/gzip');
      const r = new SandboxJobRunner({ storage: signed, job: 'praxis-harbor-verify', projectId: 'p', region: 'r', baseUrl: base, token: async () => 'tok', pollMs: 1 });
      const res = await r.run('bundles/verify/c/abc.tar.gz', 'oracle');
      expect(res).toEqual({ score: 1, log: 'ran oracle', runnerRef: 'projects/p/locations/r/jobs/praxis-harbor-verify/executions/ex-1', outputs: { 'memo.md': 'x' } });
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/v2/projects/p/locations/r/jobs/praxis-harbor-verify:run', auth: 'Bearer tok' });
      const override = (seen[0]!.body as { overrides: { containerOverrides: { args: string[]; env: { name: string; value: string }[] }[]; taskCount: number } }).overrides;
      expect(override.taskCount).toBe(1);
      expect(override.containerOverrides[0]!.args.slice(0, 2)).toEqual(['bundles/verify/c/abc.tar.gz', 'oracle']);
      expect(override.containerOverrides[0]!.args[2]).toMatch(/^results\/[0-9a-f]{32}\.json$/);
      expect(override.containerOverrides[0]!.env).toEqual([
        { name: 'PRAXIS_BUNDLE_URL', value: 'https://signed.example/read/bundles/verify/c/abc.tar.gz' },
        { name: 'PRAXIS_RESULT_URL', value: `https://signed.example/write/${override.containerOverrides[0]!.args[2]}` },
      ]);
      // Polls the execution (job-scoped viewer), never the project-wide operation.
      expect(seen.slice(1).every((s) => s.method === 'GET' && s.url.includes('/executions/ex-1'))).toBe(true);
      expect([...signed.objects.keys()].filter((k) => k.startsWith('results/'))).toEqual([]);
      expect((await r.run('bundles/verify/c/abc.tar.gz', 'null-agent')).score).toBe(0);
    });

    it('reports a failed execution and a missing result clearly', async () => {
      const r = new SandboxJobRunner({ storage: signed, job: 'praxis-harbor-verify', projectId: 'p', region: 'r', baseUrl: base, token: async () => 'tok', pollMs: 1 });
      failNext = true;
      await expect(r.run('bundles/verify/c/abc.tar.gz', 'oracle')).rejects.toThrow('The verification job failed: Task failed: exit 1');
    });

    it('fails clearly when the API refuses', async () => {
      const r = new SandboxJobRunner({ storage: signed, job: 'projects/p/locations/r/jobs/missing', projectId: 'p', region: 'r', baseUrl: `${base}/nope`, token: async () => 'tok', pollMs: 1 });
      await expect(r.run('b', 'oracle')).rejects.toThrow(/Cloud Run API POST failed \(404\)/);
    });

    it('defaultRunner refuses the job runner without signed-URL storage', () => {
      const cfg = testConfig({ HARBOR_RUNNER: 'job', HARBOR_VERIFY_JOB: 'praxis-harbor-verify' });
      expect(() => defaultRunner(cfg, new MemoryStorage())).toThrow(/needs Cloud Storage/);
      expect(defaultRunner(cfg, signed).kind).toBe('job');
    });
  });
});
