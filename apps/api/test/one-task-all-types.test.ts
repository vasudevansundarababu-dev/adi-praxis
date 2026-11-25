import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import type { ApprovedTaskRecord } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { coveredSelectorOf } from '../src/anvil/rlgym-export';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { snapshotProblems } from '../src/tasks/task-integrity';
import { ensureSlots } from '../src/tasks/task-service';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * KYC Judgment v1 §16 (owner, 25 Nov 2026: one task covers all four account types). When the template's case selector
 * reads a multi-select, the project gets ONE slot with no fixed case, the export sends the covered list, and Validate
 * warns when the task's agent-visible wording names one type. Other templates are unchanged. The reusable KYC proposal
 * fixture stands in, with its state field made a multi-select. Mocks only.
 */
const PACKET = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const covered = () => {
  const p = structuredClone(PACKET);
  p.authoring.profile.profileId = 'golden-kyc-reusable-covered-v1';
  const f = p.authoring.profile.sections[0].fields.find((x: { key: string }) => x.key === 'governingState');
  f.type = 'multi_select';
  p.authoring.template.caseSelector.strategy = 'stratified';
  return p;
};

describe('one task for all types (§16)', () => {
  let app: FastifyInstance;
  let admin: string;
  let anvilKey: string;

  beforeAll(async () => {
    app = await buildApp({ config: testConfig({ ANVIL_CREDENTIAL_NOT_AFTER: new Date(Date.now() + 60 * 86_400_000).toISOString() }), db, pingRedis: async () => true, selectionGate: stubSelectionGate });
  });
  beforeEach(async () => {
    await resetDb();
    await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    anvilKey = (await app.inject({ method: 'POST', url: '/api/v1/api-clients', headers: { cookie: admin, ...idem() }, payload: { name: 'Anvil QA', kind: 'ANVIL' } })).json().key;
  });
  afterAll(async () => {
    await app.close();
  });

  async function draft(packet: Record<string, unknown>) {
    const domainId = (await app.inject({ method: 'POST', url: '/api/v1/domains', headers: { cookie: admin, ...idem() }, payload: { name: 'Banking' } })).json().id;
    const t = (await app.inject({ method: 'POST', url: '/api/v1/templates', headers: { cookie: admin, ...idem() }, payload: { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'Old.', verificationCriteria: 'Old.', humanGate: 'PM', skills: ['KYC'], defaultTptMinutes: 60, taskModes: ['AUTHORING'] } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${t.id}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: packet });
    expect(res.statusCode, res.body).toBe(201);
    const id = res.json().data.template_version_id as string;
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${id}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    return db.template.findUniqueOrThrow({ where: { id } });
  }
  async function project(templateId: string, version: number) {
    const owner = await db.user.findFirstOrThrow({ where: { email: 'admin@test.local' } });
    return db.project.create({ data: { clientId: owner.clientId, ownerId: owner.id, templateId, templateVersion: version, name: 'One task', taskMode: 'AUTHORING', distinctTarget: 1 } });
  }

  it('a multi-select selector gives ONE slot with no fixed case; a pick-list selector still gives one per value', async () => {
    const t = await draft(covered());
    const p = await project(t.id, t.version);
    expect(await db.$transaction((tx) => ensureSlots(tx, p.id))).toBe(1);
    const [slot] = await db.coverageSlot.findMany({ where: { projectId: p.id } });
    expect(slot!.coverageTags).toMatchObject({ tags: {}, edgeCase: null });
    expect(slot!.coverageTags).not.toHaveProperty('case');
    expect(slot!.brief).toContain('Write one reusable task for every');
  });

  it('the export sends the covered list from the task; other templates keep their selector', async () => {
    const t = await draft(covered());
    const record = { input: { slot: {} }, output: { sections: { S1: { governingState: ['NY', 'CA'] } } } } as unknown as ApprovedTaskRecord;
    expect(coveredSelectorOf(t, record, 'expired_document')).toEqual({ governing_states: ['CA', 'NY'], edge_cases: ['expired_document'] });
    expect(coveredSelectorOf(t, { ...record, output: { sections: { S1: { governingState: [] } } } } as never)).toBeNull();
    const plain = await db.template.findFirstOrThrow({ where: { workflowName: 'KYC onboarding and refresh', version: 1 } });
    expect(coveredSelectorOf(plain, record)).toBeNull();
  });

  it('Validate warns (never blocks) when agent-visible wording names one type', async () => {
    const t = await draft(covered());
    const out = { profile: { id: 'golden-kyc-reusable-covered-v1', version: 1 }, sections: { S1: { governingState: ['CA', 'NY'], scope: 'Only CA applicants are in scope.' } } };
    const w = snapshotProblems(t, out).filter((p) => p.code === 'ACCOUNT_TYPE_NAMED');
    expect(w).toEqual([expect.objectContaining({ field: 'S1.scope', severity: 'warning', owner: 'author' })]);
    expect(w[0]!.message).toContain('"ca"');
  });
});
