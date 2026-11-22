import type { ApprovedTaskRecord, Template } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actorProjection, buildGenericPackages, CASE_SELECTOR_IN_STATE_PACKAGES, MAX_TASKS_PER_PART } from '../src/anvil/generic-package';
import { jcs, JcsError, jcsSha256 } from '../src/anvil/jcs';
import { jointHashes, jointTemplateSpec } from '../src/anvil/joint-template';
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

describe('KYC v7 selector block (Anvil written answers, 15 Nov 2026; MVP1 step 4)', () => {
  const V7 = { field: 'product', source: 'S1.applicationType', values: ['individual', 'adult_joint', 'teen_joint', 'custodial'] };
  const V6 = { field: 'governing_state', source: 'S1.governingState', values: ['CA', 'NY', 'TX'] };
  const slotInput = (sel: { field: string; source: string }, value: string) => ({ slot: { id: 's', brief: 'b', tags: { [sel.field]: value }, edgeCase: null, isOpen: false, case: { field: sel.field, source: sel.source, value } } });
  const authored = (s1: Record<string, string>) => {
    const out = clone(AUTHORED);
    Object.assign(out.sections.S1, s1);
    return out;
  };
  const entryOf = (b: ReturnType<typeof buildGenericPackages>) => b.parts[0]!.manifest.tasks as Record<string, unknown>[];

  it('a v7 task carries case_selector with its slot value, and coverage.example_governing_state only when set', () => {
    const withState = buildGenericPackages([{ record: record(1, authored({ applicationType: 'adult_joint', exampleGoverningState: 'NY' }), { input: slotInput(V7, 'adult_joint') } as never), template: template({ caseSelector: V7 } as never) }], { projectId: 'p1' });
    expect(withState.problems).toEqual([]);
    expect(entryOf(withState)[0]).toMatchObject({ case_selector: { field: 'product', value: 'adult_joint' }, coverage: { example_governing_state: 'NY' } });
    const files = readZip(withState.parts[0]!.zip);
    expect(JSON.parse(files.get('praxis-export.json')!.toString('utf8')).tasks[0].case_selector).toEqual({ field: 'product', value: 'adult_joint' });

    const noState = buildGenericPackages([{ record: record(1, authored({ applicationType: 'adult_joint', exampleGoverningState: '' }), { input: slotInput(V7, 'adult_joint') } as never), template: template({ caseSelector: V7 } as never) }], { projectId: 'p1' });
    expect(entryOf(noState)[0]!.case_selector).toEqual({ field: 'product', value: 'adult_joint' });
    expect(entryOf(noState)[0]).not.toHaveProperty('coverage');
    // The new fields change the v7 package identity.
    expect(noState.parts[0]!.packageSha256).not.toBe(withState.parts[0]!.packageSha256);
  });

  it('uses the authored value when the slot has none; reports a mismatch or a missing value instead of guessing', () => {
    const fromAuthored = buildGenericPackages([{ record: record(1, authored({ applicationType: 'custodial' })), template: template({ caseSelector: V7 } as never) }], { projectId: 'p1' });
    expect(entryOf(fromAuthored)[0]!.case_selector).toEqual({ field: 'product', value: 'custodial' });
    const r = buildGenericPackages(
      [
        { record: record(1, authored({ applicationType: 'teen_joint' }), { input: slotInput(V7, 'adult_joint') } as never), template: template({ caseSelector: V7 } as never) },
        { record: record(2), template: template({ caseSelector: V7 } as never) },
      ],
      { projectId: 'p1' },
    );
    expect(r.problems.map((p) => p.code)).toEqual(['GENERIC_CASE_SELECTOR_MISMATCH', 'GENERIC_CASE_SELECTOR_MISSING']);
    expect(r.parts).toEqual([]);
  });

  it('a v6 (state) package stays byte-identical: no case_selector or coverage, same hashes as before step 4', () => {
    expect(CASE_SELECTOR_IN_STATE_PACKAGES).toBe(false);
    const out = authored({ governingState: 'NY', exampleGoverningState: 'TX' });
    const b = buildGenericPackages([{ record: record(1, out, { input: slotInput(V6, 'NY') } as never), template: template({ caseSelector: V6 } as never) }], { projectId: 'p1' });
    expect(b.problems).toEqual([]);
    const entry = entryOf(b)[0]!;
    expect(entry).not.toHaveProperty('case_selector');
    expect(entry).not.toHaveProperty('coverage');
    // Hashes produced by the package builder before this change, for this exact fixture.
    expect(b.parts[0]!.packageSha256).toBe('7afeb0c1c321924cbfe52ee03a8dc320ab9fce3153a85a711804c6a85e16203d');
    expect(b.parts[0]!.zipSha256).toBe('5944026cc17fc92e3350008b44c120f3d07d4793f2d4966146a13d1d3b22450e');
  });
});
