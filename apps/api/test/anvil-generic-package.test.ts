import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnvilExportClient, type FetchLike } from '../src/anvil/export-client';
import { actorProjection, buildGenericPackages, MAX_TASKS_PER_PART } from '../src/anvil/generic-package';
import { jcs, JcsError, jcsSha256 } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec } from '../src/anvil/joint-template';
import { AnvilGatedValidator, genericSupport, validationItem } from '../src/anvil/validator';
import { readZip } from '../src/anvil/zip';
import { anvilSpecChecks } from '../src/tasks/submission';

/**
 * Generic Anvil export (`praxis.authored-task-export.v1`) against Anvil's four confirmations (11 Nov 2026) and Anvil's
 * own synthetic reference files (test/fixtures/anvil-generic, copied unchanged from Anvil's praxis-generic-v1 packet).
 * Mocks only: no network, no model, no paid calls.
 */
const F = join(__dirname, 'fixtures', 'anvil-generic');
const json = (f: string) => JSON.parse(readFileSync(join(F, f), 'utf8'));
const SPEC = json('synthetic-template-spec.json');
const HASHES = json('synthetic-template-hashes.json');
const ANVIL_ZIP = readZip(readFileSync(join(F, 'synthetic-non-Golden-export.zip')));
const anvilFile = (p: string) => JSON.parse(ANVIL_ZIP.get(p)!.toString('utf8'));
const AUTHORED = anvilFile('private/NEW-SME-9001/reference.json').authored;

const { template_id, version, ...partsAndKey } = SPEC;
const template = (over: Partial<Template> = {}) =>
  ({ id: '11111111-1111-4111-8111-111111111111', lineageId: template_id, version, status: 'PUBLISHED', agentMode: 'SINGLE', anvilSpec: partsAndKey, ...over }) as unknown as Template;
const record = (n: number, output: object = AUTHORED, over: Partial<ApprovedTaskRecord> = {}) =>
  ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, taskInstanceId: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, contentHash: 'c'.repeat(64), templateId: '11111111-1111-4111-8111-111111111111', output, ...over }) as unknown as ApprovedTaskRecord;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('RFC 8785 hashing (four confirmations, point 1)', () => {
  it('matches Anvil’s vector, whole-spec hash and the three part hashes', () => {
    expect(jcsSha256(json('jcs-vector.json'))).toBe(json('jcs-vector-hash.json').sha256);
    const joint = jointTemplateSpec(template())!;
    expect(joint).toEqual(SPEC);
    expect(Object.keys(joint)).toEqual(['schemaVersion', 'anvil_template_key', 'template_id', 'version', 'requirement', 'authoring', 'execution', 'skills']);
    expect(jointHashes(joint)).toEqual({ template_sha256: HASHES.template_sha256, part_hashes: HASHES.part_hashes });
  });

  it('refuses what RFC 8785 cannot represent instead of coercing it', () => {
    expect(() => jcs({ a: Number.NaN })).toThrow(JcsError);
    expect(() => jcs({ a: '\uD800' })).toThrow(JcsError);
    expect(() => jcs([undefined])).toThrow(JcsError);
    expect(() => jcs({ d: new Date() })).toThrow(JcsError);
    // Omitted and empty are different identities; arrays keep their order.
    expect(jcsSha256({ a: [] })).not.toBe(jcsSha256({}));
    expect(jcsSha256([1, 2])).not.toBe(jcsSha256([2, 1]));
  });

  it('a template without the joint parts has no joint spec', () => {
    expect(jointTemplateSpec(template({ anvilSpec: { requirement: { id: 'R' }, execution: {}, skills: {} } as never }))).toBeNull();
  });
});

describe('generic export package builder', () => {
  it('reproduces Anvil’s synthetic package files byte-for-byte in hash: form, actor, private reference and template', () => {
    const built = buildGenericPackages([{ record: record(1), template: template() }], { projectId: 'p1' });
    expect(built.problems).toEqual([]);
    const [part] = built.parts;
    const files = readZip(part!.zip);
    const task = record(1).taskInstanceId;
    expect([...files.keys()].sort()).toEqual(['forms/account-opening-v2.json', 'praxis-export.json', `private/${task}/reference.json`, `tasks/${task}/actor.json`]);
    const read = (p: string) => JSON.parse(files.get(p)!.toString('utf8'));
    expect(jcsSha256(read('forms/account-opening-v2.json'))).toBe(jcsSha256(anvilFile('forms/account-opening-v2.json')));
    expect(read(`tasks/${task}/actor.json`)).toEqual(anvilFile('tasks/NEW-SME-9001/actor.json'));
    expect(jcsSha256(read(`private/${task}/reference.json`))).toBe(jcsSha256(anvilFile('private/NEW-SME-9001/reference.json')));
    // Every file is RFC 8785 text.
    for (const [, bytes] of files) expect(bytes.toString('utf8')).toBe(jcs(JSON.parse(bytes.toString('utf8'))));
    const m = read('praxis-export.json');
    expect(m).toMatchObject({ schema_version: 'praxis.authored-task-export.v1', content_classification: 'synthetic', execution: { location: 'anvil_only', paid_calls: false }, batch: { part_index: 1, part_count: 1 } });
    expect(m.tasks[0]).toMatchObject({
      task_id: task,
      revision_id: record(1).id,
      template: { id: template_id, version: 2, sha256: HASHES.template_sha256 },
      form: { path: 'forms/account-opening-v2.json', sha256: jcsSha256(anvilFile('forms/account-opening-v2.json')) },
      actor: { path: `tasks/${task}/actor.json` },
      private_assets: [{ path: `private/${task}/reference.json`, purpose: 'grader_only_reference_and_rubric', access: 'private_rubric' }],
      agent_mode: 'SINGLE',
      review: { status: 'approved', revision_id: record(1).id },
    });
    // Opaque provenance only: never a person.
    expect(Object.keys(m.tasks[0].review).sort()).toEqual(['receipt_ref', 'revision_id', 'status']);
    expect(m.tasks[0].review.receipt_ref).toMatch(/^praxis-approved-record:/);
    // Anvil's package identity: JCS SHA-256 of {manifest, files: path -> JCS SHA-256}.
    const canon = Object.fromEntries([...files.keys()].sort().map((p) => [p, jcsSha256(read(p))]));
    expect(part!.packageSha256).toBe(jcsSha256({ manifest: m, files: canon }));
    // No private value reaches the actor.
    expect(files.get(`tasks/${task}/actor.json`)!.toString()).not.toContain('PRIVATE-REFERENCE-SENTINEL');
    expect(files.get(`tasks/${task}/actor.json`)!.toString()).not.toContain('request_information');
  });

  it('the same tasks always give the same package; a changed task gives a new one', () => {
    const a = buildGenericPackages([{ record: record(1), template: template() }], { projectId: 'p1' });
    const b = buildGenericPackages([{ record: record(1), template: template() }], { projectId: 'p1' });
    expect(b.parts[0]!.zip.equals(a.parts[0]!.zip)).toBe(true);
    const changed = clone(AUTHORED);
    changed.sections.S1.businessContext = 'A different synthetic context.';
    const c = buildGenericPackages([{ record: record(1, changed), template: template() }], { projectId: 'p1' });
    expect(c.batchId).not.toBe(a.batchId);
    expect(c.parts[0]!.packageId).not.toBe(a.parts[0]!.packageId);
  });

  it('never sends a task whose public view would include a field Praxis keeps private', () => {
    const leaky = clone(AUTHORED);
    leaky.sections.S4.policies = [{ ruleId: 'POL-1', ruleVersion: '1', locator: 'p.1', rationale: 'Private applicability reasoning' }];
    const built = buildGenericPackages([{ record: record(1, leaky), template: template() }], { projectId: 'p1' });
    expect(built.parts).toEqual([]);
    expect(built.problems).toEqual([expect.objectContaining({ code: 'GENERIC_PRIVATE_EXPOSURE' })]);
  });

  it('explains every task it cannot package: not joint, not published, other form, not a sections task', () => {
    const r = buildGenericPackages(
      [
        { record: record(1), template: template({ anvilSpec: null }) },
        { record: record(2), template: template({ status: 'DRAFT' }) },
        { record: record(3, { ...AUTHORED, profile: { id: 'other-form', version: 1 } }), template: template() },
        { record: record(4, { scenario: {} }), template: template() },
      ],
      { projectId: 'p1' },
    );
    expect(r.problems.map((p) => p.code)).toEqual(['GENERIC_TEMPLATE_NOT_JOINT', 'GENERIC_TEMPLATE_NOT_PUBLISHED', 'GENERIC_FORM_MISMATCH', 'GENERIC_TASK_NOT_PROFILE']);
    expect(r.parts).toEqual([]);
  });

  it('splits a large export into parts of at most 200 tasks with one batch, a consistent count and unique indexes', () => {
    const inputs = Array.from({ length: MAX_TASKS_PER_PART + 5 }, (_, i) => ({ record: record(i + 1), template: template() }));
    const r = buildGenericPackages(inputs, { projectId: 'p1' });
    expect(r.parts.map((p) => [p.partIndex, p.partCount, p.taskIds.length])).toEqual([[1, 2, 200], [2, 2, 5]]);
    const batches = r.parts.map((p) => (p.manifest.batch as { id: string }).id);
    expect(new Set(batches).size).toBe(1);
    expect(r.parts.every((p) => p.zip.length < 1_048_576)).toBe(true);
    expect(new Set(r.parts.flatMap((p) => p.taskIds)).size).toBe(205);
  });

  it('a multi-agent task carries only the agent view of its workflow (private artifacts never reach actor.json)', () => {
    const graph = {
      schemaVersion: 'praxis.workflow_graph.v1-proposed', templateId: 'T', templateVersion: 1, agentMode: 'MULTI',
      roles: [{ id: 'lead', name: 'Lead', responsibility: 'Decide.', tools: [], evidenceRefs: [] }, { id: 'analyst', name: 'Analyst', responsibility: 'Analyse.', tools: [], evidenceRefs: [] }],
      artifacts: [{ id: 'brief', label: 'Brief', visibility: 'actor' }, { id: 'answer_key', label: 'Answer key', visibility: 'private_reference' }],
      nodes: [
        { id: 'start', type: 'input', label: 'Start', policyRuleVersionIds: [], rubricCriterionIds: [], provides: ['brief'] },
        { id: 'work', type: 'agent_step', label: 'Analyse', policyRuleVersionIds: [], rubricCriterionIds: ['C1'], roleId: 'analyst', instruction: 'Analyse the brief.', inputRefs: ['brief'], outputArtifact: 'brief' },
        { id: 'done', type: 'output', label: 'Done', policyRuleVersionIds: [], rubricCriterionIds: [], deliverable: 'brief', completionCondition: 'Analysed.' },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'work', label: '' }, { id: 'e2', from: 'work', to: 'done', label: '' }],
      loops: [],
      limits: { maxTransitions: 20 },
    };
    const r = buildGenericPackages([{ record: record(1, { ...AUTHORED, workflowGraph: graph }), template: template({ agentMode: 'MULTI' }) }], { projectId: 'p1' });
    expect(r.problems).toEqual([]);
    const actor = readZip(r.parts[0]!.zip).get(`tasks/${record(1).taskInstanceId}/actor.json`)!.toString();
    expect(actor).not.toContain('answer_key');
    expect(actor).not.toContain('rubricCriterionIds');
    expect((r.parts[0]!.manifest.tasks as { agent_mode: string }[])[0]!.agent_mode).toBe('MULTI');
  });

  it('actor projection keeps public item fields and drops private ones, as Anvil recomputes it', () => {
    const form = SPEC.authoring.profile;
    const a = actorProjection(form, AUTHORED);
    expect(a).toEqual(anvilFile('tasks/NEW-SME-9001/actor.json'));
  });
});

function fake(routes: Record<string, { status: number; body: unknown }>, seen: { url: string; headers: Record<string, string>; body?: Uint8Array }[] = []): FetchLike {
  return async (url, init) => {
    seen.push({ url, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
    const key = Object.keys(routes).find((k) => url.endsWith(k))!;
    const r = routes[key]!;
    return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
}
const BASE = 'https://anvil-qa.example.test/api/v1/projects/a7454c18-602e-4907-bdd9-277067c36233/dataset-exports/generic';
const enabled = { status: 200, body: { data: { contracts: ['praxis.authored-task-export.v1'], contract: 'praxis.authored-task-export.v1', enabled: true }, meta: { request_id: 'c1' } } };
const ctx = (ts: Template[] = [template()]) => ({ projectId: 'p1', templates: new Map(ts.map((t) => [t.id, t])) });
const item = (r: ApprovedTaskRecord) => validationItem(r, 'T', []);

describe('validate and resolve through Anvil (mock transport)', () => {
  it('discovery: the exact ID in data.contracts with enabled:true; nothing else counts', () => {
    expect(genericSupport({ contracts: ['praxis.authored-task-export.v1'], enabled: true })).toBe('enabled');
    expect(genericSupport({ contracts: ['praxis.authored-task-export.v1'], enabled: false })).toBe('disabled');
    expect(genericSupport({ contract: 'praxis.authored-task-export.v1', enabled: true })).toBe('absent');
    expect(genericSupport({ contracts: ['praxis.authored-task-export.v1-proposed', 'anvil.evaluator-task-export.v1'], enabled: true })).toBe('absent');
  });

  it('valid:true -> the task is valid; Anvil’s own requirements are listed as Anvil work, not repairs; no resolve on validate', async () => {
    const seen: { url: string; headers: Record<string, string>; body?: Uint8Array }[] = [];
    const valid = json('synthetic-offline-validation.json');
    valid.anvil_requirements[0].task_id = record(1).taskInstanceId;
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': enabled, '/validate': { status: 200, body: { data: valid, meta: { request_id: 'v1' } } } }, seen)));
    const out = await v.run([item(record(1))], ctx(), { resolve: false });
    expect(out.results[0]).toMatchObject({ status: 'valid', issues: [{ code: 'AV_TEMPLATE_NOT_QUALIFIED' }] });
    expect(seen.map((s) => s.url.slice(BASE.length))).toEqual(['/contracts', '/validate']);
    expect(seen[1]!.headers['Content-Type']).toBe('application/zip');
    expect(readZip(Buffer.from(seen[1]!.body!)).has('praxis-export.json')).toBe(true);
    expect(out.anvil).toMatchObject({ support: 'enabled', parts: [{ partIndex: 1, validate: { status: 'export_valid', valid: true, requestId: 'v1' } }] });
    expect(JSON.stringify(out.anvil)).not.toContain('PRIVATE-REFERENCE-SENTINEL');
  });

  it('valid:false -> PX errors go to the task they name; other tasks stay valid', async () => {
    const r1 = record(1);
    const r2 = record(2);
    const body = { data: { valid: false, status: 'export_invalid', errors: [{ code: 'PX_CRITERIA_ANCHORS', owner: 'praxis', file: `private/${r2.taskInstanceId}/reference.json`, pointer: '/authored/sections/S7/criteria/0', message: 'Explicit 5/2/0 conditions are incomplete.', fix: 'Supply passCondition, partialCredit and failCondition.', retryable: false }], error_count: 1, anvil_requirements: [] } };
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': enabled, '/validate': { status: 422, body } })));
    const out = await v.run([item(r1), item(r2)], ctx(), { resolve: true });
    expect(out.results.map((x) => x.status)).toEqual(['valid', 'needs_fix']);
    expect(out.results[1]!.issues[0]).toMatchObject({ code: 'PX_CRITERIA_ANCHORS', path: `private/${r2.taskInstanceId}/reference.json#/authored/sections/S7/criteria/0` });
    // An invalid package is never resolved.
    expect(out.anvil!.parts[0]!.resolve).toBeUndefined();
  });

  it('valid:null (validation_blocked) -> not validated, with Anvil’s reason', async () => {
    const body = { data: { valid: null, status: 'validation_blocked', errors: [], anvil_requirements: [{ code: 'AV_TEMPLATE_NOT_REGISTERED', owner: 'anvil', status: 'blocked', task_id: record(1).taskInstanceId }] } };
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': enabled, '/validate': { status: 409, body } })));
    const out = await v.run([item(record(1))], ctx(), { resolve: true });
    expect(out.results[0]).toMatchObject({ status: 'not_validated', issues: [{ code: 'AV_TEMPLATE_NOT_REGISTERED' }] });
    expect(out.anvil!.parts[0]!.resolve).toBeUndefined();
  });

  it('export resolves a valid package with Idempotency-Key = its package hash; resolution never claims a Run', async () => {
    const seen: { url: string; headers: Record<string, string>; body?: Uint8Array }[] = [];
    const v = new AnvilGatedValidator(
      new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': enabled, '/validate': { status: 200, body: { data: { valid: true, status: 'export_valid', errors: [], anvil_requirements: [] } } }, '/resolve': { status: 200, body: { data: { status: 'import_resolved', valid: true }, meta: { request_id: 'rs1' } } } }, seen)),
    );
    const out = await v.run([item(record(1))], ctx(), { resolve: true });
    const part = out.anvil!.parts[0]!;
    expect(seen[2]!.url).toBe(`${BASE}/resolve`);
    expect(seen[2]!.headers['Idempotency-Key']).toBe(`praxis-${part.packageSha256}`);
    expect(Buffer.from(seen[2]!.body!).equals(Buffer.from(seen[1]!.body!))).toBe(true);
    expect(part.resolve).toMatchObject({ status: 'import_resolved', requestId: 'rs1' });
    expect(out.results[0]!.issues).toEqual([expect.objectContaining({ code: 'ANVIL_RESOLVED', message: expect.stringContaining('no Run was started') })]);
  });

  it('a task Praxis cannot package is not sent and says why; disabled or unreachable Anvil sends nothing', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': enabled }, seen)));
    const out = await v.run([item(record(1))], ctx([template({ anvilSpec: null })]), { resolve: true });
    expect(out.results[0]).toMatchObject({ status: 'not_validated', issues: [{ code: 'GENERIC_TEMPLATE_NOT_JOINT' }] });
    expect(seen.map((s) => s.url.slice(BASE.length))).toEqual(['/contracts']);
    const down = new AnvilGatedValidator(new AnvilExportClient(BASE, 'tok-0123456789', fake({ '/contracts': { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'Down.' } } } })));
    expect((await down.run([item(record(1))], ctx(), { resolve: true })).results[0]!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ANVIL_UNAVAILABLE' })]));
  });
});

describe('author checks on a joint template (four confirmations, point 3)', () => {
  const anchors = { passCondition: 'Full.', partialCredit: 'Partial.', failCondition: 'Fail.' };
  const out = (criteria: object[], calls: object[] = []) => ({ sections: { S7: { criteria }, S3: { recordedResponses: calls } } });
  const byId = (r: { id: string; ok: boolean; message: string }[], id: string) => r.find((c) => c.id === id)!;

  it('each criterion uses the exact evaluator (id, version) its template maps; output checks name a declared field and value', () => {
    const good = [
      { id: 'C1', weight: 33.33, critical: true, evaluatorKind: 'output-reference-v1', evaluatorVersion: '1', outputField: 'recommendation', expectedValue: 'request_information', ...anchors },
      { id: 'C2', weight: 66.67, critical: false, evaluatorKind: 'output-reference-v1', evaluatorVersion: '1', outputField: 'recommendation', expectedValue: 'request_information', ...anchors },
    ];
    expect(anvilSpecChecks(partsAndKey, out(good)).every((c) => c.ok)).toBe(true);
    const bad = [
      { ...good[0], evaluatorVersion: '2', critical: false },
      { ...good[1], outputField: 'not_declared' },
      { id: 'C9', weight: 0.01, ...anchors },
    ];
    const r = anvilSpecChecks(partsAndKey, out(bad));
    expect(byId(r, 'anvil.evaluator-kinds')).toMatchObject({ ok: false, message: expect.stringContaining('C1 (output-reference-v1 v1)') });
    expect(byId(r, 'anvil.evaluator-binding')).toMatchObject({ ok: false, message: expect.stringContaining('C9') });
    expect(byId(r, 'anvil.output-reference')).toMatchObject({ ok: false, message: expect.stringContaining('C2') });
    expect(byId(r, 'anvil.critical').ok).toBe(false);
    expect(byId(r, 'anvil.tools').ok).toBe(true);
    expect(byId(anvilSpecChecks(partsAndKey, out(good, [{ id: 'R1', tool: 'funds.transfer' }])), 'anvil.tools')).toMatchObject({ ok: false, message: expect.stringContaining('R1 (funds.transfer)') });
  });
});
