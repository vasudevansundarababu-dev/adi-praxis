import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_KYC_EXAMPLE, KYC_ACCOUNT_OPENING_PROFILE, KYC_V2_TOOLS } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { jcsSha256 } from '../src/anvil/jcs';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Joint template object and revocation delivery (Anvil's four confirmations, 11 Nov 2026, points 1, 2 and 4).
 * Mocks only: no network, no model, no paid calls.
 */
const ANVIL_PROJECT = 'a7454c18-602e-4907-bdd9-277067c36233';
const BASE = `https://anvil-qa.example.test/api/v1/projects/${ANVIL_PROJECT}/dataset-exports/generic`;
const BOUND = new Date(Date.now() + 60 * 86_400_000);

function proposal(over: { profileId?: string } = {}) {
  const id = over.profileId ?? `anvil-joint-${randomUUID().slice(0, 8)}`;
  return {
    schemaVersion: 'praxis.anvil.template-spec.v1',
    anvil_template_key: `${id}-key`,
    requirement: { reference: 'synthetic-requirement-REQ-77', channel: 'enterprise-banking' },
    authoring: {
      profile: { ...KYC_ACCOUNT_OPENING_PROFILE, profileId: id, catalogWorkflowName: `Joint workflow ${id}`, handoverName: 'Anvil joint form' },
      template: { domainName: 'Banking', primaryWork: 'Author one synthetic investigation.', verificationCriteria: 'Evidence, rules, reference and rubric agree.', humanGate: 'A person decides.', skills: ['KYC'], defaultTptMinutes: 90 },
      examples: [{ name: 'Case 1', output: { ...GOLDEN_KYC_EXAMPLE, profile: { id, version: 1 } } }],
    },
    execution: {
      schema_version: 'anvil.template-execution.v1',
      catalogue_version: '1.0.0',
      environment: { id: 'recorded-tools-v1', version: '1' },
      tools: KYC_V2_TOOLS.map((t) => ({ id: t, input_schema: { type: 'object' }, output_schema: { type: 'object' }, error_schema: { type: 'object' }, response_mode: 'recorded', pending: false, error_statuses: [], reset: 'new_episode', isolation: 'per_episode' })),
      evaluators: [{ criterion_id: 'C1', capability: { id: 'output-reference-v1', version: '1' }, evidence_source: 'output' }],
      output_schema: { type: 'object', properties: { recommendation: { type: 'string' } }, required: ['recommendation'], additionalProperties: false },
      conformance_output: { recommendation: 'approve' },
      limits: { tool_calls: 10, wall_seconds: 900, output_bytes: 4096, transitions: 10 },
      graph_node_types: [],
      rules: [],
      network: 'none',
      reset: 'new_episode',
      isolation: 'per_episode',
      paid_calls: false,
    },
    skills: { schema_version: 'anvil.template-skills.v1', authoring: { mandatory: ['KYC', 'CIP'], languages: ['en'] }, reviewing: { mandatory: ['KYC review'], languages: ['en'] } },
  };
}

describe('joint template object and revocation events', () => {
  let app: FastifyInstance;
  let admin: string;
  let anvilKey: string;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: BOUND.toISOString(), ANVIL_ENVIRONMENT: 'qa', ANVIL_EXPORT_BASE_URL: BASE }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
  });
  beforeEach(async () => {
    await resetDb();
    await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    anvilKey = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } })).json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const anvil = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url: `/api/v1/integrations/anvil/templates${url}`, headers: { authorization: `Bearer ${anvilKey}`, ...(method === 'POST' ? idem() : {}) }, ...(payload ? { payload } : {}) });

  /** Proposes, publishes and returns the published spec and its hash. */
  async function published() {
    const body = proposal();
    const p = await anvil('POST', '/proposals', body);
    expect(p.statusCode, p.body).toBe(201);
    const d = p.json().data;
    await app.inject({ method: 'POST', url: `/api/v1/templates/${d.template_version_id}/publish`, headers: { cookie: admin, ...idem() } });
    const g = (await anvil('GET', `/proposals/${d.proposal_id}`)).json().data;
    return { body, d, g };
  }

  it('contracts advertise the joint format, its exact keys, hashing and the Praxis-owned authoring schema', async () => {
    const c = (await anvil('GET', '/contracts')).json().data;
    expect(c.template_spec_schema_versions).toEqual(['praxis.anvil.template-spec.v1', 'praxis.template_spec.v1-proposed']);
    expect(c.joint_template_spec.top_level_keys).toEqual(['schemaVersion', 'anvil_template_key', 'template_id', 'version', 'requirement', 'authoring', 'execution', 'skills']);
    expect(c.authoring_schema).toMatchObject({ required: ['profile'], additionalProperties: false });
    expect(c.revocation.acknowledgement).toEqual(['event_id', 'event_sha256', 'status', 'sequence']);
  });

  it('a joint proposal: Praxis assigns template_id (stable) and version; GET returns the spec, whole and part hashes and publication status', async () => {
    const body = proposal();
    const p = await anvil('POST', '/proposals', body);
    expect(p.statusCode, p.body).toBe(201);
    const d = p.json().data;
    const row = await db.template.findUniqueOrThrow({ where: { id: d.template_version_id } });
    expect(d).toMatchObject({ anvil_template_key: body.anvil_template_key, template_id: row.lineageId, version: 1, status: 'draft_created' });
    // The parts are stored exactly as received.
    expect(row.anvilSpec).toEqual({ schemaVersion: body.schemaVersion, anvil_template_key: body.anvil_template_key, requirement: body.requirement, authoring: body.authoring, execution: body.execution, skills: body.skills });

    const draft = (await anvil('GET', `/proposals/${d.proposal_id}`)).json().data;
    expect(draft).toMatchObject({ publication_status: 'candidate', template_version_hash: null });
    expect(Object.keys(draft.template_spec)).toEqual(['schemaVersion', 'anvil_template_key', 'template_id', 'version', 'requirement', 'authoring', 'execution', 'skills']);
    expect(draft.template_spec).toMatchObject({ template_id: row.lineageId, version: 1, authoring: body.authoring });
    expect(draft.template_sha256).toBe(jcsSha256(draft.template_spec));
    expect(draft.part_hashes).toEqual({ authoring: jcsSha256(body.authoring), execution: jcsSha256(body.execution), skills: jcsSha256(body.skills) });

    await app.inject({ method: 'POST', url: `/api/v1/templates/${row.id}/publish`, headers: { cookie: admin, ...idem() } });
    const pub = (await anvil('GET', `/proposals/${d.proposal_id}`)).json().data;
    expect(pub).toMatchObject({ publication_status: 'published', template_sha256: draft.template_sha256, template_version_hash: draft.template_sha256 });
  });

  it('refuses identity Anvil may not assign, unknown fields and a wrong wrapper', async () => {
    const bad = { ...proposal(), template_id: randomUUID(), extra: 1, authoring: { form: {} } };
    const r = await anvil('POST', '/validate', bad);
    expect(r.statusCode).toBe(422);
    const errs = r.json().data.errors as { code: string; pointer: string }[];
    expect(errs.map((e) => e.pointer)).toEqual(expect.arrayContaining(['/template_id', '/extra', '/authoring/form', '/authoring/profile']));
    const noTool = proposal();
    noTool.execution.tools = noTool.execution.tools.slice(1);
    expect((await anvil('POST', '/validate', noTool)).json().data.errors.map((e: { code: string }) => e.code)).toContain('TP_TOOL_SCHEMA_MISSING');
  });

  it('qualification by (template_id, version, whole hash); revocation envelope: applied once, acknowledged, per-receipt', async () => {
    const { d, g } = await published();
    const hash = g.template_sha256 as string;
    const rA = { receipt_id: randomUUID(), body: { schema_version: 'anvil.qualification-receipt.v1', checks: 40 } };
    const rB = { receipt_id: randomUUID(), body: { schema_version: 'anvil.qualification-receipt.v1', checks: 41 } };
    for (const r of [rA, rB]) {
      const q = await anvil('POST', '/qualifications', { template_id: d.template_id, version: 1, template_version_hash: hash, status: 'QUALIFIED', receipt_id: r.receipt_id, receipt: r.body });
      expect(q.statusCode, q.body).toBe(201);
      expect(q.json().data).toMatchObject({ template_id: d.template_id, version: 1, template_version_hash: hash });
    }
    const readiness = async () => (await app.inject({ method: 'GET', url: `/api/v1/templates/${d.template_version_id}/anvil`, headers: { cookie: admin } })).json();
    expect(await readiness()).toMatchObject({ qualification: 'qualified', receiptId: rB.receipt_id, versionHash: hash });

    const event = (receipt: { receipt_id: string; body: object }, sequence: number, over: object = {}) => ({
      schema_version: 'anvil.template-revocation.v1', event_id: randomUUID(), environment: 'qa', project_id: ANVIL_PROJECT, anvil_template_key: d.anvil_template_key,
      template_id: d.template_id, version: 1, template_sha256: hash, receipt_id: receipt.receipt_id, receipt_hash: jcsSha256(receipt.body), status: 'revoked', reason: 'Synthetic re-check failed', sequence, ...over,
    });
    const send = (e: object, sha = jcsSha256(e)) => anvil('POST', '/qualifications', { kind: 'revocation', event: e, event_sha256: sha });

    // Revoking the older receipt A leaves the newer receipt B standing.
    const eA = event(rA, 2);
    const a1 = await send(eA);
    expect(a1.statusCode, a1.body).toBe(200);
    expect(a1.json().data).toEqual({ event_id: eA.event_id, event_sha256: jcsSha256(eA), status: 'applied', sequence: 2 });
    expect(await readiness()).toMatchObject({ qualification: 'qualified', receiptId: rB.receipt_id });
    // The same event again (new Idempotency-Key): acknowledged, nothing new.
    const again = await send(eA);
    expect(again.json().data, again.body).toMatchObject({ status: 'already_applied', event_id: eA.event_id });
    expect(await db.anvilRevocationEvent.count()).toBe(1);
    // Same event ID or same sequence with other content: conflict, not overwrite.
    expect((await send({ ...eA, reason: 'Changed' })).statusCode).toBe(409);
    expect((await send(event(rB, 2))).json().error).toBe('EVENT_CONFLICT');
    // Hash, binding and receipt identity are checked.
    expect((await send(event(rB, 5), '0'.repeat(64))).json().error).toBe('EVENT_HASH_MISMATCH');
    expect((await send(event(rB, 6, { project_id: randomUUID() }))).json().error).toBe('ANVIL_STREAM_MISMATCH');
    expect((await send(event(rB, 7, { environment: 'staging' }))).json().error).toBe('ANVIL_STREAM_MISMATCH');
    expect((await send(event(rB, 8, { receipt_hash: 'f'.repeat(64) }))).json().error).toBe('RECEIPT_HASH_MISMATCH');
    expect((await send(event(rB, 9, { template_sha256: 'e'.repeat(64) }))).json().error).toBe('TEMPLATE_VERSION_MISMATCH');
    // An older event for receipt A (lower sequence, arriving late) never reopens it.
    const late = await send(event(rA, 1));
    expect(late.json().data, late.body).toMatchObject({ status: 'already_applied', sequence: 1 });
    // A previously unseen revocation of B is applied even though a higher sequence (A's 2) came first.
    const eB = event(rB, 1, { event_id: randomUUID() });
    // sequence 1 is now taken by the late A event: B arrives with its own number.
    const b = await send({ ...eB, sequence: 3 });
    expect(b.json().data).toMatchObject({ status: 'applied', sequence: 3 });
    expect(await readiness()).toMatchObject({ qualification: 'revoked', anvilReady: false });
    expect(await db.auditEvent.count({ where: { action: 'template.anvil_qualification_revoked' } })).toBe(2);
    await expect(db.$executeRawUnsafe(`UPDATE "AnvilRevocationEvent" SET outcome = 'applied'`)).rejects.toThrow();
  });

  it('a revocation is refused when this Praxis is not bound to an Anvil project and environment', async () => {
    const unbound = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: BOUND.toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
    try {
      const e = { schema_version: 'anvil.template-revocation.v1', event_id: randomUUID(), environment: 'qa', project_id: ANVIL_PROJECT, anvil_template_key: 'k', template_id: randomUUID(), version: 1, template_sha256: 'a'.repeat(64), receipt_id: randomUUID(), receipt_hash: 'b'.repeat(64), status: 'revoked', reason: 'r', sequence: 1 };
      const r = await unbound.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/qualifications', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: { kind: 'revocation', event: e, event_sha256: jcsSha256(e) } });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('ANVIL_STREAM_UNBOUND');
    } finally {
      await unbound.close();
    }
  });
});
