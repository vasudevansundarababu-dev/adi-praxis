import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { rebuildCaseSelectorSlots } from '../src/jobs/case-selector-slots';
import { stubSelectionGate } from '../src/staffing/selection-gate';
import { caseCheck, coverageChecks, type TemplateRef } from '../src/tasks/definitions';
import { ensureSlots } from '../src/tasks/task-service';
import { db, idem, login, resetDb, testConfig } from './helpers';

/**
 * One task per case-selector value (owner, 13 Nov 2026): a project on the corrected KYC template gets exactly one
 * slot per state, each task carries its state, and a task whose form names another state cannot be submitted.
 * Mocks only: no network, no model, no paid calls.
 */
const PACKET = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const STATES = ['CA', 'NY', 'TX', 'FL', 'IL'];
const SELECTOR = { field: 'governing_state', source: 'S1.governingState', values: STATES };

describe('case selector: one slot and one task per value', () => {
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
    await db.$disconnect();
  });

  /** The corrected KYC proposal as the next version of an existing KYC workflow; returns the new draft. */
  async function correctedDraft() {
    const domainId = (await app.inject({ method: 'POST', url: '/api/v1/domains', headers: { cookie: admin, ...idem() }, payload: { name: 'Banking' } })).json().id;
    const t = (await app.inject({ method: 'POST', url: '/api/v1/templates', headers: { cookie: admin, ...idem() }, payload: { domainId, workflowName: 'KYC onboarding and refresh', primaryWork: 'Old.', verificationCriteria: 'Old.', humanGate: 'A person decides.', defaultTptMinutes: 90, skills: ['KYC'], taskModes: ['AUTHORING'] } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${t.id}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/anvil/templates/proposals', headers: { authorization: `Bearer ${anvilKey}`, ...idem() }, payload: structuredClone(PACKET) });
    expect(res.statusCode, res.body).toBe(201);
    return db.template.findUniqueOrThrow({ where: { id: res.json().data.template_version_id } });
  }

  async function project(templateId: string, version: number, name = 'KYC five states') {
    const owner = await db.user.findFirstOrThrow({ where: { email: 'admin@test.local' } });
    return db.project.create({ data: { clientId: owner.clientId, ownerId: owner.id, templateId, templateVersion: version, name, taskMode: 'AUTHORING', distinctTarget: 5 } });
  }

  it('the new version stores its case selector; a new version made in the UI keeps it', async () => {
    const draft = await correctedDraft();
    expect(draft.caseSelector).toEqual(SELECTOR);
    expect((await app.inject({ method: 'POST', url: `/api/v1/templates/${draft.id}/publish`, headers: { cookie: admin, ...idem() } })).statusCode).toBe(200);
    const next = await app.inject({ method: 'POST', url: `/api/v1/templates/${draft.id}/versions`, headers: { cookie: admin, ...idem() } });
    expect(next.statusCode, next.body).toBe(201);
    expect((await db.template.findUniqueOrThrow({ where: { id: next.json().id } })).caseSelector).toEqual(SELECTOR);
  });

  it('the migration backfills the selector from the stored proposal', async () => {
    const draft = await correctedDraft();
    await db.$executeRawUnsafe(`UPDATE "Template" SET case_selector = NULL WHERE id = '${draft.id}'`);
    const sql = readFileSync(new URL('../prisma/migrations/20261126000000_template_case_selector/migration.sql', import.meta.url), 'utf8');
    await db.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE "Template"')));
    expect((await db.template.findUniqueOrThrow({ where: { id: draft.id } })).caseSelector).toEqual(SELECTOR);
  });

  it('a project gets exactly one required slot per state, in order, each naming its state', async () => {
    const draft = await correctedDraft();
    const p = await project(draft.id, draft.version);
    expect(await db.$transaction((tx) => ensureSlots(tx, p.id))).toBe(5);
    const slots = await db.coverageSlot.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } });
    expect(slots.map((s) => (s.coverageTags as { tags: Record<string, string> }).tags.governing_state)).toEqual(STATES);
    expect(slots.every((s) => !s.isOpen && s.required)).toBe(true);
    expect(slots.map((s) => (s.coverageTags as { case: unknown }).case)).toEqual(STATES.map((value) => ({ field: 'governing_state', source: 'S1.governingState', value })));
    slots.forEach((s, i) => expect(s.brief).toContain(STATES[i]));
    // Idempotent: never a second set.
    expect(await db.$transaction((tx) => ensureSlots(tx, p.id))).toBe(0);
  });

  it('submission refuses a task whose form names another state, or none; the slot state is a valid coverage value', () => {
    const template: TemplateRef = { workflowName: 'KYC onboarding and refresh', profileId: 'golden-kyc-reusable-v1', domainName: 'Banking', taskDefinitionSchema: null, collectionSchema: null, coverageDimensions: [], edgeCases: [], caseSelector: SELECTOR };
    const c = { field: 'governing_state', source: 'S1.governingState', value: 'NY' };
    const slot = { tags: { governing_state: 'NY' }, edgeCase: null, isOpen: false, case: c };
    const out = (state: string) => ({ sections: { S1: { governingState: state } } });

    const good = coverageChecks(template, slot, out('NY'));
    expect(good.every((x) => x.ok)).toBe(true);
    expect(good.map((x) => x.id)).toEqual(['coverage.values', 'case.selector']);

    const wrong = caseCheck(c, out('CA'));
    expect(wrong).toMatchObject({ id: 'case.selector', section: 'S1', ok: false });
    expect(wrong.message).toMatch(/set S1\.governingState to NY \(it is CA\)/);
    expect(caseCheck(c, {}).ok).toBe(false);
    // Without a selector the same tag would be an unknown coverage value.
    expect(coverageChecks({ ...template, caseSelector: null }, { ...slot, case: undefined }, out('NY'))[0]!.ok).toBe(false);
  });

  it('the rebuild job replaces generic slots with one per state, only before any task exists, and is audited', async () => {
    const draft = await correctedDraft();
    const p = await project(draft.id, draft.version);
    // The slots a project submitted before this change got: five generic open slots.
    await db.coverageSlot.createMany({ data: STATES.map((_, position) => ({ clientId: p.clientId, projectId: p.id, coverageTags: { tags: {}, edgeCase: null }, isOpen: true, required: false, position, brief: 'Open slot: bring a realistic case.' })) });

    const dry = await rebuildCaseSelectorSlots(db, { projectId: p.id, apply: false });
    expect(dry.outcome).toBe('would_rebuild');
    expect(await db.coverageSlot.count({ where: { projectId: p.id, isOpen: true } })).toBe(5);

    const done = await rebuildCaseSelectorSlots(db, { projectId: p.id, apply: true });
    expect(done.outcome).toBe('rebuilt');
    const slots = await db.coverageSlot.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } });
    expect(slots.map((s) => (s.coverageTags as { tags: Record<string, string> }).tags.governing_state)).toEqual(STATES);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: p.id, action: 'project.slots_rebuilt' } });
    expect(audit).toMatchObject({ actorType: 'SYSTEM', actorId: 'case-selector-slots' });

    expect((await rebuildCaseSelectorSlots(db, { projectId: p.id, apply: true })).outcome).toBe('already_per_value');
    expect(await db.auditEvent.count({ where: { entityId: p.id, action: 'project.slots_rebuilt' } })).toBe(1);
  });

  it('the rebuild job refuses once a task exists, and for templates without a selector', async () => {
    const draft = await correctedDraft();
    const p = await project(draft.id, draft.version);
    await db.coverageSlot.create({ data: { clientId: p.clientId, projectId: p.id, coverageTags: { tags: {}, edgeCase: null }, isOpen: true, brief: 'Open slot.' } });
    await db.taskInstance.create({ data: { clientId: p.clientId, projectId: p.id, taskType: 'AUTHORING' } });
    const r = await rebuildCaseSelectorSlots(db, { projectId: p.id, apply: true });
    expect(r).toMatchObject({ outcome: 'refused' });
    expect(r.reason).toMatch(/1 task/);
    expect(await db.coverageSlot.count({ where: { projectId: p.id } })).toBe(1);

    const plain = await db.template.findFirstOrThrow({ where: { lineageId: draft.lineageId, version: 1 } });
    expect(plain.caseSelector).toBeNull();
    const q = await project(plain.id, plain.version, 'Old KYC');
    expect((await rebuildCaseSelectorSlots(db, { projectId: q.id, apply: false })).outcome).toBe('refused');
  });
});
