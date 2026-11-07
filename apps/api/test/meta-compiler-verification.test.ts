import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VerificationRunDto, type HarborBlueprint } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import type { Config } from '../src/config';
import { DockerRunner, MockRunner, pytestScore, readTarGz, SandboxJobRunner, type HarborRunner } from '../src/harbor/runner';
import { resolveDeps, tarGz } from '../src/meta-compiler/deps';
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
    expect(() => readTarGz(tarGz({ '../evil.sh': Buffer.from('x') }))).toThrow(/Unsafe path/);
  });

  it('DockerRunner runs with --network=none and --read-only, the task mounted read-only, and scores from pytest', async () => {
    await storage.put('b.tar.gz', bundle, 'application/gzip');
    const calls: string[][] = [];
    const r = new DockerRunner({ storage, image: 'verify:test', exec: async (cmd, args) => (calls.push([cmd, ...args]), { code: 0, stdout: '3 passed, 1 failed in 0.1s', stderr: '' }) });
    const res = await r.run('b.tar.gz', 'oracle');
    expect(res.score).toBe(0.75);
    const args = calls[0]!;
    expect(args[0]).toBe('docker');
    expect(args).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop', 'ALL', 'verify:test', 'oracle']));
    expect(args[args.indexOf('-v') + 1]).toMatch(/:\/task:ro$/);
    expect(pytestScore('no tests ran')).toBe(0);
    expect(pytestScore('2 passed in 0.01s')).toBe(1);
  });

  describe('SandboxJobRunner against a fake Cloud Run API (no network)', () => {
    let server: Server;
    let base: string;
    const seen: { method: string; url: string; auth: string; body: unknown }[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => (raw += d));
        req.on('end', async () => {
          const body = raw ? JSON.parse(raw) : null;
          seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? '', body });
          res.setHeader('content-type', 'application/json');
          if (req.method === 'POST' && req.url!.startsWith('/v2/') && req.url!.endsWith(':run')) {
            // The "job" writes its result object, as the sandbox does.
            const [, mode, resultKey] = body.overrides.containerOverrides[0].args as string[];
            await storage.put(resultKey!, Buffer.from(JSON.stringify({ score: mode === 'oracle' ? 1 : 0, log: `ran ${mode}` })), 'application/json');
            return res.end(JSON.stringify({ name: 'projects/p/locations/r/operations/op-1', done: false, metadata: { name: 'projects/p/locations/r/jobs/praxis-harbor-verify/executions/ex-1' } }));
          }
          if (req.method === 'GET' && req.url!.includes('/operations/op-1')) {
            return res.end(JSON.stringify({ name: 'projects/p/locations/r/operations/op-1', done: true, metadata: { name: 'projects/p/locations/r/jobs/praxis-harbor-verify/executions/ex-1' } }));
          }
          res.statusCode = 404;
          res.end('{}');
        });
      }).listen(0);
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it('starts the job with the bundle key, polls the operation and reads the result object', async () => {
      const r = new SandboxJobRunner({ storage, job: 'praxis-harbor-verify', projectId: 'p', region: 'r', baseUrl: base, token: async () => 'tok', pollMs: 1 });
      const res = await r.run('bundles/verify/c/abc.tar.gz', 'oracle');
      expect(res).toEqual({ score: 1, log: 'ran oracle', runnerRef: 'projects/p/locations/r/jobs/praxis-harbor-verify/executions/ex-1' });
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/v2/projects/p/locations/r/jobs/praxis-harbor-verify:run', auth: 'Bearer tok' });
      expect((seen[0]!.body as { overrides: { containerOverrides: { args: string[] }[] } }).overrides.containerOverrides[0]!.args.slice(0, 2)).toEqual(['bundles/verify/c/abc.tar.gz', 'oracle']);
      expect(seen[1]).toMatchObject({ method: 'GET', url: '/v2/projects/p/locations/r/operations/op-1' });
      expect((await r.run('bundles/verify/c/abc.tar.gz', 'null-agent')).score).toBe(0);
    });

    it('fails clearly when the API refuses', async () => {
      const r = new SandboxJobRunner({ storage, job: 'projects/p/locations/r/jobs/missing', projectId: 'p', region: 'r', baseUrl: `${base}/nope`, token: async () => 'tok', pollMs: 1 });
      await expect(r.run('b', 'oracle')).rejects.toThrow(/Cloud Run API POST failed \(404\)/);
    });
  });
});
