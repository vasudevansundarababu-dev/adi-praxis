import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenerationRunDto, type HarborBlueprint } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MemoryStorage } from '../src/candidate/storage';
import type { Config } from '../src/config';
import { resolveDeps } from '../src/meta-compiler/deps';
import { MockContentDrafter, type ContentDrafter, type DraftPrompt, type DrafterFactory } from '../src/meta-compiler/drafter';
import { GenerationOutput, loadGenerationOutput } from '../src/meta-compiler/generation';
import { metaCompilerHandlers } from '../src/meta-compiler/handlers';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';
import { api, exampleBlueprint, jsonBody, seedTemplate } from './meta-compiler-fixtures';

/** A paid-looking drafter (no network): reports fixed usage so caps can be exercised. */
class PricedDrafter implements ContentDrafter {
  readonly provider = 'claude' as const;
  calls = 0;
  constructor(readonly model: string, private readonly usage: { input: number; output: number }, private readonly text?: string) {}
  async complete(p: DraftPrompt) {
    this.calls++;
    const text = this.text ?? (await new MockContentDrafter().complete(p)).text;
    return { text, inputTokens: this.usage.input, outputTokens: this.usage.output };
  }
}

const liveConfig = (cap: number, budget: number): Config => {
  const c = testConfig({ VERTEX_PROJECT_ID: 'praxis-test-project' });
  return { ...c, metaCompiler: { ...c.metaCompiler, liveAi: true, costCapUsd: cap, dailyBudgetUsd: budget } };
};

describe('A5 generation runs (S3-01 to S3-03, S3-08, S3-11, NFR-13)', () => {
  const storage = new MemoryStorage();
  let drafters: DrafterFactory = () => new MockContentDrafter();
  let config = testConfig();
  let app: FastifyInstance;
  let http: ReturnType<typeof api>;
  let clientId: string;
  let admin: string;
  let pm: string;

  async function start(cfg: Config = testConfig()) {
    await app?.close();
    config = cfg;
    app = await buildApp({ config: cfg, db, pingRedis: async () => true, selectionGate: stubSelectionGate, storage, metaCompiler: { drafters: (c) => drafters(c) } });
    http = api(app);
    admin = await login(app, (await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'ADMIN' } } })).email);
    pm = await login(app, (await db.user.findFirstOrThrow({ where: { clientId, roles: { has: 'PM' } } })).email);
  }
  async function work() {
    const registry = new HandlerRegistry();
    for (const h of metaCompilerHandlers({ config, storage, drafters: (c) => drafters(c), deps: resolveDeps() })) registry.register(h);
    for (const ev of await db.outboxEvent.findMany({ where: { name: 'compiler.generation_requested' }, orderBy: { createdAt: 'asc' } })) await processDomainEvent(db, registry, ev.id);
  }
  const generate = (id: string, body: object = { provider: 'mock', model: 'mock-drafter-1' }) => http.post(admin, `/templates/${id}/generations`, body);

  beforeAll(async () => {
    await resetDb();
  });
  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    drafters = () => new MockContentDrafter();
    clientId = (await createClient()).id;
    await createUser(clientId, ['ADMIN']);
    await createUser(clientId, ['PM']);
    await start();
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('needs a saved blueprint with 6/6 valid sections (S2-17)', async () => {
    const none = await seedTemplate(clientId, { blueprint: null });
    expect((await generate(none.id)).json().error).toBe('BLUEPRINT_REQUIRED');
    const bp = exampleBlueprint('incomplete-one');
    bp.step_5_default_rubric.milestones[0]!.weight = 1;
    const t = await seedTemplate(clientId, { blueprint: bp });
    const res = await generate(t.id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'BLUEPRINT_INCOMPLETE', details: { problems: { stage_5: [expect.stringMatching(/add up to 100/)] } } });
    expect(await db.compilerGenerationRun.count()).toBe(0);
  });

  it('queues a run through the outbox; the worker stores the output in the evidence bucket with its SHA-256 and reaches 100% (S3-03, S3-08)', async () => {
    const t = await seedTemplate(clientId);
    const res = await generate(t.id);
    expect(res.statusCode, res.body).toBe(201);
    const queued = GenerationRunDto.parse(res.json());
    expect(queued).toMatchObject({ status: 'QUEUED', templateId: t.id, templateVersion: 1, mode: 'BLUEPRINT', provider: 'mock', model: 'mock-drafter-1', estimatedCostUsd: 0, progress: { ui: 0, backend: 0, message: 'Queued' } });
    expect(await db.outboxEvent.count({ where: { name: 'compiler.generation_requested', aggregateId: queued.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: queued.id, action: 'meta_compiler.generation_requested' } })).toBe(1);

    await work();
    const done = GenerationRunDto.parse((await http.get(admin, `/generations/${queued.id}`)).json());
    expect(done).toMatchObject({ status: 'SUCCEEDED', progress: { ui: 100, backend: 100, message: 'Generated' }, error: null });
    const row = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id: queued.id } });
    const bytes = await storage.get(row.outputRef!);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(done.outputSha256);
    const out = await loadGenerationOutput(storage, row);
    expect(Object.keys(out.artifacts)).toEqual(expect.arrayContaining(['UISpec.json', 'task.json', 'eval/test_verifiers.py']));
    expect(out.drafted).toEqual([]);
    expect(out.studioSteps).toHaveLength(6);
    expect(row.logRef).toBeTruthy();
    // Running the job again changes nothing (idempotent worker).
    await work();
    expect((await db.compilerGenerationRun.findUniqueOrThrow({ where: { id: queued.id } })).outputSha256).toBe(done.outputSha256);
  });

  it('a repeat request with the same template, prompt hash, mode and model returns the same run (S3-03)', async () => {
    const t = await seedTemplate(clientId);
    const a = await generate(t.id);
    const b = await generate(t.id);
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(await db.compilerGenerationRun.count()).toBe(1);
    expect(await db.outboxEvent.count({ where: { name: 'compiler.generation_requested' } })).toBe(1);
    // A different blueprint is a different prompt hash, so a new run.
    await db.template.update({ where: { id: t.id }, data: { blueprint: jsonBody({ ...exampleBlueprint((t.blueprint as HarborBlueprint).studio_id), domain_meta: { ...exampleBlueprint().domain_meta, persona_label: 'Other' } } as HarborBlueprint) as object } });
    expect((await generate(t.id)).json().id).not.toBe(a.json().id);
  });

  it('drafts only missing content with the drafter; the template blueprint is never changed by AI (NFR-03)', async () => {
    const bp = exampleBlueprint('needs-drafting');
    bp.authored_content.solve_sh = '';
    const t = await seedTemplate(clientId, { blueprint: bp });
    const id = (await generate(t.id)).json().id;
    await work();
    const row = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUCCEEDED');
    const out = await loadGenerationOutput(storage, row);
    expect(out.drafted).toEqual(['authored_content.solve_sh']);
    expect(out.blueprint.authored_content.solve_sh).toMatch(/^#!\/bin\/sh/);
    expect(out.blueprint.authored_content.instruction_md).toBe(bp.authored_content.instruction_md);
    expect(((await db.template.findUniqueOrThrow({ where: { id: t.id } })).blueprint as HarborBlueprint).authored_content.solve_sh).toBe('');
  });

  it('invalid model output fails the run and nothing is stored (schema-validated output)', async () => {
    const bp = exampleBlueprint('bad-output');
    bp.authored_content.solve_sh = '';
    const t = await seedTemplate(clientId, { blueprint: bp });
    drafters = () => new PricedDrafter('mock-bad', { input: 0, output: 0 }, '{"solve_sh": 42}');
    const id = (await generate(t.id, { provider: 'claude', model: 'mock-bad' })).json().id;
    await work();
    const row = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', outputRef: null, outputSha256: null });
    expect(row.error).toMatch(/failed validation/);
    // Asking again re-queues the same run.
    drafters = () => new PricedDrafter('mock-bad', { input: 0, output: 0 });
    const again = await generate(t.id, { provider: 'claude', model: 'mock-bad' });
    expect(again.json()).toMatchObject({ id, status: 'QUEUED' });
  });

  it('a blueprint saved after the request fails the run instead of generating something else', async () => {
    const t = await seedTemplate(clientId);
    const id = (await generate(t.id)).json().id;
    const changed = exampleBlueprint((t.blueprint as HarborBlueprint).studio_id);
    changed.domain_meta.persona_label = 'Changed';
    await db.template.update({ where: { id: t.id }, data: { blueprint: jsonBody(changed) as object } });
    await work();
    expect((await db.compilerGenerationRun.findUniqueOrThrow({ where: { id } })).error).toMatch(/blueprint changed/);
  });

  describe('cost control with a paid drafter (fake, no network)', () => {
    it('an estimate above the per-run cap ends the run CAPPED without calling the model', async () => {
      await start(liveConfig(0.01, 10));
      const bp = exampleBlueprint('cap-estimate');
      bp.authored_content.solve_sh = '';
      const t = await seedTemplate(clientId, { blueprint: bp });
      const d = new PricedDrafter('claude-opus-5', { input: 10, output: 10 });
      drafters = () => d;
      const res = await generate(t.id, { provider: 'claude', model: 'claude-opus-5' });
      expect(res.json()).toMatchObject({ status: 'CAPPED', error: expect.stringMatching(/per-run cap/) });
      expect(await db.outboxEvent.count({ where: { name: 'compiler.generation_requested' } })).toBe(0);
      expect(d.calls).toBe(0);
    });

    it('an actual cost above the cap ends CAPPED with usage recorded and nothing applied', async () => {
      await start(liveConfig(1, 10));
      const bp = exampleBlueprint('cap-actual');
      bp.authored_content.solve_sh = '';
      const t = await seedTemplate(clientId, { blueprint: bp });
      drafters = () => new PricedDrafter('claude-sonnet-5', { input: 10, output: 100_000 });
      const id = (await generate(t.id, { provider: 'claude', model: 'claude-sonnet-5' })).json().id;
      await work();
      const row = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'CAPPED', outputRef: null, inputTokens: 10, outputTokens: 100_000 });
      expect(Number(row.actualCostUsd)).toBeCloseTo(1.5, 4);
    });

    it('the per-client daily budget stops new runs once spent', async () => {
      await start(liveConfig(1, 1));
      const admin1 = await db.user.findFirstOrThrow({ where: { clientId } });
      const t = await seedTemplate(clientId);
      await db.compilerGenerationRun.create({ data: { clientId, templateId: t.id, templateVersion: 1, provider: 'claude', model: 'claude-sonnet-5', promptHash: 'earlier', requestedById: admin1.id, actualCostUsd: 0.99, status: 'SUCCEEDED' } });
      const bp = exampleBlueprint('budget');
      bp.authored_content.solve_sh = '';
      const t2 = await seedTemplate(clientId, { blueprint: bp, domainId: t.domainId, name: 'Second' });
      drafters = () => new PricedDrafter('claude-sonnet-5', { input: 1, output: 1 });
      expect((await generate(t2.id, { provider: 'claude', model: 'claude-sonnet-5' })).json()).toMatchObject({ status: 'CAPPED', error: expect.stringMatching(/daily generation budget/) });
    });
  });

  it('FULL_CODE is refused unless the code-generation switch is on (S3-11, D5)', async () => {
    const t = await seedTemplate(clientId);
    const res = await generate(t.id, { provider: 'mock', model: 'mock-drafter-1', mode: 'FULL_CODE' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CODEGEN_DISABLED');
  });

  it('FULL_CODE with the switch on stores the generated code alongside the configuration', async () => {
    const c = liveConfig(5, 50);
    await start({ ...c, metaCompiler: { ...c.metaCompiler, codegenEnabled: true } });
    const t = await seedTemplate(clientId);
    drafters = () => new PricedDrafter('claude-sonnet-5', { input: 10, output: 10 });
    const id = (await generate(t.id, { provider: 'claude', model: 'claude-sonnet-5', mode: 'FULL_CODE' })).json().id;
    await work();
    const out = await loadGenerationOutput(storage, await db.compilerGenerationRun.findUniqueOrThrow({ where: { id } }));
    expect(GenerationOutput.parse(out).code).toEqual({ 'studio/README.md': '# Generated studio (mock)\n' });
  });

  it('model list shows the configured models and the mock when live AI is off (S3-01, S3-02: no keys)', async () => {
    const res = await http.get(admin, '/meta-compiler/models');
    expect(res.json()).toMatchObject({ liveAi: false, codegenEnabled: false });
    expect(res.json().items.map((m: { provider: string; available: boolean }) => [m.provider, m.available])).toEqual([['claude', false], ['gemini', false], ['mock', true]]);
    expect(res.body).not.toMatch(/key|secret/i);
  });

  it('access: Admin only; other clients get 404', async () => {
    const t = await seedTemplate(clientId);
    const id = (await generate(t.id)).json().id;
    expect((await http.post(pm, `/templates/${t.id}/generations`, { provider: 'mock', model: 'm' })).statusCode).toBe(403);
    expect((await http.get(pm, `/generations/${id}`)).statusCode).toBe(403);
    expect((await http.get(pm, '/meta-compiler/models')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/generations/${id}` })).statusCode).toBe(401);
    const other = await createClient();
    const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
    expect((await http.get(otherAdmin, `/generations/${id}`)).statusCode).toBe(404);
    expect((await http.post(otherAdmin, `/templates/${t.id}/generations`, { provider: 'mock', model: 'm' })).statusCode).toBe(404);
  });
});
