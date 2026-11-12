import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_KYC_EXAMPLE, KYC_ACCOUNT_OPENING_PROFILE, KYC_V2_TOOLS } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { anvilSpecChecks } from '../src/tasks/submission';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

/**
 * Praxis template API for Anvil (Praxis-Anvil contract, approved 12 Nov 2026, section 5). Anvil proposes; Praxis checks
 * authorability, creates a draft for an Admin to publish, and records Anvil's qualification receipts. Mocks only: no
 * network, no model.
 */
function spec(over: { workflow?: string; profileId?: string; withTemplate?: boolean } = {}) {
  const id = over.profileId ?? `anvil-form-${randomUUID().slice(0, 8)}`;
  const workflow = over.workflow ?? `Anvil proposed workflow ${id}`;
  return {
    schemaVersion: 'praxis.template_spec.v1-proposed',
    requirement: { id: 'REQ-2026-041', channel: 'enterprise-banking', summary: 'Consumer account opening benchmark (synthetic).' },
    pack: {
      schemaVersion: 'praxis.golden_pack.v1',
      source: 'Anvil proposal (synthetic)',
      profile: { ...KYC_ACCOUNT_OPENING_PROFILE, profileId: id, catalogWorkflowName: workflow, handoverName: 'Anvil proposed form' },
      ...(over.withTemplate === false ? {} : { template: { domainName: 'Banking', primaryWork: 'Author one synthetic investigation with its reference and rubric.', verificationCriteria: 'Evidence, rules, reference and rubric agree.', humanGate: 'A person decides; the agent recommends.', skills: ['KYC'], defaultTptMinutes: 90 } }),
      examples: [{ name: 'Case 1', output: { ...GOLDEN_KYC_EXAMPLE, profile: { id, version: 1 } } }],
    },
    execution: {
      capabilityCatalogVersion: 'anvil-capabilities-0',
      environment: { adapter: 'mcp_replay' },
      tools: KYC_V2_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } })),
      evaluatorKinds: ['run_evidence', 'trace_check'],
      outputSchema: { type: 'object', properties: { recommendation: { type: 'string' } } },
    },
    skills: {
      authoring: { mandatory: ['KYC', 'CIP'], preferred: [], specialties: [], jurisdictions: ['US-NY'], languages: ['en'], certifications: [] },
      reviewing: { mandatory: ['KYC', 'CIP', 'Account opening'], preferred: [], specialties: [], jurisdictions: [], languages: ['en'], certifications: [] },
    },
  };
}

describe('Praxis template API for Anvil', () => {
  let app: FastifyInstance;
  let admin: string;
  let clientId: string;
  let anvilKey: string;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    const issued = await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } });
    expect(issued.statusCode, issued.body).toBe(201);
    anvilKey = issued.json().key;
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const anvil = (method: 'GET' | 'POST', url: string, payload?: object, key = anvilKey, extra: Record<string, string> = {}) =>
    app.inject({ method, url: `/api/v1/integrations/anvil/templates${url}`, headers: { authorization: `Bearer ${key}`, ...(method === 'POST' ? idem() : {}), ...extra }, ...(payload ? { payload } : {}) });

  it('an ANVIL key expires (default 30 days); other keys, sessions, expired and revoked keys are refused', async () => {
    const row = await db.apiClient.findFirstOrThrow({ where: { kind: 'ANVIL' } });
    expect(row.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await anvil('GET', '/contracts')).statusCode).toBe(200);
    const pm = await login(app, (await createUser(clientId, ['PM'])).email);
    expect((await app.inject({ method: 'GET', url: '/api/v1/integrations/anvil/templates/contracts', headers: { cookie: pm } })).statusCode).toBe(403);
    const rl = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'RL', kind: 'RL_GYM' } })).json().key;
    expect((await anvil('GET', '/contracts', undefined, rl)).statusCode).toBe(403);
    await db.apiClient.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anvil('GET', '/contracts')).statusCode).toBe(401);
    await db.apiClient.update({ where: { id: row.id }, data: { expiresAt: null } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/api-clients/${row.id}/revoke`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    expect((await anvil('GET', '/contracts')).statusCode).toBe(401);
  });

  it('contracts list the schemas, limits and codes; paid calls are off', async () => {
    const c = (await anvil('GET', '/contracts')).json();
    expect(c.data).toMatchObject({ template_spec_schema_versions: ['praxis.template_spec.v1-proposed'], pack_schema_version: 'praxis.golden_pack.v1', paid_calls: false });
    expect(c.data.error_codes).toContain('TP_TOOL_SCHEMA_MISSING');
    expect(c.meta.request_id).toBeTruthy();
  });

  it('validate: authorable proposal with staffing counts; an incomplete one gets every Anvil fix; nothing is stored', async () => {
    const ok = await anvil('POST', '/validate', spec());
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data).toMatchObject({ valid: true, status: 'template_authorable', errors: [], paid_calls: false });
    expect(ok.json().data.praxis_requirements[0]).toMatchObject({ code: 'PR_RECRUITMENT_NEEDED', counts: { eligibleAuthors: 0 } });

    const bad = spec({ withTemplate: false });
    bad.skills.reviewing.mandatory = [];
    bad.execution.tools = bad.execution.tools.slice(1);
    bad.execution.evaluatorKinds = [];
    const r = await anvil('POST', '/validate', bad);
    expect(r.statusCode).toBe(422);
    const codes = r.json().data.errors.map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['TP_SKILLS_MISSING', 'TP_TOOL_SCHEMA_MISSING', 'TP_EVALUATOR_KIND_UNKNOWN', 'TP_TEMPLATE_MISSING']));
    expect(r.json().data.errors.every((e: { owner: string; fix: string; pointer: string }) => e.owner === 'anvil' && e.fix && e.pointer)).toBe(true);
    expect(await db.templateProposal.count()).toBe(0);
    expect(await db.uploadedProfile.count()).toBe(0);
  });

  it('proposal -> draft (idempotent) -> Admin publishes -> Anvil qualifies the exact hash -> Anvil-ready; revocation is a new row', async () => {
    const body = spec();
    const key = { 'idempotency-key': `anvil-${randomUUID()}` };
    const p = await anvil('POST', '/proposals', body, anvilKey, key);
    expect(p.statusCode, p.body).toBe(201);
    const d = p.json().data;
    expect(d).toMatchObject({ status: 'draft_created', template_version: 1, profile_id: body.pack.profile.profileId });
    // Same key, same body: replayed, nothing duplicated. Same key, different body: refused.
    expect((await anvil('POST', '/proposals', body, anvilKey, key)).json().data.proposal_id).toBe(d.proposal_id);
    expect((await anvil('POST', '/proposals', { ...body, requirement: { id: 'REQ-OTHER' } }, anvilKey, key)).statusCode).toBe(409);
    expect(await db.templateProposal.count()).toBe(1);

    const draft = await db.template.findUniqueOrThrow({ where: { id: d.template_id } });
    expect(draft).toMatchObject({ status: 'DRAFT', profileId: body.pack.profile.profileId, skills: ['KYC', 'CIP'] });
    expect((draft.anvilSpec as { requirement: { id: string } }).requirement.id).toBe('REQ-2026-041');
    expect((await anvil('GET', `/proposals/${d.proposal_id}`)).json().data).toMatchObject({ status: 'draft_created', template_version_hash: null });
    expect((await app.inject({ method: 'GET', url: `/api/v1/templates/${draft.id}/anvil`, headers: { cookie: admin } })).json()).toMatchObject({ proposedByAnvil: true, qualification: 'none', anvilReady: false, requirementId: 'REQ-2026-041' });

    // Nothing goes live from the API: the Praxis Admin publishes.
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${draft.id}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    const status = (await anvil('GET', `/proposals/${d.proposal_id}`)).json().data;
    expect(status.status).toBe('published');
    const hash = status.template_version_hash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const receipt = { anvil_revision: 'test', profile: 'praxis-authored-v1', checks: 12 };
    expect((await anvil('POST', '/qualifications', { template_id: draft.id, template_version_hash: '0'.repeat(64), status: 'QUALIFIED', receipt_id: 'RCPT-1', receipt })).statusCode).toBe(409);
    const q = await anvil('POST', '/qualifications', { template_id: draft.id, template_version_hash: hash, status: 'QUALIFIED', receipt_id: 'RCPT-1', receipt });
    expect(q.statusCode, q.body).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/api/v1/templates/${draft.id}/anvil`, headers: { cookie: admin } })).json()).toMatchObject({ qualification: 'qualified', anvilReady: true, receiptId: 'RCPT-1', versionHash: hash });

    expect((await anvil('POST', '/qualifications', { template_id: draft.id, template_version_hash: hash, status: 'REVOKED', receipt_id: 'RCPT-1-REVOKE', receipt })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/api/v1/templates/${draft.id}/anvil`, headers: { cookie: admin } })).json()).toMatchObject({ qualification: 'revoked', anvilReady: false });
    await expect(db.$executeRawUnsafe(`UPDATE "TemplateQualification" SET status = 'QUALIFIED'`)).rejects.toThrow();
    expect(await db.auditEvent.count({ where: { action: { in: ['template_proposal.received', 'template.anvil_qualified', 'template.anvil_qualification_revoked'] } } })).toBe(3);
  });

  it('a change to an existing workflow becomes its next version; a second open draft is refused', async () => {
    const first = spec();
    const p1 = (await anvil('POST', '/proposals', first)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/templates/${p1.template_id}/publish`, headers: { cookie: admin, ...idem() } });
    const change = spec({ workflow: first.pack.profile.catalogWorkflowName, withTemplate: false });
    const p2 = await anvil('POST', '/proposals', change);
    expect(p2.statusCode, p2.body).toBe(201);
    expect(p2.json().data).toMatchObject({ template_version: 2, status: 'draft_created' });
    const again = await anvil('POST', '/proposals', spec({ workflow: first.pack.profile.catalogWorkflowName, withTemplate: false }));
    expect(again.statusCode).toBe(409);
    expect(again.json().error ?? again.json().code).toBeTruthy();
  });

  it('tasks on an Anvil-proposed template use only its evaluator kinds and described tools', () => {
    const anvilSpec = { execution: { evaluatorKinds: ['run_evidence'], tools: [{ name: 'identity.check' }] } };
    const good = { sections: { S7: { criteria: [{ id: 'C01', evaluatorKind: 'run_evidence' }] }, S3: { recordedResponses: [{ id: 'R1', tool: 'identity.check' }] } } };
    expect(anvilSpecChecks(anvilSpec, good).every((c) => c.ok)).toBe(true);
    const bad = { sections: { S7: { criteria: [{ id: 'C01' }, { id: 'C02', evaluatorKind: 'llm_judge' }] }, S3: { recordedResponses: [{ id: 'R1', tool: 'funds.transfer' }] } } };
    const r = anvilSpecChecks(anvilSpec, bad);
    expect(r.find((c) => c.id === 'anvil.evaluator-kinds')).toMatchObject({ ok: false, message: expect.stringContaining('C01, C02') });
    expect(r.find((c) => c.id === 'anvil.tools')).toMatchObject({ ok: false, message: expect.stringContaining('R1 (funds.transfer)') });
  });
});
